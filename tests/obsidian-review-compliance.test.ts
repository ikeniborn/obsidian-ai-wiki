import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const SRC_ROOT = resolve(new URL("../src", import.meta.url).pathname);

function readSource(path: string): string {
  return readFileSync(resolve(SRC_ROOT, path), "utf8");
}

test("production source does not suppress Obsidian window timer review rules", () => {
  const files = [
    "native-llm-executor.ts",
    "native-openai-transport.ts",
    "phases/init.ts",
  ];

  for (const file of files) {
    assert.doesNotMatch(
      readSource(file),
      /eslint-disable-next-line\s+obsidianmd\/prefer-window-timers/,
      `${file} must satisfy prefer-window-timers without disabling the rule`,
    );
  }
});

test("production source avoids direct Node timers modules", () => {
  for (const file of ["agent-runner.ts"]) {
    assert.doesNotMatch(
      readSource(file),
      /node:timers|require\(["']timers["']\)/,
      `${file} must use platform-neutral timers instead of Node timer modules`,
    );
  }
});

test("settings UI source uses Obsidian element helpers", () => {
  for (const file of ["modals.ts", "settings.ts"]) {
    assert.doesNotMatch(
      readSource(file),
      /document\.createElement/,
      `${file} must use createEl/createDiv/createSpan helpers`,
    );
    assert.doesNotMatch(
      readSource(file),
      /\.createEl\(["'](?:div|span)["']/,
      `${file} must use createDiv/createSpan shorthands`,
    );
  }
});
