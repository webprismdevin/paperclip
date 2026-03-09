import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPluginDevWatcher } from "../services/plugin-dev-watcher.js";

type LifecycleListener = (payload: { pluginId: string; pluginKey: string }) => void;

const lifecycleListeners = new Map<string, LifecycleListener>();
const lifecycle = {
  on: vi.fn((event: string, listener: LifecycleListener) => {
    lifecycleListeners.set(event, listener);
  }),
  off: vi.fn((event: string, listener: LifecycleListener) => {
    if (lifecycleListeners.get(event) === listener) {
      lifecycleListeners.delete(event);
    }
  }),
  restartWorker: vi.fn().mockResolvedValue(undefined),
} as const;

const closeWatcher = vi.fn();
const existsSyncMock = vi.fn<(path: string) => boolean>();
const watchMock = vi.fn();

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("plugin-dev-watcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lifecycleListeners.clear();
    existsSyncMock.mockReturnValue(true);
    watchMock.mockReturnValue({ close: closeWatcher });
  });

  it("starts watching local-path plugins when they are loaded after startup", async () => {
    const resolvePluginPackagePath = vi.fn().mockResolvedValue("/tmp/plugin-local");
    const devWatcher = createPluginDevWatcher(
      lifecycle as never,
      resolvePluginPackagePath,
      {
        existsSync: existsSyncMock,
        watch: watchMock as never,
      },
    );

    lifecycleListeners.get("plugin.loaded")?.({
      pluginId: "p1",
      pluginKey: "acme.test",
    });
    await flushMicrotasks();

    expect(resolvePluginPackagePath).toHaveBeenCalledWith("p1");
    expect(watchMock).toHaveBeenCalledWith(
      "/tmp/plugin-local",
      { recursive: true },
      expect.any(Function),
    );

    devWatcher.close();
  });

  it("does not double-watch the same plugin when multiple ready-state events fire", async () => {
    const resolvePluginPackagePath = vi.fn().mockResolvedValue("/tmp/plugin-local");
    const devWatcher = createPluginDevWatcher(
      lifecycle as never,
      resolvePluginPackagePath,
      {
        existsSync: existsSyncMock,
        watch: watchMock as never,
      },
    );

    lifecycleListeners.get("plugin.loaded")?.({
      pluginId: "p1",
      pluginKey: "acme.test",
    });
    lifecycleListeners.get("plugin.enabled")?.({
      pluginId: "p1",
      pluginKey: "acme.test",
    });
    await flushMicrotasks();

    expect(watchMock).toHaveBeenCalledTimes(1);

    devWatcher.close();
  });

  it("unwatches local plugins on disable/unload and unsubscribes listeners on close", async () => {
    const resolvePluginPackagePath = vi.fn().mockResolvedValue("/tmp/plugin-local");
    const devWatcher = createPluginDevWatcher(
      lifecycle as never,
      resolvePluginPackagePath,
      {
        existsSync: existsSyncMock,
        watch: watchMock as never,
      },
    );

    lifecycleListeners.get("plugin.enabled")?.({
      pluginId: "p1",
      pluginKey: "acme.test",
    });
    await flushMicrotasks();

    lifecycleListeners.get("plugin.disabled")?.({
      pluginId: "p1",
      pluginKey: "acme.test",
    });

    expect(closeWatcher).toHaveBeenCalledTimes(1);

    devWatcher.close();

    expect(lifecycle.off).toHaveBeenCalledWith("plugin.loaded", expect.any(Function));
    expect(lifecycle.off).toHaveBeenCalledWith("plugin.enabled", expect.any(Function));
    expect(lifecycle.off).toHaveBeenCalledWith("plugin.disabled", expect.any(Function));
    expect(lifecycle.off).toHaveBeenCalledWith("plugin.unloaded", expect.any(Function));
  });
});
