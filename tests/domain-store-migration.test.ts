import { describe, it, expect } from "vitest";
import { migrateDomainsV2 } from "../src/domain";
import type { DomainEntry } from "../src/domain";

describe("migrateDomainsV2", () => {
  it("resets analyzed_sources for domain without _v2", () => {
    const input: DomainEntry[] = [{ id: "x", name: "X", wiki_folder: "x", analyzed_sources: ["a","b"] }];
    const { domains, migrated } = migrateDomainsV2(input);
    expect(migrated).toBe(true);
    expect(domains[0].analyzed_sources).toEqual([]);
    expect(domains[0].analyzed_sources_v2).toBe(true);
  });

  it("leaves domain with _v2 untouched", () => {
    const input: DomainEntry[] = [{ id: "x", name: "X", wiki_folder: "x", analyzed_sources: ["a"], analyzed_sources_v2: true }];
    const { domains, migrated } = migrateDomainsV2(input);
    expect(migrated).toBe(false);
    expect(domains[0].analyzed_sources).toEqual(["a"]);
  });

  it("leaves domain without analyzed_sources untouched", () => {
    const input: DomainEntry[] = [{ id: "x", name: "X", wiki_folder: "x" }];
    const { domains, migrated } = migrateDomainsV2(input);
    expect(migrated).toBe(false);
    expect(domains[0].analyzed_sources_v2).toBeUndefined();
  });
});
