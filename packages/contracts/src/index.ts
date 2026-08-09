import { z } from "zod";

const identifier = z.string().trim().min(1).max(256);
const content = z.string().max(50_000);

export const DecisionKindSchema = z.enum(["question", "approval"]);
export type DecisionKind = z.infer<typeof DecisionKindSchema>;

export const DecisionViewSchema = z.enum(["pending", "history"]);
export type DecisionView = z.infer<typeof DecisionViewSchema>;

export const DecisionChangedEventSchema = z
  .object({
    schema_version: z.literal(1),
    event_id: identifier,
    transition: z.enum(["created", "answered", "cancelled"]),
    decision_kind: DecisionKindSchema.optional(),
    tenant_id: identifier,
    external_id: identifier.optional(),
    task_id: identifier,
    run_id: identifier.optional(),
    status: z.string().trim().min(1).max(64),
    occurred_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type DecisionChangedEvent = z.infer<typeof DecisionChangedEventSchema>;

export const DecisionChangedSseEventSchema = DecisionChangedEventSchema.omit({
  tenant_id: true,
});
export type DecisionChangedSseEvent = z.infer<
  typeof DecisionChangedSseEventSchema
>;

export const DecisionOptionSchema = z.object({
  id: identifier,
  label: content,
  description: content.optional(),
  selected: z.boolean().optional(),
});
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;

export const DecisionQuestionSchema = z.object({
  id: identifier,
  header: content.optional(),
  prompt: content,
  options: z.array(DecisionOptionSchema).max(100),
  multiple: z.boolean(),
  required: z.boolean(),
  allowFreeformInput: z.boolean(),
  answerText: content.optional(),
});
export type DecisionQuestion = z.infer<typeof DecisionQuestionSchema>;

export const DecisionApprovalSchema = z.object({
  commentAllowed: z.boolean(),
  approved: z.boolean().nullable().optional(),
  comment: content.optional(),
});
export type DecisionApproval = z.infer<typeof DecisionApprovalSchema>;

export const DecisionResolverPrincipalSchema = z.object({
  type: z.string().trim().min(1).max(64),
  id: identifier.nullable(),
  name: content.nullable(),
});

export const DecisionResolverSchema = z.object({
  type: z.enum(["user", "external_agent", "unknown"]),
  id: identifier.nullable(),
  name: content.nullable(),
  via: DecisionResolverPrincipalSchema.nullable(),
});
export type DecisionResolver = z.infer<typeof DecisionResolverSchema>;

export const DecisionSchema = z.object({
  externalId: identifier,
  kind: DecisionKindSchema,
  status: z.string().trim().min(1).max(64),
  title: content,
  summary: content.optional(),
  taskId: identifier,
  runId: identifier,
  taskTitle: content.optional(),
  taskNumber: z.number().int().nullable().optional(),
  projectName: content.optional(),
  projectFallback: content.optional(),
  sessionId: identifier.optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  resolvedAt: z.string().datetime({ offset: true }).optional(),
  cancelledAt: z.string().datetime({ offset: true }).optional(),
  cancellationReason: content.optional(),
  resolver: DecisionResolverSchema.nullable().optional(),
  questions: z.array(DecisionQuestionSchema).optional(),
  approval: DecisionApprovalSchema.optional(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const DecisionListResponseSchema = z.object({
  items: z.array(DecisionSchema),
  page: z.number().int().min(1),
  pageSize: z.literal(20),
  total: z.number().int().min(0).optional(),
  hasNext: z.boolean(),
});
export type DecisionListResponse = z.infer<typeof DecisionListResponseSchema>;

export const PendingCountResponseSchema = z.object({
  count: z.number().int().min(0),
});
export type PendingCountResponse = z.infer<typeof PendingCountResponseSchema>;

const resolveIdentity = z.object({
  externalId: identifier,
  taskId: identifier,
  runId: identifier,
});

export const QuestionAnswerSchema = z.object({
  questionId: identifier,
  optionIds: z.array(identifier).max(100),
  answerText: z.string().max(4_000).optional(),
});
export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>;

export const QuestionResolveRequestSchema = resolveIdentity
  .extend({
    decisionKind: z.literal("question"),
    answers: z.array(QuestionAnswerSchema).min(1).max(100),
  })
  .strict();
export type QuestionResolveRequest = z.infer<
  typeof QuestionResolveRequestSchema
>;

export const ApprovalResolveRequestSchema = resolveIdentity
  .extend({
    decisionKind: z.literal("approval"),
    action: z.enum(["approve", "reject"]),
    comment: z.string().max(4_000).optional(),
  })
  .strict();
export type ApprovalResolveRequest = z.infer<
  typeof ApprovalResolveRequestSchema
>;

export const ResolveRequestSchema = z.discriminatedUnion("decisionKind", [
  QuestionResolveRequestSchema,
  ApprovalResolveRequestSchema,
]);
export type ResolveRequest = z.infer<typeof ResolveRequestSchema>;

export const ResolveResponseSchema = z.object({
  ok: z.literal(true),
  externalId: identifier,
  status: z.string().trim().min(1).max(64),
});
export type ResolveResponse = z.infer<typeof ResolveResponseSchema>;

export const SessionResponseSchema = z.object({
  authenticated: z.literal(true),
  user: z.object({
    id: identifier,
    displayName: content,
    email: z.string().email().optional(),
  }),
  tenant: z.object({
    id: identifier,
    name: content.optional(),
  }),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const AndroidPushInstallationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256);

export const AndroidPushRegistrationRequestSchema = z
  .object({
    installationId: AndroidPushInstallationIdSchema,
    pushToken: z.string().trim().min(32).max(4_096),
    platform: z.literal("android"),
  })
  .strict();
export type AndroidPushRegistrationRequest = z.infer<
  typeof AndroidPushRegistrationRequestSchema
>;

export const AndroidPushRegistrationParamsSchema = z
  .object({
    installationId: AndroidPushInstallationIdSchema,
  })
  .strict();
export type AndroidPushRegistrationParams = z.infer<
  typeof AndroidPushRegistrationParamsSchema
>;

export const PushRegistrationResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .strict();
export type PushRegistrationResponse = z.infer<
  typeof PushRegistrationResponseSchema
>;

export const SettingsSchema = z.object({
  notificationsEnabled: z.boolean(),
  notifyWhileActive: z.boolean(),
  closeToTray: z.boolean(),
  autostart: z.boolean(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const RuntimeConfigSchema = z.object({
  bffUrl: z.string().url(),
  agentisUrl: z.string().url(),
});
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
