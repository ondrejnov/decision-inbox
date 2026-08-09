import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type {
  DecisionChangedEvent,
  DecisionListResponse,
  ResolveRequest,
  ResolveResponse,
  SessionResponse,
} from "@decision-inbox/contracts";
import { createApp, type AgentisGateway } from "../src/server.js";
import { AgentisRpcError } from "../src/agentis-client.js";

const session: SessionResponse = {
  authenticated: true,
  user: { id: "user-1", displayName: "Ada Lovelace" },
  tenant: { id: "tenant-1", name: "Example tenant" },
};

const list: DecisionListResponse = {
  items: [],
  page: 1,
  pageSize: 20,
  hasNext: false,
};

function gateway(overrides: Partial<AgentisGateway> = {}): AgentisGateway {
  return {
    getSession: async () => session,
    getDecisions: async () => list,
    getPendingCount: async () => ({ count: 0 }),
    resolve: async (
      _token: string,
      request: ResolveRequest,
    ): Promise<ResolveResponse> => ({
      ok: true,
      externalId: request.externalId,
      status: "answered",
    }),
    ...overrides,
  };
}

const event: DecisionChangedEvent = {
  schema_version: 1,
  event_id: "event-1",
  transition: "created",
  decision_kind: "question",
  tenant_id: "tenant-1",
  external_id: "question-1",
  task_id: "task-1",
  run_id: "run-1",
  status: "pending",
  occurred_at: "2026-08-07T10:00:00.000Z",
};

describe("BFF routes", () => {
  it("requires an Agentis token for session, decisions, count, resolve, and SSE", async () => {
    const app = await createApp({ agentis: gateway() });

    for (const request of [
      { method: "GET", url: "/v1/session" },
      { method: "GET", url: "/v1/decisions" },
      { method: "GET", url: "/v1/decisions/pending-count" },
      { method: "GET", url: "/v1/events" },
      { method: "POST", url: "/v1/decisions/resolve", payload: {} },
    ]) {
      const response = await app.inject(request);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: {
          code: "unauthorized",
          message: "Agentis authentication is required.",
        },
      });
    }
    await app.close();
  });

  it("forwards the normalized list query and returns the BFF contract", async () => {
    let received: { token: string; view: string; page: number } | undefined;
    const app = await createApp({
      agentis: gateway({
        getDecisions: async (token, view, page) => {
          received = { token, view, page };
          return { ...list, page };
        },
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/decisions?view=history&page=3",
      headers: { "x-auth-token": "user-secret" },
    });

    expect(response.statusCode).toBe(200);
    expect(received).toEqual({
      token: "user-secret",
      view: "history",
      page: 3,
    });
    expect(response.json()).toMatchObject({ page: 3, pageSize: 20 });
    await app.close();
  });

  it("preserves stale resolution errors for inline client handling", async () => {
    const app = await createApp({
      agentis: gateway({
        resolve: async () => {
          throw new AgentisRpcError(
            409,
            "decision_cancelled",
            "The decision was cancelled.",
          );
        },
      }),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/decisions/resolve",
      headers: { "x-auth-token": "user-secret" },
      payload: {
        decisionKind: "approval",
        externalId: "approval-1",
        taskId: "task-1",
        runId: "run-1",
        action: "approve",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: "decision_cancelled",
        message: "The decision was cancelled.",
      },
    });
    await app.close();
  });

  it("validates, allowlists, deduplicates, and tenant-scopes webhook events", async () => {
    const app = await createApp({
      agentis: gateway(),
      webhookAllowedIps: ["127.0.0.1/32"],
    });
    const received: unknown[] = [];
    app.eventHub.subscribe("tenant-1", (value) => received.push(value));

    const first = await app.inject({
      method: "POST",
      url: "/v1/webhooks/agentis/decision-changed",
      headers: { "x-forwarded-for": "198.51.100.20" },
      payload: event,
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/webhooks/agentis/decision-changed",
      payload: event,
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/webhooks/agentis/decision-changed",
      payload: { ...event, tenant_id: undefined },
    });

    expect(first.statusCode).toBe(202);
    expect(duplicate.statusCode).toBe(202);
    expect(duplicate.json()).toEqual({ accepted: true, deduplicated: true });
    expect(invalid.statusCode).toBe(400);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(
      expect.not.objectContaining({ tenant_id: "tenant-1" }),
    );
    await app.close();
  });

  it("logs why a webhook source was rejected without logging its payload", async () => {
    const logLines: string[] = [];
    const app = await createApp({
      agentis: gateway(),
      logger: {
        level: "warn",
        stream: new Writable({
          write(chunk, _encoding, callback) {
            logLines.push(chunk.toString());
            callback();
          },
        }),
      },
      config: {
        trustedProxyCidrs: [],
      },
      webhookAllowedIps: ["203.0.113.0/24"],
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/agentis/decision-changed",
      headers: { "x-forwarded-for": "203.0.113.20" },
      payload: { ...event, external_id: "must-not-be-logged" },
    });

    expect(response.statusCode).toBe(403);
    expect(logLines).toHaveLength(1);
    const log = JSON.parse(logLines[0] ?? "{}") as Record<string, unknown>;
    expect(log).toMatchObject({
      msg: "Agentis decision webhook rejected",
      reason: "source_ip_not_allowed",
      clientIp: "127.0.0.1",
      remoteAddress: "127.0.0.1",
      forwardedForPresent: true,
      forwardedForUsed: false,
      remoteAddressTrusted: false,
      webhookAllowedIps: ["203.0.113.0/24"],
      trustedProxyCidrs: [],
    });
    expect(logLines[0]).not.toContain("must-not-be-logged");
    await app.close();
  });

  it("logs when the desktop app connects without logging its token", async () => {
    const logLines: string[] = [];
    const app = await createApp({
      agentis: gateway(),
      logger: {
        level: "info",
        stream: new Writable({
          write(chunk, _encoding, callback) {
            logLines.push(chunk.toString());
            callback();
          },
        }),
      },
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string")
      throw new Error("Expected the BFF to listen on a TCP port.");
    const controller = new AbortController();

    const response = await fetch(`http://127.0.0.1:${address.port}/v1/events`, {
      headers: { "X-Auth-Token": "must-not-be-logged" },
      signal: controller.signal,
    });

    expect(response.status).toBe(200);
    const logs = logLines.map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );
    const accessLog = logs.find((line) => line.msg === "incoming request");
    expect(accessLog).toMatchObject({
      req: expect.objectContaining({ method: "GET", url: "/v1/events" }),
    });
    const connectionLog = logs.find(
      (line) => line.msg === "Desktop app connected",
    );
    expect(connectionLog).toMatchObject({
      msg: "Desktop app connected",
      tenantId: "tenant-1",
      userId: "user-1",
      activeConnections: 1,
    });
    expect(logLines.join("\n")).not.toContain("must-not-be-logged");

    controller.abort();
    await app.close();
  });
});
