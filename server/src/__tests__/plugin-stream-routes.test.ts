import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginStreamBus } from "../services/plugin-stream-bus.js";
import type { PluginStreamBus } from "../services/plugin-stream-bus.js";

// ---------------------------------------------------------------------------
// Mocks — same pattern as plugins-routes.test.ts
// ---------------------------------------------------------------------------

const registry = {
  list: vi.fn(),
  listInstalled: vi.fn(),
  listByStatus: vi.fn(),
  getById: vi.fn(),
  getByKey: vi.fn(),
  getConfig: vi.fn(),
  upsertConfig: vi.fn(),
  listCompanyAvailability: vi.fn(),
  getCompanyAvailability: vi.fn(),
  updateCompanyAvailability: vi.fn(),
  seedEnabledForAllCompanies: vi.fn(),
};

const lifecycle = {
  load: vi.fn(),
  unload: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  upgrade: vi.fn(),
};

const loader = {
  installPlugin: vi.fn(),
};

const mockWorkerManager = {
  call: vi.fn(),
  getWorker: vi.fn(),
  isRunning: vi.fn(),
  startWorker: vi.fn(),
  stopWorker: vi.fn(),
  stopAll: vi.fn(),
  diagnostics: vi.fn(),
};

vi.mock("../services/plugin-registry.js", () => ({
  pluginRegistryService: vi.fn(() => registry),
}));

vi.mock("../services/plugin-lifecycle.js", () => ({
  pluginLifecycleManager: vi.fn(() => lifecycle),
}));

vi.mock("../services/plugin-loader.js", () => ({
  pluginLoader: vi.fn(() => loader),
  getPluginUiContributionMetadata: vi.fn(() => null),
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: vi.fn(),
}));

import { pluginRoutes } from "../routes/plugins.js";
import type { PluginRouteBridgeDeps } from "../routes/plugins.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockPlugin(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    pluginKey: "acme.test",
    version: "1.0.0",
    status: "ready",
    packageName: "@acme/test",
    installedAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    manifestJson: {
      id: "acme.test",
      apiVersion: 1,
      version: "1.0.0",
      displayName: "Test Plugin",
      description: "A test plugin",
      author: "Test Author",
      categories: ["connector"],
      capabilities: [],
      entrypoints: { worker: "./worker.js" },
    },
    ...overrides,
  };
}

const readyPlugin = createMockPlugin();

function createStreamApp(streamBus: PluginStreamBus) {
  const bridgeDeps: PluginRouteBridgeDeps = {
    workerManager: mockWorkerManager as any,
    streamBus,
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = {
      type: "board",
      source: "session",
      userId: "u_board",
      isInstanceAdmin: true,
      companyIds: ["c1"],
    };
    next();
  });
  app.use(pluginRoutes({} as never, loader as any, undefined, undefined, undefined, bridgeDeps));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status) || 500
      : 500;
    const message = error instanceof Error ? error.message : "Unexpected error";
    res.status(status).json({ error: message });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SSE stream bridge route", () => {
  let streamBus: PluginStreamBus;

  beforeEach(() => {
    vi.resetAllMocks();
    registry.list.mockResolvedValue([]);
    registry.listByStatus.mockResolvedValue([]);
    registry.getById.mockResolvedValue(null);
    registry.getByKey.mockResolvedValue(null);
    streamBus = createPluginStreamBus();
  });

  // -------------------------------------------------------------------------
  // Error cases
  // -------------------------------------------------------------------------

  it("returns 501 when bridge deps have no stream bus", async () => {
    const bridgeDeps: PluginRouteBridgeDeps = {
      workerManager: mockWorkerManager as any,
      // streamBus intentionally omitted
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = {
        type: "board",
        source: "session",
        userId: "u_board",
        isInstanceAdmin: true,
        companyIds: ["c1"],
      };
      next();
    });
    app.use(pluginRoutes({} as never, loader as any, undefined, undefined, undefined, bridgeDeps));

    const res = await request(app)
      .get("/plugins/p1/bridge/stream/chat")
      .query({ companyId: "c1" });

    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/stream.*not enabled/i);
  });

  it("returns 400 when companyId query param is missing", async () => {
    registry.getById.mockResolvedValueOnce(readyPlugin);
    const app = createStreamApp(streamBus);

    const res = await request(app)
      .get("/plugins/p1/bridge/stream/chat");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/companyId/i);
  });

  it("returns 404 when plugin is not found", async () => {
    const app = createStreamApp(streamBus);

    const res = await request(app)
      .get("/plugins/unknown/bridge/stream/chat")
      .query({ companyId: "c1" });

    expect(res.status).toBe(404);
  });

  // -------------------------------------------------------------------------
  // SSE connection and event delivery
  // -------------------------------------------------------------------------

  it("opens an SSE connection and receives events", async () => {
    registry.getById.mockResolvedValue(readyPlugin);
    const app = createStreamApp(streamBus);

    // Start SSE request — supertest doesn't natively support streaming,
    // so we use the raw http server and node's http client.
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;

    try {
      const chunks: string[] = [];

      await new Promise<void>((resolve, reject) => {
        const http = require("node:http");
        const req = http.get(
          `http://127.0.0.1:${port}/plugins/p1/bridge/stream/chat?companyId=c1`,
          {
            headers: {
              Accept: "text/event-stream",
              Cookie: "", // required by assertBoard
            },
          },
          (res: any) => {
            expect(res.statusCode).toBe(200);
            expect(res.headers["content-type"]).toBe("text/event-stream");
            expect(res.headers["cache-control"]).toBe("no-cache");

            res.on("data", (chunk: Buffer) => {
              chunks.push(chunk.toString());
            });

            // Wait for the initial :ok comment, then publish events
            setTimeout(() => {
              streamBus.publish("p1", "chat", "c1", { text: "hello" });
              streamBus.publish("p1", "chat", "c1", { text: "world" });

              // Give events time to flush, then close
              setTimeout(() => {
                req.destroy();
                resolve();
              }, 50);
            }, 50);
          },
        );

        req.on("error", (err: Error) => {
          // ECONNRESET is expected when we destroy the request
          if ((err as any).code !== "ECONNRESET") {
            reject(err);
          }
        });
      });

      const fullOutput = chunks.join("");
      // Should contain the initial comment
      expect(fullOutput).toContain(":ok");
      // Should contain the streamed events as SSE data lines
      expect(fullOutput).toContain('data: {"text":"hello"}');
      expect(fullOutput).toContain('data: {"text":"world"}');
    } finally {
      server.close();
    }
  });

  it("includes event type for non-message events", async () => {
    registry.getById.mockResolvedValue(readyPlugin);
    const app = createStreamApp(streamBus);

    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;

    try {
      const chunks: string[] = [];

      await new Promise<void>((resolve, reject) => {
        const http = require("node:http");
        const req = http.get(
          `http://127.0.0.1:${port}/plugins/p1/bridge/stream/chat?companyId=c1`,
          (res: any) => {
            res.on("data", (chunk: Buffer) => {
              chunks.push(chunk.toString());
            });

            setTimeout(() => {
              streamBus.publish("p1", "chat", "c1", { status: "opened" }, "open");
              streamBus.publish("p1", "chat", "c1", { token: "hi" });
              streamBus.publish("p1", "chat", "c1", { status: "closed" }, "close");

              setTimeout(() => {
                req.destroy();
                resolve();
              }, 50);
            }, 50);
          },
        );

        req.on("error", (err: Error) => {
          if ((err as any).code !== "ECONNRESET") reject(err);
        });
      });

      const fullOutput = chunks.join("");
      // "open" event type should have an event: field
      expect(fullOutput).toContain("event: open\n");
      expect(fullOutput).toContain('data: {"status":"opened"}');
      // default "message" events should NOT have an event: field
      expect(fullOutput).toContain('data: {"token":"hi"}');
      // "close" event type
      expect(fullOutput).toContain("event: close\n");
      expect(fullOutput).toContain('data: {"status":"closed"}');
    } finally {
      server.close();
    }
  });

  it("unsubscribes when client disconnects", async () => {
    registry.getById.mockResolvedValue(readyPlugin);
    const app = createStreamApp(streamBus);

    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;

    try {
      // Track calls to a spy listener we inject separately
      const spy = vi.fn();
      const unsub = streamBus.subscribe("p1", "chat", "c1", spy);

      await new Promise<void>((resolve, reject) => {
        const http = require("node:http");
        const req = http.get(
          `http://127.0.0.1:${port}/plugins/p1/bridge/stream/chat?companyId=c1`,
          (res: any) => {
            // Wait a bit then destroy the connection
            setTimeout(() => {
              req.destroy();
              // After client disconnects, publish an event
              setTimeout(() => {
                streamBus.publish("p1", "chat", "c1", { text: "after-disconnect" });
                resolve();
              }, 50);
            }, 50);
          },
        );
        req.on("error", (err: Error) => {
          if ((err as any).code !== "ECONNRESET") reject(err);
        });
      });

      // The spy listener (which was NOT the SSE route's listener) should still receive
      // events, proving the SSE route's own subscription was cleaned up independently.
      expect(spy).toHaveBeenCalledWith({ text: "after-disconnect" }, "message");

      unsub();
    } finally {
      server.close();
    }
  });

  it("does not throw when res becomes unwritable during event delivery", async () => {
    registry.getById.mockResolvedValue(readyPlugin);
    const app = createStreamApp(streamBus);

    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;

    try {
      await new Promise<void>((resolve, reject) => {
        const http = require("node:http");
        const req = http.get(
          `http://127.0.0.1:${port}/plugins/p1/bridge/stream/chat?companyId=c1`,
          (res: any) => {
            // Wait for connection, then destroy immediately and publish
            setTimeout(() => {
              req.destroy();
              // Publish rapidly after destroy — should not throw
              setTimeout(() => {
                expect(() => {
                  streamBus.publish("p1", "chat", "c1", { text: "during-close" });
                  streamBus.publish("p1", "chat", "c1", { text: "during-close-2" });
                }).not.toThrow();
                resolve();
              }, 30);
            }, 30);
          },
        );
        req.on("error", (err: Error) => {
          if ((err as any).code !== "ECONNRESET") reject(err);
        });
      });
    } finally {
      server.close();
    }
  });

  it("delivers close event type to SSE clients", async () => {
    registry.getById.mockResolvedValue(readyPlugin);
    const app = createStreamApp(streamBus);

    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;

    try {
      const chunks: string[] = [];

      await new Promise<void>((resolve, reject) => {
        const http = require("node:http");
        const req = http.get(
          `http://127.0.0.1:${port}/plugins/p1/bridge/stream/chat?companyId=c1`,
          (res: any) => {
            res.on("data", (chunk: Buffer) => {
              chunks.push(chunk.toString());
            });

            setTimeout(() => {
              // Simulate what the worker manager does on crash:
              // publish a synthetic close event
              streamBus.publish("p1", "chat", "c1", { reason: "worker_crash" }, "close");

              setTimeout(() => {
                req.destroy();
                resolve();
              }, 50);
            }, 50);
          },
        );

        req.on("error", (err: Error) => {
          if ((err as any).code !== "ECONNRESET") reject(err);
        });
      });

      const fullOutput = chunks.join("");
      expect(fullOutput).toContain("event: close\n");
      expect(fullOutput).toContain('data: {"reason":"worker_crash"}');
    } finally {
      server.close();
    }
  });
});
