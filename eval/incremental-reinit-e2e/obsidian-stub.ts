// Minimal obsidian stub so the eval can bundle src/utils/vault-walk.ts, which
// value-imports TFile/TFolder for instanceof checks. parseWikiSources (the only
// vault-walk export this eval uses) never touches them at runtime, so empty
// classes are sufficient to satisfy esbuild's named-import resolution.
export class TFile {}
export class TFolder {}
export const moment = {
  locale(): string {
    return (globalThis as { __MOMENT_LOCALE__?: string }).__MOMENT_LOCALE__ ?? "en";
  },
};
