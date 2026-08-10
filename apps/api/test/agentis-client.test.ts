import { describe, expect, it, vi } from "vitest";
import { AgentisClient, AgentisRpcError } from "../src/agentis-client.js";
import type {
  ApprovalResolveRequest,
  QuestionResolveRequest,
} from "@decision-inbox/contracts";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("AgentisClient", () => {
  it("maps the decision list and sends the user token only as X-Auth-Token", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("X-Auth-Token")).toBe(
          "user-secret",
        );
        expect(JSON.parse(String(init?.body))).toMatchObject({
          method: "decision.get_list",
          params: {
            qo: {
              view: "pending",
              page: 2,
            },
          },
        });

        return response({
          jsonrpc: "2.0",
          id: "request-1",
          result: {
            items: [
              {
                id: "question:question-1",
                type: "question",
                external_id: "question-1",
                status: 1,
                created: "2026-08-07T10:00:00.000Z",
                task: { id: 42, title: "Deploy service" },
                run_id: "run-9",
                question: {
                  questions: [
                    {
                      id: "q-1",
                      header: "Target",
                      question: "Where should it run?",
                      options: [
                        {
                          id: "prod",
                          label: "Production",
                          description: "Deploy to customer-facing servers.",
                        },
                      ],
                      multiple: false,
                      allowFreeformInput: false,
                    },
                  ],
                },
              },
            ],
            total: 41,
          },
        });
      },
    );
    const client = new AgentisClient({
      baseUrl: "https://agentis.example.com",
      fetchImpl,
      sessionMethod: "auth.user_data",
    });

    const result = await client.getDecisions("user-secret", "pending", 2);

    expect(result).toEqual({
      items: [
        expect.objectContaining({
          externalId: "question-1",
          kind: "question",
          taskId: "42",
          questions: [
            expect.objectContaining({
              id: "q-1",
              prompt: "Where should it run?",
              allowFreeformInput: false,
              options: [
                expect.objectContaining({
                  id: "prod",
                  label: "Production",
                  description: "Deploy to customer-facing servers.",
                }),
              ],
            }),
          ],
        }),
      ],
      page: 2,
      pageSize: 20,
      total: 41,
      hasNext: true,
    });
  });

  it("maps question and approval replies to their Agentis RPC contracts", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          method: string;
          params: unknown;
        };
        calls.push(body);
        return response({
          jsonrpc: "2.0",
          id: "1",
          result: { status: "answered" },
        });
      },
    );
    const client = new AgentisClient({
      baseUrl: "https://agentis.example.com/api",
      fetchImpl,
      sessionMethod: "auth.user_data",
    });
    const question: QuestionResolveRequest = {
      decisionKind: "question",
      externalId: "question-1",
      taskId: "42",
      runId: "run-9",
      answers: [{ questionId: "q-1", optionIds: ["prod"], answerText: "fast" }],
    };
    const rejection: ApprovalResolveRequest = {
      decisionKind: "approval",
      externalId: "approval-1",
      taskId: "42",
      runId: "run-9",
      action: "reject",
      comment: "Needs another review",
    };
    const approval: ApprovalResolveRequest = {
      decisionKind: "approval",
      externalId: "approval-2",
      taskId: "42",
      runId: "run-9",
      action: "approve",
      comment: "Ship it",
    };

    await client.resolve("user-secret", question);
    await client.resolve("user-secret", rejection);
    await client.resolve("user-secret", approval);

    expect(calls.map(({ method, params }) => ({ method, params }))).toEqual([
      {
        method: "task.question_reply",
        params: {
          external_id: "question-1",
          results: [
            {
              question_id: "q-1",
              selected_options: ["prod"],
              answer_text: "fast",
            },
          ],
        },
      },
      {
        method: "task.approve_reply",
        params: {
          external_id: "approval-1",
          approved: false,
          comment: "Needs another review",
        },
      },
      {
        method: "task.approve_reply",
        params: {
          external_id: "approval-2",
          approved: true,
          comment: "Ship it",
        },
      },
    ]);
  });

  it("maps the existing approval payload into the focused card contract", async () => {
    const client = new AgentisClient({
      baseUrl: "https://agentis.example.com",
      sessionMethod: "auth.user_data",
      fetchImpl: async () =>
        response({
          jsonrpc: "2.0",
          id: "1",
          result: {
            items: [
              {
                id: "approval:approval-1",
                type: "approval",
                external_id: "approval-1",
                status: 1,
                created: "2026-08-07T10:00:00.000Z",
                task: { id: "task-1", title: "Release" },
                run_id: "run-1",
                approval: {
                  title: "Publish the release",
                  description: "This will deploy to production.",
                },
              },
            ],
            count: 1,
          },
        }),
    });

    await expect(
      client.getDecisions("user-secret", "pending", 1),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          kind: "approval",
          title: "Publish the release",
          summary: "This will deploy to production.",
          taskId: "task-1",
        }),
      ],
    });
  });

  it("preserves the complete audit context for decision history", async () => {
    const client = new AgentisClient({
      baseUrl: "https://agentis.example.com",
      sessionMethod: "auth.user_data",
      fetchImpl: async () =>
        response({
          jsonrpc: "2.0",
          id: "1",
          result: {
            items: [
              {
                id: "question:question-1",
                type: "question",
                external_id: "question-1",
                status: 2,
                created: "2026-08-07T10:00:00Z",
                resolved_at: "2026-08-07T10:30:00Z",
                task: { id: "task-1", number: 42, title: "Release" },
                project: { id: "project-1", text: "Platform" },
                project_fallback: "/workspace/ignored",
                run_id: "run-1",
                session_id: "session-1",
                resolver: {
                  type: "external_agent",
                  id: "agent-1",
                  name: "Release bot",
                  via: {
                    type: "service_token",
                    id: "token-1",
                    name: "Desktop token",
                  },
                },
                question: {
                  questions: [
                    {
                      id: "q-1",
                      header: "Target",
                      question: "Where should it run?",
                      options: [
                        {
                          id: "prod",
                          label: "Production",
                          description: "Customer-facing servers",
                          selected: true,
                        },
                      ],
                      multiple: false,
                      allowFreeformInput: true,
                      answerText: "After midnight",
                    },
                  ],
                },
              },
            ],
            count: 1,
          },
        }),
    });

    await expect(
      client.getDecisions("user-secret", "history", 1),
    ).resolves.toMatchObject({
      items: [
        {
          kind: "question",
          status: "answered",
          title: "Target",
          taskNumber: 42,
          projectName: "Platform",
          projectFallback: "/workspace/ignored",
          sessionId: "session-1",
          resolvedAt: "2026-08-07T10:30:00.000Z",
          resolver: {
            type: "external_agent",
            id: "agent-1",
            name: "Release bot",
            via: {
              type: "service_token",
              id: "token-1",
              name: "Desktop token",
            },
          },
          questions: [
            expect.objectContaining({
              header: "Target",
              answerText: "After midnight",
              options: [
                expect.objectContaining({
                  label: "Production",
                  selected: true,
                }),
              ],
            }),
          ],
        },
      ],
    });
  });

  it("preserves stale Agentis error codes and statuses", async () => {
    const fetchImpl = vi.fn(async () =>
      response(
        {
          jsonrpc: "2.0",
          id: "1",
          error: {
            code: 400,
            message: "This decision is already resolved",
            data: { reason: "already_resolved", status: 2 },
          },
        },
        200,
      ),
    );
    const client = new AgentisClient({
      baseUrl: "https://agentis.example.com",
      fetchImpl,
      sessionMethod: "auth.user_data",
    });

    await expect(client.getPendingCount("user-secret")).rejects.toMatchObject<
      Partial<AgentisRpcError>
    >({
      code: "already_resolved",
      status: 409,
    });
  });

  it("resolves tenant identity from a nested Agentis auth payload", async () => {
    const fetchImpl = vi.fn(async () =>
      response({
        jsonrpc: "2.0",
        id: "1",
        result: {
          auth: {
            identity: {
              id: "user-2",
              name: "Grace Hopper",
              email: "grace@example.com",
            },
            tenant_id: "tenant-2",
            tenant: { id: "tenant-2", name: "Compiler team" },
          },
        },
      }),
    );
    const client = new AgentisClient({
      baseUrl: "https://agentis.example.com",
      fetchImpl,
      sessionMethod: "auth.user_data",
    });

    await expect(client.getSession("user-secret")).resolves.toEqual({
      authenticated: true,
      user: {
        id: "user-2",
        displayName: "Grace Hopper",
        email: "grace@example.com",
      },
      tenant: { id: "tenant-2", name: "Compiler team" },
    });
  });
});
