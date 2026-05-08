import { describe, it, expect } from "vitest";
import { maskProxyUrl, parseNoProxy } from "../src/proxy";

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
