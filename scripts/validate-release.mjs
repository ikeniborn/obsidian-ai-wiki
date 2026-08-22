#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const RELEASE_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const PRINTABLE_ASCII_PATTERN = /^[\x20-\x7e]+$/;
const README_DISCLOSURES = ["Network use", "Accounts and payment", "External file access", "License"];

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
  const packageVersion = packageJson?.version;
  const readme = validateRequiredText(root, "README.md", errors);
  validateRequiredText(root, "LICENSE", errors);

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
    if (/sourceMappingURL\s*=\s*data:/.test(main)) {
      errors.push("[dist/main.js] inline source map is not allowed");
    }
    if (/\b(?:claude-agent|ClaudeCliClient|iclaudePath)\b/.test(main)) {
      errors.push("[dist/main.js] forbidden Claude backend marker");
    }
    if (/\b(?:node:)?child_process\b/.test(main)) {
      errors.push("[dist/main.js] forbidden Node subprocess transport");
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
