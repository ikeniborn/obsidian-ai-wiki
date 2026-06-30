/**
 * Boot shims for the live graph-floor harness. Must be the first import.
 * 1. `.md` → text (esbuild uses loader:text in prod; here manual).
 * 2. Stub "obsidian" with a real fetch-backed requestUrl so PageSimilarityService's
 *    fetchEmbeddings() can hit the live OpenAI-compatible /embeddings endpoint headlessly.
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
const Module = require("module") as { _load: (...args: unknown[]) => unknown; _resolveFilename: (...args: unknown[]) => string };
const _origResolve = Module._resolveFilename;
Module._resolveFilename = function (...args: unknown[]) {
  if (args[0] === "obsidian") return "obsidian";
  return _origResolve.apply(this, args);
};
const _origLoad = Module._load;
Module._load = function (...args: unknown[]) {
  if (args[0] === "obsidian") {
    return {
      moment: { locale: () => "en" },
      Platform: { isDesktopApp: true, isMobile: false },
      async requestUrl(opts: { url: string; method?: string; headers?: Record<string, string>; body?: string }) {
        const r = await fetch(opts.url, { method: opts.method ?? "GET", headers: opts.headers, body: opts.body });
        const text = await r.text();
        return { status: r.status, text };
      },
    };
  }
  return _origLoad.apply(this, args);
};
