# Plugin Stream Bus: Missing Wiring in `app.ts`

**Status:** Bug / missing wiring — the implementation exists but is never connected
**Affects:** Any plugin using `ctx.streams.emit()` to push real-time events to the UI
**Severity:** All plugin SSE streaming is silently broken (endpoint returns 501)

---

## Summary

The plugin SDK exposes a complete streaming API (`ctx.streams.open/emit/close` on the worker side, `usePluginStream()` on the UI side), backed by an SSE endpoint at `GET /api/plugins/:pluginId/bridge/stream/:channel`. The entire pipeline is implemented:

- `PluginStreamBus` (`server/src/services/plugin-stream-bus.ts`) — in-memory pub/sub
- Worker RPC host handles `streams.open/emit/close` JSON-RPC notifications
- `plugin-worker-manager.ts` tracks open channels and supports `onStreamNotification` callback
- `plugins.ts` SSE route subscribes to the stream bus and fans out to connected clients

**But `app.ts` never creates a `PluginStreamBus` instance or wires the callback.** The SSE route checks `bridgeDeps?.streamBus` and returns 501.

## What's Missing

Three things in `server/src/app.ts`:

### 1. Create the stream bus

```typescript
import { createPluginStreamBus } from "./services/plugin-stream-bus.js";

const streamBus = createPluginStreamBus();
```

### 2. Route worker stream notifications to the bus

The worker manager needs to know what to do when a worker sends `streams.open/emit/close` notifications. Currently `onStreamNotification` is a per-worker option on `WorkerStartOptions`, but there's no manager-level equivalent — so the plugin loader never sets it.

Either:

**(a) Add `onStreamNotification` to `PluginWorkerManagerOptions`** and have the manager auto-inject it into per-worker options (this is what we did locally):

```typescript
// In plugin-worker-manager.ts PluginWorkerManagerOptions:
onStreamNotification?: (pluginId: string, method: string, params: Record<string, unknown>) => void;

// In startWorker(), before createPluginWorkerHandle:
if (!options.onStreamNotification && managerOptions?.onStreamNotification) {
  const managerCb = managerOptions.onStreamNotification;
  options = {
    ...options,
    onStreamNotification: (method, params) => managerCb(pluginId, method, params),
  };
}
```

**(b) Or add it to `PluginRuntimeServices`** and have the plugin loader pass it when building worker options. This is arguably cleaner but touches more files.

### 3. Pass `streamBus` in bridge deps

```typescript
// In app.ts where pluginRoutes is mounted:
pluginRoutes(
  db,
  loader,
  { scheduler, jobStore },
  { workerManager },
  { toolDispatcher },
  { workerManager, streamBus },  // bridgeDeps — was just { workerManager }
);
```

## Data Flow (When Wired)

```
Worker: ctx.streams.emit("chat:threadId", { type: "text", text: "Hello" })
  → JSON-RPC notification: { method: "streams.emit", params: { channel, companyId, event } }
  → plugin-worker-manager.ts onStreamNotification callback
  → streamBus.publish(pluginId, channel, companyId, event)
  → SSE route subscriber writes: data: {"type":"text","text":"Hello"}\n\n
  → Browser EventSource receives event
  → usePluginStream() hook returns it in events array
```

## Impact

Without this wiring, **no plugin can use real-time streaming**. `ctx.streams.emit()` calls silently go nowhere, and `usePluginStream()` connections get 501. Plugins must fall back to polling `usePluginData()` with `refresh()`.

## Files to Change

| File | Change |
|------|--------|
| `server/src/app.ts` | Create `streamBus`, pass `onStreamNotification` to worker manager, pass `streamBus` in `bridgeDeps` |
| `server/src/services/plugin-worker-manager.ts` | Add `onStreamNotification` to `PluginWorkerManagerOptions`, inject into per-worker options |

Total: ~20 lines across 2 files. No new dependencies. No behavior changes for existing plugins (they weren't using streaming because it didn't work).
