import { describe, it, expect } from "vitest";
import { i18n } from "../src/i18n";

describe("i18n manage-sources strings", () => {
  it("view.init is renamed to 'Init' in en locale", () => {
    // moment is mocked in vitest.mock.ts to return 'en'
    expect(i18n().view.init).toBe("Init");
  });

  it("modal.manageSourcesTitle is a function returning domain id", () => {
    expect(i18n().modal.manageSourcesTitle("ai")).toBe("Sources: «ai»");
  });

  it("modal.ingestScopeNew returns count in label", () => {
    expect(i18n().modal.ingestScopeNew(2)).toContain("2");
  });

  it("modal.ingestScopeAll returns total count in label", () => {
    expect(i18n().modal.ingestScopeAll(5)).toContain("5");
  });

  it("view.addSourceTitle exists", () => {
    expect(typeof i18n().view.addSourceTitle).toBe("string");
  });
});
