import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC_ROOT = path.join(REPO_ROOT, "src");

// Obsidian and Electron are provided by the host and are marked external in
// esbuild.config.mjs, so they are deliberately absent from package.json.
const HOST_PROVIDED = new Set(["obsidian", "electron"]);

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectSourceFiles(full));
    else if (entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

function packageNameOf(specifier: string): string | undefined {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return undefined;
  if (specifier.startsWith("node:")) return undefined;
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

// An import clause never contains a quote before its `from`, so refusing quotes
// in between keeps string literals such as a "from" stopword out of the match.
const IMPORT_PATTERN = /\b(?:import|export)(?:[^"'\n]|\n)*?\bfrom\s*["']([^"']+)["']/g;
// esbuild resolves and bundles literal require() calls; that is how undici
// reaches the shipped artifact despite looking host-provided.
const REQUIRE_PATTERN = /\brequire\(\s*["']([^"']+)["']\s*\)/g;

function importedPackages(): Map<string, string[]> {
  const byPackage = new Map<string, string[]>();
  for (const file of collectSourceFiles(SRC_ROOT)) {
    const text = readFileSync(file, "utf8");
    for (const pattern of [IMPORT_PATTERN, REQUIRE_PATTERN]) {
      for (const match of text.matchAll(pattern)) {
        const name = packageNameOf(match[1]);
        if (name === undefined || HOST_PROVIDED.has(name)) continue;
        const relative = path.relative(REPO_ROOT, file);
        const files = byPackage.get(name) ?? [];
        if (!files.includes(relative)) files.push(relative);
        byPackage.set(name, files);
      }
    }
  }
  return byPackage;
}

test("every package imported by src/ is declared as a runtime dependency", () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const dependencies = new Set(Object.keys(pkg.dependencies ?? {}));
  const devDependencies = new Set(Object.keys(pkg.devDependencies ?? {}));

  const misclassified: string[] = [];
  for (const [name, files] of importedPackages()) {
    if (dependencies.has(name)) continue;
    const where = devDependencies.has(name) ? "devDependencies" : "not declared";
    misclassified.push(`${name} (${where}) imported by ${files.join(", ")}`);
  }

  // A package that ships inside dist/main.js but sits outside `dependencies` is
  // invisible to `npm audit --omit=dev`, which is the release security gate.
  assert.deepEqual(misclassified, []);
});
