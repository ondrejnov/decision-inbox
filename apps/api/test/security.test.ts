import { describe, expect, it } from "vitest";
import { isIpAllowed } from "../src/ip-allowlist.js";
import { IdempotencyStore } from "../src/idempotency.js";

describe("webhook security helpers", () => {
  it("matches exact IPs and CIDR ranges without trusting arbitrary proxy headers", () => {
    expect(isIpAllowed("203.0.113.8", ["203.0.113.8"])).toBe(true);
    expect(isIpAllowed("203.0.113.8", ["203.0.113.0/24"])).toBe(true);
    expect(isIpAllowed("10.244.11.73", ["10.0.0.0/8"])).toBe(true);
    expect(isIpAllowed("10.244.11.73", ["0.0.0.0/0"])).toBe(true);
    expect(isIpAllowed("198.51.100.8", ["203.0.113.0/24"])).toBe(false);
    expect(isIpAllowed("203.0.113.8", [])).toBe(false);
  });

  it("expires and bounds webhook event ids in memory", () => {
    let now = 1_000;
    const store = new IdempotencyStore({
      ttlMs: 100,
      maxEntries: 2,
      now: () => now,
    });

    expect(store.remember("event-1")).toBe(true);
    expect(store.remember("event-1")).toBe(false);
    now += 101;
    expect(store.remember("event-1")).toBe(true);
    expect(store.size).toBe(1);
    store.remember("event-2");
    store.remember("event-3");
    expect(store.size).toBe(2);
    expect(store.has("event-1")).toBe(false);
    expect(store.has("event-2")).toBe(true);
    expect(store.has("event-3")).toBe(true);
  });
});
