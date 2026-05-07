import { describe, it, expect } from "vitest";
import { applyDomainEvent } from "../src/domain";
import type { DomainEntry } from "../src/domain";

const base: DomainEntry = {
  id: "os",
  name: "OS",
  wiki_folder: "os",
  source_paths: ["docs/os"],
  entity_types: [],
  language_notes: "",
};

describe("applyDomainEvent", () => {
  it("appends new domain on domain_created", () => {
    const result = applyDomainEvent([], { kind: "domain_created", entry: base });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(base);
  });

  it("idempotent: domain_created with existing id does not duplicate", () => {
    const result = applyDomainEvent([base], { kind: "domain_created", entry: base });
    expect(result).toHaveLength(1);
  });

  it("merges patch on domain_updated", () => {
    const result = applyDomainEvent([base], {
      kind: "domain_updated",
      domainId: "os",
      patch: { language_notes: "RU" },
    });
    expect(result[0].language_notes).toBe("RU");
    expect(result[0].name).toBe("OS");
  });

  it("returns same list on domain_updated for unknown id", () => {
    const result = applyDomainEvent([base], {
      kind: "domain_updated",
      domainId: "unknown",
      patch: { language_notes: "X" },
    });
    expect(result[0].language_notes).toBe("");
  });

  it("adds source path with dedupe", () => {
    const result = applyDomainEvent([base], {
      kind: "source_path_added",
      domainId: "os",
      path: "docs/os/new",
    });
    expect(result[0].source_paths).toEqual(["docs/os", "docs/os/new"]);
  });

  it("does not duplicate existing source path", () => {
    const result = applyDomainEvent([base], {
      kind: "source_path_added",
      domainId: "os",
      path: "docs/os",
    });
    expect(result[0].source_paths).toEqual(["docs/os"]);
  });

  it("does not mutate input array", () => {
    const input = [base];
    applyDomainEvent(input, { kind: "domain_created", entry: { ...base, id: "new" } });
    expect(input).toHaveLength(1);
  });
});
