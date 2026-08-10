import type {
  Decision,
  DecisionChangedSseEvent,
  DecisionListResponse,
  PendingCountResponse,
  ResolveRequest,
  ResolveResponse,
  RuntimeConfig,
  SessionResponse,
  Settings,
} from "@decision-inbox/contracts";
import type { DesktopApi, SettingsPatch } from "../shared/ipc";

const session: SessionResponse = {
  authenticated: true,
  user: { id: "demo-user", displayName: "Ada Lovelace" },
  tenant: { id: "demo-tenant", name: "Demo workspace" },
};

const pending: Decision[] = [
  {
    externalId: "question-demo",
    kind: "question",
    status: "pending",
    title: "How should the migration be rolled out?",
    summary: "The agent needs one choice before it can continue.",
    taskId: "task-1042",
    runId: "run-22",
    taskTitle: "Plan database migration",
    createdAt: "2026-08-07T10:00:00.000Z",
    questions: [
      {
        id: "rollout",
        prompt: "Select a rollout strategy",
        options: [
          { id: "canary", label: "Canary first" },
          { id: "all-at-once", label: "All at once" },
        ],
        multiple: false,
        required: true,
        allowFreeformInput: false,
      },
      {
        id: "window",
        prompt: "Which maintenance window is approved?",
        options: [
          { id: "tonight", label: "Tonight, 22:00 UTC" },
          { id: "tomorrow", label: "Tomorrow, 08:00 UTC" },
        ],
        multiple: false,
        required: true,
        allowFreeformInput: true,
      },
    ],
  },
  {
    externalId: "approval-demo",
    kind: "approval",
    status: "pending",
    title: "Approve production deployment",
    summary: "Deploy build 2026.08.07.1 to the production environment.",
    taskId: "task-1043",
    runId: "run-23",
    taskTitle: "Release production build",
    createdAt: "2026-08-07T09:30:00.000Z",
    approval: { commentAllowed: true },
  },
];

const history: Decision[] = [
  {
    ...pending[1]!,
    externalId: "approval-history",
    status: "answered",
    title: "Approve staging deployment",
    summary: "Deploy build 2026.08.06.4 to the staging environment.",
    taskNumber: 1043,
    projectName: "Platform",
    resolvedAt: "2026-08-06T14:42:00.000Z",
    resolver: {
      type: "user",
      id: "demo-user",
      name: "Ada Lovelace",
      via: null,
    },
    approval: {
      commentAllowed: true,
      approved: true,
      comment: "Verified against the release checklist.",
    },
  },
];

let activePending = [...pending];
let settings: Settings = {
  notificationsEnabled: true,
  notificationSoundEnabled: false,
  notifyWhileActive: false,
  closeToTray: true,
  autostart: false,
};

const config: RuntimeConfig = {
  bffUrl: "http://127.0.0.1:8787",
  agentisUrl: "https://agentis.invalid",
};

export const demoApi: DesktopApi = {
  getConfig: async () => config,
  getSession: async () => session,
  beginTokenEntry: async () => undefined,
  cancelTokenEntry: async () => undefined,
  submitTokenEntry: async (_autostart: boolean) => session,
  logout: async () => undefined,
  getDecisions: async (view, page): Promise<DecisionListResponse> => ({
    items: view === "pending" ? activePending : history,
    page,
    pageSize: 20,
    hasNext: false,
  }),
  getPendingCount: async (): Promise<PendingCountResponse> => ({
    count: activePending.length,
  }),
  setPendingCount: async (_count: number) => undefined,
  resolve: async (request: ResolveRequest): Promise<ResolveResponse> => {
    activePending = activePending.filter(
      (item) => item.externalId !== request.externalId,
    );
    return { ok: true, externalId: request.externalId, status: "answered" };
  },
  getSettings: async () => settings,
  saveSettings: async (patch: SettingsPatch) => {
    settings = { ...settings, ...patch };
    return settings;
  },
  startEvents: async () => undefined,
  stopEvents: async () => undefined,
  openTask: async () => undefined,
  onDecisionChanged:
    (_listener: (event: DecisionChangedSseEvent) => void) => () =>
      undefined,
  onNotificationSound: (_listener: () => void) => () => undefined,
  onOpenPending: (_listener: () => void) => () => undefined,
  onTokenEntryState: (_listener: (state: { length: number }) => void) => () =>
    undefined,
  onTokenEntrySubmit: (_listener: () => void) => () => undefined,
  onEventsReconnected: (_listener: () => void) => () => undefined,
  onAuthRequired: (_listener: () => void) => () => undefined,
};
