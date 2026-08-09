import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqlitePushRegistrationStore } from "../src/push-registration-store.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite push registration store", () => {
  it("persists registrations across database reopen", () => {
    const directory = mkdtempSync(join(tmpdir(), "decision-inbox-push-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "nested", "registrations.sqlite");
    const first = new SqlitePushRegistrationStore({ path });
    first.register({
      installationId: "installation-1",
      pushToken: "token-1",
      platform: "android",
      tenantId: "tenant-1",
      userId: "user-1",
    });
    first.close();

    const reopened = new SqlitePushRegistrationStore({ path });
    expect(reopened.listByTenant("tenant-1")).toMatchObject([
      {
        installationId: "installation-1",
        pushToken: "token-1",
        platform: "android",
        tenantId: "tenant-1",
        userId: "user-1",
      },
    ]);
    reopened.close();
  });

  it("upserts installations and cleanly reassigns unique tokens", () => {
    let now = new Date("2026-08-09T10:00:00.000Z");
    const store = new SqlitePushRegistrationStore({
      path: ":memory:",
      now: () => now,
    });
    store.register({
      installationId: "installation-1",
      pushToken: "token-1",
      platform: "android",
      tenantId: "tenant-1",
      userId: "user-1",
    });
    now = new Date("2026-08-09T11:00:00.000Z");
    store.register({
      installationId: "installation-1",
      pushToken: "token-2",
      platform: "android",
      tenantId: "tenant-2",
      userId: "user-2",
    });
    store.register({
      installationId: "installation-2",
      pushToken: "token-2",
      platform: "android",
      tenantId: "tenant-3",
      userId: "user-3",
    });

    expect(store.listByTenant("tenant-1")).toEqual([]);
    expect(store.listByTenant("tenant-2")).toEqual([]);
    expect(store.listByTenant("tenant-3")).toMatchObject([
      {
        installationId: "installation-2",
        pushToken: "token-2",
        tenantId: "tenant-3",
        userId: "user-3",
      },
    ]);
    store.close();
  });

  it("isolates tenant listings and requires matching ownership to unregister", () => {
    const store = new SqlitePushRegistrationStore({ path: ":memory:" });
    store.register({
      installationId: "installation-1",
      pushToken: "token-1",
      platform: "android",
      tenantId: "tenant-1",
      userId: "user-1",
    });
    store.register({
      installationId: "installation-2",
      pushToken: "token-2",
      platform: "android",
      tenantId: "tenant-2",
      userId: "user-2",
    });

    expect(store.listByTenant("tenant-1")).toHaveLength(1);
    expect(store.listByTenant("tenant-2")).toHaveLength(1);
    expect(store.unregister("installation-1", "tenant-2", "user-1")).toBe(
      false,
    );
    expect(store.unregister("installation-1", "tenant-1", "user-2")).toBe(
      false,
    );
    expect(store.unregister("installation-1", "tenant-1", "user-1")).toBe(true);
    expect(store.listByTenant("tenant-1")).toEqual([]);
    expect(store.listByTenant("tenant-2")).toHaveLength(1);
    store.close();
  });

  it("bounds registrations per tenant user while retaining the current installation", () => {
    let hour = 10;
    const store = new SqlitePushRegistrationStore({
      path: ":memory:",
      maxRegistrationsPerUser: 2,
      now: () => new Date(`2026-08-09T${hour++}:00:00.000Z`),
    });
    for (const id of ["installation-1", "installation-2", "installation-3"]) {
      store.register({
        installationId: id,
        pushToken: `token-${id}`,
        platform: "android",
        tenantId: "tenant-1",
        userId: "user-1",
      });
    }
    store.register({
      installationId: "other-user-installation",
      pushToken: "other-user-token",
      platform: "android",
      tenantId: "tenant-1",
      userId: "user-2",
    });

    expect(
      store
        .listByTenant("tenant-1")
        .filter((registration) => registration.userId === "user-1")
        .map((registration) => registration.installationId),
    ).toEqual(["installation-2", "installation-3"]);
    expect(store.listByTenant("tenant-1")).toHaveLength(3);
    store.close();
  });
});
