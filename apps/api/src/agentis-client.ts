import {
  ApprovalResolveRequestSchema,
  DecisionListResponseSchema,
  DecisionSchema,
  DecisionViewSchema,
  PendingCountResponseSchema,
  QuestionResolveRequestSchema,
  ResolveRequestSchema,
  SessionResponseSchema,
  type ApprovalResolveRequest,
  type Decision,
  type DecisionListResponse,
  type DecisionQuestion,
  type DecisionView,
  type PendingCountResponse,
  type QuestionResolveRequest,
  type ResolveRequest,
  type SessionResponse,
} from "@decision-inbox/contracts";
import { ApiError } from "./errors.js";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface AgentisClientOptions {
  baseUrl: string;
  fetchImpl?: FetchLike;
  sessionMethod: string;
}

export class AgentisRpcError extends ApiError {
  constructor(status: number, code: string, message: string) {
    super(status, code, message);
    this.name = "AgentisRpcError";
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function integerValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function dateValue(...values: unknown[]): string {
  for (const value of values) {
    const string = stringValue(value);
    if (!string) continue;
    const date = new Date(string);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date(0).toISOString();
}

function optionalDateValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    const string = stringValue(value);
    if (!string) continue;
    const date = new Date(string);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return undefined;
}

function firstValue(
  source: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function nestedValue(
  source: Record<string, unknown>,
  keys: readonly string[],
  depth = 4,
): unknown {
  const direct = firstValue(source, ...keys);
  if (direct !== undefined) return direct;
  if (depth === 0) return undefined;
  for (const value of Object.values(source)) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      continue;
    const nested = nestedValue(record(value), keys, depth - 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function nestedRecord(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const value = nestedValue(source, keys);
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? record(value)
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeOption(
  value: unknown,
  index: number,
): {
  id: string;
  label: string;
  description?: string;
  selected?: boolean;
} | null {
  if (typeof value === "string") return { id: value, label: value };
  const item = record(value);
  const id =
    stringValue(firstValue(item, "id", "value", "key")) ??
    `option-${index + 1}`;
  const label = stringValue(
    firstValue(item, "label", "title", "text", "name", "value"),
  );
  const description = stringValue(firstValue(item, "description"));
  const selectedValue = firstValue(
    item,
    "selected",
    "is_selected",
    "isSelected",
  );
  return label
    ? {
        id,
        label,
        description,
        selected:
          typeof selectedValue === "boolean" ? selectedValue : undefined,
      }
    : null;
}

function normalizeQuestion(
  value: unknown,
  index: number,
): DecisionQuestion | null {
  const item = record(value);
  const id =
    stringValue(firstValue(item, "id", "question_id", "questionId")) ??
    `question-${index + 1}`;
  const header = stringValue(firstValue(item, "header"));
  const prompt = stringValue(
    firstValue(item, "prompt", "question", "text", "title"),
  );
  const options = arrayValue(firstValue(item, "options", "choices")).flatMap(
    (option, optionIndex) => {
      const normalized = normalizeOption(option, optionIndex);
      return normalized ? [normalized] : [];
    },
  );
  if (!header && !prompt && options.length === 0) return null;
  return {
    id,
    header,
    prompt: prompt ?? "",
    options,
    multiple: booleanValue(
      firstValue(item, "multiple", "multi_select", "multiSelect"),
      false,
    ),
    required: booleanValue(firstValue(item, "required"), true),
    allowFreeformInput: booleanValue(
      firstValue(
        item,
        "allowFreeformInput",
        "allow_freeform_input",
        "allow_free_text",
      ),
      false,
    ),
    answerText: stringValue(firstValue(item, "answerText", "answer_text")),
  };
}

function normalizeStatus(value: unknown, view: DecisionView): string {
  const status = stringValue(value)?.toLowerCase();
  if (status === "1") return "pending";
  if (status === "2") return "answered";
  if (status === "3") return "cancelled";
  return status ?? (view === "pending" ? "pending" : "answered");
}

function normalizeResolver(value: unknown): Decision["resolver"] {
  if (value === null || value === undefined) return null;
  const resolver = record(value);
  const rawType = stringValue(firstValue(resolver, "type"));
  const type =
    rawType === "user" || rawType === "external_agent" ? rawType : "unknown";
  const viaValue = firstValue(resolver, "via");
  const via = record(viaValue);
  const viaType = stringValue(firstValue(via, "type"));
  return {
    type,
    id: stringValue(firstValue(resolver, "id")) ?? null,
    name: stringValue(firstValue(resolver, "name")) ?? null,
    via:
      viaValue && viaType
        ? {
            type: viaType,
            id: stringValue(firstValue(via, "id")) ?? null,
            name: stringValue(firstValue(via, "name")) ?? null,
          }
        : null,
  };
}

function unwrap(value: unknown): Record<string, unknown> {
  let current = record(value);
  for (let index = 0; index < 3; index += 1) {
    const next = firstValue(current, "data", "form", "result");
    if (!next || typeof next !== "object" || Array.isArray(next)) break;
    current = record(next);
  }
  return current;
}

function normalizeDecision(
  value: unknown,
  view: DecisionView,
): Decision | null {
  const item = record(value);
  const task = record(firstValue(item, "task"));
  const run = record(firstValue(item, "run"));
  const project = record(firstValue(item, "project"));
  const questionGroup = record(firstValue(item, "question"));
  const approval = record(firstValue(item, "approval"));
  const questions = arrayValue(firstValue(questionGroup, "questions")).flatMap(
    (question, index) => {
      const normalized = normalizeQuestion(question, index);
      return normalized ? [normalized] : [];
    },
  );
  const kindValue = stringValue(
    firstValue(item, "type", "decision_kind", "decisionKind", "kind"),
  );
  const kind =
    kindValue === "approval" ||
    kindValue === "approve" ||
    kindValue === "approve_request"
      ? "approval"
      : "question";
  const externalId = stringValue(
    firstValue(item, "external_id", "externalId", "id"),
  );
  const taskId =
    stringValue(firstValue(item, "task_id", "taskId")) ??
    stringValue(firstValue(task, "id"));
  const runId =
    stringValue(firstValue(item, "run_id", "runId")) ??
    stringValue(firstValue(run, "id"));
  if (!externalId || !taskId || !runId) return null;

  const taskTitle = stringValue(firstValue(task, "title", "name"));
  const firstQuestion = questions[0];
  const title =
    stringValue(firstValue(item, "title")) ??
    (kind === "approval"
      ? stringValue(firstValue(approval, "title", "description"))
      : stringValue(firstValue(questionGroup, "title", "header"))) ??
    firstQuestion?.header ??
    firstQuestion?.prompt ??
    taskTitle ??
    (kind === "approval" ? "Approval request" : "Question");
  const summary =
    stringValue(firstValue(item, "summary", "description", "details")) ??
    (kind === "approval"
      ? stringValue(firstValue(approval, "description"))
      : firstQuestion?.prompt);
  const status = normalizeStatus(firstValue(item, "status", "state"), view);
  const resolvedAt = optionalDateValue(
    firstValue(item, "resolved_at", "resolvedAt", "answered_at", "answeredAt"),
  );
  const cancelledAt = optionalDateValue(
    firstValue(item, "cancelled_at", "cancelledAt"),
  );
  const parsed = DecisionSchema.safeParse({
    externalId,
    kind,
    status,
    title,
    summary,
    taskId,
    runId,
    taskTitle,
    taskNumber:
      integerValue(firstValue(task, "number")) ??
      integerValue(firstValue(item, "task_number", "taskNumber")),
    projectName: stringValue(firstValue(project, "text", "name", "title")),
    projectFallback: stringValue(
      firstValue(item, "project_fallback", "projectFallback"),
    ),
    sessionId: stringValue(firstValue(item, "session_id", "sessionId")),
    createdAt: dateValue(
      firstValue(item, "created", "created_at", "createdAt", "occurred_at"),
      firstValue(task, "created_at"),
    ),
    updatedAt: optionalDateValue(
      firstValue(item, "updated_at", "updatedAt"),
      resolvedAt,
      cancelledAt,
    ),
    resolvedAt,
    cancelledAt,
    cancellationReason: stringValue(
      firstValue(item, "cancellation_reason", "cancellationReason"),
    ),
    resolver: normalizeResolver(firstValue(item, "resolver")),
    questions: questions.length > 0 ? questions : undefined,
    approval:
      kind === "approval"
        ? {
            commentAllowed: true,
            approved:
              typeof firstValue(approval, "approved") === "boolean"
                ? (firstValue(approval, "approved") as boolean)
                : null,
            comment: stringValue(firstValue(approval, "comment")),
          }
        : undefined,
  });
  return parsed.success ? parsed.data : null;
}

function listItems(value: unknown): { items: unknown[]; total?: number } {
  const root = unwrap(value);
  const possibleItems = firstValue(root, "items", "rows", "decisions");
  const items = arrayValue(possibleItems);
  const totalValue = firstValue(root, "total", "count", "total_count");
  return {
    items,
    total:
      typeof totalValue === "number" && Number.isInteger(totalValue)
        ? totalValue
        : undefined,
  };
}

export class AgentisClient {
  private readonly fetchImpl: FetchLike;
  private readonly endpoint: string;

  constructor(private readonly options: AgentisClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.endpoint = options.baseUrl.replace(/\/$/, "").endsWith("/api")
      ? options.baseUrl.replace(/\/$/, "")
      : `${options.baseUrl.replace(/\/$/, "")}/api`;
  }

  async getSession(token: string): Promise<SessionResponse> {
    const result = await this.rpc(this.options.sessionMethod, {}, token);
    const root = unwrap(result);
    const auth = nestedRecord(root, ["auth"]);
    const identity = nestedRecord(auth, ["identity", "user_data", "userData"]);
    const user = nestedRecord(root, [
      "user",
      "user_data",
      "userData",
      "identity",
    ]);
    const tenant = nestedRecord(root, [
      "tenant",
      "active_tenant",
      "activeTenant",
    ]);
    const tenantId =
      stringValue(nestedValue(root, ["tenant_id", "tenantId"])) ??
      stringValue(firstValue(auth, "tenant_id", "tenantId")) ??
      stringValue(firstValue(identity, "tenant_id", "tenantId")) ??
      stringValue(firstValue(user, "tenant_id", "tenantId")) ??
      stringValue(firstValue(tenant, "id"));
    const userId =
      stringValue(nestedValue(root, ["user_id", "userId"])) ??
      stringValue(firstValue(root, "id")) ??
      stringValue(firstValue(identity, "id", "user_id", "userId")) ??
      stringValue(firstValue(user, "id"));
    const displayName =
      stringValue(nestedValue(root, ["display_name", "displayName", "name"])) ??
      stringValue(
        firstValue(user, "display_name", "displayName", "name", "email"),
      ) ??
      "Agentis user";
    const email =
      stringValue(nestedValue(root, ["email"])) ??
      stringValue(firstValue(identity, "email")) ??
      stringValue(firstValue(user, "email"));
    const parsed = SessionResponseSchema.safeParse({
      authenticated: true,
      user: { id: userId, displayName, email },
      tenant: {
        id: tenantId,
        name:
          stringValue(nestedValue(root, ["tenant_name", "tenantName"])) ??
          stringValue(firstValue(tenant, "name", "title")),
      },
    });
    if (!parsed.success) {
      throw new AgentisRpcError(
        502,
        "tenant_identity_unavailable",
        "Agentis did not return a usable user and tenant identity.",
      );
    }
    return parsed.data;
  }

  async getDecisions(
    token: string,
    view: DecisionView,
    page: number,
  ): Promise<DecisionListResponse> {
    const validatedView = DecisionViewSchema.parse(view);
    const result = await this.rpc(
      "decision.get_list",
      { qo: { view: validatedView, page } },
      token,
    );
    const { items, total } = listItems(result);
    const normalized = items.flatMap((item) => {
      const decision = normalizeDecision(item, validatedView);
      return decision ? [decision] : [];
    });
    return DecisionListResponseSchema.parse({
      items: normalized,
      page,
      pageSize: 20,
      total,
      hasNext:
        total === undefined ? normalized.length === 20 : page * 20 < total,
    });
  }

  async getPendingCount(token: string): Promise<PendingCountResponse> {
    const result = await this.rpc("decision.get_pending_count", {}, token);
    const root = unwrap(result);
    const countValue =
      typeof result === "number"
        ? result
        : firstValue(root, "count", "pending_count", "pendingCount");
    const count =
      typeof countValue === "number" && Number.isInteger(countValue)
        ? countValue
        : 0;
    return PendingCountResponseSchema.parse({ count: Math.max(0, count) });
  }

  async resolve(
    token: string,
    request: ResolveRequest,
  ): Promise<{ status: string }> {
    const validated = ResolveRequestSchema.parse(request);
    if (validated.decisionKind === "question") {
      const question = QuestionResolveRequestSchema.parse(validated);
      const result = await this.rpc(
        "task.question_reply",
        {
          external_id: question.externalId,
          results: question.answers.map((answer) => ({
            question_id: answer.questionId,
            selected_options: answer.optionIds,
            answer_text: answer.answerText,
          })),
        },
        token,
      );
      return {
        status:
          stringValue(firstValue(unwrap(result), "status", "state")) ??
          "answered",
      };
    }
    const approval = ApprovalResolveRequestSchema.parse(validated);
    const result = await this.rpc(
      "task.approve_reply",
      {
        external_id: approval.externalId,
        approved: approval.action === "approve",
        comment: approval.comment ?? "",
      },
      token,
    );
    return {
      status:
        stringValue(firstValue(unwrap(result), "status", "state")) ??
        "answered",
    };
  }

  private async rpc(
    method: string,
    params: Record<string, unknown>,
    token: string,
  ): Promise<unknown> {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "X-Auth-Token": token,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
        id: crypto.randomUUID(),
      }),
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AgentisRpcError(
        response.status || 502,
        "agentis_invalid_response",
        "Agentis returned an invalid response.",
      );
    }
    const root = record(body);
    const error = record(root.error);
    if (!response.ok || Object.keys(error).length > 0) {
      const data = record(error.data);
      const reason = stringValue(firstValue(data, "reason", "code"));
      const code =
        reason ?? stringValue(error.code) ?? `agentis_http_${response.status}`;
      const message = stringValue(error.message) ?? "Agentis request failed.";
      const status =
        code === "already_resolved" || code === "decision_cancelled"
          ? 409
          : response.status >= 400
            ? response.status
            : typeof error.code === "number" && error.code >= 400
              ? error.code
              : 502;
      throw new AgentisRpcError(status, code, message);
    }
    return root.result ?? body;
  }
}
