export interface DesktopActivityReporterOptions {
  getSystemIdleTime: () => number;
  reportPresence: (active: boolean) => Promise<void>;
  idleThresholdSeconds?: number;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  now?: () => number;
}

const DEFAULT_IDLE_THRESHOLD_SECONDS = 5 * 60;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

export class DesktopActivityReporter {
  private readonly getSystemIdleTime: () => number;
  private readonly reportPresence: (active: boolean) => Promise<void>;
  private readonly idleThresholdSeconds: number;
  private readonly pollIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly now: () => number;
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;
  private running = false;
  private systemAvailable = true;
  private lastReportedActive?: boolean;
  private lastReportedAt = 0;

  constructor(options: DesktopActivityReporterOptions) {
    this.getSystemIdleTime = options.getSystemIdleTime;
    this.reportPresence = options.reportPresence;
    this.idleThresholdSeconds =
      options.idleThresholdSeconds ?? DEFAULT_IDLE_THRESHOLD_SECONDS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.checkNow();
    this.timer = setInterval(() => void this.checkNow(), this.pollIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.lastReportedActive = undefined;
    this.lastReportedAt = 0;
  }

  async stopAndReportInactive(): Promise<void> {
    this.stop();
    await this.inFlight;
    try {
      await this.reportPresence(false);
      this.lastReportedActive = false;
      this.lastReportedAt = this.now();
    } catch {
      this.lastReportedActive = undefined;
      this.lastReportedAt = 0;
      // Presence expires server-side if shutdown/logout reporting is unavailable.
    }
  }

  setSystemAvailable(available: boolean): void {
    this.systemAvailable = available;
    if (this.running) void this.checkNow();
  }

  async checkNow(): Promise<void> {
    if (this.inFlight) {
      await this.inFlight;
      return this.checkNow();
    }

    let active = false;
    try {
      active =
        this.systemAvailable &&
        this.getSystemIdleTime() < this.idleThresholdSeconds;
    } catch {
      // Unknown OS state must not suppress a mobile notification.
    }
    const timestamp = this.now();
    const heartbeatDue =
      active && timestamp - this.lastReportedAt >= this.heartbeatIntervalMs;
    if (this.lastReportedActive === active && !heartbeatDue) return;

    const report = this.reportPresence(active)
      .then(() => {
        this.lastReportedActive = active;
        this.lastReportedAt = timestamp;
      })
      .catch(() => {
        // The next poll retries; the BFF expires stale active presence.
      })
      .finally(() => {
        if (this.inFlight === report) this.inFlight = undefined;
      });
    this.inFlight = report;
    await report;
  }
}
