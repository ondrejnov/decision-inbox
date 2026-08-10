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
  taskTitle?: string;
}

export interface NotificationManagerOptions {
  baselineStore: EncryptedValueStore;
  settings: Settings;
  isWindowActive: () => boolean;
  deliver: (summary: NotificationSummary) => void;
  resolveTaskTitle?: (
    event: DecisionChangedSseEvent,
  ) => Promise<string | undefined>;
  burstMs?: number;
}

interface PendingNotification {
  kind: DecisionKind;
  event: DecisionChangedSseEvent;
}

function keyFor(kind: DecisionKind, externalId: string): string {
  return `${kind}:${externalId}`;
}

/** Tracks only encrypted decision keys; decision text never enters notification state. */
export class NotificationManager {
  private readonly baselineStore: EncryptedValueStore;
  private readonly isWindowActive: () => boolean;
  private readonly deliver: (summary: NotificationSummary) => void;
  private readonly resolveTaskTitle:
    | ((event: DecisionChangedSseEvent) => Promise<string | undefined>)
    | undefined;
  private readonly burstMs: number;
  private settings: Settings;
  private baseline = new Set<string>();
  private loaded = false;
  private persistenceAvailable = true;
  private pendingBurst: PendingNotification[] = [];
  private burstTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: NotificationManagerOptions) {
    this.baselineStore = options.baselineStore;
    this.settings = options.settings;
    this.isWindowActive = options.isWindowActive;
    this.deliver = options.deliver;
    this.resolveTaskTitle = options.resolveTaskTitle;
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
      this.deliverSummary(
        items.map((item) => ({ kind: item.kind, taskTitle: item.taskTitle })),
      );
    } else if (newItems.length > 0) {
      this.deliverSummary(
        newItems.map((item) => ({
          kind: item.kind,
          taskTitle: item.taskTitle,
        })),
      );
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
      this.pendingBurst.push({ kind: event.decision_kind, event });
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
      const pending = this.pendingBurst;
      this.pendingBurst = [];
      if (pending.length > 0) void this.deliverBurst(pending);
    }, this.burstMs);
  }

  private async deliverBurst(
    pending: readonly PendingNotification[],
  ): Promise<void> {
    if (!this.canDeliver()) return;
    let taskTitle: string | undefined;
    if (pending.length === 1 && this.resolveTaskTitle) {
      try {
        taskTitle = await this.resolveTaskTitle(pending[0]!.event);
      } catch {
        // A failed title lookup must not suppress the generic notification.
      }
    }
    this.deliverSummary(
      pending.map((item) => ({ kind: item.kind, taskTitle })),
    );
  }

  private deliverSummary(
    notifications: readonly {
      kind: DecisionKind;
      taskTitle?: string;
    }[],
  ): void {
    if (!this.canDeliver()) return;
    const counts = new Map<DecisionKind, number>();
    for (const { kind } of notifications)
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    const orderedKinds: DecisionKind[] = [];
    for (const kind of ["question", "approval"] as const) {
      if (counts.has(kind)) orderedKinds.push(kind);
    }
    const taskTitle =
      notifications.length === 1 ? notifications[0]?.taskTitle : undefined;
    this.deliver({
      count: notifications.length,
      kinds: orderedKinds,
      ...(taskTitle ? { taskTitle } : {}),
    });
  }

  private canDeliver(): boolean {
    if (!this.persistenceAvailable || !this.settings.notificationsEnabled)
      return false;
    return !this.isWindowActive() || this.settings.notifyWhileActive;
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
