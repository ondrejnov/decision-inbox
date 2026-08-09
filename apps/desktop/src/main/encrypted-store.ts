import fs from "node:fs";

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface FileSystemLike {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: "utf8"): string;
  writeFileSync(path: string, data: string, options: { mode: number }): void;
  unlinkSync(path: string): void;
}

const nodeFileSystem: FileSystemLike = {
  existsSync: fs.existsSync,
  readFileSync: (path, encoding) => fs.readFileSync(path, encoding),
  writeFileSync: (path, data, options) => fs.writeFileSync(path, data, options),
  unlinkSync: fs.unlinkSync,
};

/** Stores ciphertext only. If OS encryption is unavailable, it fails closed. */
export class EncryptedValueStore {
  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageLike,
    private readonly fileSystem: FileSystemLike = nodeFileSystem,
  ) {}

  read(): string | null {
    if (!this.fileSystem.existsSync(this.filePath)) return null;
    const stored = JSON.parse(
      this.fileSystem.readFileSync(this.filePath, "utf8"),
    ) as { ciphertext?: unknown };
    if (typeof stored.ciphertext !== "string" || !stored.ciphertext) {
      throw new Error("Encrypted credential store is invalid.");
    }
    this.assertAvailable();
    return this.safeStorage.decryptString(
      Buffer.from(stored.ciphertext, "base64"),
    );
  }

  write(value: string): void {
    this.assertAvailable();
    const ciphertext = this.safeStorage.encryptString(value).toString("base64");
    this.fileSystem.writeFileSync(
      this.filePath,
      JSON.stringify({ version: 1, ciphertext }),
      { mode: 0o600 },
    );
  }

  clear(): void {
    if (this.fileSystem.existsSync(this.filePath))
      this.fileSystem.unlinkSync(this.filePath);
  }

  private assertAvailable(): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error(
        "OS secure storage is unavailable; credentials were not persisted.",
      );
    }
  }
}
