import { describe, it, expect } from "vitest";
import { validateDomainId } from "../src/domain";

describe("validateDomainId", () => {
  it("returns null for valid ASCII id", () => {
    expect(validateDomainId("projects")).toBeNull();
  });

  it("returns null for valid cyrillic id", () => {
    expect(validateDomainId("ии")).toBeNull();
  });

  it("returns null for id with hyphen and underscore", () => {
    expect(validateDomainId("my-domain_v2")).toBeNull();
  });

  it("returns error string for empty id", () => {
    expect(typeof validateDomainId("")).toBe("string");
  });

  it("returns error string for id with slash", () => {
    expect(typeof validateDomainId("bad/slash")).toBe("string");
  });

  it("returns error string for id with space", () => {
    expect(typeof validateDomainId("bad id")).toBe("string");
  });

  it("returns error string for id with dot", () => {
    expect(typeof validateDomainId("bad.id")).toBe("string");
  });
});
