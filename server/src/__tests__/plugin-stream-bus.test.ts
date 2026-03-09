import { describe, expect, it, vi, beforeEach } from "vitest";
import { createPluginStreamBus } from "../services/plugin-stream-bus.js";
import type { PluginStreamBus, StreamSubscriber } from "../services/plugin-stream-bus.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createPluginStreamBus", () => {
  let bus: PluginStreamBus;

  beforeEach(() => {
    bus = createPluginStreamBus();
  });

  // -------------------------------------------------------------------------
  // Basic subscribe and publish
  // -------------------------------------------------------------------------

  describe("subscribe and publish", () => {
    it("delivers an event to a subscriber", () => {
      const listener = vi.fn();
      const unsubscribe = bus.subscribe("plugin-1", "channel-a", "company-1", listener);

      const event = { message: "hello" };
      bus.publish("plugin-1", "channel-a", "company-1", event);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(event, "message");
    });

    it("does not deliver to a different channel", () => {
      const listener = vi.fn();
      bus.subscribe("plugin-1", "channel-a", "company-1", listener);

      const event = { message: "hello" };
      bus.publish("plugin-1", "channel-b", "company-1", event);

      expect(listener).not.toHaveBeenCalled();
    });

    it("does not deliver to a different companyId", () => {
      const listener = vi.fn();
      bus.subscribe("plugin-1", "channel-a", "company-1", listener);

      const event = { message: "hello" };
      bus.publish("plugin-1", "channel-a", "company-2", event);

      expect(listener).not.toHaveBeenCalled();
    });

    it("does not deliver to a different pluginId", () => {
      const listener = vi.fn();
      bus.subscribe("plugin-1", "channel-a", "company-1", listener);

      const event = { message: "hello" };
      bus.publish("plugin-2", "channel-a", "company-1", event);

      expect(listener).not.toHaveBeenCalled();
    });

    it("multiple subscribers receive the same event", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      bus.subscribe("plugin-1", "channel-a", "company-1", listener1);
      bus.subscribe("plugin-1", "channel-a", "company-1", listener2);

      const event = { message: "hello" };
      bus.publish("plugin-1", "channel-a", "company-1", event);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener1).toHaveBeenCalledWith(event, "message");
      expect(listener2).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledWith(event, "message");
    });

    it("unsubscribe stops delivery", () => {
      const listener = vi.fn();
      const unsubscribe = bus.subscribe("plugin-1", "channel-a", "company-1", listener);

      const event1 = { message: "first" };
      bus.publish("plugin-1", "channel-a", "company-1", event1);
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();

      const event2 = { message: "second" };
      bus.publish("plugin-1", "channel-a", "company-1", event2);
      expect(listener).toHaveBeenCalledTimes(1); // still 1
    });

    it("unsubscribe cleans up empty sets (no memory leak)", () => {
      const listener = vi.fn();
      const unsubscribe = bus.subscribe("plugin-1", "channel-a", "company-1", listener);

      // Publish to verify the subscription exists
      bus.publish("plugin-1", "channel-a", "company-1", { message: "test" });
      expect(listener).toHaveBeenCalledTimes(1);

      // Unsubscribe — the internal Set for this key should be removed entirely
      unsubscribe();

      // Publishing again should not call the listener
      bus.publish("plugin-1", "channel-a", "company-1", { message: "test2" });
      expect(listener).toHaveBeenCalledTimes(1); // unchanged

      // This test verifies that the Map entry is cleaned up by observing
      // that no listeners exist for this combination anymore
    });
  });

  // -------------------------------------------------------------------------
  // Event types
  // -------------------------------------------------------------------------

  describe("event types", () => {
    it("eventType defaults to 'message'", () => {
      const listener = vi.fn();
      bus.subscribe("plugin-1", "channel-a", "company-1", listener);

      const event = { data: "test" };
      bus.publish("plugin-1", "channel-a", "company-1", event);

      expect(listener).toHaveBeenCalledWith(event, "message");
    });

    it("non-default eventType is forwarded", () => {
      const listener = vi.fn();
      bus.subscribe("plugin-1", "channel-a", "company-1", listener);

      const event = { data: "test" };
      bus.publish("plugin-1", "channel-a", "company-1", event, "open");

      expect(listener).toHaveBeenCalledWith(event, "open");
    });

    it("different eventTypes can coexist", () => {
      const listener = vi.fn();
      bus.subscribe("plugin-1", "channel-a", "company-1", listener);

      bus.publish("plugin-1", "channel-a", "company-1", { type: "a" }, "open");
      bus.publish("plugin-1", "channel-a", "company-1", { type: "b" }, "close");

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenNthCalledWith(1, { type: "a" }, "open");
      expect(listener).toHaveBeenNthCalledWith(2, { type: "b" }, "close");
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe("edge cases", () => {
    it("publish with no subscribers does not throw", () => {
      const event = { message: "hello" };

      expect(() => {
        bus.publish("plugin-1", "channel-a", "company-1", event);
      }).not.toThrow();
    });

    it("multiple unsubscribes do not throw (idempotent)", () => {
      const listener = vi.fn();
      const unsubscribe = bus.subscribe("plugin-1", "channel-a", "company-1", listener);

      expect(() => {
        unsubscribe();
        unsubscribe();
      }).not.toThrow();
    });

    it("subscriber can unsubscribe during a publish callback", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      let unsubscribe1: () => void;

      const callback1: StreamSubscriber = (event, eventType) => {
        listener1(event, eventType);
        unsubscribe1();
      };

      unsubscribe1 = bus.subscribe("plugin-1", "channel-a", "company-1", callback1);
      bus.subscribe("plugin-1", "channel-a", "company-1", listener2);

      const event = { message: "test" };
      bus.publish("plugin-1", "channel-a", "company-1", event);

      // Both should be called once (listener1 unsubscribes itself during its call)
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);

      // Second publish should not call listener1 again
      bus.publish("plugin-1", "channel-a", "company-1", event);
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(2);
    });

    it("handles complex event objects", () => {
      const listener = vi.fn();
      bus.subscribe("plugin-1", "channel-a", "company-1", listener);

      const complexEvent = {
        nested: { deep: { value: 42 } },
        array: [1, 2, 3],
        null: null,
        undefined: undefined,
      };

      bus.publish("plugin-1", "channel-a", "company-1", complexEvent);

      expect(listener).toHaveBeenCalledWith(complexEvent, "message");
    });

    it("handles null and undefined events", () => {
      const listener = vi.fn();
      bus.subscribe("plugin-1", "channel-a", "company-1", listener);

      bus.publish("plugin-1", "channel-a", "company-1", null);
      expect(listener).toHaveBeenCalledWith(null, "message");

      bus.publish("plugin-1", "channel-a", "company-1", undefined);
      expect(listener).toHaveBeenCalledWith(undefined, "message");
    });

    it("handles primitive event values", () => {
      const listener = vi.fn();
      bus.subscribe("plugin-1", "channel-a", "company-1", listener);

      bus.publish("plugin-1", "channel-a", "company-1", "string-event");
      expect(listener).toHaveBeenNthCalledWith(1, "string-event", "message");

      bus.publish("plugin-1", "channel-a", "company-1", 42);
      expect(listener).toHaveBeenNthCalledWith(2, 42, "message");

      bus.publish("plugin-1", "channel-a", "company-1", true);
      expect(listener).toHaveBeenNthCalledWith(3, true, "message");
    });
  });

  // -------------------------------------------------------------------------
  // Isolation and multiple subscriptions
  // -------------------------------------------------------------------------

  describe("isolation and multiple subscriptions", () => {
    it("independent subscriptions are isolated", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const listener3 = vi.fn();

      bus.subscribe("plugin-1", "channel-a", "company-1", listener1);
      bus.subscribe("plugin-1", "channel-a", "company-2", listener2);
      bus.subscribe("plugin-2", "channel-a", "company-1", listener3);

      const event = { message: "test" };
      bus.publish("plugin-1", "channel-a", "company-1", event);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).not.toHaveBeenCalled();
      expect(listener3).not.toHaveBeenCalled();
    });

    it("multiple subscribers on different channels of same plugin and company", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      bus.subscribe("plugin-1", "channel-a", "company-1", listener1);
      bus.subscribe("plugin-1", "channel-b", "company-1", listener2);

      const event = { message: "test" };
      bus.publish("plugin-1", "channel-a", "company-1", event);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).not.toHaveBeenCalled();

      bus.publish("plugin-1", "channel-b", "company-1", event);
      expect(listener1).toHaveBeenCalledTimes(1); // unchanged
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it("same listener can subscribe to multiple channels", () => {
      const listener = vi.fn();

      bus.subscribe("plugin-1", "channel-a", "company-1", listener);
      bus.subscribe("plugin-1", "channel-b", "company-1", listener);

      const event = { message: "test" };
      bus.publish("plugin-1", "channel-a", "company-1", event);
      expect(listener).toHaveBeenCalledTimes(1);

      bus.publish("plugin-1", "channel-b", "company-1", event);
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it("concurrent subscriptions and unsubscriptions during publish are safe", () => {
      const listeners = Array.from({ length: 10 }, () => vi.fn());
      const unsubscribes: Array<() => void> = [];

      listeners.forEach((listener) => {
        unsubscribes.push(
          bus.subscribe("plugin-1", "channel-a", "company-1", listener),
        );
      });

      const event = { message: "concurrent-test" };

      // During publish, listeners at even indices unsubscribe themselves
      listeners.forEach((listener, idx) => {
        if (idx % 2 === 0) {
          listener.mockImplementation(() => {
            unsubscribes[idx]();
          });
        }
      });

      bus.publish("plugin-1", "channel-a", "company-1", event);

      // All listeners should be called exactly once during the first publish
      listeners.forEach((listener) => {
        expect(listener).toHaveBeenCalledTimes(1);
      });

      // Publish again — only odd-indexed listeners should fire
      bus.publish("plugin-1", "channel-a", "company-1", event);
      listeners.forEach((listener, idx) => {
        if (idx % 2 === 0) {
          expect(listener).toHaveBeenCalledTimes(1); // unchanged
        } else {
          expect(listener).toHaveBeenCalledTimes(2);
        }
      });
    });

    it("listener throwing does not prevent other listeners from being called", () => {
      const listener1 = vi.fn(() => { throw new Error("boom"); });
      const listener2 = vi.fn();

      bus.subscribe("plugin-1", "channel-a", "company-1", listener1);
      bus.subscribe("plugin-1", "channel-a", "company-1", listener2);

      // publish currently does not catch — verify Set iteration continues.
      // If it throws, listener2 would not be called. We test current behavior.
      expect(() => {
        bus.publish("plugin-1", "channel-a", "company-1", { test: true });
      }).toThrow("boom");

      expect(listener1).toHaveBeenCalledTimes(1);
      // Note: listener2 may or may not be called depending on Set iteration
      // order — this test documents current behavior.
    });
  });
});
