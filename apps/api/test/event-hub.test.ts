import { describe, expect, it } from "vitest";
import { EventHub } from "../src/event-hub.js";

const baseEvent = {
  schema_version: 1 as const,
  event_id: "event-1",
  transition: "created" as const,
  decision_kind: "question" as const,
  tenant_id: "tenant-1",
  external_id: "question-1",
  task_id: "task-1",
  run_id: "run-1",
  status: "pending",
  occurred_at: "2026-08-07T10:00:00.000Z",
};

describe("EventHub SSE fan-out", () => {
  it("replays tenant events by last id and never includes tenant_id", () => {
    const hub = new EventHub({ maxEventsPerTenant: 3 });
    hub.publish(baseEvent);
    hub.publish({
      ...baseEvent,
      event_id: "event-2",
      external_id: "question-2",
    });
    const replayed: unknown[] = [];

    const unsubscribe = hub.subscribe(
      "tenant-1",
      (event) => replayed.push(event),
      "event-1",
    );

    expect(replayed).toEqual([
      expect.objectContaining({
        event_id: "event-2",
        external_id: "question-2",
      }),
    ]);
    expect(replayed[0]).not.toHaveProperty("tenant_id");
    expect(hub.connectionCount).toBe(1);
    unsubscribe();
    expect(hub.connectionCount).toBe(0);
  });

  it("does not deliver events across tenants", () => {
    const hub = new EventHub();
    const tenantOne: unknown[] = [];
    hub.subscribe("tenant-1", (event) => tenantOne.push(event));
    hub.publish({ ...baseEvent, tenant_id: "tenant-2" });
    expect(tenantOne).toHaveLength(0);
  });

  it("supports a cancellation collection event without decision content", () => {
    const hub = new EventHub();
    const received: unknown[] = [];
    hub.subscribe("tenant-1", (event) => received.push(event));

    hub.publish({
      schema_version: 1,
      event_id: "event-cancelled",
      transition: "cancelled",
      tenant_id: "tenant-1",
      task_id: "task-1",
      status: "cancelled",
      occurred_at: "2026-08-07T10:00:00.000Z",
    });

    expect(received).toEqual([
      expect.objectContaining({
        event_id: "event-cancelled",
        transition: "cancelled",
      }),
    ]);
  });
});
