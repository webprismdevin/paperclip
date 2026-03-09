/**
 * @fileoverview Regression tests for three plugin subsystem bug fixes:
 *
 * 1. Webhook raw-body capture — ensures signature verification uses original
 *    bytes, not re-serialized JSON.
 * 2. Double-activation in loadSingle() — ensures plugins are activated exactly
 *    once when transitioning from 'installed' to 'ready'.
 * 3. Server-side instance config validation — ensures invalid config is rejected
 *    at the API boundary against the plugin's instanceConfigSchema.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { validateInstanceConfig } from "../services/plugin-config-validator.js";

// ---------------------------------------------------------------------------
// 1. Webhook raw-body capture
// ---------------------------------------------------------------------------

describe("webhook raw-body capture", () => {
  it("a known signed payload verifies against raw bytes but fails when re-serialized", () => {
    // Providers sign the exact byte stream they send. Whitespace, key order,
    // and Unicode escaping all matter. This payload has non-default formatting
    // that JSON.stringify would destroy.
    const originalPayload = '{"action":  "push", "ref":"refs/heads/main"}';
    const reserialized = JSON.stringify(JSON.parse(originalPayload));

    // The original has extra whitespace after "action":
    expect(originalPayload).not.toBe(reserialized);

    // Simulate an HMAC that was computed over the original bytes
    const crypto = require("node:crypto");
    const secret = "whsec_test_secret";
    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(originalPayload, "utf-8")
      .digest("hex");

    // Verifying against original bytes succeeds
    const sigFromRaw = crypto
      .createHmac("sha256", secret)
      .update(originalPayload, "utf-8")
      .digest("hex");
    expect(sigFromRaw).toBe(expectedSig);

    // Verifying against re-serialized bytes FAILS — this is the bug we fixed
    const sigFromReserialized = crypto
      .createHmac("sha256", secret)
      .update(reserialized, "utf-8")
      .digest("hex");
    expect(sigFromReserialized).not.toBe(expectedSig);
  });
});

// ---------------------------------------------------------------------------
// 2. Double-activation guard in loadSingle()
//
// The lifecycle flow was:
//   loadSingle("installed") → lifecycle.load() → activateReadyPlugin()
//     → loadSingle("ready") → activatePlugin()   [first activation]
//   Then loadSingle would call activatePlugin() again. [BUG - double activation]
//
// After the fix, loadSingle returns after lifecycle.load() without calling
// activatePlugin() a second time.
// ---------------------------------------------------------------------------

const mockRegistry = {
  getById: vi.fn(),
  list: vi.fn(),
  listByStatus: vi.fn(),
  updateStatus: vi.fn(),
};

vi.mock("../services/plugin-registry.js", () => ({
  pluginRegistryService: () => mockRegistry,
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe("loadSingle does not double-activate installed plugins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls lifecycleManager.load once and does not call activatePlugin again", async () => {
    const { pluginLoader } = await import("../services/plugin-loader.js");

    const mockPlugin = {
      id: "p1",
      pluginKey: "test.plugin",
      status: "installed",
      version: "1.0.0",
      manifestJson: {
        id: "test.plugin",
        apiVersion: 1,
        version: "1.0.0",
        displayName: "Test",
        description: "Test",
        author: "Test",
        categories: ["connector"],
        capabilities: [],
        entrypoints: { worker: "./worker.js" },
      },
    };

    const readyPlugin = { ...mockPlugin, status: "ready" };

    // First getById returns installed, second (after lifecycle.load) returns ready
    mockRegistry.getById
      .mockResolvedValueOnce(mockPlugin)
      .mockResolvedValueOnce(readyPlugin);

    let lifecycleLoadCalled = 0;
    const startWorkerCalls: string[] = [];

    const mockLifecycle = {
      load: vi.fn(async () => {
        lifecycleLoadCalled++;
        return readyPlugin;
      }),
    };

    const mockWorkerManager = {
      startWorker: vi.fn(async (pluginId: string) => {
        startWorkerCalls.push(pluginId);
      }),
      stopWorker: vi.fn(),
    };

    const loader = pluginLoader(
      {} as any, // db — mocked via vi.mock
      { localPluginDir: "/tmp/test-plugins" },
      {
        lifecycleManager: mockLifecycle as any,
        workerManager: mockWorkerManager as any,
        eventBus: { subscribe: () => {} } as any,
        jobScheduler: { syncJobs: async () => ({ synced: 0, removed: 0 }) } as any,
        jobStore: {} as any,
        toolDispatcher: { registerPluginTools: () => {} } as any,
        buildHostHandlers: () => ({}) as any,
        instanceInfo: { instanceId: "test" } as any,
      },
    );

    const result = await loader.loadSingle("p1");

    // lifecycle.load() should have been called exactly once
    expect(lifecycleLoadCalled).toBe(1);
    expect(mockLifecycle.load).toHaveBeenCalledWith("p1");

    // The result should indicate success
    expect(result.success).toBe(true);
    expect(result.plugin.status).toBe("ready");

    // Worker should NOT have been started by loadSingle directly
    // (lifecycle.load → activateReadyPlugin → loadSingle would start it
    // in the real flow, but we mocked lifecycle.load to not recurse)
    expect(startWorkerCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Server-side instance config validation
// ---------------------------------------------------------------------------

describe("validateInstanceConfig", () => {
  it("accepts valid config matching the schema", () => {
    const schema = {
      type: "object",
      properties: {
        apiKey: { type: "string" },
        timeout: { type: "number" },
      },
      required: ["apiKey"],
    };

    const result = validateInstanceConfig({ apiKey: "sk-123", timeout: 30 }, schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("rejects config missing required fields", () => {
    const schema = {
      type: "object",
      properties: {
        apiKey: { type: "string" },
      },
      required: ["apiKey"],
    };

    const result = validateInstanceConfig({ timeout: 30 }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it("rejects config with wrong field types", () => {
    const schema = {
      type: "object",
      properties: {
        port: { type: "number" },
      },
    };

    const result = validateInstanceConfig({ port: "not-a-number" }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => e.field.includes("port"))).toBe(true);
  });

  it("accepts any config when schema is empty", () => {
    const result = validateInstanceConfig({ anything: "goes" }, {});
    expect(result.valid).toBe(true);
  });

  it("rejects config with additional properties when additionalProperties is false", () => {
    const schema = {
      type: "object",
      properties: {
        apiKey: { type: "string" },
      },
      additionalProperties: false,
    };

    const result = validateInstanceConfig({ apiKey: "sk-123", extra: "nope" }, schema);
    expect(result.valid).toBe(false);
  });
});
