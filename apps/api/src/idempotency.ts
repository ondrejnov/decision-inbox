interface IdempotencyEntry {
  expiresAt: number;
  sequence: number;
}

export interface IdempotencyOptions {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}

export class IdempotencyStore {
  private readonly entries = new Map<string, IdempotencyEntry>();
  private sequence = 0;
  private readonly now: () => number;

  constructor(private readonly options: IdempotencyOptions) {
    this.now = options.now ?? Date.now;
    if (options.ttlMs <= 0 || options.maxEntries <= 0) {
      throw new Error("Idempotency TTL and capacity must be positive.");
    }
  }

  get size(): number {
    this.prune();
    return this.entries.size;
  }

  has(eventId: string): boolean {
    this.prune();
    return this.entries.has(eventId);
  }

  /** Returns false when the id was already seen within the bounded TTL window. */
  remember(eventId: string): boolean {
    this.prune();
    if (this.entries.has(eventId)) return false;

    this.entries.set(eventId, {
      expiresAt: this.now() + this.options.ttlMs,
      sequence: ++this.sequence,
    });
    this.evictOldest();
    return true;
  }

  private prune(): void {
    const now = this.now();
    for (const [eventId, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(eventId);
    }
  }

  private evictOldest(): void {
    while (this.entries.size > this.options.maxEntries) {
      let oldestId: string | undefined;
      let oldestSequence = Number.POSITIVE_INFINITY;
      for (const [eventId, entry] of this.entries) {
        if (entry.sequence < oldestSequence) {
          oldestId = eventId;
          oldestSequence = entry.sequence;
        }
      }
      if (oldestId === undefined) return;
      this.entries.delete(oldestId);
    }
  }
}
