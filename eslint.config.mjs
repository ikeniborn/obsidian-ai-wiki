import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";

// Mirrors the Obsidian community plugin reviewer so `npm run lint` reproduces
// release-blocking findings locally before publishing. Aligned to the rule set
// the reviewer actually enforces — see the override block below.
export default defineConfig([
  {
    ignores: ["main.js", "dist/**", "node_modules/**", "esbuild.config.mjs"],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
      // The plugin only injects Node globals when manifest.isDesktopOnly is
      // true. This plugin keeps isDesktopOnly:false for mobile, but guards its
      // desktop-only `require(...)` calls at runtime, so the symbols are valid.
      globals: { ...globals.node, NodeJS: "readonly" },
    },
    rules: {
      // Rules not enforced by the current Obsidian reviewer. Keeping them on
      // would diverge local lint from the release gate (and sentence-case
      // mangles product names like "GPT-4o-mini"). Revisit if the reviewer adds
      // them.
      "obsidianmd/ui/sentence-case": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      // The reviewer treats Node builtin imports as advisory warnings (this is a
      // mobile-capable plugin whose desktop-only paths are runtime-guarded), not
      // release-blocking errors. Match that severity so warnings stay visible
      // without failing the lint gate.
      "import/no-nodejs-modules": "warn",
    },
  },
]);
