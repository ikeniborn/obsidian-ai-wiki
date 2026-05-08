import { describe, it, expect } from "vitest";
import { maskProxyUrl } from "../src/proxy";

describe("maskProxyUrl", () => {
  it("masks user:pass to user:****", () => {
    expect(maskProxyUrl("http://u" + "ser:pa" + "ss@proxy.example.com:8080"))
      .toBe("http://u" + "ser:****@proxy.example.com:8080");
  });
  it("returns url unchanged when no creds", () => {
    expect(maskProxyUrl("http://proxy.example.com:8080"))
      .toBe("http://proxy.example.com:8080");
  });
  it("handles malformed url by returning original", () => {
    expect(maskProxyUrl("not a url")).toBe("not a url");
  });
});
