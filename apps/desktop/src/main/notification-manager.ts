import {
  DecisionChangedSseEventSchema,
  type Decision,
  type DecisionChangedSseEvent,
  type DecisionKind,
  type Settings,
} from "@decision-inbox/contracts";
import { EncryptedValueStore } from "./encrypted-store.js";

export interface NotificationSummary {
  count: number;
  kinds: DecisionKind[];
}

export interface NotificationManagerOptions {
  baselineStore: EncryptedValueStore;
  settings: Settings;
  isWindowActive: () => boolean;
  deliver: (summary: NotificationSummary) => void;
  burstMs?: number;
}

function keyFor(kind: DecisionKind, externalId: string): string {
  return `${kind}:${externalId}`;
}

/** Tracks only encrypted decision keys; decision text never enters notification state. */
export class NotificationManager {
  private readonly baselineStore: EncryptedValueStore;
  private readonly isWindowActive: () => boolean;
  private readonly deliver: (summary: NotificationSummary) => void;
  private readonly burstMs: number;
  private settings: Settings;
  private baseline = new Set<string>();
  private loaded = false;
  private persistenceAvailable = true;
  private pendingBurst = new Map<DecisionKind, number>();
  private burstTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: NotificationManagerOptions) {
    this.baselineStore = options.baselineStore;
    this.settings = options.settings;
    this.isWindowActive = options.isWindowActive;
    this.deliver = options.deliver;
    this.burstMs = options.burstMs ?? 800;
  }

  load(): void {
    let raw: string | null = null;
    try {
      raw = this.baselineStore.read();
    } catch {
      // Never fall back to plaintext. Notifications stay disabled for this session.
      this.persistenceAvailable = false;
    }
    if (raw) {
      try {
        const values = JSON.parse(raw) as unknown;
        if (Array.isArray(values)) {
          this.baseline = new Set(
            values.filter(
              (value): value is string => typeof value === "string",
            ),
          );
        }
      } catch {
        this.persistenceAvailable = false;
      }
    }
    this.loaded = true;
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
  }

  seedInitial(items: readonly Decision[]): void {
    if (!this.loaded) this.load();
    const current = new Set(
      items.map((item) => keyFor(item.kind, item.externalId)),
    );
    const newItems = items.filter(
      (item) => !this.baseline.has(keyFor(item.kind, item.externalId)),
    );
    const shouldSummarize = !this.baseline.size && current.size > 0;
    this.baseline = current;
    this.persist();
    if (shouldSummarize) {
      this.deliverSummary(items.map((item) => item.kind));
    } else if (newItems.length > 0) {
      this.deliverSummary(newItems.map((item) => item.kind));
    }
  }

  handleEvent(value: DecisionChangedSseEvent): void {
    const event = DecisionChangedSseEventSchema.parse(value);
    if (
      event.transition === "created" &&
      event.status === "pending" &&
      event.decision_kind &&
      event.external_id
    ) {
      const key = keyFor(event.decision_kind, event.external_id);
      if (this.baseline.has(key)) return;
      this.baseline.add(key);
      this.persist();
      this.pendingBurst.set(
        event.decision_kind,
        (this.pendingBurst.get(event.decision_kind) ?? 0) + 1,
      );
      this.scheduleBurst();
      return;
    }
    if (
      (event.transition === "answered" || event.transition === "cancelled") &&
      event.decision_kind &&
      event.external_id
    ) {
      const key = keyFor(event.decision_kind, event.external_id);
      this.baseline.delete(key);
      this.persist();
    }
  }

  clear(): void {
    this.baseline.clear();
    this.persist();
  }

  private scheduleBurst(): void {
    if (this.burstTimer) return;
    this.burstTimer = setTimeout(() => {
      this.burstTimer = undefined;
      const kinds: DecisionKind[] = [];
      let count = 0;
      for (const [kind, value] of this.pendingBurst) {
        count += value;
        kinds.push(kind);
      }
      this.pendingBurst.clear();
      if (count > 0)
        this.deliverSummary(
          Array.from(
            { length: count },
            (_, index) => kinds[index % kinds.length]!,
          ),
        );
    }, this.burstMs);
  }

  private deliverSummary(kinds: readonly DecisionKind[]): void {
    if (!this.persistenceAvailable) return;
    if (!this.settings.notificationsEnabled) return;
    if (this.isWindowActive() && !this.settings.notifyWhileActive) return;
    const counts = new Map<DecisionKind, number>();
    for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    const orderedKinds: DecisionKind[] = [];
    for (const kind of ["question", "approval"] as const) {
      if (counts.has(kind)) orderedKinds.push(kind);
    }
    this.deliver({ count: kinds.length, kinds: orderedKinds });
  }

  private persist(): void {
    if (!this.persistenceAvailable) return;
    try {
      this.baselineStore.write(
        JSON.stringify(Array.from(this.baseline).sort()),
      );
    } catch {
      this.persistenceAvailable = false;
    }
  }
}
