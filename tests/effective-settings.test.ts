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

  it("merges only apiKey from local nativeAgent", () => {
    const eff = resolveEffective(DEFAULT_SETTINGS, {
      iclaudePath: "",
      nativeAgent: { apiKey: "secret" },
    });
    expect(eff.nativeAgent.apiKey).toBe("secret");
    expect(eff.nativeAgent.baseUrl).toBe(DEFAULT_SETTINGS.nativeAgent.baseUrl);
    expect(eff.nativeAgent.model).toBe(DEFAULT_SETTINGS.nativeAgent.model);
    expect(eff.nativeAgent.perOperation).toBe(DEFAULT_SETTINGS.nativeAgent.perOperation);
  });

  it("merges proxy.password from local into effective proxy", () => {
    const s = { ...DEFAULT_SETTINGS, proxy: { enabled: true, url: "http://p:1", username: "u" } };
    const eff = resolveEffective(s, { iclaudePath: "", proxy: { password: "pw" } });
    expect(eff.proxy.enabled).toBe(true);
    expect(eff.proxy.url).toBe("http://p:1");
    expect(eff.proxy.password).toBe("pw");
  });

  it("returns proxy from settings when local proxy absent", () => {
    const s = { ...DEFAULT_SETTINGS, proxy: { enabled: false, url: "" } };
    const eff = resolveEffective(s, { iclaudePath: "" });
    expect(eff.proxy.enabled).toBe(false);
    expect(eff.proxy.password).toBeUndefined();
  });

  it("claudeAgent comes fully from settings, not local", () => {
    const eff = resolveEffective(DEFAULT_SETTINGS, { iclaudePath: "" });
    expect(eff.claudeAgent.model).toBe(DEFAULT_SETTINGS.claudeAgent.model);
    expect(eff.claudeAgent.allowedTools).toBe(DEFAULT_SETTINGS.claudeAgent.allowedTools);
  });
});
