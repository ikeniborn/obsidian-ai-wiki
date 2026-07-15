import assert from "node:assert/strict";
import test from "node:test";
import { routeAndValidatePages } from "../src/phases/entity-routing";
import type { DomainEntry } from "../src/domain";

function domain(): DomainEntry {
  return {
    id: "oc-mac",
    name: "OC-Mac",
    wiki_folder: "oc-mac",
    entity_types: [
      { type: "application", description: "", extraction_cues: [] },
      { type: "protocol", description: "", extraction_cues: [] },
      { type: "tool", description: "", extraction_cues: [], wiki_subfolder: "tools" },
    ],
  };
}

const neverCalled = async (): Promise<Map<string, string>> => {
  throw new Error("classifier must not be called");
};

test("routes each page into its entity type's subfolder (type-name fallback + wiki_subfolder)", async () => {
  const pages = [
    { path: "!Wiki/oc-mac/entities/wiki_oc-mac_safari.md", content: "a" },
    { path: "!Wiki/oc-mac/entities/wiki_oc-mac_socks5.md", content: "b" },
    { path: "!Wiki/oc-mac/entities/wiki_oc-mac_proxifier.md", content: "c" },
  ];
  const entities = [
    { name: "Safari", type: "application" },
    { name: "SOCKS5", type: "protocol" },
    { name: "Proxifier", type: "tool" },
  ];
  const { routed, rejected } = await routeAndValidatePages(pages, entities, domain(), "!Wiki/oc-mac", neverCalled);
  assert.equal(rejected.length, 0);
  assert.deepEqual(routed.map((p) => p.path), [
    "!Wiki/oc-mac/application/wiki_oc-mac_safari.md",
    "!Wiki/oc-mac/protocol/wiki_oc-mac_socks5.md",
    "!Wiki/oc-mac/tools/wiki_oc-mac_proxifier.md", // wiki_subfolder overrides type name
  ]);
});

test("ignores the LLM-chosen subfolder — reroutes even a correct-looking path", async () => {
  const pages = [{ path: "!Wiki/oc-mac/wrongdir/wiki_oc-mac_safari.md", content: "a" }];
  const entities = [{ name: "Safari", type: "application" }];
  const { routed } = await routeAndValidatePages(pages, entities, domain(), "!Wiki/oc-mac", neverCalled);
  assert.equal(routed[0].path, "!Wiki/oc-mac/application/wiki_oc-mac_safari.md");
});

test("calls the classifier fallback for a page whose entity has no type, then routes it", async () => {
  const pages = [{ path: "!Wiki/oc-mac/entities/wiki_oc-mac_terminal.md", content: "a" }];
  const entities = [{ name: "Terminal" }]; // no type
  let calls = 0;
  const classify = async (stems: string[]): Promise<Map<string, string>> => {
    calls++;
    assert.deepEqual(stems, ["wiki_oc-mac_terminal"]);
    return new Map([["wiki_oc-mac_terminal", "tool"]]);
  };
  const { routed, rejected } = await routeAndValidatePages(pages, entities, domain(), "!Wiki/oc-mac", classify);
  assert.equal(calls, 1);
  assert.equal(rejected.length, 0);
  assert.equal(routed[0].path, "!Wiki/oc-mac/tools/wiki_oc-mac_terminal.md");
});

test("retries the classifier up to maxRounds, then rejects a page that stays unresolved", async () => {
  const pages = [{ path: "!Wiki/oc-mac/entities/wiki_oc-mac_mystery.md", content: "a" }];
  const entities = [{ name: "Mystery" }];
  let calls = 0;
  const classify = async (): Promise<Map<string, string>> => {
    calls++;
    return new Map([["wiki_oc-mac_mystery", "not_a_domain_type"]]); // invalid → never accepted
  };
  const { routed, rejected } = await routeAndValidatePages(pages, entities, domain(), "!Wiki/oc-mac", classify, 2);
  assert.equal(calls, 2); // maxRounds
  assert.equal(routed.length, 0);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /no valid entity type/);
});

test("rejects (no entities/ fallback) when the domain has no entity types", async () => {
  const d: DomainEntry = { id: "oc-mac", name: "x", wiki_folder: "oc-mac", entity_types: [] };
  const pages = [{ path: "!Wiki/oc-mac/entities/wiki_oc-mac_safari.md", content: "a" }];
  const { routed, rejected } = await routeAndValidatePages(pages, [{ name: "Safari", type: "application" }], d, "!Wiki/oc-mac", async () => new Map());
  assert.equal(routed.length, 0);
  assert.equal(rejected.length, 1);
});
