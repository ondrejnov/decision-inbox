import { describe, expect, it, vi } from "vitest";
import { DesktopActivityReporter } from "../src/main/desktop-activity-reporter";

describe("desktop activity reporter", () => {
  it("uses system-wide idle time and refreshes only active heartbeats", async () => {
    let idleSeconds = 0;
    let now = 0;
    const reportPresence = vi.fn(async (_active: boolean) => undefined);
    const reporter = new DesktopActivityReporter({
      getSystemIdleTime: () => idleSeconds,
      reportPresence,
      idleThresholdSeconds: 300,
      heartbeatIntervalMs: 30_000,
      now: () => now,
    });

    await reporter.checkNow();
    expect(reportPresence).toHaveBeenLastCalledWith(true);

    now = 29_999;
    await reporter.checkNow();
    expect(reportPresence).toHaveBeenCalledTimes(1);

    now = 30_000;
    await reporter.checkNow();
    expect(reportPresence).toHaveBeenCalledTimes(2);
    expect(reportPresence).toHaveBeenLastCalledWith(true);

    idleSeconds = 300;
    await reporter.checkNow();
    expect(reportPresence).toHaveBeenLastCalledWith(false);

    now = 60_000;
    await reporter.checkNow();
    expect(reportPresence).toHaveBeenCalledTimes(3);

    idleSeconds = 0;
    await reporter.checkNow();
    expect(reportPresence).toHaveBeenCalledTimes(4);
    expect(reportPresence).toHaveBeenLastCalledWith(true);
  });

  it("reports lock and logout as inactive", async () => {
    const reportPresence = vi.fn(async (_active: boolean) => undefined);
    const reporter = new DesktopActivityReporter({
      getSystemIdleTime: () => 0,
      reportPresence,
      pollIntervalMs: 60_000,
    });

    reporter.start();
    await reporter.checkNow();
    reporter.setSystemAvailable(false);
    await vi.waitFor(() => {
      expect(reportPresence).toHaveBeenLastCalledWith(false);
    });
    await reporter.stopAndReportInactive();

    expect(reportPresence).toHaveBeenLastCalledWith(false);
    expect(
      reportPresence.mock.calls.filter(([active]) => !active),
    ).toHaveLength(2);

    reporter.setSystemAvailable(true);
    reporter.start();
    await reporter.checkNow();
    expect(reportPresence).toHaveBeenLastCalledWith(true);
    reporter.stop();
  });
});
