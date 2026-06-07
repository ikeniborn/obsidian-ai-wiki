import { describe, it, expect } from "vitest";
import { VisionTempStore, base64ToArrayBuffer } from "../src/phases/vision-temp-store";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";

/** In-memory adapter that actually persists, so put→get round-trips work. */
function memVault() {
  const text = new Map<string, string>();
  const bin = new Map<string, ArrayBuffer>();
  const removed: string[] = [];
  const adapter: VaultAdapter = {
    read: (p) => text.has(p) ? Promise.resolve(text.get(p)!) : Promise.reject(new Error("nf")),
    write: (p, d) => { text.set(p, d); return Promise.resolve(); },
    append: () => Promise.resolve(),
    list: () => Promise.resolve({ files: [], folders: [] }),
    exists: (p) => Promise.resolve(text.has(p) || bin.has(p)),
    mkdir: () => Promise.resolve(),
    writeBinary: (p, d) => { bin.set(p, d); return Promise.resolve(); },
    rmdir: (p) => { removed.push(p); return Promise.resolve(); },
  };
  return { vt: new VaultTools(adapter, "/vault"), text, bin, removed, adapter };
}

const DIR = ".obsidian/plugins/x/.vision-tmp/run1";

describe("base64ToArrayBuffer", () => {
  it("decodes raw base64 to bytes", () => {
    const buf = base64ToArrayBuffer(btoa("ABC"));
    expect(Array.from(new Uint8Array(buf))).toEqual([65, 66, 67]);
  });
});

describe("VisionTempStore", () => {
  it("round-trips a description by embed path", async () => {
    const { vt } = memVault();
    const store = new VisionTempStore(vt, DIR);
    await store.putDescription("img/a.png", "A red circle.");
    expect(await store.getDescription("img/a.png")).toBe("A red circle.");
  });

  it("returns null on cache miss", async () => {
    const { vt } = memVault();
    const store = new VisionTempStore(vt, DIR);
    expect(await store.getDescription("img/missing.png")).toBeNull();
  });

  it("writes PNG under the plugin dir, not the vault content tree", async () => {
    const { vt, bin } = memVault();
    const store = new VisionTempStore(vt, DIR);
    await store.putPng("draw.excalidraw", btoa("PNGBYTES"));
    const keys = [...bin.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0].startsWith(DIR + "/")).toBe(true);
    expect(keys[0].endsWith(".png")).toBe(true);
  });

  it("cleanup removes the run dir recursively", async () => {
    const { vt, removed } = memVault();
    const store = new VisionTempStore(vt, DIR);
    await store.cleanup();
    expect(removed).toContain(DIR);
  });

  it("returns null when stored path doesn't match requested path (collision guard)", async () => {
    // keyFor("img/a.png") === "img_a_png"; seed a mismatched envelope at that key
    const { vt, text } = memVault();
    text.set(`${DIR}/img_a_png.json`, JSON.stringify({ path: "DIFFERENT", desc: "stale" }));
    const store = new VisionTempStore(vt, DIR);
    expect(await store.getDescription("img/a.png")).toBeNull();
  });

  it("swallows adapter errors — never throws", async () => {
    const adapter: VaultAdapter = {
      read: () => Promise.reject(new Error("boom")),
      write: () => Promise.reject(new Error("boom")),
      append: () => Promise.resolve(),
      list: () => Promise.resolve({ files: [], folders: [] }),
      exists: () => Promise.resolve(true),
      mkdir: () => Promise.resolve(),
      writeBinary: () => Promise.reject(new Error("boom")),
      rmdir: () => Promise.reject(new Error("boom")),
    };
    const store = new VisionTempStore(new VaultTools(adapter, "/vault"), DIR);
    await expect(store.putDescription("a", "b")).resolves.toBeUndefined();
    await expect(store.getDescription("a")).resolves.toBeNull();
    await expect(store.putPng("a", btoa("x"))).resolves.toBeUndefined();
    await expect(store.cleanup()).resolves.toBeUndefined();
  });
});
