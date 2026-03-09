/**
 * Tests for ctx.streams (worker-side streaming API).
 *
 * Stream notifications are fire-and-forget JSON-RPC messages (no id).
 * They are sent via notifyHost() which writes to stdout synchronously
 * during handler execution — appearing BEFORE the method response.
 *
 * We use the same MockStdio approach as plugin-worker-rpc-host.test.ts
 * but read all messages and filter by type.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import type { PluginCapability, PluginCategory } from "@paperclipai/shared";
import {
  startWorkerRpcHost,
  definePlugin,
  JSONRPC_VERSION,
} from "@paperclipai/plugin-sdk";
import type {
  JsonRpcSuccessResponse,
  InitializeParams,
  WorkerRpcHost,
} from "@paperclipai/plugin-sdk";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tick = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

function makeManifest() {
  return {
    id: "test.streams",
    apiVersion: 1,
    version: "1.0.0",
    displayName: "Stream Test Plugin",
    description: "Tests ctx.streams",
    categories: ["connector" as PluginCategory],
    capabilities: [] as PluginCapability[],
    entrypoints: { worker: "dist/worker.js" },
  };
}

function makeInitializeParams(): InitializeParams {
  return {
    manifest: makeManifest(),
    config: {},
    instanceInfo: { instanceId: "inst-1", hostVersion: "1.0.0" },
    apiVersion: 1,
  };
}

class MockStdio {
  workerStdin: PassThrough;
  workerStdout: PassThrough;
  private _outBuffer = "";
  private _outWaiters: Array<(data: string) => void> = [];

  constructor() {
    this.workerStdin = new PassThrough();
    this.workerStdout = new PassThrough();
    this.workerStdout.on("data", (chunk: Buffer) => {
      this._outBuffer += chunk.toString();
      this._flushWaiters();
    });
  }

  private _flushWaiters(): void {
    while (this._outWaiters.length > 0 && this._outBuffer.includes("\n")) {
      const idx = this._outBuffer.indexOf("\n");
      const line = this._outBuffer.slice(0, idx);
      this._outBuffer = this._outBuffer.slice(idx + 1);
      const waiter = this._outWaiters.shift()!;
      waiter(line);
    }
  }

  sendToWorker(message: unknown): void {
    this.workerStdin.write(JSON.stringify(message) + "\n");
  }

  readNextMessage<T = unknown>(): Promise<T> {
    return new Promise((resolve) => {
      if (this._outBuffer.includes("\n")) {
        const idx = this._outBuffer.indexOf("\n");
        const line = this._outBuffer.slice(0, idx);
        this._outBuffer = this._outBuffer.slice(idx + 1);
        resolve(JSON.parse(line) as T);
      } else {
        this._outWaiters.push((line) => resolve(JSON.parse(line) as T));
      }
    });
  }

  async initialize(): Promise<JsonRpcSuccessResponse> {
    this.sendToWorker({ jsonrpc: JSONRPC_VERSION, id: 1, method: "initialize", params: makeInitializeParams() });
    return this.readNextMessage<JsonRpcSuccessResponse>();
  }

  /**
   * Send a request and collect ALL messages until we find the response (by id).
   * Returns both the response and any notifications that arrived.
   */
  async requestCollectAll(
    id: number,
    method: string,
    params: unknown,
  ): Promise<{ response: any; notifications: any[] }> {
    this.sendToWorker({ jsonrpc: JSONRPC_VERSION, id, method, params });

    const notifications: any[] = [];
    // Keep reading until we find our response
    for (;;) {
      const msg = await this.readNextMessage<any>();
      if (msg.id === id) {
        return { response: msg, notifications };
      }
      notifications.push(msg);
    }
  }

  destroy(): void {
    this.workerStdin.destroy();
    this.workerStdout.destroy();
    this._outWaiters = [];
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let processExitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
});

afterEach(() => {
  processExitSpy.mockRestore();
});

describe("ctx.streams notifications", () => {
  let stdio: MockStdio;
  let host: WorkerRpcHost;

  beforeEach(() => {
    stdio = new MockStdio();
  });

  afterEach(() => {
    if (host?.running) host.stop();
    stdio.destroy();
  });

  it("ctx.streams has open, emit, close methods", async () => {
    let receivedCtx: any;
    const plugin = definePlugin({
      async setup(ctx) { receivedCtx = ctx; },
    });
    host = startWorkerRpcHost({ plugin, stdin: stdio.workerStdin, stdout: stdio.workerStdout });
    await stdio.initialize();
    expect(typeof receivedCtx.streams.open).toBe("function");
    expect(typeof receivedCtx.streams.emit).toBe("function");
    expect(typeof receivedCtx.streams.close).toBe("function");
  });

  it("ctx.streams.open sends a streams.open notification", async () => {
    const plugin = definePlugin({
      async setup(ctx) {
        ctx.actions.register("go", async () => {
          ctx.streams.open("events", "comp-1");
          return { ok: true };
        });
      },
    });
    host = startWorkerRpcHost({ plugin, stdin: stdio.workerStdin, stdout: stdio.workerStdout });
    await stdio.initialize();

    const { notifications } = await stdio.requestCollectAll(10, "performAction", { key: "go", params: {} });

    expect(notifications).toHaveLength(1);
    expect(notifications[0].method).toBe("streams.open");
    expect(notifications[0].params).toEqual({ channel: "events", companyId: "comp-1" });
    expect(notifications[0].id).toBeUndefined();
  });

  it("ctx.streams.emit carries companyId from open", async () => {
    const plugin = definePlugin({
      async setup(ctx) {
        ctx.actions.register("go", async () => {
          ctx.streams.open("ch", "comp-2");
          ctx.streams.emit("ch", { token: "hi" });
          return { ok: true };
        });
      },
    });
    host = startWorkerRpcHost({ plugin, stdin: stdio.workerStdin, stdout: stdio.workerStdout });
    await stdio.initialize();

    const { notifications } = await stdio.requestCollectAll(10, "performAction", { key: "go", params: {} });

    expect(notifications).toHaveLength(2);
    const emitNotif = notifications.find((n) => n.method === "streams.emit");
    expect(emitNotif).toBeDefined();
    expect(emitNotif!.params.channel).toBe("ch");
    expect(emitNotif!.params.companyId).toBe("comp-2");
    expect(emitNotif!.params.event).toEqual({ token: "hi" });
  });

  it("ctx.streams.close clears channel mapping", async () => {
    const plugin = definePlugin({
      async setup(ctx) {
        ctx.actions.register("go", async () => {
          ctx.streams.open("ch", "comp-3");
          ctx.streams.close("ch");
          // After close, emit should have empty companyId
          ctx.streams.emit("ch", { after: true });
          return { ok: true };
        });
      },
    });
    host = startWorkerRpcHost({ plugin, stdin: stdio.workerStdin, stdout: stdio.workerStdout });
    await stdio.initialize();

    const { notifications } = await stdio.requestCollectAll(10, "performAction", { key: "go", params: {} });

    expect(notifications).toHaveLength(3);

    const closeNotif = notifications.find((n) => n.method === "streams.close");
    expect(closeNotif).toBeDefined();
    expect(closeNotif!.params.companyId).toBe("comp-3");

    const emitNotif = notifications.find((n) => n.method === "streams.emit");
    expect(emitNotif).toBeDefined();
    expect(emitNotif!.params.companyId).toBe(""); // cleared by close
  });

  it("emit before open uses empty companyId", async () => {
    const plugin = definePlugin({
      async setup(ctx) {
        ctx.actions.register("go", async () => {
          ctx.streams.emit("orphan", { x: 1 });
          return { ok: true };
        });
      },
    });
    host = startWorkerRpcHost({ plugin, stdin: stdio.workerStdin, stdout: stdio.workerStdout });
    await stdio.initialize();

    const { notifications } = await stdio.requestCollectAll(10, "performAction", { key: "go", params: {} });

    expect(notifications).toHaveLength(1);
    expect(notifications[0].method).toBe("streams.emit");
    expect(notifications[0].params.companyId).toBe("");
  });

  it("multiple channels maintain independent companyId mappings", async () => {
    const plugin = definePlugin({
      async setup(ctx) {
        ctx.actions.register("go", async () => {
          ctx.streams.open("ch-a", "comp-a");
          ctx.streams.open("ch-b", "comp-b");
          ctx.streams.emit("ch-a", { type: "a" });
          ctx.streams.emit("ch-b", { type: "b" });
          return { ok: true };
        });
      },
    });
    host = startWorkerRpcHost({ plugin, stdin: stdio.workerStdin, stdout: stdio.workerStdout });
    await stdio.initialize();

    const { notifications } = await stdio.requestCollectAll(10, "performAction", { key: "go", params: {} });

    expect(notifications).toHaveLength(4);

    const emits = notifications.filter((n) => n.method === "streams.emit");
    const emitA = emits.find((n) => n.params.channel === "ch-a");
    const emitB = emits.find((n) => n.params.channel === "ch-b");

    expect(emitA!.params.companyId).toBe("comp-a");
    expect(emitB!.params.companyId).toBe("comp-b");
  });
});
