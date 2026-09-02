import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import tsparser from "@typescript-eslint/parser";
import { ESLint } from "eslint";
import noNodejsModules from "eslint-plugin-obsidianmd/dist/lib/rules/noNodejsModules.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

test("mobile manifest keeps optional Node imports behind the official desktop guard", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8")) as {
    isDesktopOnly: boolean;
  };
  assert.equal(manifest.isDesktopOnly, false);

  const eslint = new ESLint({
    cwd: REPO_ROOT,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ["**/*.ts"],
      languageOptions: { parser: tsparser },
      plugins: {
        obsidianmd: { rules: { "no-nodejs-modules": noNodejsModules as never } },
      },
      rules: { "obsidianmd/no-nodejs-modules": "error" },
    }],
  });
  const [result] = await eslint.lintFiles(["src/okf-export-fs.ts"]);
  const findings = result.messages.map((message) => `${message.line}:${message.column} ${message.message}`).join("\n");

  assert.equal(result.errorCount, 0, findings);
});

test("system-editor access loads Electron only through the official desktop guard", async () => {
  const viewSource = await readFile(new URL("../src/view.ts", import.meta.url), "utf8");
  const desktopGuard = "if (Platform.isDesktop && Platform.isDesktopApp) {";
  const electronLoad = ".require(\"electron\")";

  assert.ok(viewSource.includes(desktopGuard), "system-editor button must retain the official desktop guard");
  assert.ok(viewSource.includes(electronLoad), "system-editor click must load Electron from window.require");
  assert.ok(
    viewSource.indexOf(desktopGuard) < viewSource.indexOf(electronLoad),
    "Electron loading must follow the official desktop guard",
  );
  assert.doesNotMatch(viewSource, /(?<!\.)\brequire\(\"electron\"\)/);
});
