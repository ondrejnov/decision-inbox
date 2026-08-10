import type { DecisionChangedEvent } from "@decision-inbox/contracts";
import { GoogleAuth, type AuthClient } from "google-auth-library";
import type {
  PushRegistration,
  PushRegistrationStore,
} from "./push-registration-store.js";
import type { DesktopPresence } from "./desktop-presence-store.js";

export type PushSendResult = "sent" | "disabled" | "invalid-token";

export interface PushSender {
  send(
    registration: PushRegistration,
    event: DecisionChangedEvent,
  ): Promise<PushSendResult>;
}

export interface PushDispatcher {
  dispatch(event: DecisionChangedEvent): Promise<void>;
}

export class DisabledPushSender implements PushSender {
  async send(): Promise<PushSendResult> {
    return "disabled";
  }
}

function providerErrorCode(error: unknown): string | undefined {
  const response = (error as { response?: { data?: unknown } }).response;
  const root = response?.data as
    | { error?: { details?: Array<{ errorCode?: unknown }> } }
    | undefined;
  for (const detail of root?.error?.details ?? []) {
    if (typeof detail.errorCode === "string") return detail.errorCode;
  }
  return undefined;
}

export class FcmPushSender implements PushSender {
  private readonly auth: GoogleAuth;
  private authClient?: AuthClient;

  constructor(
    private readonly projectId: string,
    auth?: GoogleAuth,
  ) {
    this.auth =
      auth ??
      new GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
      });
  }

  async send(
    registration: PushRegistration,
    event: DecisionChangedEvent,
  ): Promise<PushSendResult> {
    try {
      const client = (this.authClient ??= await this.auth.getClient());
      await client.request({
        method: "POST",
        timeout: 10_000,
        url: `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/messages:send`,
        data: {
          message: {
            token: registration.pushToken,
            notification: {
              title: "Decision Inbox",
              body: "A decision needs your attention.",
            },
            data: {
              schema_version: "1",
              route: "pending",
              event_id: event.event_id,
            },
            android: {
              priority: "high",
              notification: {
                channel_id: "decision_inbox_pending",
              },
            },
          },
        },
      });
      return "sent";
    } catch (error) {
      const code = providerErrorCode(error);
      if (code === "UNREGISTERED" || code === "SENDER_ID_MISMATCH") {
        return "invalid-token";
      }
      throw new Error("FCM request failed.");
    }
  }
}

export class RegistrationPushDispatcher implements PushDispatcher {
  constructor(
    private readonly registrations: PushRegistrationStore,
    private readonly sender: PushSender,
    private readonly desktopPresence: DesktopPresence,
  ) {}

  async dispatch(event: DecisionChangedEvent): Promise<void> {
    if (
      event.transition !== "created" ||
      event.status !== "pending" ||
      !event.decision_kind ||
      !event.external_id
    ) {
      return;
    }

    let failures = 0;
    await Promise.all(
      this.registrations
        .listByTenant(event.tenant_id)
        .filter(
          (registration) =>
            !this.desktopPresence.isActive(
              registration.tenantId,
              registration.userId,
            ),
        )
        .map(async (registration) => {
          try {
            const result = await this.sender.send(registration, event);
            if (result === "invalid-token") {
              this.registrations.removeByToken(registration.pushToken);
            }
          } catch {
            failures += 1;
          }
        }),
    );
    if (failures > 0) throw new Error(`${failures} push request(s) failed.`);
  }
}
