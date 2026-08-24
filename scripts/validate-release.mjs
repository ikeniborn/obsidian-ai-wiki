#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const RELEASE_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const PRINTABLE_ASCII_PATTERN = /^[\x20-\x7e]+$/;
const README_DISCLOSURES = ["Network use", "Accounts and payment", "External file access", "License"];
const PROTECTED_RELEASE_VERSION = "0.3.5";
const PREBUILD_ACTIVE_SURFACES = ["src", "eval", "scripts"];
const ACTIVE_SURFACE_EXCLUSIONS = new Set(["scripts/dspy/CLAUDE.md", "scripts/validate-release.mjs"]);
const ACTIVE_TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".env",
  ".example",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".lock",
  ".md",
  ".mjs",
  ".py",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const ACTIVE_TEXT_NAMES = new Set([".gitignore", ".python-version", "Makefile"]);
const FORBIDDEN_ACTIVE_MARKERS = [
  { category: "Claude backend", pattern: /\b(?:claude-agent|ClaudeCliClient)\b/ },
  { category: "Claude CLI probe", pattern: /\bclaude-probe\b/ },
  { category: "subprocess", pattern: /\b(?:node:)?child_process\b|\bspawn\s*\(/ },
  { category: "Claude configuration", pattern: /\b(?:iclaudePath|claudePath)\b/ },
  { category: "Claude UI", pattern: /\bClaude Code\b/ },
];

function fail(message) {
  process.stderr.write(`Release validation failed:\n- [arguments] ${message}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  let root = process.cwd();
  let phase;
  const seen = new Set();

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];

    if (flag !== "--root" && flag !== "--phase") {
      throw new Error(`unknown argument: ${flag}`);
    }
    if (seen.has(flag)) {
      throw new Error(`duplicate argument: ${flag}`);
    }
    if (value === undefined || value === "--root" || value === "--phase") {
      throw new Error(`${flag} requires a value`);
    }
    seen.add(flag);

    if (flag === "--root") {
      root = value;
    } else {
      phase = value;
    }
  }

  if (phase !== "prebuild" && phase !== "postbuild") {
    throw new Error("--phase must be prebuild or postbuild");
  }

  return { root, phase };
}

function display(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function parseReleaseVersion(value) {
  if (typeof value !== "string" || !RELEASE_VERSION_PATTERN.test(value)) return undefined;
  return value.split(".").map((part) => BigInt(part));
}

function compareReleaseVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function readJson(root, source, errors) {
  let contents;
  try {
    contents = readFileSync(path.join(root, source), "utf8");
  } catch {
    errors.push(`[${source}] cannot be read`);
    return undefined;
  }

  try {
    return JSON.parse(contents);
  } catch {
    errors.push(`[${source}] invalid JSON`);
    return undefined;
  }
}

function validateVersion(source, actual, expected, errors) {
  if (expected === undefined) return;
  if (actual !== expected) {
    errors.push(`[${source}] version ${display(actual)} does not match package.json version ${display(expected)}`);
  }
}

function validateRequiredText(root, source, errors) {
  try {
    const contents = readFileSync(path.join(root, source), "utf8");
    if (contents.trim() === "") errors.push(`[${source}] missing or empty`);
    return contents;
  } catch {
    errors.push(`[${source}] missing or empty`);
    return undefined;
  }
}

function validateMatchingFiles(root, source, expectedSource, errors) {
  try {
    const actual = readFileSync(path.join(root, source));
    const expected = readFileSync(path.join(root, expectedSource));
    if (!actual.equals(expected)) errors.push(`[${source}] bytes do not match ${expectedSource}`);
  } catch {
    // Required-file and JSON checks report missing inputs.
  }
}

function listTrackedActiveSurfaceFiles(root, surfaces, errors) {
  let output;
  try {
    output = execFileSync("git", ["-C", root, "ls-files", "-z", "--", ...surfaces], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    errors.push("[active surfaces] cannot list tracked files");
    return [];
  }

  return [...new Set(output.split("\0").filter(Boolean))]
    .filter((source) => !ACTIVE_SURFACE_EXCLUSIONS.has(source))
    .filter((source) => {
      const name = path.posix.basename(source);
      return ACTIVE_TEXT_NAMES.has(name) || ACTIVE_TEXT_EXTENSIONS.has(path.posix.extname(name));
    })
    .sort((left, right) => (left > right) - (left < right));
}

function validateActiveSurfaceContents(source, contents, errors) {
  for (const { category, pattern } of FORBIDDEN_ACTIVE_MARKERS) {
    const match = pattern.exec(source) ?? pattern.exec(contents);
    if (match !== null) {
      errors.push(`[${source}] forbidden ${category} marker: ${match[0]}`);
    }
  }
}

function validateActiveSurfaces(root, surfaces, errors) {
  const sources = listTrackedActiveSurfaceFiles(root, surfaces, errors);

  for (const source of sources) {
    let contents;
    try {
      contents = readFileSync(path.join(root, source), "utf8");
    } catch {
      errors.push(`[${source}] cannot be read`);
      continue;
    }
    validateActiveSurfaceContents(source, contents, errors);
  }
}

function isHttpUrl(value) {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateManifestUrls(source, manifest, errors) {
  if (manifest?.authorUrl !== undefined && !isHttpUrl(manifest.authorUrl)) {
    errors.push(`[${source}] authorUrl must be an HTTP or HTTPS URL`);
  }
  if (manifest?.fundingUrl === undefined) return;
  const validFundingUrl = isHttpUrl(manifest.fundingUrl)
    || (manifest.fundingUrl !== null
      && typeof manifest.fundingUrl === "object"
      && !Array.isArray(manifest.fundingUrl)
      && Object.keys(manifest.fundingUrl).length > 0
      && Object.entries(manifest.fundingUrl).every(([label, url]) => label.trim() !== "" && isHttpUrl(url)));
  if (!validFundingUrl) {
    errors.push(`[${source}] fundingUrl must be an HTTP or HTTPS URL or an object of URLs`);
  }
}

function validateManifest(source, manifest, packageVersion, errors) {
  if (manifest === undefined) return;

  if (manifest?.id !== "ai-wiki") {
    errors.push(`[${source}] id ${display(manifest?.id)} must be ai-wiki`);
  }
  validateVersion(source, manifest?.version, packageVersion, errors);
  if (typeof manifest?.version !== "string" || !RELEASE_VERSION_PATTERN.test(manifest.version)) {
    errors.push(`[${source}] version ${display(manifest?.version)} must use the x.y.z format`);
  }
  if (typeof manifest?.name !== "string" || manifest.name.trim() === "") {
    errors.push(`[${source}] name must be a non-empty string`);
  } else {
    if (!PRINTABLE_ASCII_PATTERN.test(manifest.name)) {
      errors.push(`[${source}] name must use printable ASCII characters`);
    }
    if (!/^[A-Za-z0-9 +()-]+$/.test(manifest.name)) {
      errors.push(`[${source}] name contains unsupported punctuation`);
    }
    if (/\b(?:obsidian|plugin)\b/i.test(manifest.name)) {
      errors.push(`[${source}] name must not contain "Obsidian" or "Plugin"`);
    }
  }
  if (typeof manifest?.description !== "string" || manifest.description.trim() === "") {
    errors.push(`[${source}] description must be a non-empty string`);
  } else {
    if ([...manifest.description].length > 250) errors.push(`[${source}] description must be at most 250 characters`);
    if (!manifest.description.endsWith(".")) errors.push(`[${source}] description must end with a period`);
    if (!PRINTABLE_ASCII_PATTERN.test(manifest.description)) {
      errors.push(`[${source}] description must use printable ASCII characters`);
    }
    if (/^This is a plugin\b/i.test(manifest.description)) {
      errors.push(`[${source}] description must not start with "This is a plugin"`);
    }
  }
  if (typeof manifest?.author !== "string" || manifest.author.trim() === "") {
    errors.push(`[${source}] author must be a non-empty string`);
  }
  if (typeof manifest?.minAppVersion !== "string" || !RELEASE_VERSION_PATTERN.test(manifest.minAppVersion)) {
    errors.push(`[${source}] minAppVersion ${display(manifest?.minAppVersion)} must use the x.y.z format`);
  }
  if (typeof manifest?.isDesktopOnly !== "boolean") {
    errors.push(`[${source}] isDesktopOnly must be a boolean`);
  }
  validateManifestUrls(source, manifest, errors);
}

function validatePrebuild(root) {
  const errors = [];
  const packageJson = readJson(root, "package.json", errors);
  const packageLock = readJson(root, "package-lock.json", errors);
  const rootManifest = readJson(root, "manifest.json", errors);
  const sourceManifest = readJson(root, "src/manifest.json", errors);
  const versionsJson = readJson(root, "versions.json", errors);
  const packageVersion = packageJson?.version;
  const readme = validateRequiredText(root, "README.md", errors);
  validateRequiredText(root, "LICENSE", errors);
  validateActiveSurfaces(root, PREBUILD_ACTIVE_SURFACES, errors);

  if (packageJson !== undefined) {
    if (typeof packageVersion !== "string" || !SEMVER_PATTERN.test(packageVersion)) {
      errors.push(`[package.json] version ${display(packageVersion)} is not valid SemVer`);
    } else if (!RELEASE_VERSION_PATTERN.test(packageVersion)) {
      errors.push(`[package.json] version ${display(packageVersion)} must use the x.y.z release format`);
    }
  }
  if (packageLock !== undefined) {
    validateVersion("package-lock.json", packageLock?.version, packageVersion, errors);
    validateVersion('package-lock.json packages[""]', packageLock?.packages?.[""]?.version, packageVersion, errors);
  }
  validateManifest("manifest.json", rootManifest, packageVersion, errors);
  validateManifest("src/manifest.json", sourceManifest, packageVersion, errors);
  validateMatchingFiles(root, "manifest.json", "src/manifest.json", errors);
  if (versionsJson !== undefined) {
    if (versionsJson?.[PROTECTED_RELEASE_VERSION] !== "1.7.2") {
      errors.push("[versions.json] 0.3.5 must remain mapped to 1.7.2");
    }
    const versionKeys = versionsJson !== null && typeof versionsJson === "object"
      ? Object.keys(versionsJson)
      : [];
    const invalidVersionKeys = versionKeys.filter((key) => parseReleaseVersion(key) === undefined);
    for (const key of invalidVersionKeys) {
      errors.push(`[versions.json] version key ${key} must use exact x.y.z format`);
    }
    const currentRelease = parseReleaseVersion(packageVersion);
    const protectedRelease = parseReleaseVersion(PROTECTED_RELEASE_VERSION);
    if (currentRelease !== undefined && protectedRelease !== undefined) {
      if (compareReleaseVersions(currentRelease, protectedRelease) <= 0) {
        errors.push(
          `[package.json] release version ${packageVersion} must be greater than protected version ${PROTECTED_RELEASE_VERSION}`,
        );
      } else if (invalidVersionKeys.length === 0) {
        const highestReleaseKey = versionKeys.reduce((highest, key) => {
          if (highest === undefined) return key;
          const keyVersion = parseReleaseVersion(key);
          const highestVersion = parseReleaseVersion(highest);
          return keyVersion !== undefined
            && highestVersion !== undefined
            && compareReleaseVersions(keyVersion, highestVersion) > 0
            ? key
            : highest;
        }, undefined);
        if (highestReleaseKey !== packageVersion) {
          errors.push(
            `[versions.json] highest release key ${display(highestReleaseKey)} must equal package.json version ${packageVersion}`,
          );
        }
      }
    }
    if (
      typeof packageVersion === "string"
      && typeof sourceManifest?.minAppVersion === "string"
      && versionsJson?.[packageVersion] !== sourceManifest.minAppVersion
    ) {
      errors.push(
        `[versions.json] ${packageVersion} must map to src/manifest.json minAppVersion ${sourceManifest.minAppVersion}`,
      );
    }
  }
  if (readme !== undefined) {
    for (const heading of README_DISCLOSURES) {
      const pattern = new RegExp(`^#{2,3} ${heading}$`, "mi");
      if (!pattern.test(readme)) errors.push(`[README.md] missing required disclosure: ${heading}`);
    }
  }

  return { errors, packageVersion };
}

function validatePostbuild(root) {
  const { errors, packageVersion } = validatePrebuild(root);

  for (const source of ["dist/main.js", "dist/manifest.json", "dist/styles.css"]) {
    try {
      if (readFileSync(path.join(root, source)).length === 0) {
        errors.push(`[${source}] missing or empty`);
      }
    } catch {
      errors.push(`[${source}] missing or empty`);
    }
  }

  try {
    const main = readFileSync(path.join(root, "dist/main.js"), "utf8");
    validateActiveSurfaceContents("dist/main.js", main, errors);
    if (/sourceMappingURL\s*=\s*data:/.test(main)) {
      errors.push("[dist/main.js] inline source map is not allowed");
    }
  } catch {
    // Missing assets are reported by the required-file check above.
  }

  let sourceManifest;
  let distManifest;
  try {
    sourceManifest = readFileSync(path.join(root, "src/manifest.json"));
  } catch {
    // Prebuild reports the source manifest read error.
  }
  try {
    distManifest = readFileSync(path.join(root, "dist/manifest.json"));
  } catch {
    // The required-file check reports the dist manifest read error.
  }

  if (distManifest !== undefined) {
    try {
      validateManifest("dist/manifest.json", JSON.parse(distManifest.toString("utf8")), packageVersion, errors);
    } catch {
      errors.push("[dist/manifest.json] invalid JSON");
    }
  }

  if (sourceManifest !== undefined && distManifest !== undefined) {
    if (!sourceManifest.equals(distManifest)) {
      errors.push("[dist/manifest.json] bytes do not match src/manifest.json");
    }
  }

  return errors;
}

try {
  const { root, phase } = parseArgs(process.argv.slice(2));
  const resolvedRoot = path.resolve(root);
  const errors = phase === "postbuild" ? validatePostbuild(resolvedRoot) : validatePrebuild(resolvedRoot).errors;
  if (errors.length > 0) {
    process.stderr.write(`Release validation failed:\n- ${errors.join("\n- ")}\n`);
    process.exitCode = 1;
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
