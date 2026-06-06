import { describe, it, expect, vi } from "vitest";
import {
  extractObsidianEmbedPaths,
  insertDescriptions,
  analyzeImage,
  analyzeAttachments,
  getMimeType,
  stripImageDataUriPrefix,
} from "../src/phases/attachment-analyzer";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";
import type { LlmClient } from "../src/types";

describe("extractObsidianEmbedPaths", () => {
  it("returns empty array for plain text", () => {
    expect(extractObsidianEmbedPaths("no embeds here")).toEqual([]);
  });

  it("extracts single PNG embed", () => {
    expect(extractObsidianEmbedPaths("![[image.png]]")).toEqual(["image.png"]);
  });

  it("extracts multiple embeds", () => {
    const md = "# Title\n![[a.png]]\nText\n![[b.pdf]]\n![[c.excalidraw]]";
    expect(extractObsidianEmbedPaths(md)).toEqual(["a.png", "b.pdf", "c.excalidraw"]);
  });

  it("ignores standard markdown images", () => {
    expect(extractObsidianEmbedPaths("![alt](image.png)")).toEqual([]);
  });

  it("ignores wiki links without !", () => {
    expect(extractObsidianEmbedPaths("[[note.md]]")).toEqual([]);
  });

  it("trims whitespace in embed path", () => {
    expect(extractObsidianEmbedPaths("![[ image.png ]]")).toEqual(["image.png"]);
  });
});

describe("insertDescriptions", () => {
  it("inserts description immediately after embed line", () => {
    const md = "![[img.png]]\nNext line";
    const descriptions = new Map([["img.png", "A red circle."]]);
    const result = insertDescriptions(md, descriptions);
    expect(result).toBe("![[img.png]]\n> *[Vision] A red circle.*\nNext line");
  });

  it("is idempotent — skips embed that already has [Vision] marker", () => {
    const md = "![[img.png]]\n> *[Vision] Already described.*\nNext line";
    const descriptions = new Map([["img.png", "New description."]]);
    const result = insertDescriptions(md, descriptions);
    expect(result).toBe(md);
  });

  it("skips embed with no matching description", () => {
    const md = "![[unknown.png]]";
    const result = insertDescriptions(md, new Map());
    expect(result).toBe(md);
  });

  it("handles embed at end of file with no trailing newline", () => {
    const md = "Text\n![[img.png]]";
    const descriptions = new Map([["img.png", "A square."]]);
    const result = insertDescriptions(md, descriptions);
    expect(result).toBe("Text\n![[img.png]]\n> *[Vision] A square.*");
  });

  it("skips empty-line separator before [Vision] marker", () => {
    const md = "![[img.png]]\n\n> *[Vision] Already here.*";
    const descriptions = new Map([["img.png", "New."]]);
    const result = insertDescriptions(md, descriptions);
    expect(result).toBe(md);
  });
});

function makeLlm(content: string): LlmClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content } }],
        }),
      },
    },
  } as unknown as LlmClient;
}

function makeVaultTools(binaryData: Record<string, ArrayBuffer> = {}, textData: Record<string, string> = {}): VaultTools {
  const adapter: VaultAdapter & { readBinary: ReturnType<typeof vi.fn> } = {
    read: vi.fn().mockImplementation(async (p: string) => textData[p] ?? ""),
    write: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(false),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readBinary: vi.fn().mockImplementation(async (p: string) => {
      if (p in binaryData) return binaryData[p];
      throw new Error(`not found: ${p}`);
    }),
    // Treat every test linkpath as a resolvable indexed file (identity resolve).
    resolveLink: vi.fn().mockImplementation((linkpath: string) => linkpath),
    // Default: no excalidraw renderer wired (host plugin absent).
    renderExcalidrawPng: vi.fn().mockResolvedValue(null),
  };
  return new VaultTools(adapter, "/vault");
}

describe("getMimeType", () => {
  it.each([
    ["photo.png", "image/png"],
    ["photo.jpg", "image/jpeg"],
    ["photo.jpeg", "image/jpeg"],
    ["photo.webp", "image/webp"],
    ["doc.pdf", null],
    ["draw.excalidraw", null],
    ["note.md", null],
  ])("%s → %s", (path, expected) => {
    expect(getMimeType(path)).toBe(expected);
  });
});

describe("stripImageDataUriPrefix", () => {
  it("strips a data:image/png;base64, prefix to raw base64", () => {
    expect(stripImageDataUriPrefix("data:image/png;base64,iVBORw0KGgo=")).toBe("iVBORw0KGgo=");
  });
  it("returns raw base64 unchanged", () => {
    expect(stripImageDataUriPrefix("iVBORw0KGgo=")).toBe("iVBORw0KGgo=");
  });
  it("handles other image subtypes", () => {
    expect(stripImageDataUriPrefix("data:image/jpeg;base64,QUJD")).toBe("QUJD");
  });
});

describe("analyzeImage", () => {
  it("calls LLM with base64 data URL and returns description", async () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    const llm = makeLlm("A blue rectangle.");
    const result = await analyzeImage(buf, "image/png", llm, "gpt-4o-mini", new AbortController().signal);
    expect(result).toBe("A blue rectangle.");
    const call = (llm.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.model).toBe("gpt-4o-mini");
    expect(call.stream).toBe(false);
    const userContent = call.messages[1].content[0];
    expect(userContent.type).toBe("image_url");
    expect(userContent.image_url.url).toMatch(/^data:image\/png;base64,/);
  });
});

describe("analyzeAttachments", () => {
  it("returns description for PNG embed", async () => {
    const buf = new Uint8Array([1]).buffer;
    const vaultTools = makeVaultTools({ "photo.png": buf });
    const llm = makeLlm("A circle.");
    const result = await analyzeAttachments(["photo.png"], vaultTools, llm, "gpt-4o-mini", new AbortController().signal);
    expect(result.get("photo.png")).toBe("A circle.");
  });

  it("skips unknown extension, emits no entry", async () => {
    const vaultTools = makeVaultTools();
    const llm = makeLlm("unused");
    const result = await analyzeAttachments(["video.mp4"], vaultTools, llm, "gpt-4o-mini", new AbortController().signal);
    expect(result.has("video.mp4")).toBe(false);
    expect((llm.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("skips attachment when readBinary throws (file not found)", async () => {
    const vaultTools = makeVaultTools({});  // empty — readBinary throws for any path
    const llm = makeLlm("should not be called");
    const result = await analyzeAttachments(["missing.png"], vaultTools, llm, "gpt-4o-mini", new AbortController().signal);
    expect(result.has("missing.png")).toBe(false);
  });

  it("skips unresolved embed (path traversal), never reads", async () => {
    const buf = new Uint8Array([1]).buffer;
    const vaultTools = makeVaultTools({ "../../../secret.png": buf });
    // Simulate Obsidian failing to resolve a traversal embed to an indexed file.
    (vaultTools.adapter.resolveLink as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const llm = makeLlm("should not be called");
    const result = await analyzeAttachments(["../../../secret.png"], vaultTools, llm, "gpt-4o-mini", new AbortController().signal);
    expect(result.has("../../../secret.png")).toBe(false);
    expect(vaultTools.adapter.readBinary as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("processes multiple embeds sequentially", async () => {
    const buf = new Uint8Array([1]).buffer;
    const vaultTools = makeVaultTools({ "a.png": buf, "b.jpg": buf });
    const llm = {
      chat: {
        completions: {
          create: vi.fn()
            .mockResolvedValueOnce({ choices: [{ message: { content: "First." } }] })
            .mockResolvedValueOnce({ choices: [{ message: { content: "Second." } }] }),
        },
      },
    } as unknown as LlmClient;
    const result = await analyzeAttachments(["a.png", "b.jpg"], vaultTools, llm, "gpt-4o-mini", new AbortController().signal);
    expect(result.get("a.png")).toBe("First.");
    expect(result.get("b.jpg")).toBe("Second.");
  });
});

describe("analyzeAttachments — excalidraw", () => {
  it("renders excalidraw via host plugin and returns Vision description", async () => {
    const vaultTools = makeVaultTools();
    (vaultTools.adapter.renderExcalidrawPng as ReturnType<typeof vi.fn>)
      .mockResolvedValue("RENDEREDB64");
    const llm = makeLlm("A flowchart.");
    const result = await analyzeAttachments(["draw.excalidraw"], vaultTools, llm, "gpt-4o-mini", new AbortController().signal);
    expect(result.get("draw.excalidraw")).toBe("A flowchart.");
    const call = (llm.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userContent = call.messages[1].content[0];
    expect(userContent.type).toBe("image_url");
    expect(userContent.image_url.url).toBe("data:image/png;base64,RENDEREDB64");
  });

  it("skips excalidraw when renderer returns null (no host plugin)", async () => {
    const vaultTools = makeVaultTools();  // renderExcalidrawPng defaults to null
    const llm = makeLlm("should not be called");
    const result = await analyzeAttachments(["draw.excalidraw"], vaultTools, llm, "gpt-4o-mini", new AbortController().signal);
    expect(result.has("draw.excalidraw")).toBe(false);
    expect((llm.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("returns both prose description and mermaid for a diagram", async () => {
    const vaultTools = makeVaultTools();
    (vaultTools.adapter.renderExcalidrawPng as ReturnType<typeof vi.fn>)
      .mockResolvedValue("RENDEREDB64");
    const visionOut = "A login flow: user → auth service → database.\n\n```mermaid\nflowchart LR\n  user --> auth --> db\n```";
    const llm = makeLlm(visionOut);
    const result = await analyzeAttachments(["flow.excalidraw"], vaultTools, llm, "gpt-4o-mini", new AbortController().signal);
    const desc = result.get("flow.excalidraw")!;
    expect(desc).toContain("A login flow");
    expect(desc).toContain("```mermaid");
  });
});
