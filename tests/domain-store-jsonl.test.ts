import assert from "node:assert/strict";
import test from "node:test";
import { DomainStore } from "../src/domain-store";

class MemoryAdapter {
  files = new Map<string, string>();
  writePaths: string[] = [];

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || [...this.files.keys()].some((p) => p.startsWith(path + "/"));
  }

  async read(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`ENOENT ${path}`);
    return v;
  }

  async write(path: string, data: string): Promise<void> {
    this.writePaths.push(path);
    this.files.set(path, data);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async rename(from: string, to: string): Promise<void> {
    const v = await this.read(from);
    this.files.delete(from);
    this.files.set(to, v);
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const folders = new Set<string>();
    const files: string[] = [];
    for (const key of this.files.keys()) {
      if (!key.startsWith(path + "/")) continue;
      const rest = key.slice(path.length + 1);
      const first = rest.split("/")[0];
      if (rest.includes("/")) folders.add(`${path}/${first}`);
      else files.push(`${path}/${first}`);
    }
    return { files, folders: [...folders] };
  }
}

function vault(adapter: MemoryAdapter): any {
  return {
    adapter,
    createFolder: async (path: string) => {
      adapter.files.set(`${path}/.keep`, "");
    },
  };
}

test("DomainStore loads domains from per-domain metadata", async () => {
  const adapter = new MemoryAdapter();
  adapter.files.set(
    "!Wiki/hld/metadata.jsonl",
    '{"kind":"domain","schemaVersion":1,"id":"hld","name":"HLD","wiki_folder":"hld","source_paths":["src"]}\n',
  );
  const store = new DomainStore(vault(adapter));
  assert.deepEqual(await store.load(), [{
    id: "hld",
    name: "HLD",
    wiki_folder: "hld",
    source_paths: ["src"],
    entity_types: [],
    analyzed_sources: {},
    analyzed_sources_v2: true,
    analyzed_sources_v3: true,
  }]);
});

test("DomainStore removes metadata for domains omitted from save", async () => {
  const adapter = new MemoryAdapter();
  adapter.files.set(
    "!Wiki/keep/metadata.jsonl",
    '{"kind":"domain","schemaVersion":1,"id":"keep","name":"Keep","wiki_folder":"keep","source_paths":["src/keep"]}\n',
  );
  adapter.files.set(
    "!Wiki/drop/metadata.jsonl",
    '{"kind":"domain","schemaVersion":1,"id":"drop","name":"Drop","wiki_folder":"drop","source_paths":["src/drop"]}\n',
  );
  adapter.files.set("!Wiki/drop/page.md", "# Existing wiki page\n");
  const store = new DomainStore(vault(adapter));

  await store.save([{
    id: "keep",
    name: "Keep",
    wiki_folder: "keep",
    source_paths: ["src/keep"],
    entity_types: [],
  }]);

  assert.equal(await adapter.exists("!Wiki/drop/metadata.jsonl"), false);
  assert.equal(await adapter.exists("!Wiki/drop/page.md"), true);
  assert.deepEqual((await store.load()).map((d) => d.id), ["keep"]);
});

test("DomainStore removes legacy global registry on save", async () => {
  const adapter = new MemoryAdapter();
  adapter.files.set("!Wiki/_config/_domain.json", JSON.stringify([{
    id: "legacy",
    name: "Legacy",
    wiki_folder: "legacy",
    source_paths: ["src/legacy"],
    entity_types: [],
  }]));
  const store = new DomainStore(vault(adapter));

  await store.save([]);

  assert.equal(await adapter.exists("!Wiki/_config/_domain.json"), false);
  assert.deepEqual(await store.load(), []);
});

test("exact metadata update preserves opaque records, order, and unknown current-record fields", async () => {
  const adapter = new MemoryAdapter();
  const path = "!Wiki/hld/metadata.jsonl";
  const records = [
    {
      kind: "domain",
      schemaVersion: 1,
      id: "hld",
      name: "HLD",
      wiki_folder: "hld",
      source_paths: ["sources/target.md", "sources/keep.md"],
      vendorDomain: { retained: true },
    },
    { kind: "vendor_opaque", schemaVersion: 9, payload: { exact: ["a", 2] } },
    {
      kind: "entity_type",
      type: "concept",
      description: "Old",
      extraction_cues: ["old"],
      vendorEntity: "retained",
    },
    {
      kind: "source_state",
      path: "sources/target.md",
      hash: "target-hash",
      vendorSource: "removed-with-governed-record",
    },
    {
      kind: "source_state",
      path: "sources/keep.md",
      hash: "keep-hash",
      vendorSource: "retained",
    },
  ];
  adapter.files.set(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  const store = new DomainStore(vault(adapter));

  const snapshot = await store.readExactMetadata(path, "hld");
  assert.deepEqual(
    snapshot.records.map((record) => record.kind),
    ["domain", "vendor_opaque", "entity_type", "source_state", "source_state"],
  );
  await store.writeExactMetadata(snapshot, {
    ...snapshot.entry,
    source_paths: ["sources/keep.md"],
    analyzed_sources: { "sources/keep.md": "keep-hash" },
    entity_types: [{
      type: "concept",
      description: "Updated",
      extraction_cues: ["new"],
    }],
  });

  const actual = adapter.files.get(path)!.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(actual.map((record) => record.kind), [
    "domain",
    "vendor_opaque",
    "entity_type",
    "source_state",
  ]);
  assert.deepEqual(actual[1], records[1]);
  assert.deepEqual(actual[0].vendorDomain, { retained: true });
  assert.equal(actual[2].vendorEntity, "retained");
  assert.equal(actual[2].description, "Updated");
  assert.equal(actual[3].vendorSource, "retained");
  assert.equal(actual[3].path, "sources/keep.md");
});

test("exact metadata read rejects future versions of governed record kinds", async () => {
  for (const futureRecord of [
    {
      kind: "domain",
      schemaVersion: 2,
      id: "hld",
      name: "HLD",
      wiki_folder: "hld",
      source_paths: [],
    },
    {
      kind: "entity_type",
      schemaVersion: 2,
      type: "concept",
      description: "Future",
      extraction_cues: [],
    },
    {
      kind: "source_state",
      schemaVersion: 2,
      path: "sources/future.md",
      hash: "future",
    },
  ]) {
    const adapter = new MemoryAdapter();
    const path = "!Wiki/hld/metadata.jsonl";
    const domain = {
      kind: "domain",
      schemaVersion: 1,
      id: "hld",
      name: "HLD",
      wiki_folder: "hld",
      source_paths: [],
    };
    const records = futureRecord.kind === "domain"
      ? [futureRecord]
      : [domain, futureRecord];
    adapter.files.set(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n");

    await assert.rejects(
      new DomainStore(vault(adapter)).readExactMetadata(path, "hld"),
      /unsupported.*schema.*version|future.*version/i,
      futureRecord.kind,
    );
  }
});

test("exact metadata update preserves an opaque unsafe-integer record as its exact raw line", async () => {
  const adapter = new MemoryAdapter();
  const path = "!Wiki/hld/metadata.jsonl";
  const domainLine = JSON.stringify({
    kind: "domain",
    schemaVersion: 1,
    id: "hld",
    name: "HLD",
    wiki_folder: "hld",
    source_paths: ["sources/target.md", "sources/keep.md"],
  });
  const opaqueLine = '  {"kind":"vendor_opaque","unsafe":9007199254740993,"payload":{"keep":"exact"}}  ';
  const targetLine = '{"kind":"source_state","path":"sources/target.md","hash":"target"}';
  const keepLine = '{"kind":"source_state","path":"sources/keep.md","hash":"keep"}';
  const raw = [domainLine, opaqueLine, targetLine, keepLine].join("\n") + "\n";
  adapter.files.set(path, raw);
  const store = new DomainStore(vault(adapter));

  const snapshot = await store.readExactMetadata(path, "hld");
  assert.equal(snapshot.rawRecordLines[1], opaqueLine);
  await store.writeExactMetadata(snapshot, {
    ...snapshot.entry,
    source_paths: ["sources/keep.md"],
    analyzed_sources: { "sources/keep.md": "keep" },
  });

  const actual = adapter.files.get(path)!;
  assert.equal(actual.split("\n")[1], opaqueLine);
  assert.match(actual, /"unsafe":9007199254740993/);
  assert.doesNotMatch(actual, /"unsafe":9007199254740992/);
});

test("exact metadata read rejects unsafe integers in unknown fields of governed records without writing", async () => {
  const adapter = new MemoryAdapter();
  const path = "!Wiki/hld/metadata.jsonl";
  const raw = [
    '{"kind":"domain","schemaVersion":1,"id":"hld","name":"HLD","wiki_folder":"hld","source_paths":[],"vendor":{"unsafe":9007199254740993}}',
  ].join("\n") + "\n";
  adapter.files.set(path, raw);

  await assert.rejects(
    new DomainStore(vault(adapter)).readExactMetadata(path, "hld"),
    /metadata\.jsonl.*domain.*unsafe integer.*vendor\.unsafe/i,
  );
  assert.equal(adapter.files.get(path), raw);
  assert.deepEqual(adapter.writePaths, []);
});

test("exact metadata read rejects duplicate governed identities without writing", async () => {
  const domain = {
    kind: "domain",
    schemaVersion: 1,
    id: "hld",
    name: "HLD",
    wiki_folder: "hld",
    source_paths: [],
  };
  const entity = {
    kind: "entity_type",
    type: "concept",
    description: "Concept",
    extraction_cues: ["concept"],
  };
  const source = {
    kind: "source_state",
    path: "sources/a.md",
    hash: "hash",
  };
  const cases = [
    {
      name: "domain",
      records: [domain, { ...domain }],
      error: /exactly one.*domain|duplicate.*domain/i,
    },
    {
      name: "entity_type.type",
      records: [domain, entity, { ...entity, description: "Duplicate" }],
      error: /duplicate.*entity_type.*concept/i,
    },
    {
      name: "source_state.path",
      records: [domain, source, { ...source, hash: "duplicate" }],
      error: /duplicate.*source_state.*sources\/a\.md/i,
    },
  ];

  for (const fixture of cases) {
    const adapter = new MemoryAdapter();
    const path = "!Wiki/hld/metadata.jsonl";
    const raw = fixture.records.map((record) => JSON.stringify(record)).join("\n") + "\n";
    adapter.files.set(path, raw);

    await assert.rejects(
      new DomainStore(vault(adapter)).readExactMetadata(path, "hld"),
      fixture.error,
      fixture.name,
    );
    assert.equal(adapter.files.get(path), raw, fixture.name);
    assert.deepEqual(adapter.writePaths, [], fixture.name);
  }
});

test("exact metadata read rejects malformed governed current records without writing", async () => {
  const domain = {
    kind: "domain",
    schemaVersion: 1,
    id: "hld",
    name: "HLD",
    wiki_folder: "hld",
    source_paths: [],
  };
  const cases = [
    {
      name: "domain.source_paths",
      records: [{ ...domain, source_paths: "sources" }],
      error: /domain.*source_paths/i,
    },
    {
      name: "entity_type.extraction_cues",
      records: [
        domain,
        {
          kind: "entity_type",
          type: "concept",
          description: "Concept",
          extraction_cues: "concept",
        },
      ],
      error: /entity_type.*extraction_cues/i,
    },
    {
      name: "source_state.hash",
      records: [
        domain,
        { kind: "source_state", path: "sources/a.md", hash: 42 },
      ],
      error: /source_state.*hash/i,
    },
  ];

  for (const fixture of cases) {
    const adapter = new MemoryAdapter();
    const path = "!Wiki/hld/metadata.jsonl";
    const raw = fixture.records.map((record) => JSON.stringify(record)).join("\n") + "\n";
    adapter.files.set(path, raw);

    await assert.rejects(
      new DomainStore(vault(adapter)).readExactMetadata(path, "hld"),
      fixture.error,
      fixture.name,
    );
    assert.equal(adapter.files.get(path), raw, fixture.name);
    assert.deepEqual(adapter.writePaths, [], fixture.name);
  }
});

test("exact metadata write cannot let runtime EntityType.kind erase its governed record", async () => {
  const adapter = new MemoryAdapter();
  const path = "!Wiki/hld/metadata.jsonl";
  adapter.files.set(path, [
    '{"kind":"domain","schemaVersion":1,"id":"hld","name":"HLD","wiki_folder":"hld","source_paths":[]}',
    '{"kind":"entity_type","type":"concept","description":"Original","extraction_cues":["original"]}',
  ].join("\n") + "\n");
  const store = new DomainStore(vault(adapter));
  const snapshot = await store.readExactMetadata(path, "hld");
  const malicious = {
    ...snapshot.entry.entity_types![0],
    kind: "vendor_opaque",
    description: "Updated",
    extraction_cues: ["updated"],
  };

  await store.writeExactMetadata(snapshot, {
    ...snapshot.entry,
    entity_types: [malicious],
  });

  const next = await store.readExactMetadata(path, "hld");
  assert.deepEqual(next.entry.entity_types, [{
    type: "concept",
    description: "Updated",
    extraction_cues: ["updated"],
  }]);
  assert.equal(next.records.some((record) => record.kind === "vendor_opaque"), false);
});

test("exact metadata read rejects missing or non-string record kinds without writing", async () => {
  const domain = '{"kind":"domain","schemaVersion":1,"id":"hld","name":"HLD","wiki_folder":"hld","source_paths":[]}';
  for (const [name, malformed] of [
    ["missing", '{"payload":"opaque"}'],
    ["non-string", '{"kind":42,"payload":"opaque"}'],
  ]) {
    const adapter = new MemoryAdapter();
    const path = "!Wiki/hld/metadata.jsonl";
    const raw = `${domain}\n${malformed}\n`;
    adapter.files.set(path, raw);

    await assert.rejects(
      new DomainStore(vault(adapter)).readExactMetadata(path, "hld"),
      /metadata\.jsonl.*kind.*non-empty string|record.*kind/i,
      name,
    );
    assert.equal(adapter.files.get(path), raw, name);
    assert.deepEqual(adapter.writePaths, [], name);
  }
});
