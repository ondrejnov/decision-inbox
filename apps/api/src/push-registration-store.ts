import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { AndroidPushRegistrationRequest } from "@decision-inbox/contracts";

export interface PushRegistration extends AndroidPushRegistrationRequest {
  tenantId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterPushInput extends AndroidPushRegistrationRequest {
  tenantId: string;
  userId: string;
}

export interface PushRegistrationStore {
  register(input: RegisterPushInput): void;
  unregister(installationId: string, tenantId: string, userId: string): boolean;
  listByTenant(tenantId: string): PushRegistration[];
  removeByToken(pushToken: string): void;
  close(): void;
}

export interface SqlitePushRegistrationStoreOptions {
  path: string;
  now?: () => Date;
  maxRegistrationsPerUser?: number;
}

interface RegistrationRow {
  installation_id: string;
  push_token: string;
  tenant_id: string;
  user_id: string;
  platform: "android";
  created_at: string;
  updated_at: string;
}

export class SqlitePushRegistrationStore implements PushRegistrationStore {
  private readonly database: DatabaseSync;
  private readonly deleteOtherTokenOwner: StatementSync;
  private readonly upsertRegistration: StatementSync;
  private readonly unregisterRegistration: StatementSync;
  private readonly listTenantRegistrations: StatementSync;
  private readonly removeToken: StatementSync;
  private readonly pruneUserRegistrations: StatementSync;
  private readonly now: () => Date;
  private readonly maxRegistrationsPerUser: number;

  constructor(options: SqlitePushRegistrationStoreOptions) {
    if (options.path !== ":memory:") {
      mkdirSync(dirname(options.path), { recursive: true });
    }
    this.now = options.now ?? (() => new Date());
    this.maxRegistrationsPerUser = options.maxRegistrationsPerUser ?? 20;
    if (
      !Number.isInteger(this.maxRegistrationsPerUser) ||
      this.maxRegistrationsPerUser < 1
    ) {
      throw new RangeError(
        "maxRegistrationsPerUser must be a positive integer.",
      );
    }
    this.database = new DatabaseSync(options.path);
    this.database.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS push_registrations (
        installation_id TEXT PRIMARY KEY,
        push_token TEXT NOT NULL UNIQUE,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        platform TEXT NOT NULL CHECK (platform = 'android'),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS push_registrations_tenant_id_idx
        ON push_registrations (tenant_id);
    `);
    this.deleteOtherTokenOwner = this.database.prepare(`
      DELETE FROM push_registrations
      WHERE push_token = ? AND installation_id <> ?
    `);
    this.upsertRegistration = this.database.prepare(`
      INSERT INTO push_registrations (
        installation_id, push_token, tenant_id, user_id, platform,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (installation_id) DO UPDATE SET
        push_token = excluded.push_token,
        tenant_id = excluded.tenant_id,
        user_id = excluded.user_id,
        platform = excluded.platform,
        updated_at = excluded.updated_at
    `);
    this.unregisterRegistration = this.database.prepare(`
      DELETE FROM push_registrations
      WHERE installation_id = ? AND tenant_id = ? AND user_id = ?
    `);
    this.listTenantRegistrations = this.database.prepare(`
      SELECT installation_id, push_token, tenant_id, user_id, platform,
             created_at, updated_at
      FROM push_registrations
      WHERE tenant_id = ?
      ORDER BY installation_id
    `);
    this.removeToken = this.database.prepare(`
      DELETE FROM push_registrations WHERE push_token = ?
    `);
    this.pruneUserRegistrations = this.database.prepare(`
      DELETE FROM push_registrations
      WHERE installation_id IN (
        SELECT installation_id
        FROM push_registrations
        WHERE tenant_id = ? AND user_id = ? AND installation_id <> ?
        ORDER BY updated_at DESC, installation_id DESC
        LIMIT -1 OFFSET ?
      )
    `);
  }

  register(input: RegisterPushInput): void {
    const timestamp = this.now().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.deleteOtherTokenOwner.run(input.pushToken, input.installationId);
      this.upsertRegistration.run(
        input.installationId,
        input.pushToken,
        input.tenantId,
        input.userId,
        input.platform,
        timestamp,
        timestamp,
      );
      this.pruneUserRegistrations.run(
        input.tenantId,
        input.userId,
        input.installationId,
        this.maxRegistrationsPerUser - 1,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  unregister(
    installationId: string,
    tenantId: string,
    userId: string,
  ): boolean {
    return (
      Number(
        this.unregisterRegistration.run(installationId, tenantId, userId)
          .changes,
      ) > 0
    );
  }

  listByTenant(tenantId: string): PushRegistration[] {
    return (
      this.listTenantRegistrations.all(tenantId) as unknown as RegistrationRow[]
    ).map((row) => ({
      installationId: row.installation_id,
      pushToken: row.push_token,
      tenantId: row.tenant_id,
      userId: row.user_id,
      platform: row.platform,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  removeByToken(pushToken: string): void {
    this.removeToken.run(pushToken);
  }

  close(): void {
    this.database.close();
  }
}
