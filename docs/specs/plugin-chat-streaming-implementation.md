# Plugin Chat: Streaming Implementation Plan

## Goal

Make the chat plugin work with real-time SSE streaming instead of polling. The backend infrastructure is 100% complete — we need frontend bridge code and plugin updates.

## What Exists (Done)

| Layer | Status | Location |
|-------|--------|----------|
| SSE route | Done | `server/src/routes/plugins.ts` — `GET /api/plugins/:pluginId/bridge/stream/:channel?companyId=X` |
| Stream bus | Done | `server/src/services/plugin-stream-bus.ts` — in-memory pub/sub with `subscribe()`/`publish()` |
| Worker RPC | Done | `sdk/src/protocol.ts` — `streams.open`, `streams.emit`, `streams.close` JSON-RPC notifications |
| Worker context | Done | `sdk/src/worker-rpc-host.ts` — `ctx.streams.open/emit/close` methods |
| Worker manager | Done | `server/src/services/plugin-worker-manager.ts` — forwards notifications to stream bus, crash cleanup |
| SDK types | Done | `sdk/src/ui/types.ts` — `PluginStreamResult<T>` interface |
| SDK hook declaration | Done | `sdk/src/ui/hooks.ts` — `usePluginStream<T>(channel, options?)` |

## What's Missing (To Build)

### 1. `usePluginStream()` concrete implementation in `ui/src/plugins/bridge.ts`

Opens an `EventSource` to the SSE endpoint, accumulates events, tracks connection state.

### 2. Register `usePluginStream` in `ui/src/plugins/bridge-init.ts`

Add it to the `sdkUi` object in `initPluginBridge()`.

### 3. Update plugin worker to emit stream events

In `sendMessage` action, call `ctx.streams.emit()` inside the `onEvent` callback to push events to the UI in real-time.

### 4. Update plugin UI to consume stream events

Replace polling with `usePluginStream()` for live token-by-token updates.

## Code Changes

See the corresponding commits for the implementation.
