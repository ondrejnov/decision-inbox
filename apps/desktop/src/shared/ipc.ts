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

export interface SettingsPatch {
  notificationsEnabled?: boolean;
  notifyWhileActive?: boolean;
  closeToTray?: boolean;
  autostart?: boolean;
  autostartConsent?: boolean;
}

export interface DesktopApi {
  getConfig(): Promise<RuntimeConfig>;
  getSession(): Promise<SessionResponse | null>;
  beginTokenEntry(): Promise<void>;
  cancelTokenEntry(): Promise<void>;
  submitTokenEntry(autostart: boolean): Promise<SessionResponse>;
  logout(): Promise<void>;
  getDecisions(view: DecisionView, page: number): Promise<DecisionListResponse>;
  getPendingCount(): Promise<PendingCountResponse>;
  setPendingCount(count: number): Promise<void>;
  resolve(request: ResolveRequest): Promise<ResolveResponse>;
  getSettings(): Promise<Settings>;
  saveSettings(patch: SettingsPatch): Promise<Settings>;
  startEvents(lastEventId?: string): Promise<void>;
  stopEvents(): Promise<void>;
  openTask(taskId: string, runId: string): Promise<void>;
  onDecisionChanged(
    listener: (event: DecisionChangedSseEvent) => void,
  ): () => void;
  onOpenPending(listener: () => void): () => void;
  onTokenEntryState(listener: (state: { length: number }) => void): () => void;
  onTokenEntrySubmit(listener: () => void): () => void;
  onEventsReconnected(listener: () => void): () => void;
  onAuthRequired(listener: () => void): () => void;
}
