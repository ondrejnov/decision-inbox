import {
  DecisionChangedSseEventSchema,
  type DecisionChangedSseEvent,
} from "@decision-inbox/contracts";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface SseClientOptions {
  url: string;
  getToken: () => string;
  onEvent: (event: DecisionChangedSseEvent) => void;
  onConnected?: () => void;
  onUnauthorized?: () => void;
  fetchImpl?: FetchLike;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class SseClient {
  private readonly fetchImpl: FetchLike;
  private running = false;
  private controller: AbortController | undefined;
  private lastEventId: string | undefined;

  constructor(private readonly options: SseClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  start(lastEventId?: string): void {
    if (this.running) return;
    this.running = true;
    this.lastEventId = lastEventId ?? this.lastEventId;
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.controller?.abort();
    this.controller = undefined;
  }

  private async loop(): Promise<void> {
    let retryMs = 1_000;
    while (this.running) {
      try {
        await this.consumeConnection();
        retryMs = 1_000;
      } catch {
        if (!this.running) return;
        await wait(retryMs);
        retryMs = Math.min(retryMs * 2, 30_000);
      }
    }
  }

  private async consumeConnection(): Promise<void> {
    this.controller = new AbortController();
    const headers: Record<string, string> = {
      accept: "text/event-stream",
      "X-Auth-Token": this.options.getToken(),
    };
    if (this.lastEventId) headers["Last-Event-ID"] = this.lastEventId;
    const response = await this.fetchImpl(this.options.url, {
      headers,
      signal: this.controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      this.running = false;
      this.options.onUnauthorized?.();
      return;
    }
    if (!response.ok || !response.body)
      throw new Error("SSE connection failed.");
    this.options.onConnected?.();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventId = "";
    let data = "";
    while (this.running) {
      const result = await reader.read();
      if (result.done) throw new Error("SSE connection closed.");
      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line === "") {
          if (data) {
            const parsed = DecisionChangedSseEventSchema.safeParse(
              JSON.parse(data),
            );
            if (parsed.success) {
              eventId = parsed.data.event_id || eventId;
              this.lastEventId = eventId;
              this.options.onEvent(parsed.data);
            }
          }
          eventId = "";
          data = "";
        } else if (line.startsWith("id:")) {
          eventId = line.slice(3).trim();
        } else if (line.startsWith("data:")) {
          data += line.slice(5).trim();
        }
      }
    }
  }
}
