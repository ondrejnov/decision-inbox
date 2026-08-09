import path from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  nativeImage,
  Notification,
  safeStorage,
  shell,
  Tray,
  ipcMain,
} from "electron";
import {
  ResolveRequestSchema,
  type DecisionChangedSseEvent,
} from "@decision-inbox/contracts";
import { BffClient, BffClientError } from "./bff-client.js";
import { CredentialStore } from "./credential-store.js";
import { EncryptedValueStore } from "./encrypted-store.js";
import { NotificationManager } from "./notification-manager.js";
import { SseClient } from "./sse-client.js";
import { loadRuntimeConfig } from "./runtime-config.js";
import { SettingsStore, settingsPath } from "./settings-store.js";
import type { SettingsPatch } from "../shared/ipc.js";

const directory = __dirname;
const hasSingleInstance = app.requestSingleInstanceLock();
// Windows nativeImage does not decode SVG; inline PNGs also avoid dev/package asset paths.
const trayIconPng = {
  idle: "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA1UlEQVR4nGPwd3vKgIYN/N2ezvd3e3rf3+3pfyrh+1AzDdDtQ+YI+Ls97aeipbhwP9QuFAeABM7TwXIYPg9zBMwB9PA5tpBggMU5vS2HYQMGaOIYKAfMZ6ByaicV32cYQMvBeNQBow4YOg5YvvjTf2IBSO2oA0YdMOoAqjqguuTN/727vhLtAJBakB6qOQDkI3T88sUfuIUgNjY1VI0CdHz54k+4A0Bscs0h2wEFma/+f/n8F4xBbLo7gFp4UDTJBrxROuDN8gHvmAyKrtmAd04HrHsOABp3SqtVi2baAAAAAElFTkSuQmCC",
  pending:
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA1UlEQVR4nGO4o6bGgIYN7qipzb+jpnb/jprafyrh+1AzDdDtQ+YI3FFT66eipbhwP9QuFAeABM7TwXIYPg9zBMwB9PA5tpBggMU5vS2HYQMGaOIYKAfMZ6ByaicV32cYQMvBeNQBow4YOg54N3nyf2IBSO2oA0YdMOoAqjrgaUzM/0/r1hHtAJBakB6qOQDkI3T8+8kTuIUgNjY1VI0CdPzt5Em4A0Bscs0h2wGP/f3///34EYxBbLo7gFp4UDTJBrxROuDN8gHvmAyKrtmAd04HrHsOAIl0I8gkkbxlAAAAAElFTkSuQmCC",
} as const;

if (!hasSingleInstance) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | undefined;
  let tray: Tray | undefined;
  let isQuitting = false;
  let bff: BffClient;
  let sse: SseClient;
  let credentials: CredentialStore;
  let settings: SettingsStore;
  let notifications: NotificationManager;
  let tokenEntryActive = false;
  let tokenBuffer = "";
  const runtimeConfig = loadRuntimeConfig();

  function showInbox(): void {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("open-pending");
  }

  function configureAutostart(enabled: boolean): void {
    if (
      process.platform === "linux" ||
      process.platform === "win32" ||
      process.platform === "darwin"
    ) {
      app.setLoginItemSettings({ openAtLogin: enabled });
    }
  }

  function notificationBody(summary: {
    count: number;
    kinds: string[];
  }): string {
    const labels = summary.kinds.map((kind) => {
      const label = kind === "question" ? "question" : "approval";
      return summary.count === 1 ? label : `${label}s`;
    });
    return `${summary.count} new ${labels.join(" and ")} require your attention`;
  }

  function trayIcon(hasPending = false): Electron.NativeImage {
    const icon = hasPending ? trayIconPng.pending : trayIconPng.idle;
    return nativeImage.createFromBuffer(Buffer.from(icon, "base64"));
  }

  function updateTrayPendingCount(value: number): void {
    if (!tray) return;
    tray.setImage(trayIcon(value > 0));
    tray.setToolTip(
      value > 0 ? `Decision Inbox · ${value} pending` : "Decision Inbox",
    );
  }

  async function syncInitialNotifications(): Promise<void> {
    try {
      const pending = await bff.getDecisions("pending", 1);
      notifications.seedInitial(pending.items);
    } catch {
      // A failed sync is rendered as offline state; it must not expose token/content in logs.
    }
  }

  function emitTokenEntryState(): void {
    mainWindow?.webContents.send("token-entry-state", {
      length: tokenBuffer.length,
    });
  }

  function clearTokenEntry(): void {
    tokenBuffer = "";
    tokenEntryActive = false;
    emitTokenEntryState();
  }

  function appendToken(value: string): void {
    if (!value) return;
    tokenBuffer = `${tokenBuffer}${value}`.slice(0, 4096);
    emitTokenEntryState();
  }

  function captureTokenInput(
    event: Electron.Event,
    input: Electron.Input,
  ): void {
    if (!tokenEntryActive || input.type !== "keyDown") return;
    event.preventDefault();
    const modifiers = input.modifiers ?? [];
    const modifiedPaste =
      (modifiers.includes("control") || modifiers.includes("command")) &&
      input.key.toLowerCase() === "v";
    if (modifiedPaste) {
      appendToken(clipboard.readText());
    } else if (input.key === "Backspace") {
      tokenBuffer = tokenBuffer.slice(0, -1);
      emitTokenEntryState();
    } else if (input.key === "Delete") {
      clearTokenEntry();
    } else if (input.key === "Escape") {
      clearTokenEntry();
    } else if (input.key === "Enter") {
      mainWindow?.webContents.send("token-entry-submit");
    } else if (input.key.length === 1) {
      appendToken(input.key);
    }
  }

  async function submitTokenEntry(autostart: boolean): Promise<unknown> {
    const token = tokenBuffer.trim();
    if (!token) {
      throw new BffClientError(
        400,
        "token_required",
        "An Agentis token is required.",
      );
    }
    clearTokenEntry();
    const session = await bff.onboard(token);
    settings.update({ autostart });
    configureAutostart(settings.get().autostart);
    await syncInitialNotifications();
    return session;
  }

  function createWindow(): BrowserWindow {
    const window = new BrowserWindow({
      width: 960,
      height: 720,
      minWidth: 820,
      minHeight: 600,
      backgroundColor: "#f7f8fb",
      show: false,
      webPreferences: {
        preload: path.join(directory, "../preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("before-input-event", captureTokenInput);
    window.on("close", (event) => {
      if (!isQuitting && settings.get().closeToTray) {
        event.preventDefault();
        window.hide();
      }
    });
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (rendererUrl) {
      void window.loadURL(rendererUrl);
    } else {
      void window.loadFile(path.join(directory, "../renderer/index.html"));
    }
    return window;
  }

  function createTray(): Tray {
    const nextTray = new Tray(trayIcon());
    nextTray.setToolTip("Decision Inbox");
    nextTray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open pending inbox", click: showInbox },
        { type: "separator" },
        {
          label: "Quit",
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ]),
    );
    nextTray.on("click", showInbox);
    return nextTray;
  }

  function registerIpc(): void {
    ipcMain.handle("get-config", () => runtimeConfig);
    ipcMain.handle("get-session", async () => bff.getSession());
    ipcMain.handle("begin-token-entry", () => {
      tokenBuffer = "";
      tokenEntryActive = true;
      emitTokenEntryState();
    });
    ipcMain.handle("cancel-token-entry", () => clearTokenEntry());
    ipcMain.handle("submit-token-entry", (_event, autostart: unknown) =>
      submitTokenEntry(autostart === true),
    );
    ipcMain.handle("logout", async () => {
      sse.stop();
      await bff.logout();
      notifications.clear();
      updateTrayPendingCount(0);
    });
    ipcMain.handle(
      "get-decisions",
      async (_event, view: unknown, page: unknown) => {
        if (
          (view !== "pending" && view !== "history") ||
          typeof page !== "number"
        ) {
          throw new Error("Invalid decision query.");
        }
        return bff.getDecisions(view, page);
      },
    );
    ipcMain.handle("get-pending-count", () => bff.getPendingCount());
    ipcMain.handle("set-pending-count", (_event, value: unknown) => {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new Error("Invalid pending count.");
      }
      updateTrayPendingCount(value);
    });
    ipcMain.handle("resolve", (_event, request: unknown) => {
      const parsed = ResolveRequestSchema.safeParse(request);
      if (!parsed.success) {
        throw new BffClientError(
          400,
          "invalid_request",
          "The decision resolution payload is invalid.",
        );
      }
      return bff.resolve(parsed.data);
    });
    ipcMain.handle("get-settings", () => settings.get());
    ipcMain.handle("save-settings", (_event, value: unknown) => {
      const patch = (value ?? {}) as SettingsPatch;
      const next = settings.update(patch);
      configureAutostart(next.autostart);
      notifications.setSettings(next);
      return next;
    });
    ipcMain.handle("start-events", (_event, lastEventId?: unknown) => {
      sse.start(typeof lastEventId === "string" ? lastEventId : undefined);
    });
    ipcMain.handle("stop-events", () => sse.stop());
    ipcMain.handle(
      "open-task",
      async (_event, taskId: unknown, runId: unknown) => {
        if (
          typeof taskId !== "string" ||
          typeof runId !== "string" ||
          !/^[\w.:-]+$/.test(taskId) ||
          !/^[\w.:-]+$/.test(runId)
        ) {
          throw new Error("Invalid task link.");
        }
        const url = new URL(
          `/task/${encodeURIComponent(taskId)}?openRun=${encodeURIComponent(runId)}`,
          runtimeConfig.agentisUrl,
        );
        await shell.openExternal(url.toString());
      },
    );
  }

  app.on("second-instance", () => showInbox());
  app
    .whenReady()
    .then(() => {
      Menu.setApplicationMenu(null);
      credentials = new CredentialStore(app.getPath("userData"), safeStorage);
      settings = new SettingsStore(settingsPath(app.getPath("userData")));
      bff = new BffClient(runtimeConfig.bffUrl, credentials);
      const baselineStore = new EncryptedValueStore(
        path.join(app.getPath("userData"), "notification-baseline.json"),
        safeStorage,
      );
      notifications = new NotificationManager({
        baselineStore,
        settings: settings.get(),
        isWindowActive: () => mainWindow?.isFocused() ?? false,
        deliver: (summary) => {
          if (!Notification.isSupported()) return;
          const notification = new Notification({
            title: "Decision Inbox",
            body: notificationBody(summary),
            silent: true,
          });
          notification.on("click", showInbox);
          notification.show();
        },
      });
      notifications.load();
      mainWindow = createWindow();
      sse = new SseClient({
        url: bff.getEventStreamUrl(),
        getToken: () => bff.getStoredToken(),
        onEvent: (event: DecisionChangedSseEvent) => {
          notifications.handleEvent(event);
          mainWindow?.webContents.send("decision-changed", event);
        },
        onConnected: () => mainWindow?.webContents.send("events-reconnected"),
        onUnauthorized: () => mainWindow?.webContents.send("auth-required"),
      });
      tray = createTray();
      registerIpc();
      configureAutostart(settings.get().autostart);
      mainWindow.once("ready-to-show", () => {
        const launchedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;
        if (!launchedAtLogin || !settings.get().autostart) mainWindow?.show();
        void syncInitialNotifications();
      });
    })
    .catch(() => {
      app.quit();
    });

  app.on("before-quit", () => {
    isQuitting = true;
    sse?.stop();
    tray?.destroy();
  });
}
