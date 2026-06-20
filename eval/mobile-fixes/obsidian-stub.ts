// Minimal `obsidian` stub for the out-of-vault mobile-fixes eval.
// The import tree pulls only `requestUrl` (src/page-similarity.ts); the deterministic
// tests never call it.
export function requestUrl(): never {
  throw new Error("requestUrl is not available in the mobile-fixes eval");
}
