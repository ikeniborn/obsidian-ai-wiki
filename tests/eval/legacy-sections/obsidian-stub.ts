// Minimal `obsidian` stub for the out-of-vault legacy-sections eval.
// The only symbol the eval's import tree pulls from `obsidian` is `requestUrl`
// (in src/page-similarity.ts). The deterministic chunk logic never calls it, and the
// embedding A/B path uses the global `fetch` directly — so this stub only needs to exist.
export function requestUrl(): never {
  throw new Error("requestUrl is not available in the legacy-sections eval");
}
