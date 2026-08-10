import cors from "@fastify/cors";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyServerOptions,
} from "fastify";
import {
  AndroidPushRegistrationParamsSchema,
  AndroidPushRegistrationRequestSchema,
  DecisionChangedEventSchema,
  DecisionListResponseSchema,
  DecisionViewSchema,
  DesktopPresenceRequestSchema,
  DesktopPresenceResponseSchema,
  PendingCountResponseSchema,
  PushRegistrationResponseSchema,
  ResolveRequestSchema,
  ResolveResponseSchema,
  SessionResponseSchema,
  type DecisionChangedEvent,
  type DecisionListResponse,
  type DecisionView,
  type DesktopPresenceResponse,
  type PendingCountResponse,
  type PushRegistrationResponse,
  type ResolveRequest,
  type ResolveResponse,
  type SessionResponse,
} from "@decision-inbox/contracts";
import { AgentisClient, type AgentisRpcError } from "./agentis-client.js";
import { loadConfig, type ApiConfig } from "./config.js";
import { ApiError } from "./errors.js";
import { EventHub, formatSseEvent } from "./event-hub.js";
import {
  DesktopPresenceStore,
  type DesktopPresence,
} from "./desktop-presence-store.js";
import { IdempotencyStore } from "./idempotency.js";
import { isIpAllowed } from "./ip-allowlist.js";
import {
  DisabledPushSender,
  FcmPushSender,
  RegistrationPushDispatcher,
  type PushDispatcher,
  type PushSender,
} from "./push-dispatcher.js";
import {
  SqlitePushRegistrationStore,
  type PushRegistrationStore,
} from "./push-registration-store.js";

export interface AgentisGateway {
  getSession(token: string): Promise<SessionResponse>;
  getDecisions(
    token: string,
    view: DecisionView,
    page: number,
  ): Promise<DecisionListResponse>;
  getPendingCount(token: string): Promise<PendingCountResponse>;
  resolve(token: string, request: ResolveRequest): Promise<{ status: string }>;
}

export interface AppOptions {
  agentis?: AgentisGateway;
  config?: Partial<ApiConfig>;
  eventHub?: EventHub;
  idempotency?: IdempotencyStore;
  logger?: FastifyServerOptions["logger"];
  pushDispatcher?: PushDispatcher;
  desktopPresence?: DesktopPresence;
  pushSender?: PushSender;
  pushStore?: PushRegistrationStore;
  webhookAllowedIps?: string[];
}

export type BffApp = FastifyInstance & { eventHub: EventHub };

function authToken(request: FastifyRequest): string {
  const header = request.headers["x-auth-token"];
  const token = Array.isArray(header) ? header[0] : header;
  if (!token || !token.trim()) {
    throw new ApiError(
      401,
      "unauthorized",
      "Agentis authentication is required.",
    );
  }
  return token.trim();
}

interface RequestIpResolution {
  clientIp: string;
  remoteAddress: string;
  forwardedForPresent: boolean;
  forwardedForUsed: boolean;
  remoteAddressTrusted: boolean;
}

function resolveRequestIp(
  request: FastifyRequest,
  trustedProxyCidrs: readonly string[],
): RequestIpResolution {
  const remoteAddress = request.raw.socket.remoteAddress ?? "";
  const forwarded = request.headers["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const forwardedClientIp = firstForwarded?.split(",")[0]?.trim();
  const remoteAddressTrusted = Boolean(
    remoteAddress && isIpAllowed(remoteAddress, trustedProxyCidrs),
  );
  const forwardedForUsed = Boolean(remoteAddressTrusted && forwardedClientIp);

  return {
    clientIp: forwardedForUsed
      ? (forwardedClientIp ?? "")
      : remoteAddress || request.ip,
    remoteAddress: remoteAddress || request.ip,
    forwardedForPresent: Boolean(firstForwarded),
    forwardedForUsed,
    remoteAddressTrusted,
  };
}

function errorFromUnknown(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const fastifyError = error as { statusCode?: unknown };
  if (
    typeof fastifyError.statusCode === "number" &&
    fastifyError.statusCode >= 400 &&
    fastifyError.statusCode < 500
  ) {
    const status =
      fastifyError.statusCode === 414 ? 400 : fastifyError.statusCode;
    return new ApiError(
      status,
      fastifyError.statusCode === 413 ? "request_too_large" : "invalid_request",
      fastifyError.statusCode === 413
        ? "The request is too large."
        : "The request is invalid.",
    );
  }
  return new ApiError(502, "agentis_unavailable", "Agentis is unavailable.");
}

function queryParams(request: FastifyRequest): {
  view: DecisionView;
  page: number;
} {
  const query = request.query as Record<string, unknown>;
  const viewResult = DecisionViewSchema.safeParse(query.view ?? "pending");
  const pageNumber = Number(query.page ?? 1);
  if (
    !viewResult.success ||
    !Number.isInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > 1_000_000
  ) {
    throw new ApiError(
      400,
      "invalid_query",
      "The decision view or page is invalid.",
    );
  }
  return { view: viewResult.data, page: pageNumber };
}

function bodyValue(request: FastifyRequest): ResolveRequest {
  const parsed = ResolveRequestSchema.safeParse(request.body);
  if (!parsed.success)
    throw new ApiError(
      400,
      "invalid_request",
      "The decision resolution payload is invalid.",
    );
  return parsed.data;
}

function pushRegistrationBody(request: FastifyRequest) {
  const parsed = AndroidPushRegistrationRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_request",
      "The push registration payload is invalid.",
    );
  }
  return parsed.data;
}

function pushRegistrationParams(request: FastifyRequest) {
  const parsed = AndroidPushRegistrationParamsSchema.safeParse(request.params);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_request",
      "The push registration installation is invalid.",
    );
  }
  return parsed.data;
}

function desktopPresenceBody(request: FastifyRequest) {
  const parsed = DesktopPresenceRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_request",
      "The desktop presence payload is invalid.",
    );
  }
  return parsed.data;
}

export async function createApp(options: AppOptions = {}): Promise<BffApp> {
  const loaded = loadConfig();
  const config: ApiConfig = {
    ...loaded,
    ...options.config,
    webhookAllowedIps:
      options.webhookAllowedIps ??
      options.config?.webhookAllowedIps ??
      loaded.webhookAllowedIps,
  };
  const eventHub = options.eventHub ?? new EventHub();
  const idempotency =
    options.idempotency ??
    new IdempotencyStore({
      ttlMs: config.webhookIdempotencyTtlMs,
      maxEntries: config.webhookIdempotencyMaxEntries,
    });
  const agentis =
    options.agentis ??
    new AgentisClient({
      baseUrl: config.agentisApiUrl,
      sessionMethod: config.agentisSessionRpc,
    });
  const pushStore =
    options.pushStore ??
    new SqlitePushRegistrationStore({ path: config.sqlitePath });
  const pushSender =
    options.pushSender ??
    (config.firebaseProjectId
      ? new FcmPushSender(config.firebaseProjectId)
      : new DisabledPushSender());
  const desktopPresence = options.desktopPresence ?? new DesktopPresenceStore();
  const pushDispatcher =
    options.pushDispatcher ??
    new RegistrationPushDispatcher(pushStore, pushSender, desktopPresence);
  const app = Fastify({
    logger:
      options.logger ??
      (process.env.NODE_ENV === "test" ? false : { level: "info" }),
    bodyLimit: 64 * 1024,
    routerOptions: { maxParamLength: 4_096 },
  }) as unknown as BffApp;
  app.decorate("eventHub", eventHub);
  app.addHook("onClose", async () => pushStore.close());
  await app.register(cors, {
    origin:
      config.corsOrigins.length === 0
        ? false
        : config.corsOrigins.length === 1 && config.corsOrigins[0] === "*"
          ? true
          : config.corsOrigins,
  });

  app.setErrorHandler((error, _request, reply) => {
    const apiError = errorFromUnknown(error);
    reply
      .code(apiError.status)
      .send({ error: { code: apiError.code, message: apiError.message } });
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "decision-inbox-bff",
  }));
  app.get("/v1/health", async () => ({
    status: "ok",
    service: "decision-inbox-bff",
  }));

  app.get("/v1/session", async (request, reply) => {
    try {
      const result = SessionResponseSchema.parse(
        await agentis.getSession(authToken(request)),
      );
      return reply.send(result);
    } catch (error) {
      throw errorFromUnknown(error);
    }
  });

  app.put("/v1/push/registration", async (request, reply) => {
    try {
      const token = authToken(request);
      const registration = pushRegistrationBody(request);
      const identity = SessionResponseSchema.parse(
        await agentis.getSession(token),
      );
      try {
        pushStore.register({
          ...registration,
          tenantId: identity.tenant.id,
          userId: identity.user.id,
        });
      } catch {
        throw new ApiError(
          503,
          "push_registration_unavailable",
          "Push registration storage is unavailable.",
        );
      }
      const response: PushRegistrationResponse =
        PushRegistrationResponseSchema.parse({ ok: true });
      return reply.send(response);
    } catch (error) {
      throw errorFromUnknown(error);
    }
  });

  app.delete(
    "/v1/push/registration/:installationId",
    async (request, reply) => {
      try {
        const token = authToken(request);
        const { installationId } = pushRegistrationParams(request);
        const identity = SessionResponseSchema.parse(
          await agentis.getSession(token),
        );
        try {
          pushStore.unregister(
            installationId,
            identity.tenant.id,
            identity.user.id,
          );
        } catch {
          throw new ApiError(
            503,
            "push_registration_unavailable",
            "Push registration storage is unavailable.",
          );
        }
        const response: PushRegistrationResponse =
          PushRegistrationResponseSchema.parse({ ok: true });
        return reply.send(response);
      } catch (error) {
        throw errorFromUnknown(error);
      }
    },
  );

  app.put("/v1/desktop/presence", async (request, reply) => {
    try {
      const token = authToken(request);
      const presence = desktopPresenceBody(request);
      const identity = SessionResponseSchema.parse(
        await agentis.getSession(token),
      );
      desktopPresence.report(
        identity.tenant.id,
        identity.user.id,
        presence.active,
      );
      const response: DesktopPresenceResponse =
        DesktopPresenceResponseSchema.parse({ ok: true });
      return reply.send(response);
    } catch (error) {
      throw errorFromUnknown(error);
    }
  });

  app.get("/v1/decisions", async (request, reply) => {
    try {
      const { view, page } = queryParams(request);
      const result = DecisionListResponseSchema.parse(
        await agentis.getDecisions(authToken(request), view, page),
      );
      return reply.send(result);
    } catch (error) {
      throw errorFromUnknown(error);
    }
  });

  app.get("/v1/decisions/pending-count", async (request, reply) => {
    try {
      const result = PendingCountResponseSchema.parse(
        await agentis.getPendingCount(authToken(request)),
      );
      return reply.send(result);
    } catch (error) {
      throw errorFromUnknown(error);
    }
  });

  app.post("/v1/decisions/resolve", async (request, reply) => {
    try {
      const token = authToken(request);
      const resolution = bodyValue(request);
      const result = await agentis.resolve(token, resolution);
      const response: ResolveResponse = ResolveResponseSchema.parse({
        ok: true,
        externalId: resolution.externalId,
        status: result.status,
      });
      return reply.send(response);
    } catch (error) {
      throw errorFromUnknown(error);
    }
  });

  app.post("/v1/webhooks/agentis/decision-changed", async (request, reply) => {
    const source = resolveRequestIp(request, config.trustedProxyCidrs);
    const logContext = {
      clientIp: source.clientIp,
      remoteAddress: source.remoteAddress,
      forwardedForPresent: source.forwardedForPresent,
      forwardedForUsed: source.forwardedForUsed,
      remoteAddressTrusted: source.remoteAddressTrusted,
      webhookAllowedIps: config.webhookAllowedIps,
      trustedProxyCidrs: config.trustedProxyCidrs,
    };
    if (!isIpAllowed(source.clientIp, config.webhookAllowedIps)) {
      request.log.warn(
        {
          ...logContext,
          reason:
            config.webhookAllowedIps.length === 0
              ? "webhook_allowlist_empty"
              : "source_ip_not_allowed",
        },
        "Agentis decision webhook rejected",
      );
      return reply.code(403).send({
        error: {
          code: "webhook_forbidden",
          message: "Webhook source is not allowed.",
        },
      });
    }
    const parsed = DecisionChangedEventSchema.safeParse(request.body);
    if (!parsed.success) {
      request.log.warn(
        {
          ...logContext,
          reason: "invalid_payload",
          validationIssues: parsed.error.issues.map((issue) => ({
            code: issue.code,
            path: issue.path.join("."),
          })),
        },
        "Agentis decision webhook rejected",
      );
      return reply.code(400).send({
        error: {
          code: "invalid_webhook",
          message: "Webhook payload is invalid.",
        },
      });
    }
    if (
      parsed.data.transition !== "cancelled" &&
      (!parsed.data.decision_kind ||
        !parsed.data.external_id ||
        !parsed.data.run_id)
    ) {
      request.log.warn(
        {
          ...logContext,
          reason: "decision_identity_missing",
        },
        "Agentis decision webhook rejected",
      );
      return reply.code(400).send({
        error: {
          code: "invalid_webhook",
          message: "Created and answered events require decision identity.",
        },
      });
    }
    if (!idempotency.remember(parsed.data.event_id)) {
      return reply.code(202).send({ accepted: true, deduplicated: true });
    }
    eventHub.publish(parsed.data);
    try {
      await pushDispatcher.dispatch(parsed.data);
    } catch {
      request.log.warn(
        {
          eventId: parsed.data.event_id,
          tenantId: parsed.data.tenant_id,
        },
        "Push notification dispatch failed",
      );
    }
    return reply.code(202).send({ accepted: true });
  });

  app.get("/v1/events", async (request, reply) => {
    let identity: SessionResponse;
    try {
      identity = await agentis.getSession(authToken(request));
    } catch (error) {
      throw errorFromUnknown(error);
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    const lastEventIdHeader = request.headers["last-event-id"];
    const lastEventId = Array.isArray(lastEventIdHeader)
      ? lastEventIdHeader[0]
      : lastEventIdHeader;
    const sink = (event: Parameters<typeof formatSseEvent>[0]) => {
      if (!reply.raw.destroyed) reply.raw.write(formatSseEvent(event));
    };
    const unsubscribe = eventHub.subscribe(
      identity.tenant.id,
      sink,
      lastEventId,
    );
    request.log.info(
      {
        tenantId: identity.tenant.id,
        userId: identity.user.id,
        activeConnections: eventHub.connectionCount,
      },
      "Desktop app connected",
    );
    const keepalive = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(": keepalive\n\n");
    }, 25_000);
    const cleanup = () => {
      clearInterval(keepalive);
      unsubscribe();
    };
    request.raw.once("close", cleanup);
    return reply;
  });

  return app;
}

export type { AgentisRpcError };
