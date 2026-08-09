export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isStaleCode(code: string): boolean {
  return code === "already_resolved" || code === "decision_cancelled";
}
