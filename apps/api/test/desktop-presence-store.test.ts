import { describe, expect, it } from "vitest";
import { DesktopPresenceStore } from "../src/desktop-presence-store.js";

describe("desktop presence store", () => {
  it("expires active heartbeats and clears explicit inactivity", () => {
    let now = 1_000;
    const presence = new DesktopPresenceStore({
      activeTtlMs: 75_000,
      now: () => now,
    });

    presence.report("tenant-1", "user-1", true);
    expect(presence.isActive("tenant-1", "user-1")).toBe(true);
    expect(presence.isActive("tenant-1", "user-2")).toBe(false);

    now += 75_000;
    expect(presence.isActive("tenant-1", "user-1")).toBe(false);

    presence.report("tenant-1", "user-1", true);
    presence.report("tenant-1", "user-1", false);
    expect(presence.isActive("tenant-1", "user-1")).toBe(false);
  });
});
