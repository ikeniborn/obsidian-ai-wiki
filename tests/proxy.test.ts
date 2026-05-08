import { describe, it, expect } from "vitest";
import { buildProxyUrl, createProxyDispatcher, createProxyFetch, maskProxyUrl, parseNoProxy, shouldBypass } from "../src/proxy";
import { __setPlatformMobile } from "obsidian";

describe("createProxyDispatcher", () => {
  it("returns null when disabled", () => {
    expect(createProxyDispatcher({ enabled: false, url: "http://p:1" })).toBeNull();
  });
  it("returns null on mobile", () => {
    __setPlatformMobile(true);
    try {
      expect(createProxyDispatcher({ enabled: true, url: "http://p:1" })).toBeNull();
    } finally {
      __setPlatformMobile(false);
    }
  });
  it("returns Dispatcher when enabled on desktop", () => {
    const d = createProxyDispatcher({ enabled: true, url: "http://p:1" });
    expect(d).not.toBeNull();
    expect(typeof (d as { dispatch?: unknown }).dispatch).toBe("function");
  });
});

describe("createProxyFetch", () => {
  it("returns null when no dispatcher (mobile)", () => {
    __setPlatformMobile(true);
    try {
      expect(createProxyFetch({ enabled: true, url: "http://p:1" })).toBeNull();
    } finally {
      __setPlatformMobile(false);
    }
  });
  it("returns null when disabled", () => {
    expect(createProxyFetch({ enabled: false, url: "http://p:1" })).toBeNull();
  });
  it("returns a function on desktop when enabled", () => {
    const f = createProxyFetch({ enabled: true, url: "http://p:1" });
    expect(typeof f).toBe("function");
  });
});

describe("buildProxyUrl", () => {
  it("returns url unchanged when no creds", () => {
    expect(buildProxyUrl({ enabled: true, url: "http://proxy:8080" }))
      .toBe("http://proxy:8080/");
  });
  it("embeds and url-encodes user/pass", () => {
    const out = buildProxyUrl({
      enabled: true,
      url: "http://proxy:8080",
      username: "alice@corp",
      password: "p@ss:word/!",
    });
    expect(out).toContain("alice%40corp:p%40ss%3Aword%2F!@proxy:8080");
  });
  it("throws on malformed url", () => {
    expect(() => buildProxyUrl({ enabled: true, url: "::not a url" }))
      .toThrow();
  });
  it("encodes spaces in password", () => {
    const out = buildProxyUrl({
      enabled: true,
      url: "http://h:1",
      username: "u",
      password: "a b",
    });
    expect(out).toContain("u:a%20b@h:1");
  });
});

describe("shouldBypass", () => {
  it("exact match (case-insensitive)", () => {
    expect(shouldBypass("Localhost", ["localhost"])).toBe(true);
    expect(shouldBypass("api.example.com", ["other.com"])).toBe(false);
  });
  it("suffix glob *.domain", () => {
    expect(shouldBypass("api.internal", ["*.internal"])).toBe(true);
    expect(shouldBypass("internal", ["*.internal"])).toBe(false);
    expect(shouldBypass("a.b.internal", ["*.internal"])).toBe(true);
  });
  it("IP literal exact", () => {
    expect(shouldBypass("127.0.0.1", ["127.0.0.1"])).toBe(true);
    expect(shouldBypass("127.0.0.2", ["127.0.0.1"])).toBe(false);
  });
  it("empty list never bypasses", () => {
    expect(shouldBypass("anything", [])).toBe(false);
  });
});

describe("parseNoProxy", () => {
  it("splits CSV and trims", () => {
    expect(parseNoProxy("localhost, 127.0.0.1 ,*.internal"))
      .toEqual(["localhost", "127.0.0.1", "*.internal"]);
  });
  it("drops empty entries", () => {
    expect(parseNoProxy("a,,b,")).toEqual(["a", "b"]);
  });
  it("returns [] for undefined", () => {
    expect(parseNoProxy(undefined)).toEqual([]);
  });
  it("returns [] for empty string", () => {
    expect(parseNoProxy("")).toEqual([]);
  });
});

describe("maskProxyUrl", () => {
  it("masks user:pass to user:****", () => {
    expect(maskProxyUrl("http://u" + "ser:pa" + "ss@proxy.example.com:8080"))
      .toBe("http://u" + "ser:****@proxy.example.com:8080/");
  });
  it("returns url unchanged when no creds", () => {
    expect(maskProxyUrl("http://proxy.example.com:8080"))
      .toBe("http://proxy.example.com:8080");
  });
  it("handles malformed url by returning original", () => {
    expect(maskProxyUrl("not a url")).toBe("not a url");
  });
});
