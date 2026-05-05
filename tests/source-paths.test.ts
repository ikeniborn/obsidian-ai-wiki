import { describe, it, expect } from "vitest";
import { consolidateSourcePaths } from "../src/source-paths";

const ROOT = "/project";

describe("consolidateSourcePaths", () => {
  it("adds path to empty list", () => {
    expect(consolidateSourcePaths([], "notes/", ROOT))
      .toEqual(["notes/"]);
  });

  it("no change when new path is already covered by ancestor", () => {
    // "notes/" covers "notes/sub/" — adding "notes/sub/" is redundant
    expect(consolidateSourcePaths(["notes/"], "notes/sub/", ROOT))
      .toEqual(["notes/"]);
  });

  it("no change when identical path already exists", () => {
    expect(consolidateSourcePaths(["notes/"], "notes/", ROOT))
      .toEqual(["notes/"]);
  });

  it("replaces deeper descendants when ancestor is added", () => {
    const result = consolidateSourcePaths(["notes/sub/", "docs/"], "notes/", ROOT);
    expect(result).toContain("notes/");
    expect(result).toContain("docs/");
    expect(result).not.toContain("notes/sub/");
  });

  it("replaces multiple descendants", () => {
    const result = consolidateSourcePaths(["notes/a/", "notes/b/", "other/"], "notes/", ROOT);
    expect(result).toContain("notes/");
    expect(result).toContain("other/");
    expect(result).not.toContain("notes/a/");
    expect(result).not.toContain("notes/b/");
  });

  it("no overlap — both paths kept", () => {
    const result = consolidateSourcePaths(["docs/"], "notes/", ROOT);
    expect(result).toContain("docs/");
    expect(result).toContain("notes/");
  });

  it("handles absolute existing paths mixed with relative new path", () => {
    const result = consolidateSourcePaths(["/project/notes/sub/"], "notes/", ROOT);
    expect(result).toContain("notes/");
    expect(result).not.toContain("/project/notes/sub/");
  });

  it("handles absolute new path with relative existing", () => {
    const result = consolidateSourcePaths(["notes/sub/"], "/project/notes/", ROOT);
    expect(result).toContain("/project/notes/");
    expect(result).not.toContain("notes/sub/");
  });
});
