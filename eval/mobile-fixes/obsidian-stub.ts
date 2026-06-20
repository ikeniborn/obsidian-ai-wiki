// Minimal `obsidian` stub for the out-of-vault mobile-fixes eval.
// The import tree pulls `requestUrl` (src/page-similarity.ts) and `moment` (src/i18n.ts);
// neither is called on the deterministic test paths.
export function requestUrl(): never {
  throw new Error("requestUrl is not available in the mobile-fixes eval");
}
// moment is imported by i18n.ts but only called inside resolveLang(), which is not
// exercised by the deterministic tests (isVisionSupportedOnMobile → getMimeType only).
export const moment: unknown = null;
