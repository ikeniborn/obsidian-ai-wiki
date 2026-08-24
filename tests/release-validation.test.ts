import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parse } from "yaml";

const CLI_PATH = fileURLToPath(new URL("../scripts/validate-release.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const VERSION = "0.4.0";
const MANIFEST = {
  id: "ai-wiki",
  name: "AI Wiki",
  version: VERSION,
  minAppVersion: "1.13.0",
  description: "Build and maintain a structured wiki from raw notes with AI-assisted extraction and synthesis.",
  author: "ikeniborn",
  authorUrl: "https://github.com/ikeniborn",
  isDesktopOnly: false,
};
const MANIFEST_TEXT = JSON.stringify(MANIFEST);
const VERSIONS = {
  "0.3.5": "1.7.2",
  [VERSION]: MANIFEST.minAppVersion,
};
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

type FixtureFiles = Record<string, string | Uint8Array>;

function releaseMetadata(
  version: string,
  minAppVersion: string,
  versions: Record<string, string>,
): FixtureFiles {
  const manifest = JSON.stringify({ ...MANIFEST, version, minAppVersion });
  return {
    "package.json": JSON.stringify({ name: "obsidian-ai-wiki", version }),
    "package-lock.json": JSON.stringify({
      name: "obsidian-ai-wiki",
      version,
      lockfileVersion: 3,
      packages: { "": { name: "obsidian-ai-wiki", version } },
    }),
    "manifest.json": manifest,
    "src/manifest.json": manifest,
    "versions.json": JSON.stringify(versions),
  };
}

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
    "versions.json": JSON.stringify(VERSIONS),
    "README.md": README_TEXT,
    "LICENSE": "Apache License\n",
    ...overrides,
  };

  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }

  const init = spawnSync("git", ["init", "--quiet", root], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  const add = spawnSync("git", ["-C", root, "add", "--all"], { encoding: "utf8" });
  assert.equal(add.status, 0, add.stderr);

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

function readReleaseWorkflow(): Record<string, any> {
  return parse(
    readFileSync(path.join(REPO_ROOT, ".github/workflows/release.yml"), "utf8"),
  ) as Record<string, any>;
}

test("prebuild validation passes for matching release metadata", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("prebuild validation scans only tracked active text surfaces", async (t) => {
  const root = await createFixture({
    ".gitignore": "eval/ignored/\n",
    "docs/superpowers/legacy.md": "Claude Code claude-agent child_process spawn( iclaudePath claudePath claude-probe\n",
    "scripts/dspy/CLAUDE.md": "Claude Code claude-agent child_process spawn( iclaudePath claudePath claude-probe\n",
    "eval/ignored/run.cjs": "Claude Code claude-agent child_process spawn( iclaudePath claudePath claude-probe\n",
    "eval/bundle.bin": Buffer.from("\0Claude Code claude-agent child_process"),
    "tests/negative-markers.ts": "Claude Code claude-agent child_process spawn( iclaudePath claudePath claude-probe\n",
    "src/openai.ts": "const provider = 'OpenAI';\n",
  });
  await mkdir(path.join(root, "eval/untracked"), { recursive: true });
  await writeFile(
    path.join(root, "eval/untracked/run.cjs"),
    "Claude Code claude-agent child_process spawn( iclaudePath claudePath claude-probe\n",
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 0, result.stderr);
});

const ACTIVE_MARKER_CASES = [
  {
    path: "src/claude-agent.ts",
    contents: "export const client = 'ClaudeCliClient';\n",
    category: "Claude backend",
    marker: "claude-agent",
  },
  {
    path: "src/backend.ts",
    contents: "export const client = 'ClaudeCliClient';\n",
    category: "Claude backend",
    marker: "ClaudeCliClient",
  },
  {
    path: "eval/claude-probe/run.ts",
    contents: "export const probe = 'enabled';\n",
    category: "Claude CLI probe",
    marker: "claude-probe",
  },
  {
    path: "scripts/process.mjs",
    contents: "import 'node:child_process';\n",
    category: "subprocess",
    marker: "node:child_process",
  },
  {
    path: "scripts/spawn.ts",
    contents: "spawn('tool');\n",
    category: "subprocess",
    marker: "spawn(",
  },
  {
    path: "src/config.ts",
    contents: "export const path = 'iclaudePath';\n",
    category: "Claude configuration",
    marker: "iclaudePath",
  },
  {
    path: "src/legacy-config.ts",
    contents: "export const path = 'claudePath';\n",
    category: "Claude configuration",
    marker: "claudePath",
  },
  {
    path: "src/ui.ts",
    contents: "export const label = 'Claude Code';\n",
    category: "Claude UI",
    marker: "Claude Code",
  },
  {
    path: "scripts/Makefile",
    contents: "audit:\n\t@echo 'Claude Code'\n",
    category: "Claude UI",
    marker: "Claude Code",
  },
] as const;

for (const fixture of ACTIVE_MARKER_CASES) {
  test(`prebuild reports exact ${fixture.category} marker from ${fixture.path}`, async (t) => {
    const root = await createFixture({ [fixture.path]: fixture.contents });
    t.after(() => rm(root, { recursive: true, force: true }));

    const result = validate(root, "prebuild");

    assert.equal(result.status, 1);
    assert.equal(
      result.stderr,
      `Release validation failed:\n- [${fixture.path}] forbidden ${fixture.category} marker: ${fixture.marker}\n`,
    );
  });
}

test("prebuild fails closed when a tracked active text candidate cannot be read", async (t) => {
  const source = "src/unreadable.ts";
  const root = await createFixture({ [source]: "export const value = true;\n" });
  await rm(path.join(root, source));
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.equal(result.stderr, `Release validation failed:\n- [${source}] cannot be read\n`);
});

test("dist marker passes prebuild and fails postbuild with exact evidence", async (t) => {
  const root = await createPostbuildFixture({
    "dist/main.js": "const client = 'ClaudeCliClient';\n",
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const prebuild = validate(root, "prebuild");
  const postbuild = validate(root, "postbuild");

  assert.equal(prebuild.status, 0, prebuild.stderr);
  assert.equal(prebuild.stderr, "");
  assert.equal(postbuild.status, 1);
  assert.equal(
    postbuild.stderr,
    "Release validation failed:\n- [dist/main.js] forbidden Claude backend marker: ClaudeCliClient\n",
  );
});

test("postbuild scans an untracked generated dist main directly", async (t) => {
  const root = await createPostbuildFixture({
    "dist/main.js": "const client = 'ClaudeCliClient';\n",
  });
  const untrack = spawnSync(
    "git",
    ["-C", root, "rm", "--cached", "--quiet", "--", "dist/main.js"],
    { encoding: "utf8" },
  );
  assert.equal(untrack.status, 0, untrack.stderr);
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "postbuild");

  assert.equal(result.status, 1);
  assert.equal(
    result.stderr,
    "Release validation failed:\n- [dist/main.js] forbidden Claude backend marker: ClaudeCliClient\n",
  );
});

test("repository release metadata preserves 0.3.5 and synchronizes 0.3.6", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  ) as { version: string };
  const packageLock = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package-lock.json"), "utf8"),
  ) as { version: string; packages: Record<string, { version: string }> };
  const sourceManifestText = readFileSync(path.join(REPO_ROOT, "src/manifest.json"), "utf8");
  const rootManifestText = readFileSync(path.join(REPO_ROOT, "manifest.json"), "utf8");
  const distManifestText = readFileSync(path.join(REPO_ROOT, "dist/manifest.json"), "utf8");
  const sourceManifest = JSON.parse(sourceManifestText) as typeof MANIFEST;
  const rootManifest = JSON.parse(rootManifestText) as typeof MANIFEST;
  const distManifest = JSON.parse(distManifestText) as typeof MANIFEST;
  const versionsJson = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "versions.json"), "utf8"),
  ) as Record<string, string>;

  assert.equal(packageJson.version, "0.3.6");
  assert.equal(packageLock.version, "0.3.6");
  assert.equal(packageLock.packages[""].version, "0.3.6");
  assert.equal(sourceManifest.version, "0.3.6");
  assert.equal(rootManifest.version, "0.3.6");
  assert.equal(distManifest.version, "0.3.6");
  assert.deepEqual(rootManifest, sourceManifest);
  assert.deepEqual(distManifest, sourceManifest);
  assert.equal(rootManifestText, sourceManifestText);
  assert.equal(distManifestText, sourceManifestText);
  assert.equal(sourceManifest.minAppVersion, "1.13.0");
  assert.equal(sourceManifest.isDesktopOnly, false);
  assert.equal(versionsJson["0.3.5"], "1.7.2");
  assert.equal(versionsJson["0.3.6"], "1.13.0");
});

test("prebuild validation rejects a changed 0.3.5 compatibility mapping", async (t) => {
  const root = await createFixture({
    "versions.json": JSON.stringify({ ...VERSIONS, "0.3.5": "1.13.0" }),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[versions\.json\] 0\.3\.5 must remain mapped to 1\.7\.2/);
});

test("prebuild validation rejects a release version below protected 0.3.5", async (t) => {
  const root = await createFixture(releaseMetadata("0.3.4", "1.7.2", {
    "0.3.4": "1.7.2",
    "0.3.5": "1.7.2",
  }));
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[package\.json\] release version 0\.3\.4 must be greater than protected version 0\.3\.5/);
});

test("prebuild validation rejects the protected 0.3.5 as the current release", async (t) => {
  const root = await createFixture(releaseMetadata("0.3.5", "1.7.2", {
    "0.3.5": "1.7.2",
  }));
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[package\.json\] release version 0\.3\.5 must be greater than protected version 0\.3\.5/);
});

test("prebuild validation rejects a current release below the highest versions.json key", async (t) => {
  const root = await createFixture(releaseMetadata("0.3.6", "1.13.0", {
    "0.3.5": "1.7.2",
    "0.3.6": "1.13.0",
    "0.3.7": "1.13.0",
  }));
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[versions\.json\] highest release key 0\.3\.7 must equal package\.json version 0\.3\.6/);
});

for (const invalidKey of ["999.0", "999.0.0-beta"]) {
  test(`prebuild validation rejects malformed versions.json key ${invalidKey}`, async (t) => {
    const root = await createFixture({
      "versions.json": JSON.stringify({ ...VERSIONS, [invalidKey]: "1.13.0" }),
    });
    t.after(() => rm(root, { recursive: true, force: true }));

    const result = validate(root, "prebuild");

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      new RegExp(`\\[versions\\.json\\] version key ${invalidKey.replaceAll(".", "\\.")} must use exact x\\.y\\.z format`),
    );
    assert.doesNotMatch(result.stderr, /\[versions\.json\] highest release key/);
  });
}

test("prebuild validation rejects a missing current compatibility mapping", async (t) => {
  const root = await createFixture({
    "versions.json": JSON.stringify({ "0.3.5": "1.7.2" }),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[versions\.json\] 0\.4\.0 must map to src\/manifest\.json minAppVersion 1\.13\.0/);
});

test("prebuild validation rejects a mismatched current compatibility mapping", async (t) => {
  const root = await createFixture({
    "versions.json": JSON.stringify({ ...VERSIONS, [VERSION]: "1.7.2" }),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[versions\.json\] 0\.4\.0 must map to src\/manifest\.json minAppVersion 1\.13\.0/);
});

test("prebuild validation rejects stale package-lock versions", async (t) => {
  const root = await createFixture({
    "package-lock.json": JSON.stringify({
      name: "obsidian-ai-wiki",
      version: "0.3.9",
      lockfileVersion: 3,
      packages: { "": { name: "obsidian-ai-wiki", version: "0.3.9" } },
    }),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[package-lock\.json\] version 0\.3\.9 does not match package\.json version 0\.4\.0/);
  assert.match(result.stderr, /\[package-lock\.json packages\[""\]\] version 0\.3\.9 does not match package\.json version 0\.4\.0/);
});

test("prebuild validation rejects manifest id and version mismatches", async (t) => {
  const root = await createFixture({
    "manifest.json": JSON.stringify({
      id: "other-plugin",
      name: "AI Wiki",
      version: "0.3.9",
    }),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[manifest\.json\] id other-plugin must be ai-wiki/);
  assert.match(result.stderr, /\[manifest\.json\] version 0\.3\.9 does not match package\.json version 0\.4\.0/);
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

for (const marker of ["claude-agent", "ClaudeCliClient", "iclaudePath", "claudePath"]) {
  test(`postbuild validation rejects Claude backend marker ${marker}`, async (t) => {
    const root = await createPostbuildFixture({
      "dist/main.js": `const marker = '${marker}';\n`,
    });
    t.after(() => rm(root, { recursive: true, force: true }));

    const result = validate(root, "postbuild");

    assert.equal(result.status, 1);
    const category = marker === "iclaudePath" || marker === "claudePath"
      ? "Claude configuration"
      : "Claude backend";
    assert.equal(
      result.stderr,
      `Release validation failed:\n- [dist/main.js] forbidden ${category} marker: ${marker}\n`,
    );
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
    assert.equal(
      result.stderr,
      `Release validation failed:\n- [dist/main.js] forbidden subprocess marker: ${marker}\n`,
    );
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
      version: "0.3.9",
    }),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "postbuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[dist\/manifest\.json\] id other-plugin must be ai-wiki/);
  assert.match(result.stderr, /\[dist\/manifest\.json\] version 0\.3\.9 does not match package\.json version 0\.4\.0/);
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
    "package.json": JSON.stringify({ name: "obsidian-ai-wiki", version: "v0.4.0" }),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[package\.json\] version v0\.4\.0 is not valid SemVer/);
});

test("prebuild validation does not report an undefined release version when package.json is missing", async (t) => {
  const root = await createFixture();
  await rm(path.join(root, "package.json"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[package\.json\] cannot be read/);
  assert.doesNotMatch(result.stderr, /version undefined/);
});

test("prebuild validation does not report an undefined release version when package.json is invalid", async (t) => {
  const root = await createFixture({ "package.json": "{" });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "prebuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[package\.json\] invalid JSON/);
  assert.doesNotMatch(result.stderr, /version undefined/);
});

test("prebuild validation requires exact release versions", async (t) => {
  const version = "0.4.0-beta.1";
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
  assert.match(result.stderr, /\[package\.json\] version 0\.4\.0-beta\.1 must use the x\.y\.z release format/);
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

const RELEASE_ASSETS = ["dist/main.js", "dist/manifest.json", "dist/styles.css"];
const GENERATED_RELEASE_PATHS = [...RELEASE_ASSETS, "manifest.json", "versions.json"];
const TEST_SHA = "1111111111111111111111111111111111111111";

function workflowStepIdentity(step: Record<string, any>): string {
  if (typeof step.uses === "string") return step.uses.replace(/@.*$/, "");
  if (step.id === "version") return "read-version";
  return step.name ?? step.run;
}

function releasePublisherStep(): Record<string, any> | undefined {
  return (readReleaseWorkflow().jobs.release.steps as Array<Record<string, any>>)
    .find((step) => step.name === "Reconcile and publish create-only release");
}

test("release workflow has one serialized master publisher with every gate before mutation", () => {
  const workflow = readReleaseWorkflow();
  const jobs = Object.keys(workflow.jobs);
  const job = workflow.jobs.release;
  const steps = job.steps as Array<Record<string, any>>;

  assert.deepEqual(workflow.on, {
    push: { branches: ["master"], paths: ["src/manifest.json"] },
  });
  assert.equal(workflow.on.workflow_dispatch, undefined);
  assert.deepEqual(workflow.concurrency, {
    group: "obsidian-ai-wiki-release",
    queue: "max",
    "cancel-in-progress": false,
  });
  assert.deepEqual(jobs, ["release"]);
  assert.deepEqual(job.permissions, {
    contents: "write",
    attestations: "write",
    "id-token": "write",
  });
  assert.deepEqual(steps.map(workflowStepIdentity), [
    "actions/checkout",
    "actions/setup-node",
    "npm ci",
    "npm run release:validate:pre",
    "npm run lint",
    "npm run typecheck",
    "npm test",
    "node eval/mobile-fixes/run.cjs",
    "Build",
    "npm run release:validate:post",
    "Verify tracked generated release files",
    "read-version",
    "Capture release asset metadata",
    "actions/attest-build-provenance",
    "Reconcile and publish create-only release",
  ]);

  const diff = steps.find((step) => step.name === "Verify tracked generated release files");
  assert.equal(diff?.run, `git diff --exit-code -- ${GENERATED_RELEASE_PATHS.join(" ")}`);
  const digest = steps.find((step) => step.name === "Capture release asset metadata");
  assert.match(String(digest?.run), /release-assets\.tsv/);
  for (const asset of RELEASE_ASSETS) assert.match(String(digest?.run), new RegExp(asset.replace(".", "\\.")));
  assert.match(String(digest?.run), /stat -c %s/);
  assert.match(String(digest?.run), /sha256sum/);
  const attestation = steps.find((step) => workflowStepIdentity(step) === "actions/attest-build-provenance");
  assert.deepEqual(String(attestation?.with?.["subject-path"]).trim().split("\n"), RELEASE_ASSETS);
});

test("release publisher is one create-only Bash state machine", () => {
  const workflowText = readFileSync(path.join(REPO_ROOT, ".github/workflows/release.yml"), "utf8");
  const publisher = releasePublisherStep();
  assert.ok(publisher, "create-only publisher step is missing");
  assert.equal(publisher.env?.GH_TOKEN, "${{ github.token }}");
  const shell = String(publisher.run);
  assert.match(shell, /^set -euo pipefail/m);
  assert.match(shell, /gh api --paginate --slurp "repos\/\$GITHUB_REPOSITORY\/releases\?per_page=100"/);
  assert.equal(
    shell.match(/gh release create "\$version" dist\/main\.js dist\/manifest\.json dist\/styles\.css --verify-tag --target "\$GITHUB_SHA" --title "\$version" --generate-notes/g)?.length,
    1,
  );
  assert.equal(shell.match(/git push --porcelain origin "\$GITHUB_SHA:refs\/tags\/\$version"/g)?.length, 1);
  assert.match(shell, /GITHUB_RUN_ATTEMPT/);
  assert.match(shell, /release-assets\.tsv/);
  assert.doesNotMatch(workflowText, /softprops\/action-gh-release|gh release (?:edit|upload|delete)|git push[^\n]*(?:--force|-f\b)|clobber/i);
  assert.doesNotMatch(shell, /gh api[^\n]*(?:--method|-X)\s*(?:POST|PATCH|PUT|DELETE)/i);
});

type PublisherScenario =
  | "absent"
  | "completed"
  | "draft"
  | "partial"
  | "duplicate"
  | "api-failure"
  | "malformed"
  | "first-existing"
  | "rerun-exact"
  | "wrong-tag"
  | "annotated-tag"
  | "lost-ack"
  | "create-failure"
  | "post-wrong"
  | "post-missing"
  | "post-extra"
  | "post-size"
  | "post-digest"
  | "post-bytes";

async function runPublisherScenario(scenario: PublisherScenario, attempt = 1) {
  const root = await mkdtemp(path.join(tmpdir(), "release-publisher-"));
  const fakeBin = path.join(root, "bin");
  const runnerTemp = path.join(root, "runner");
  const dist = path.join(root, "dist");
  await mkdir(fakeBin, { recursive: true });
  await mkdir(runnerTemp, { recursive: true });
  await mkdir(dist, { recursive: true });
  const contents: Record<string, string> = {
    "main.js": "console.log('release');\n",
    "manifest.json": JSON.stringify({ version: VERSION }),
    "styles.css": ".ai-wiki { display: block; }\n",
  };
  for (const [name, body] of Object.entries(contents)) await writeFile(path.join(dist, name), body);
  const metadata = Object.entries(contents).map(([name, body]) => {
    const bytes = Buffer.byteLength(body);
    const digest = createHash("sha256").update(body).digest("hex");
    return `${name}\t${bytes}\t${digest}`;
  }).join("\n");
  await writeFile(path.join(runnerTemp, "release-assets.tsv"), `${metadata}\n`);

  const operationLog = path.join(root, "operations.log");
  const createdMarker = path.join(root, "created");
  const fakeGh = path.join(fakeBin, "gh");
  await writeFile(fakeGh, `#!/usr/bin/env node
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.OPERATION_LOG, "gh\\t" + args.join("\\t") + "\\n");
const scenario = process.env.FAKE_SCENARIO;
const created = fs.existsSync(process.env.FAKE_CREATED);
const names = ["main.js", "manifest.json", "styles.css"];
const asset = (name) => {
  const body = fs.readFileSync(path.join(process.env.FAKE_ROOT, "dist", name));
  return { name, size: body.length, digest: "sha256:" + crypto.createHash("sha256").update(body).digest("hex"), url: "asset://" + name };
};
const release = (changes = {}) => ({ id: 7, tag_name: "${VERSION}", draft: false, prerelease: false, published_at: "2026-08-24T00:00:00Z", assets: names.map(asset), ...changes });
const list = () => {
  if (!created && scenario === "api-failure") process.exit(70);
  if (!created && scenario === "malformed") return process.stdout.write("{}");
  let records = [];
  if (!created) {
    if (scenario === "completed") records = [release()];
    if (scenario === "draft") records = [release({ draft: true, published_at: null })];
    if (scenario === "partial") records = [release({ assets: names.slice(0, 2).map(asset) })];
    if (scenario === "duplicate") records = [release(), release({ id: 8 })];
  } else {
    let current = release();
    if (scenario === "post-wrong") current = release({ assets: [{ ...asset("main.js"), name: "wrong.js" }, asset("manifest.json"), asset("styles.css")] });
    if (scenario === "post-missing") current = release({ assets: names.slice(0, 2).map(asset) });
    if (scenario === "post-extra") current = release({ assets: [...names.map(asset), { ...asset("main.js"), name: "extra.js" }] });
    if (scenario === "post-size") current = release({ assets: [{ ...asset("main.js"), size: asset("main.js").size + 1 }, asset("manifest.json"), asset("styles.css")] });
    if (scenario === "post-digest") current = release({ assets: [{ ...asset("main.js"), digest: asset("main.js").digest.toUpperCase() }, asset("manifest.json"), asset("styles.css")] });
    records = [current];
  }
  if (!created && scenario === "duplicate") return process.stdout.write(JSON.stringify([[records[0]], [records[1]]]));
  process.stdout.write(JSON.stringify([[], records]));
};
if (args[0] === "release" && args[1] === "create") {
  if (scenario === "create-failure") process.exit(71);
  fs.writeFileSync(process.env.FAKE_CREATED, "created");
  process.exit(0);
}
if (args[0] !== "api") process.exit(72);
const target = args[args.length - 1];
if (target.includes("releases?per_page=100")) return list();
if (target.includes("git/ref/tags/")) {
  const type = scenario === "annotated-tag" ? "tag" : "commit";
  const sha = scenario === "wrong-tag" ? "2222222222222222222222222222222222222222" : process.env.GITHUB_SHA;
  return process.stdout.write(JSON.stringify({ object: { type, sha } }));
}
if (target.startsWith("asset://")) {
  const name = target.slice("asset://".length);
  const body = fs.readFileSync(path.join(process.env.FAKE_ROOT, "dist", name));
  process.stdout.write(scenario === "post-bytes" && name === "main.js" ? Buffer.concat([body, Buffer.from("x")]) : body);
  return;
}
process.exit(73);
`);
  await chmod(fakeGh, 0o755);

  const fakeGit = path.join(fakeBin, "git");
  await writeFile(fakeGit, `#!/bin/sh
printf 'git\\t%s\\n' "$*" >> "$OPERATION_LOG"
case "$FAKE_SCENARIO" in
  absent|create-failure|post-*) printf '*\\t[new tag]\\n'; exit 0 ;;
  lost-ack) printf 'claim acknowledgement lost\\n' >&2; exit 1 ;;
  *) printf '=\\t[up to date]\\n'; exit 0 ;;
esac
`);
  await chmod(fakeGit, 0o755);

  const publisher = releasePublisherStep();
  assert.ok(publisher, "create-only publisher step is missing");
  const command = String(publisher.run).replaceAll("${{ steps.version.outputs.version }}", VERSION);
  const result = spawnSync("/bin/bash", ["-c", command], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      FAKE_SCENARIO: scenario,
      FAKE_ROOT: root,
      FAKE_CREATED: createdMarker,
      OPERATION_LOG: operationLog,
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_SHA: TEST_SHA,
      GITHUB_RUN_ID: "9001",
      GITHUB_RUN_ATTEMPT: String(attempt),
      GH_TOKEN: "test-token",
      RUNNER_TEMP: runnerTemp,
    },
  });
  const operations = readFileSync(operationLog, "utf8").trim().split("\n").filter(Boolean);
  await rm(root, { recursive: true, force: true });
  return { result, operations };
}

test("create-only publisher state matrix is fail closed and mutation bounded", async (t) => {
  const cases: Array<{ scenario: PublisherScenario; attempt?: number; success: boolean; pushes: number; creates: number }> = [
    { scenario: "absent", success: true, pushes: 1, creates: 1 },
    { scenario: "completed", success: true, pushes: 0, creates: 0 },
    { scenario: "draft", success: false, pushes: 0, creates: 0 },
    { scenario: "partial", success: false, pushes: 0, creates: 0 },
    { scenario: "duplicate", success: false, pushes: 0, creates: 0 },
    { scenario: "api-failure", success: false, pushes: 0, creates: 0 },
    { scenario: "malformed", success: false, pushes: 0, creates: 0 },
    { scenario: "first-existing", success: false, pushes: 1, creates: 0 },
    { scenario: "rerun-exact", attempt: 2, success: true, pushes: 1, creates: 1 },
    { scenario: "wrong-tag", attempt: 2, success: false, pushes: 1, creates: 0 },
    { scenario: "annotated-tag", attempt: 2, success: false, pushes: 1, creates: 0 },
    { scenario: "lost-ack", success: false, pushes: 1, creates: 0 },
    { scenario: "create-failure", success: false, pushes: 1, creates: 1 },
    { scenario: "post-wrong", success: false, pushes: 1, creates: 1 },
    { scenario: "post-missing", success: false, pushes: 1, creates: 1 },
    { scenario: "post-extra", success: false, pushes: 1, creates: 1 },
    { scenario: "post-size", success: false, pushes: 1, creates: 1 },
    { scenario: "post-digest", success: false, pushes: 1, creates: 1 },
    { scenario: "post-bytes", success: false, pushes: 1, creates: 1 },
  ];

  for (const fixture of cases) {
    await t.test(fixture.scenario, async () => {
      const { result, operations } = await runPublisherScenario(fixture.scenario, fixture.attempt);
      assert.equal(result.status === 0, fixture.success, `${result.stdout}\n${result.stderr}\n${operations.join("\n")}`);
      assert.equal(operations.filter((line) => line.startsWith("git\tpush ")).length, fixture.pushes);
      assert.equal(operations.filter((line) => line.startsWith("gh\trelease\tcreate\t")).length, fixture.creates);
      assert.equal(operations.filter((line) => /release\t(?:edit|upload|delete)/.test(line)).length, 0);
      assert.ok(operations.filter((line) => line.startsWith("gh\trelease\tcreate\t")).length <= 1);
    });
  }
});

test("successful publisher states have exact terminal operation order", async () => {
  const absent = await runPublisherScenario("absent");
  assert.deepEqual(absent.operations.map((line) => line.split("\t").slice(0, 2).join(" ")), [
    "gh api",
    "git push --porcelain origin 1111111111111111111111111111111111111111:refs/tags/0.4.0",
    "gh release",
    "gh api",
    "gh api",
    "gh api",
    "gh api",
    "gh api",
  ]);
  const completed = await runPublisherScenario("completed");
  assert.equal(completed.result.status, 0);
  assert.equal(completed.operations.some((line) => line.startsWith("git\t") || line.startsWith("gh\trelease\tcreate")), false);
  const rerun = await runPublisherScenario("rerun-exact", 2);
  assert.equal(rerun.result.status, 0);
  const createIndex = rerun.operations.findIndex((line) => line.startsWith("gh\trelease\tcreate"));
  const freshSearchIndex = rerun.operations.findIndex((line, index) => index > 0 && line.includes("releases?per_page=100"));
  assert.ok(freshSearchIndex < createIndex);
});
