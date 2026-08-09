import {
  RuntimeConfigSchema,
  type RuntimeConfig,
} from "@decision-inbox/contracts";

export function loadRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  return RuntimeConfigSchema.parse({
    bffUrl: env.DECISION_BFF_URL ?? "https://agapprove.agentis.cz",
    agentisUrl: env.AGENTIS_WEB_URL ?? "https://agentis.cz",
  });
}
