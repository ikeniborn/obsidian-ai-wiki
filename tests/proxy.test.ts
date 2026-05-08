import { describe, it, expect } from "vitest";
import { maskProxyUrl, parseNoProxy, shouldBypass } from "../src/proxy";

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
