import {
  ApiErrorResponseSchema,
  DecisionListResponseSchema,
  DecisionViewSchema,
  PendingCountResponseSchema,
  ResolveRequestSchema,
  ResolveResponseSchema,
  SessionResponseSchema,
  type DecisionListResponse,
  type DecisionView,
  type PendingCountResponse,
  type ResolveRequest,
  type ResolveResponse,
  type SessionResponse,
} from "@decision-inbox/contracts";
import type { CredentialStore } from "./credential-store.js";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class BffClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BffClientError";
  }
}

export class BffClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly credentialStore: CredentialStore,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async getSession(): Promise<SessionResponse | null> {
    const token = this.credentialStore.getToken();
    if (!token) return null;
    try {
      return SessionResponseSchema.parse(
        await this.request("/v1/session", token),
      );
    } catch (error) {
      if (error instanceof BffClientError && error.status === 401) return null;
      throw error;
    }
  }

  async onboard(token: string): Promise<SessionResponse> {
    const normalized = token.trim();
    if (!normalized)
      throw new BffClientError(
        400,
        "token_required",
        "An Agentis token is required.",
      );
    const session = SessionResponseSchema.parse(
      await this.request("/v1/session", normalized),
    );
    this.credentialStore.saveToken(normalized);
    return session;
  }

  async logout(): Promise<void> {
    this.credentialStore.clear();
  }

  async getDecisions(
    view: DecisionView,
    page: number,
  ): Promise<DecisionListResponse> {
    const validatedView = DecisionViewSchema.parse(view);
    return DecisionListResponseSchema.parse(
      await this.request(
        `/v1/decisions?view=${encodeURIComponent(validatedView)}&page=${page}`,
        this.requireToken(),
      ),
    );
  }

  async getPendingCount(): Promise<PendingCountResponse> {
    return PendingCountResponseSchema.parse(
      await this.request("/v1/decisions/pending-count", this.requireToken()),
    );
  }

  async resolve(request: ResolveRequest): Promise<ResolveResponse> {
    const validated = ResolveRequestSchema.parse(request);
    return ResolveResponseSchema.parse(
      await this.request("/v1/decisions/resolve", this.requireToken(), {
        method: "POST",
        body: JSON.stringify(validated),
      }),
    );
  }

  getEventStreamUrl(): string {
    return `${this.baseUrl}/v1/events`;
  }

  getStoredToken(): string {
    return this.requireToken();
  }

  private requireToken(): string {
    const token = this.credentialStore.getToken();
    if (!token)
      throw new BffClientError(
        401,
        "unauthorized",
        "Agentis authentication is required.",
      );
    return token;
  }

  private async request(
    path: string,
    token: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "X-Auth-Token": token,
        ...init.headers,
      },
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new BffClientError(
        response.status || 502,
        "invalid_bff_response",
        "The BFF returned an invalid response.",
      );
    }
    if (!response.ok) {
      const parsed = ApiErrorResponseSchema.safeParse(body);
      throw new BffClientError(
        response.status,
        parsed.success ? parsed.data.error.code : "bff_request_failed",
        parsed.success ? parsed.data.error.message : "The BFF request failed.",
      );
    }
    return body;
  }
}
