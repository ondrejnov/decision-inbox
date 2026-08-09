import {
  DecisionChangedEventSchema,
  DecisionChangedSseEventSchema,
  type DecisionChangedEvent,
  type DecisionChangedSseEvent,
} from "@decision-inbox/contracts";

export type EventSink = (event: DecisionChangedSseEvent) => void;

interface StoredEvent {
  event: DecisionChangedSseEvent;
}

export interface EventHubOptions {
  maxEventsPerTenant?: number;
  maxTenants?: number;
}

/** In-process tenant fan-out. It intentionally has no durable event or content store. */
export class EventHub {
  private readonly connections = new Map<string, Set<EventSink>>();
  private readonly history = new Map<string, StoredEvent[]>();
  private readonly maxEventsPerTenant: number;
  private readonly maxTenants: number;

  constructor(options: EventHubOptions = {}) {
    this.maxEventsPerTenant = options.maxEventsPerTenant ?? 100;
    this.maxTenants = options.maxTenants ?? 1_000;
  }

  publish(event: DecisionChangedEvent): void {
    const validated = DecisionChangedEventSchema.parse(event);
    const { tenant_id: tenantId, ...clientEvent } = validated;
    const sseEvent = DecisionChangedSseEventSchema.parse(clientEvent);
    let events = this.history.get(tenantId);
    if (!events) {
      if (this.history.size >= this.maxTenants) {
        const evictable =
          Array.from(this.history.keys()).find(
            (candidate) => !this.connections.has(candidate),
          ) ?? this.history.keys().next().value;
        if (evictable) this.history.delete(evictable);
      }
      events = [];
      this.history.set(tenantId, events);
    }
    events.push({ event: sseEvent });
    while (events.length > this.maxEventsPerTenant) events.shift();
    this.history.set(tenantId, events);

    for (const sink of this.connections.get(tenantId) ?? []) {
      try {
        sink(sseEvent);
      } catch {
        // A failed client must not make the webhook request retry.
      }
    }
  }

  subscribe(
    tenantId: string,
    sink: EventSink,
    lastEventId?: string,
  ): () => void {
    const connectionSet =
      this.connections.get(tenantId) ?? new Set<EventSink>();
    this.connections.set(tenantId, connectionSet);
    if (lastEventId) {
      const replay = this.history.get(tenantId) ?? [];
      let replaying = false;
      for (const stored of replay) {
        if (replaying) sink(stored.event);
        if (stored.event.event_id === lastEventId) replaying = true;
      }
    }
    connectionSet.add(sink);
    return () => {
      connectionSet.delete(sink);
      if (connectionSet.size === 0) this.connections.delete(tenantId);
    };
  }

  get connectionCount(): number {
    let count = 0;
    for (const connections of this.connections.values())
      count += connections.size;
    return count;
  }
}

export function formatSseEvent(event: DecisionChangedSseEvent): string {
  return `id: ${event.event_id}\nevent: decision.changed\ndata: ${JSON.stringify(event)}\n\n`;
}
