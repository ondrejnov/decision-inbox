import fs from "node:fs";
import path from "node:path";
import { SettingsSchema, type Settings } from "@decision-inbox/contracts";
import type { SettingsPatch } from "../shared/ipc.js";

export const defaultSettings: Settings = {
  notificationsEnabled: true,
  notificationSoundEnabled: false,
  notifyWhileActive: false,
  closeToTray: true,
  autostart: false,
};

export class SettingsStore {
  private settings: Settings;

  constructor(private readonly filePath: string) {
    this.settings = this.read();
  }

  get(): Settings {
    return this.settings;
  }

  update(patch: SettingsPatch): Settings {
    const next = SettingsSchema.parse({ ...this.settings, ...patch });
    this.settings = next;
    fs.writeFileSync(this.filePath, JSON.stringify(next, null, 2), {
      mode: 0o600,
    });
    return next;
  }

  private read(): Settings {
    try {
      if (!fs.existsSync(this.filePath)) return defaultSettings;
      const value = JSON.parse(
        fs.readFileSync(this.filePath, "utf8"),
      ) as unknown;
      return SettingsSchema.parse(value);
    } catch {
      return defaultSettings;
    }
  }
}

export function settingsPath(userDataPath: string): string {
  return path.join(userDataPath, "settings.json");
}
