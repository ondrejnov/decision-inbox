import { describe, expect, it } from "vitest";
import {
  AndroidPushRegistrationParamsSchema,
  AndroidPushRegistrationRequestSchema,
  DesktopPresenceRequestSchema,
  DesktopPresenceResponseSchema,
  PushRegistrationResponseSchema,
} from "@decision-inbox/contracts";

describe("Android push contracts", () => {
  it("accepts the exact registration and response shapes", () => {
    const pushToken = "p".repeat(32);
    expect(
      AndroidPushRegistrationRequestSchema.parse({
        installationId: "installation-1",
        pushToken,
        platform: "android",
      }),
    ).toEqual({
      installationId: "installation-1",
      pushToken,
      platform: "android",
    });
    expect(
      AndroidPushRegistrationParamsSchema.parse({
        installationId: "installation-1",
      }),
    ).toEqual({ installationId: "installation-1" });
    expect(PushRegistrationResponseSchema.parse({ ok: true })).toEqual({
      ok: true,
    });
  });

  it("rejects unknown properties, oversized identifiers/tokens, and other platforms", () => {
    const valid = {
      installationId: "installation-1",
      pushToken: "p".repeat(32),
      platform: "android" as const,
    };
    expect(
      AndroidPushRegistrationRequestSchema.safeParse({
        ...valid,
        tenantId: "client-controlled",
      }).success,
    ).toBe(false);
    expect(
      AndroidPushRegistrationRequestSchema.safeParse({
        ...valid,
        installationId: "i".repeat(257),
      }).success,
    ).toBe(false);
    expect(
      AndroidPushRegistrationRequestSchema.safeParse({
        ...valid,
        pushToken: "too-short",
      }).success,
    ).toBe(false);
    expect(
      AndroidPushRegistrationRequestSchema.safeParse({
        ...valid,
        pushToken: "t".repeat(4_097),
      }).success,
    ).toBe(false);
    expect(
      AndroidPushRegistrationRequestSchema.safeParse({
        ...valid,
        platform: "ios",
      }).success,
    ).toBe(false);
    expect(
      PushRegistrationResponseSchema.safeParse({ ok: true, token: "secret" })
        .success,
    ).toBe(false);
  });
});

describe("desktop presence contracts", () => {
  it("accepts only an explicit active state and generic response", () => {
    expect(DesktopPresenceRequestSchema.parse({ active: true })).toEqual({
      active: true,
    });
    expect(DesktopPresenceResponseSchema.parse({ ok: true })).toEqual({
      ok: true,
    });
    expect(
      DesktopPresenceRequestSchema.safeParse({ active: true, userId: "user-2" })
        .success,
    ).toBe(false);
  });
});
