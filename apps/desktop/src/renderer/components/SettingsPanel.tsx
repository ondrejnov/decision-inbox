import { useMutation } from "@tanstack/react-query";
import { BellIcon, BellSlashIcon, GearSixIcon } from "@phosphor-icons/react";
import type { Settings } from "@decision-inbox/contracts";
import type { DesktopApi, SettingsPatch } from "../../shared/ipc";

interface SettingsPanelProps {
  api: DesktopApi;
  settings: Settings;
  onChange: (settings: Settings) => void;
}

export function SettingsPanel({ api, settings, onChange }: SettingsPanelProps) {
  const mutation = useMutation({
    mutationFn: (patch: SettingsPatch) => api.saveSettings(patch),
    onSuccess: onChange,
  });

  function update(patch: SettingsPatch): void {
    mutation.mutate(patch);
  }

  return (
    <section
      className="absolute right-0 top-12 z-20 w-72 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl shadow-slate-900/10"
      aria-label="Notification settings"
    >
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <GearSixIcon size={18} className="text-indigo-600" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-slate-900">Settings</h2>
      </div>
      <div className="space-y-3 pt-3 text-sm">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={settings.notificationsEnabled}
            onChange={(event) =>
              update({ notificationsEnabled: event.target.checked })
            }
            className="mt-0.5 size-4 accent-indigo-600"
          />
          <span className="flex gap-2">
            <BellIcon
              size={17}
              className="mt-0.5 text-slate-400"
              aria-hidden="true"
            />
            <span>
              <strong className="font-medium text-slate-800">
                Notifications
              </strong>
              <br />
              <span className="text-xs text-slate-500">
                Show new pending decisions.
              </span>
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={settings.notifyWhileActive}
            onChange={(event) =>
              update({ notifyWhileActive: event.target.checked })
            }
            className="mt-0.5 size-4 accent-indigo-600"
          />
          <span className="flex gap-2">
            <BellSlashIcon
              size={17}
              className="mt-0.5 text-slate-400"
              aria-hidden="true"
            />
            <span>
              <strong className="font-medium text-slate-800">
                Notify while active
              </strong>
              <br />
              <span className="text-xs text-slate-500">
                Allow notifications while this window is focused.
              </span>
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={settings.closeToTray}
            onChange={(event) => update({ closeToTray: event.target.checked })}
            className="mt-0.5 size-4 accent-indigo-600"
          />
          <span>
            <strong className="font-medium text-slate-800">
              Close to tray
            </strong>
            <br />
            <span className="text-xs text-slate-500">
              Keep the inbox available in the tray.
            </span>
          </span>
        </label>
      </div>
      {mutation.isError ? (
        <p role="alert" className="mt-3 text-xs text-rose-600">
          Could not save settings.
        </p>
      ) : null}
    </section>
  );
}
