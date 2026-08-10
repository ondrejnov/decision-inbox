import { contextBridge, ipcRenderer } from "electron";
import type {
  DecisionChangedSseEvent,
  DecisionListResponse,
  DecisionView,
  PendingCountResponse,
  ResolveRequest,
  ResolveResponse,
  RuntimeConfig,
  SessionResponse,
  Settings,
} from "@decision-inbox/contracts";
import type { DesktopApi, SettingsPatch } from "./shared/ipc.js";

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args).catch((value: unknown) => {
    const errorValue = value as {
      message?: unknown;
      code?: unknown;
      status?: unknown;
    };
    const error = new Error(
      typeof errorValue.message === "string"
        ? errorValue.message
        : "Desktop request failed.",
    );
    if (typeof errorValue.code === "string")
      Object.assign(error, { code: errorValue.code });
    if (typeof errorValue.status === "number")
      Object.assign(error, { status: errorValue.status });
    throw error;
  });
}

const desktopApi: DesktopApi = {
  getConfig: () => invoke<RuntimeConfig>("get-config"),
  getSession: () => invoke<SessionResponse | null>("get-session"),
  beginTokenEntry: () => invoke<void>("begin-token-entry"),
  cancelTokenEntry: () => invoke<void>("cancel-token-entry"),
  submitTokenEntry: (autostart: boolean) =>
    invoke<SessionResponse>("submit-token-entry", autostart),
  logout: () => invoke<void>("logout"),
  getDecisions: (view: DecisionView, page: number) =>
    invoke<DecisionListResponse>("get-decisions", view, page),
  getPendingCount: () => invoke<PendingCountResponse>("get-pending-count"),
  setPendingCount: (count: number) => invoke<void>("set-pending-count", count),
  resolve: (request: ResolveRequest) =>
    invoke<ResolveResponse>("resolve", request),
  getSettings: () => invoke<Settings>("get-settings"),
  saveSettings: (patch: SettingsPatch) =>
    invoke<Settings>("save-settings", patch),
  startEvents: (lastEventId?: string) =>
    invoke<void>("start-events", lastEventId),
  stopEvents: () => invoke<void>("stop-events"),
  openTask: (taskId: string, runId: string) =>
    invoke<void>("open-task", taskId, runId),
  onDecisionChanged: (listener: (event: DecisionChangedSseEvent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: DecisionChangedSseEvent,
    ) => listener(value);
    ipcRenderer.on("decision-changed", handler);
    return () => ipcRenderer.removeListener("decision-changed", handler);
  },
  onNotificationSound: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on("notification-sound", handler);
    return () => ipcRenderer.removeListener("notification-sound", handler);
  },
  onOpenPending: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on("open-pending", handler);
    return () => ipcRenderer.removeListener("open-pending", handler);
  },
  onTokenEntryState: (listener: (state: { length: number }) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: { length: number },
    ) => listener(state);
    ipcRenderer.on("token-entry-state", handler);
    return () => ipcRenderer.removeListener("token-entry-state", handler);
  },
  onTokenEntrySubmit: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on("token-entry-submit", handler);
    return () => ipcRenderer.removeListener("token-entry-submit", handler);
  },
  onEventsReconnected: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on("events-reconnected", handler);
    return () => ipcRenderer.removeListener("events-reconnected", handler);
  },
  onAuthRequired: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on("auth-required", handler);
    return () => ipcRenderer.removeListener("auth-required", handler);
  },
};

contextBridge.exposeInMainWorld("desktopApi", desktopApi);
