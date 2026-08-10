import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Settings } from "@decision-inbox/contracts";
import type { DesktopApi } from "../src/shared/ipc";
import { SettingsPanel } from "../src/renderer/components/SettingsPanel";

const settings: Settings = {
  notificationsEnabled: true,
  notificationSoundEnabled: false,
  notifyWhileActive: false,
  closeToTray: true,
  autostart: false,
};

describe("SettingsPanel", () => {
  it("enables the notification sound preference", async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn(async () => ({
      ...settings,
      notificationSoundEnabled: true,
    }));
    const api = { saveSettings } as unknown as DesktopApi;
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <SettingsPanel api={api} settings={settings} onChange={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.click(
      screen.getByRole("checkbox", { name: /Notification sound/i }),
    );

    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith({
        notificationSoundEnabled: true,
      }),
    );
  });
});
