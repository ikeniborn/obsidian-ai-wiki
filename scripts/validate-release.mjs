#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

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

function validateManifest(source, manifest, packageVersion, errors) {
  if (manifest === undefined) return;

  if (manifest?.id !== "ai-wiki") {
    errors.push(`[${source}] id ${display(manifest?.id)} must be ai-wiki`);
  }
  validateVersion(source, manifest?.version, packageVersion, errors);
}

function validatePrebuild(root) {
  const errors = [];
  const packageJson = readJson(root, "package.json", errors);
  const packageLock = readJson(root, "package-lock.json", errors);
  const rootManifest = readJson(root, "manifest.json", errors);
  const sourceManifest = readJson(root, "src/manifest.json", errors);
  const packageVersion = packageJson?.version;

  if (packageJson !== undefined && (typeof packageVersion !== "string" || !SEMVER_PATTERN.test(packageVersion))) {
    errors.push(`[package.json] version ${display(packageVersion)} is not valid SemVer`);
  }
  if (packageLock !== undefined) {
    validateVersion("package-lock.json", packageLock?.version, packageVersion, errors);
    validateVersion('package-lock.json packages[""]', packageLock?.packages?.[""]?.version, packageVersion, errors);
  }
  validateManifest("manifest.json", rootManifest, packageVersion, errors);
  validateManifest("src/manifest.json", sourceManifest, packageVersion, errors);

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
