import { describe, it, expect } from "vitest";
import { collectMdInPaths, walkFolder } from "../src/view";

function makeFile(path: string, extension: string) {
  return { path, extension } as any;
}

function makeFolder(path: string, children: unknown[]) {
  return { path, children } as any;
}

describe("walkFolder", () => {
  it("collects .md files from a flat folder", () => {
    const f1 = makeFile("Notes/a.md", "md");
    const f2 = makeFile("Notes/b.txt", "txt");
    const folder = makeFolder("Notes", [f1, f2]);
    const out: unknown[] = [];
    walkFolder(folder, out as any);
    expect(out).toEqual([f1]);
  });

  it("recurses into subfolders", () => {
    const f1 = makeFile("Notes/sub/deep.md", "md");
    const sub = makeFolder("Notes/sub", [f1]);
    const folder = makeFolder("Notes", [sub]);
    const out: unknown[] = [];
    walkFolder(folder, out as any);
    expect(out).toEqual([f1]);
  });

  it("ignores non-.md files at all depths", () => {
    const f1 = makeFile("Notes/img.png", "png");
    const folder = makeFolder("Notes", [f1]);
    const out: unknown[] = [];
    walkFolder(folder, out as any);
    expect(out).toEqual([]);
  });
});

describe("collectMdInPaths", () => {
  it("returns files only from configured source paths", () => {
    const f1 = makeFile("Notes/AI/a.md", "md");
    const folder = makeFolder("Notes/AI", [f1]);
    const vault = {
      getFolderByPath: (p: string) => (p === "Notes/AI" ? folder : null),
    } as any;
    const result = collectMdInPaths(vault, ["Notes/AI", "Notes/Missing"]);
    expect(result).toEqual([f1]);
  });

  it("returns empty array when source path folder does not exist", () => {
    const vault = { getFolderByPath: () => null } as any;
    const result = collectMdInPaths(vault, ["Notes/Nonexistent"]);
    expect(result).toEqual([]);
  });

  it("returns empty array when sourcePaths is empty", () => {
    const vault = { getFolderByPath: () => null } as any;
    const result = collectMdInPaths(vault, []);
    expect(result).toEqual([]);
  });
});
