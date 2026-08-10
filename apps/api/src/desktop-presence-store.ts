export interface DesktopPresence {
  report(tenantId: string, userId: string, active: boolean): void;
  isActive(tenantId: string, userId: string): boolean;
}

export interface DesktopPresenceStoreOptions {
  activeTtlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

const DEFAULT_ACTIVE_TTL_MS = 75_000;
const DEFAULT_MAX_ENTRIES = 10_000;

function presenceKey(tenantId: string, userId: string): string {
  return `${tenantId.length}:${tenantId}${userId}`;
}

/** Ephemeral presence: an absent or expired heartbeat always allows mobile push. */
export class DesktopPresenceStore implements DesktopPresence {
  private readonly activeUntil = new Map<string, number>();
  private readonly activeTtlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: DesktopPresenceStoreOptions = {}) {
    this.activeTtlMs = options.activeTtlMs ?? DEFAULT_ACTIVE_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
    if (!Number.isInteger(this.activeTtlMs) || this.activeTtlMs < 1) {
      throw new RangeError("activeTtlMs must be a positive integer.");
    }
    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new RangeError("maxEntries must be a positive integer.");
    }
  }

  report(tenantId: string, userId: string, active: boolean): void {
    const key = presenceKey(tenantId, userId);
    this.activeUntil.delete(key);
    if (!active) return;

    while (this.activeUntil.size >= this.maxEntries) {
      const oldest = this.activeUntil.keys().next().value;
      if (oldest === undefined) break;
      this.activeUntil.delete(oldest);
    }
    this.activeUntil.set(key, this.now() + this.activeTtlMs);
  }

  isActive(tenantId: string, userId: string): boolean {
    const key = presenceKey(tenantId, userId);
    const activeUntil = this.activeUntil.get(key);
    if (activeUntil === undefined) return false;
    if (activeUntil <= this.now()) {
      this.activeUntil.delete(key);
      return false;
    }
    return true;
  }
}
