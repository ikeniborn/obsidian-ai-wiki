import { describe, it, expect } from "vitest";
import { parseIndexAnnotations } from "../src/wiki-index";

describe("parseIndexAnnotations used in init", () => {
  it("parses annotations from _index.md content", () => {
    const content = `# Wiki Index\n\n## general\n- [[Alpha]] !Wiki/d/sub/Alpha.md — machine learning model\n- [[Beta]] !Wiki/d/sub/Beta.md — cooking recipes\n`;
    const map = parseIndexAnnotations(content);
    expect(map.get("Alpha")).toBe("machine learning model");
    expect(map.get("Beta")).toBe("cooking recipes");
    expect(map.size).toBe(2);
  });
});
