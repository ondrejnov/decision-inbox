import { describe, expect, it, vi } from "vitest";
import { SseClient } from "../src/main/sse-client";

describe("SseClient", () => {
  it("stops and asks for re-authentication on an unauthorized stream", async () => {
    const onUnauthorized = vi.fn();
    const client = new SseClient({
      url: "https://decisions.example.com/v1/events",
      getToken: () => "expired-token",
      onEvent: vi.fn(),
      onUnauthorized,
      fetchImpl: async () => new Response(null, { status: 401 }),
    });

    client.start();
    await vi.waitFor(() => expect(onUnauthorized).toHaveBeenCalledOnce());
    client.stop();
  });
});
