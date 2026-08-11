import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const CLI_PATH = fileURLToPath(new URL("../scripts/validate-release.mjs", import.meta.url));
const VERSION = "0.2.2";
const MANIFEST_TEXT = JSON.stringify({
  id: "ai-wiki",
  name: "AI Wiki",
  version: VERSION,
});

type FixtureFiles = Record<string, string>;

async function createFixture(overrides: FixtureFiles = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "release-validation-"));
  const files: FixtureFiles = {
    "package.json": JSON.stringify({ name: "obsidian-ai-wiki", version: VERSION }),
    "package-lock.json": JSON.stringify({
      name: "obsidian-ai-wiki",
      version: VERSION,
      lockfileVersion: 3,
      packages: { "": { name: "obsidian-ai-wiki", version: VERSION } },
    }),
    "manifest.json": MANIFEST_TEXT,
    "src/manifest.json": MANIFEST_TEXT,
    ...overrides,
  };

  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }

  return root;
}

function createPostbuildFixture(overrides: FixtureFiles = {}): Promise<string> {
  return createFixture({
    "dist/main.js": "console.log('built');\n",
    "dist/manifest.json": MANIFEST_TEXT,
    "dist/styles.css": ".ai-wiki { display: block; }\n",
    ...overrides,
  });
}

function validate(root: string, phase: "prebuild" | "postbuild") {
  return runCli(["--root", root, "--phase", phase]);
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
  });
}

test("prebuild validation passes for matching release metadata", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("prebuild validation rejects stale package-lock versions", async (t) => {
  const root = await createFixture({
    "package-lock.json": JSON.stringify({
      name: "obsidian-ai-wiki",
      version: "0.2.1",
      lockfileVersion: 3,
      packages: { "": { name: "obsidian-ai-wiki", version: "0.2.1" } },
    }),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[package-lock\.json\] version 0\.2\.1 does not match package\.json version 0\.2\.2/);
  assert.match(result.stderr, /\[package-lock\.json packages\[""\]\] version 0\.2\.1 does not match package\.json version 0\.2\.2/);
});

test("prebuild validation rejects manifest id and version mismatches", async (t) => {
  const root = await createFixture({
    "manifest.json": JSON.stringify({
      id: "other-plugin",
      name: "AI Wiki",
      version: "0.2.1",
    }),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[manifest\.json\] id other-plugin must be ai-wiki/);
  assert.match(result.stderr, /\[manifest\.json\] version 0\.2\.1 does not match package\.json version 0\.2\.2/);
});

test("postbuild validation rejects a missing required asset", async (t) => {
  const root = await createFixture({
    "dist/main.js": "console.log('built');\n",
    "dist/manifest.json": MANIFEST_TEXT,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "postbuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[dist\/styles\.css\] missing or empty/);
});

test("postbuild validation rejects an empty required asset", async (t) => {
  const root = await createPostbuildFixture({ "dist/main.js": "" });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "postbuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[dist\/main\.js\] missing or empty/);
});

test("postbuild validation passes for complete release artifacts", async (t) => {
  const root = await createPostbuildFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "postbuild");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("postbuild validation rejects an inline source map", async (t) => {
  const root = await createPostbuildFixture({
    "dist/main.js": "console.log('built');\n//# sourceMappingURL=data:application/json;base64,e30=\n",
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "postbuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[dist\/main\.js\] inline source map is not allowed/);
});

test("postbuild validation rejects dist manifest id and version mismatches", async (t) => {
  const root = await createPostbuildFixture({
    "dist/manifest.json": JSON.stringify({
      id: "other-plugin",
      name: "AI Wiki",
      version: "0.2.1",
    }),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "postbuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[dist\/manifest\.json\] id other-plugin must be ai-wiki/);
  assert.match(result.stderr, /\[dist\/manifest\.json\] version 0\.2\.1 does not match package\.json version 0\.2\.2/);
});

test("postbuild validation requires byte-identical source and dist manifests", async (t) => {
  const root = await createPostbuildFixture({
    "dist/manifest.json": `${MANIFEST_TEXT}\n`,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "postbuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[dist\/manifest\.json\] bytes do not match src\/manifest\.json/);
});

test("postbuild validation reports source and dist manifest errors independently", async (t) => {
  const root = await createPostbuildFixture({ "dist/manifest.json": "{" });
  await rm(path.join(root, "src/manifest.json"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "postbuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[src\/manifest\.json\] cannot be read/);
  assert.match(result.stderr, /\[dist\/manifest\.json\] invalid JSON/);
});

test("CLI rejects missing, unknown, and duplicate arguments", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const missingPhase = runCli(["--root", root]);
  const unknown = runCli(["--root", root, "--phase", "prebuild", "--unknown", "value"]);
  const duplicate = runCli(["--root", root, "--phase", "prebuild", "--phase", "prebuild"]);

  assert.equal(missingPhase.status, 1);
  assert.match(missingPhase.stderr, /\[arguments\] --phase must be prebuild or postbuild/);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /\[arguments\] unknown argument: --unknown/);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /\[arguments\] duplicate argument: --phase/);
});

test("prebuild validation rejects a non-SemVer package version", async (t) => {
  const root = await createFixture({
    "package.json": JSON.stringify({ name: "obsidian-ai-wiki", version: "v0.2.2" }),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[package\.json\] version v0\.2\.2 is not valid SemVer/);
});
