/**
 * CJS-mode boot shims for eval/cross-domain/run.ts.
 * Must be the first import so it executes before any src/ module is loaded.
 *
 * 1. Register `.md` extension so `import x from "*.md"` works (esbuild uses
 *    loader:text in production; here we do it manually).
 * 2. Stub "obsidian" — only available inside Obsidian/Electron at runtime.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const req = require as NodeRequire & {
  extensions: Record<string, (m: { exports: unknown }, filename: string) => void>;
};
req.extensions[".md"] = (m, filename) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  m.exports = require("fs").readFileSync(filename, "utf-8");
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("module") as { _load: (...args: unknown[]) => unknown };
const _origLoad = Module._load;
Module._load = function (...args: unknown[]) {
  if (args[0] === "obsidian") {
    return { moment: { locale: () => "en" }, Platform: { isDesktopApp: true, isMobile: false } };
  }
  return _origLoad.apply(this, args);
};
