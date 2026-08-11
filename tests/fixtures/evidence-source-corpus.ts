const neutralLine = (section: number, line: number): string =>
  `Record ${section.toString().padStart(2, "0")}.${line.toString().padStart(2, "0")}: data данные 資料 ${"x".repeat(5)}.`;

export function smallEvidenceSource(): string {
  return [
    "# Compact set",
    "",
    "## Segment one",
    "Record 01.01: data alpha.",
    "## Segment two",
    "Record 02.01: data beta.",
    "## Segment three",
    "Record 03.01: data gamma.",
  ].join("\n");
}

export function mediumEvidenceSource(): string {
  return Array.from({ length: 12 }, (_, section) => [
    `## Segment ${section + 1}`,
    ...Array.from({ length: 8 }, (_, line) => neutralLine(section + 1, line + 1)),
  ].join("\n")).join("\n");
}

export function headingHeavyEvidenceSource(): string {
  return Array.from({ length: 34 }, (_, section) => [
    `## Segment ${section + 1}`,
    ...Array.from({ length: 11 }, (_, line) => neutralLine(section + 1, line + 1)),
  ].join("\n")).join("\n");
}

export function oversizedParagraphEvidenceSource(): string {
  return [
    "# Oversized block",
    ...Array.from(
      { length: 280 },
      (_, index) => `Unit ${index.toString().padStart(3, "0")} ${"q".repeat(72)}`,
    ),
  ].join("\n");
}

export function fencedEvidenceSource(): string {
  return [
    "# Structured samples",
    "",
    "```text",
    ...Array.from({ length: 180 }, (_, index) => `sample_${index.toString().padStart(3, "0")} = ${"v".repeat(48)}`),
    "```",
    "",
    "## Tail",
    ...Array.from({ length: 24 }, (_, index) => `Tail ${index + 1}: ${"z".repeat(36)}.`),
  ].join("\n");
}

export function mixedOversizedEvidenceSource(): string {
  return [
    "# Mixed source",
    ...Array.from({ length: 90 }, (_, index) => `Paragraph ${index + 1}: ${"p".repeat(52)}.`),
    "## Sample block",
    "```text",
    ...Array.from({ length: 120 }, (_, index) => `entry_${index.toString().padStart(3, "0")} = ${"c".repeat(44)}`),
    "```",
    "## Closing range",
    ...Array.from({ length: 90 }, (_, index) => `Closing ${index + 1}: ${"t".repeat(52)}.`),
  ].join("\n");
}
