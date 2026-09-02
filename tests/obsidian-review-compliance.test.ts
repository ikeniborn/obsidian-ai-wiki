import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const SRC_ROOT = resolve(new URL("../src", import.meta.url).pathname);
const PROJECT_ROOT = resolve(new URL("..", import.meta.url).pathname);

function readSource(path: string): string {
  return readFileSync(resolve(SRC_ROOT, path), "utf8");
}

function readProjectFile(path: string): string {
  return readFileSync(resolve(PROJECT_ROOT, path), "utf8");
}

function listTypeScriptFiles(path: string): string[] {
  const root = resolve(PROJECT_ROOT, path);

  if (!existsSync(root)) return [];

  return readdirSync(root, { recursive: true })
    .filter((entry): entry is string => typeof entry === "string" && /\.tsx?$/.test(entry))
    .sort();
}

function readNamedStringArray(source: string, name: string): string[] {
  const match = source.match(new RegExp(`const ${name} = \\[(.*?)\\];`, "s"));

  assert.ok(match, `${name} must be a separately named array`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
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

test("lint configuration matches the official Obsidian reviewer contract", () => {
  const packageJson = JSON.parse(readProjectFile("package.json"));
  const packageLock = JSON.parse(readProjectFile("package-lock.json"));
  const eslintConfig = readProjectFile("eslint.config.mjs");
  const officialScannerIgnoredPaths = [
    "node_modules",
    "dist",
    "build",
    "pkg",
    "test-vault",
    ".obsidian",
    "**/.obsidian/**",
    "esbuild.config.mjs",
    "version-bump.mjs",
    "**/*.test.*",
    "**/*.tests.*",
    "**/*.spec.*",
    "**/*.specs.*",
    "**/test/**",
    "**/tests/**",
    "**/__tests__/**",
    "**/mocks/**",
    "**/__mocks__/**",
    "**/*.cjs",
    "**/*.mjs",
    "**/*.cts",
    "**/*.mts",
    "**/vite*",
    "**/scripts/**",
    "**/docs/**",
    "**/i18n/**",
    "**/i18next/**",
    "**/locale/**",
    "**/locales/**",
    "**/translations/**",
    "**/l10n/**",
    ".pnpm-store",
    "**/testUtils**",
    "automation/**",
    "e2e-tests/**",
  ];

  assert.equal(packageJson.devDependencies["eslint-plugin-obsidianmd"], "0.4.1");
  assert.equal(
    packageLock.packages["node_modules/eslint-plugin-obsidianmd"].version,
    "0.4.1",
  );
  assert.equal(packageJson.scripts.lint, "eslint . --max-warnings 0");
  assert.match(eslintConfig, /\.\.\.obsidianmd\.configs\.recommended/);
  assert.doesNotMatch(eslintConfig, /rules\s*:/);
  assert.deepEqual(
    readNamedStringArray(eslintConfig, "COMMUNITY_SCANNER_IGNORES"),
    officialScannerIgnoredPaths,
  );
  assert.deepEqual(readNamedStringArray(eslintConfig, "LOCAL_WORKSPACE_IGNORES"), ["tmp"]);
  assert.match(
    eslintConfig,
    /globalIgnores\(\[\.\.\.COMMUNITY_SCANNER_IGNORES, \.\.\.LOCAL_WORKSPACE_IGNORES\]\)/,
  );
});

test("scanner-visible eval sources live under an ignored test directory", () => {
  assert.deepEqual(
    listTypeScriptFiles("eval"),
    [],
    "top-level eval must not contain TypeScript visible to the community scanner",
  );
  assert.ok(existsSync(resolve(PROJECT_ROOT, "tests/eval")));
  assert.ok(
    listTypeScriptFiles("tests/eval").length > 0,
    "retained eval TypeScript must live under tests/eval",
  );
});
