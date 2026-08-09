import { describe, expect, it } from "vitest";
import type { DecisionChangedEvent } from "@decision-inbox/contracts";
import type { GoogleAuth } from "google-auth-library";
import { FcmPushSender } from "../src/push-dispatcher.js";
import type { PushRegistration } from "../src/push-registration-store.js";

const registration: PushRegistration = {
  installationId: "installation-1",
  pushToken: "push-token-1",
  tenantId: "tenant-1",
  userId: "user-1",
  platform: "android",
  createdAt: "2026-08-09T00:00:00.000Z",
  updatedAt: "2026-08-09T00:00:00.000Z",
};

const event: DecisionChangedEvent = {
  schema_version: 1,
  event_id: "event-1",
  transition: "created",
  decision_kind: "question",
  tenant_id: "tenant-1",
  external_id: "question-1",
  task_id: "task-1",
  run_id: "run-1",
  status: "pending",
  occurred_at: "2026-08-09T00:00:00.000Z",
};

function authWithRequest(
  request: (options: Record<string, unknown>) => Promise<unknown>,
): GoogleAuth {
  return {
    getClient: async () => ({ request }),
  } as unknown as GoogleAuth;
}

describe("FCM push sender", () => {
  it("sends a generic high-priority pending-inbox notification", async () => {
    let request: Record<string, unknown> | undefined;
    const sender = new FcmPushSender(
      "firebase-project",
      authWithRequest(async (options) => {
        request = options;
        return {};
      }),
    );

    await expect(sender.send(registration, event)).resolves.toBe("sent");

    expect(request).toMatchObject({
      method: "POST",
      timeout: 10_000,
      url: "https://fcm.googleapis.com/v1/projects/firebase-project/messages:send",
      data: {
        message: {
          token: "push-token-1",
          notification: {
            title: "Decision Inbox",
            body: "A decision needs your attention.",
          },
          data: {
            schema_version: "1",
            route: "pending",
            event_id: "event-1",
          },
          android: {
            priority: "high",
            notification: { channel_id: "decision_inbox_pending" },
          },
        },
      },
    });
    expect(JSON.stringify(request)).not.toContain("question-1");
  });

  it("removes only provider-classified permanent tokens", async () => {
    const providerError = (errorCode: string) => ({
      response: { data: { error: { details: [{ errorCode }] } } },
    });
    const mismatched = new FcmPushSender(
      "firebase-project",
      authWithRequest(async () => {
        throw providerError("SENDER_ID_MISMATCH");
      }),
    );
    const invalidRequest = new FcmPushSender(
      "firebase-project",
      authWithRequest(async () => {
        throw providerError("INVALID_ARGUMENT");
      }),
    );

    await expect(mismatched.send(registration, event)).resolves.toBe(
      "invalid-token",
    );
    await expect(invalidRequest.send(registration, event)).rejects.toThrow(
      "FCM request failed.",
    );
  });
});
