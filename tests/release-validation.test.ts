import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parse } from "yaml";

const CLI_PATH = fileURLToPath(new URL("../scripts/validate-release.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const VERSION = "0.2.2";
const MANIFEST = {
  id: "ai-wiki",
  name: "AI Wiki",
  version: VERSION,
  minAppVersion: "1.7.2",
  description: "Build and maintain a structured wiki from raw notes with AI-assisted extraction and synthesis.",
  author: "ikeniborn",
  authorUrl: "https://github.com/ikeniborn",
  isDesktopOnly: false,
};
const MANIFEST_TEXT = JSON.stringify(MANIFEST);
const README_TEXT = `# AI Wiki

## Community directory disclosures

### Network use

Selected note content is sent to the configured AI service for processing.

### Accounts and payment

The plugin is free. Optional cloud services may require an account or payment.

### External file access

The plugin does not execute a user-configured AI CLI or another external AI process.

### License

Licensed under Apache License 2.0.
`;

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
    "README.md": README_TEXT,
    "LICENSE": "Apache License\n",
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

for (const marker of ["claude-agent", "ClaudeCliClient", "iclaudePath"]) {
  test(`postbuild validation rejects Claude backend marker ${marker}`, async (t) => {
    const root = await createPostbuildFixture({
      "dist/main.js": `const marker = '${marker}';\n`,
    });
    t.after(() => rm(root, { recursive: true, force: true }));

    const result = validate(root, "postbuild");

    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[dist\/main\.js\] forbidden Claude backend marker/);
  });
}

for (const marker of ["node:child_process", "child_process"]) {
  test(`postbuild validation rejects Node subprocess marker ${marker}`, async (t) => {
    const root = await createPostbuildFixture({
      "dist/main.js": `const marker = '${marker}';\n`,
    });
    t.after(() => rm(root, { recursive: true, force: true }));

    const result = validate(root, "postbuild");

    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[dist\/main\.js\] forbidden Node subprocess transport/);
  });
}

for (const marker of ["claude-agentic", "ClaudeCliClientFactory", "iclaudePaths", "child_processes"]) {
  test(`postbuild validation allows near-miss marker ${marker}`, async (t) => {
    const root = await createPostbuildFixture({
      "dist/main.js": `const marker = '${marker}';\n`,
    });
    t.after(() => rm(root, { recursive: true, force: true }));

    const result = validate(root, "postbuild");

    assert.equal(result.status, 0, result.stderr);
  });
}

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

test("prebuild validation does not report an undefined release version when package.json is missing", async (t) => {
  const root = await createFixture();
  await rm(path.join(root, "package.json"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[package\.json\] cannot be read/);
  assert.doesNotMatch(result.stderr, /\[package\.json\] version undefined/);
});

test("prebuild validation does not report an undefined release version when package.json is invalid", async (t) => {
  const root = await createFixture({ "package.json": "{" });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[package\.json\] invalid JSON/);
  assert.doesNotMatch(result.stderr, /\[package\.json\] version undefined/);
});

test("prebuild validation requires exact release versions", async (t) => {
  const version = "0.2.2-beta.1";
  const manifest = JSON.stringify({ ...MANIFEST, version });
  const root = await createFixture({
    "package.json": JSON.stringify({ name: "obsidian-ai-wiki", version }),
    "package-lock.json": JSON.stringify({
      name: "obsidian-ai-wiki",
      version,
      lockfileVersion: 3,
      packages: { "": { name: "obsidian-ai-wiki", version } },
    }),
    "manifest.json": manifest,
    "src/manifest.json": manifest,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[package\.json\] version 0\.2\.2-beta\.1 must use the x\.y\.z release format/);
});

test("prebuild validation enforces community manifest fields and description rules", async (t) => {
  const invalidManifest = JSON.stringify({
    ...MANIFEST,
    description: "This is a plugin — without an action statement",
    author: "",
    minAppVersion: "1.7",
    isDesktopOnly: "false",
  });
  const root = await createFixture({
    "manifest.json": invalidManifest,
    "src/manifest.json": invalidManifest,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /description must not start with "This is a plugin"/);
  assert.match(result.stderr, /description must end with a period/);
  assert.match(result.stderr, /description must use printable ASCII characters/);
  assert.match(result.stderr, /author must be a non-empty string/);
  assert.match(result.stderr, /minAppVersion 1\.7 must use the x\.y\.z format/);
  assert.match(result.stderr, /isDesktopOnly must be a boolean/);
});

test("prebuild validation enforces community name and URL rules", async (t) => {
  const invalidManifest = JSON.stringify({
    ...MANIFEST,
    name: "Obsidian Plugin ⚡",
    authorUrl: "ftp://example.com",
    fundingUrl: 42,
  });
  const root = await createFixture({
    "manifest.json": invalidManifest,
    "src/manifest.json": invalidManifest,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /name must use printable ASCII characters/);
  assert.match(result.stderr, /name contains unsupported punctuation/);
  assert.match(result.stderr, /name must not contain "Obsidian" or "Plugin"/);
  assert.match(result.stderr, /authorUrl must be an HTTP or HTTPS URL/);
  assert.match(result.stderr, /fundingUrl must be an HTTP or HTTPS URL or an object of URLs/);
});

test("prebuild validation requires matching root and source manifests", async (t) => {
  const root = await createFixture({
    "manifest.json": JSON.stringify({ ...MANIFEST, description: "Build a different wiki." }),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[manifest\.json\] bytes do not match src\/manifest\.json/);
});

test("prebuild validation requires community policy files and disclosures", async (t) => {
  const root = await createFixture({
    "README.md": "# AI Wiki\n",
    "LICENSE": "",
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[LICENSE\] missing or empty/);
  assert.match(result.stderr, /\[README\.md\] missing required disclosure: Network use/);
  assert.match(result.stderr, /\[README\.md\] missing required disclosure: Accounts and payment/);
  assert.match(result.stderr, /\[README\.md\] missing required disclosure: External file access/);
  assert.match(result.stderr, /\[README\.md\] missing required disclosure: License/);
});

test("release workflow gates attestation and publication behind validated build assets", () => {
  const workflow = parse(
    readFileSync(path.join(REPO_ROOT, ".github/workflows/release.yml"), "utf8"),
  ) as Record<string, any>;
  const job = workflow.jobs.release;
  const steps = job.steps as Array<Record<string, any>>;
  const identity = (step: Record<string, any>): string => {
    if (typeof step.uses === "string") return step.uses.replace(/@.*$/, "");
    if (step.id === "version") return "read-version";
    return step.run;
  };

  assert.deepEqual(workflow.on.push, {
    branches: ["master"],
    paths: ["src/manifest.json"],
  });
  assert.deepEqual(job.permissions, {
    contents: "write",
    attestations: "write",
    "id-token": "write",
  });
  assert.deepEqual(steps.map(identity), [
    "actions/checkout",
    "actions/setup-node",
    "npm ci",
    "npm run release:validate:pre",
    "npm run lint",
    "npm run typecheck",
    "npm test",
    "npm run build",
    "npm run release:validate:post",
    "actions/attest-build-provenance",
    "read-version",
    "softprops/action-gh-release",
  ]);

  const setupNode = steps.find((step) => identity(step) === "actions/setup-node");
  assert.equal(setupNode?.with?.["node-version"], 20);

  for (const step of steps.slice(0, 9)) {
    assert.equal(step["continue-on-error"], undefined);
  }
  for (const step of steps.slice(9)) {
    assert.equal(step.if, undefined);
  }

  const assets = ["dist/main.js", "dist/manifest.json", "dist/styles.css"];
  const assetLines = (value: unknown): string[] =>
    String(value)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  const attestation = steps.find((step) => identity(step) === "actions/attest-build-provenance");
  const release = steps.find((step) => identity(step) === "softprops/action-gh-release");
  assert.deepEqual(assetLines(attestation?.with?.["subject-path"]), assets);
  assert.deepEqual(assetLines(release?.with?.files), assets);

  const versionOutput = "${{ steps.version.outputs.version }}";
  assert.equal(steps[10].id, "version");
  assert.match(steps[10].run, /node -p .*package\.json.*GITHUB_OUTPUT/);
  assert.equal(release?.with?.tag_name, versionOutput);
  assert.equal(release?.with?.name, versionOutput);
});
