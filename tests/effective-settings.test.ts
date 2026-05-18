import { describe, it, expect } from "vitest";
import { resolveEffective } from "../src/effective-settings";
import { DEFAULT_SETTINGS } from "../src/types";

describe("resolveEffective", () => {
  it("returns settings unchanged when local has no overrides", () => {
    const eff = resolveEffective(DEFAULT_SETTINGS, { iclaudePath: "" });
    expect(eff.backend).toBe(DEFAULT_SETTINGS.backend);
    expect(eff.nativeAgent.baseUrl).toBe(DEFAULT_SETTINGS.nativeAgent.baseUrl);
  });

  it("overrides backend when local backend set", () => {
    const eff = resolveEffective(DEFAULT_SETTINGS, { iclaudePath: "", backend: "native-agent" });
    expect(eff.backend).toBe("native-agent");
  });

  it("merges nativeAgent overrides while preserving non-overridden fields", () => {
    const eff = resolveEffective(DEFAULT_SETTINGS, {
      iclaudePath: "",
      nativeAgent: {
        baseUrl: "https://x/v1",
        apiKey: "k",
        model: "m",
        temperature: 0.5,
        topP: null,
      },
    });
    expect(eff.nativeAgent.baseUrl).toBe("https://x/v1");
    expect(eff.nativeAgent.apiKey).toBe("k");
    expect(eff.nativeAgent.perOperation).toBe(DEFAULT_SETTINGS.nativeAgent.perOperation);
    expect(eff.nativeAgent.operations).toEqual(DEFAULT_SETTINGS.nativeAgent.operations);
  });

  it("returns proxy from local when present", () => {
    const proxy = { enabled: true, url: "http://p:1" };
    const eff = resolveEffective(DEFAULT_SETTINGS, { iclaudePath: "", proxy });
    expect(eff.proxy).toEqual(proxy);
  });

  it("returns disabled default proxy when missing in local", () => {
    const eff = resolveEffective(DEFAULT_SETTINGS, { iclaudePath: "" });
    expect(eff.proxy).toEqual({ enabled: false, url: "" });
  });

  it("merges claudeAgent overrides", () => {
    const eff = resolveEffective(DEFAULT_SETTINGS, {
      iclaudePath: "",
      claudeAgent: { model: "haiku", allowedTools: "Read" },
    });
    expect(eff.claudeAgent.model).toBe("haiku");
    expect(eff.claudeAgent.allowedTools).toBe("Read");
    expect(eff.claudeAgent.perOperation).toBe(DEFAULT_SETTINGS.claudeAgent.perOperation);
  });
});
