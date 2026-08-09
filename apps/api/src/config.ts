import { parseAllowlist } from "./ip-allowlist.js";

export interface ApiConfig {
  host: string;
  port: number;
  agentisApiUrl: string;
  agentisSessionRpc: string;
  webhookAllowedIps: string[];
  trustedProxyCidrs: string[];
  corsOrigins: string[];
  webhookIdempotencyTtlMs: number;
  webhookIdempotencyMaxEntries: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    host: env.BFF_HOST ?? "127.0.0.1",
    port: positiveInteger(env.BFF_PORT, 8787),
    agentisApiUrl: env.AGENTIS_API_URL ?? "https://agentis.invalid",
    agentisSessionRpc: env.AGENTIS_SESSION_RPC ?? "auth.user_data",
    webhookAllowedIps: parseAllowlist(env.WEBHOOK_ALLOWED_IPS),
    trustedProxyCidrs: parseAllowlist(env.TRUSTED_PROXY_CIDRS),
    corsOrigins: parseAllowlist(env.BFF_CORS_ORIGINS),
    webhookIdempotencyTtlMs: positiveInteger(
      env.WEBHOOK_IDEMPOTENCY_TTL_MS,
      15 * 60 * 1000,
    ),
    webhookIdempotencyMaxEntries: positiveInteger(
      env.WEBHOOK_IDEMPOTENCY_MAX_ENTRIES,
      10_000,
    ),
  };
}
