import { describe, expect, it, vi } from "vitest";
import type { Decision, Settings } from "@decision-inbox/contracts";
import {
  EncryptedValueStore,
  type SafeStorageLike,
} from "../src/main/encrypted-store";
import { NotificationManager } from "../src/main/notification-manager";

class FakeSafeStorage implements SafeStorageLike {
  available = true;
  isEncryptionAvailable(): boolean {
    return this.available;
  }
  encryptString(value: string): Buffer {
    return Buffer.from(`encrypted:${value}`);
  }
  decryptString(value: Buffer): string {
    return value.toString().replace(/^encrypted:/, "");
  }
}

function memoryFileSystem() {
  const files = new Map<string, string>();
  return {
    files,
    existsSync: (path: string) => files.has(path),
    readFileSync: (path: string) => files.get(path) ?? "",
    writeFileSync: (path: string, data: string) => {
      files.set(path, data);
    },
    unlinkSync: (path: string) => {
      files.delete(path);
    },
  };
}

const settings: Settings = {
  notificationsEnabled: true,
  notifyWhileActive: false,
  closeToTray: true,
  autostart: false,
};

const decision: Decision = {
  externalId: "question-1",
  kind: "question",
  status: "pending",
  title: "Private decision text must not be stored in notification state",
  taskId: "task-1",
  runId: "run-1",
  createdAt: "2026-08-07T10:00:00.000Z",
};

describe("main-process security and notifications", () => {
  it("fails closed when OS encryption is unavailable and stores ciphertext only", () => {
    const safeStorage = new FakeSafeStorage();
    const fileSystem = memoryFileSystem();
    const store = new EncryptedValueStore(
      "/token.json",
      safeStorage,
      fileSystem,
    );
    store.write("secret-token");
    expect(fileSystem.files.get("/token.json")).not.toContain("secret-token");
    expect(store.read()).toBe("secret-token");
    safeStorage.available = false;
    expect(() => store.write("new-token")).toThrow(
      "OS secure storage is unavailable",
    );
  });

  it("shows one initial summary and then only new pending events", () => {
    vi.useFakeTimers();
    const safeStorage = new FakeSafeStorage();
    const fileSystem = memoryFileSystem();
    const baseline = new EncryptedValueStore(
      "/baseline.json",
      safeStorage,
      fileSystem,
    );
    const deliver = vi.fn();
    const manager = new NotificationManager({
      baselineStore: baseline,
      settings,
      isWindowActive: () => false,
      deliver,
      burstMs: 10,
    });
    manager.load();
    manager.seedInitial([decision]);
    expect(deliver).toHaveBeenCalledWith({ count: 1, kinds: ["question"] });
    deliver.mockClear();
    manager.handleEvent({
      schema_version: 1,
      event_id: "event-2",
      transition: "created",
      decision_kind: "approval",
      external_id: "approval-1",
      task_id: "task-1",
      run_id: "run-1",
      status: "pending",
      occurred_at: "2026-08-07T10:01:00.000Z",
    });
    vi.advanceTimersByTime(11);
    expect(deliver).toHaveBeenCalledWith({ count: 1, kinds: ["approval"] });
    expect(fileSystem.files.get("/baseline.json")).not.toContain(
      "Private decision text",
    );

    manager.handleEvent({
      schema_version: 1,
      event_id: "event-3",
      transition: "cancelled",
      task_id: "task-1",
      status: "cancelled",
      occurred_at: "2026-08-07T10:02:00.000Z",
    });
    vi.useRealTimers();
  });
});
