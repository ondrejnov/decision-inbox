import path from "node:path";
import type { SafeStorageLike } from "./encrypted-store.js";
import { EncryptedValueStore } from "./encrypted-store.js";

export class CredentialStore {
  private readonly store: EncryptedValueStore;

  constructor(userDataPath: string, safeStorage: SafeStorageLike) {
    this.store = new EncryptedValueStore(
      path.join(userDataPath, "agentis-token.json"),
      safeStorage,
    );
  }

  getToken(): string | null {
    return this.store.read();
  }

  saveToken(token: string): void {
    const normalized = token.trim();
    if (!normalized) throw new Error("An Agentis token is required.");
    this.store.write(normalized);
  }

  clear(): void {
    this.store.clear();
  }
}
