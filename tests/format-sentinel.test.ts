import { describe, it, expect } from "vitest";
import { parseSentinelOutput } from "../src/phases/format-utils";

const R = "<<<REPORT>>>";
const F = "<<<FORMATTED>>>";
const E = "<<<END>>>";
const VC = "<<<VISION_COUNT>>>";
const EM = "<<<EMBEDS>>>";

function sentinel(report: string, formatted: string): string {
  return `${R}\n${report}\n${F}\n${formatted}\n${E}`;
}

describe("parseSentinelOutput", () => {
  it("extracts report and formatted between markers", () => {
    const text = sentinel("## Changes\n- added frontmatter", "---\n# Page\n\nContent.");
    const result = parseSentinelOutput(text, false);
    expect(result).not.toBeNull();
    expect(result!.report).toBe("## Changes\n- added frontmatter");
    expect(result!.formatted).toBe("---\n# Page\n\nContent.");
    expect(result!.truncated).toBe(false);
  });

  it("returns null if REPORT marker absent", () => {
    const text = `${F}\n---\n# Page\n${E}`;
    expect(parseSentinelOutput(text, false)).toBeNull();
  });

  it("returns null if FORMATTED marker absent", () => {
    const text = `${R}\nreport\n${E}`;
    expect(parseSentinelOutput(text, false)).toBeNull();
  });

  it("salvage: FORMATTED present but END absent → truncated: true, uses rest as formatted", () => {
    const text = `${R}\nreport\n${F}\n---\n# Page\n\nUnfinished`;
    const result = parseSentinelOutput(text, false);
    expect(result).not.toBeNull();
    expect(result!.truncated).toBe(true);
    expect(result!.formatted).toBe("---\n# Page\n\nUnfinished");
  });

  it("hasVision=true: requires VISION_COUNT and EMBEDS markers", () => {
    const text = sentinel("report", "---\n# Page");
    expect(parseSentinelOutput(text, true)).toBeNull();
  });

  it("hasVision=true: parses VISION_COUNT and EMBEDS", () => {
    const text = [
      `${R}\nreport`,
      `${F}\n---\n# Page`,
      `${VC}2`,
      `${EM}img/a.png|img/b.png`,
      E,
    ].join("\n");
    const result = parseSentinelOutput(text, true);
    expect(result).not.toBeNull();
    expect(result!.visionCount).toBe(2);
    expect(result!.embeds).toEqual(["img/a.png", "img/b.png"]);
    expect(result!.truncated).toBe(false);
  });

  it("markdown with tables and control chars does not break parsing", () => {
    const mdWithTable = [
      "---",
      "tags: [test]",
      "---",
      "",
      "# Page",
      "",
      "| Суп | Время |",
      "|---|---|",
      "| **Харчо** | 1–2 ч |",
      "| **Щи** | 3 ч |",
      "",
      "```bash",
      "echo 'hello'",
      "```",
    ].join("\n");
    const text = sentinel("report", mdWithTable);
    const result = parseSentinelOutput(text, false);
    expect(result).not.toBeNull();
    expect(result!.formatted).toContain("| **Харчо** |");
    expect(result!.formatted).toContain("```bash");
  });
});
