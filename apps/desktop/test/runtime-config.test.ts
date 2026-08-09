import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../src/main/runtime-config";

describe("desktop runtime config", () => {
  it("uses the public Agentis URL by default", () => {
    expect(loadRuntimeConfig({})).toEqual({
      bffUrl: "http://127.0.0.1:8787",
      agentisUrl: "https://agentis.cz",
    });
  });

  it("allows the Agentis URL to be overridden", () => {
    expect(
      loadRuntimeConfig({ AGENTIS_WEB_URL: "https://staging.agentis.cz" })
        .agentisUrl,
    ).toBe("https://staging.agentis.cz");
  });
});
