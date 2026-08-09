import type {
  ResolveRequest,
  ResolveResponse,
} from "@decision-inbox/contracts";
import type { DesktopApi } from "../shared/ipc";
import { demoApi } from "./demo-api";

export function desktopApi(): DesktopApi {
  if (import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE === "1")
    return demoApi;
  if (!window.desktopApi) throw new Error("Desktop bridge is unavailable.");
  return window.desktopApi;
}

export function isStaleError(error: unknown): boolean {
  const value = error as { code?: unknown };
  return (
    value.code === "already_resolved" || value.code === "decision_cancelled"
  );
}

export type ResolveFunction = (
  request: ResolveRequest,
) => Promise<ResolveResponse>;
