export const moment = {
  locale(): string {
    return (globalThis as { __MOMENT_LOCALE__?: string }).__MOMENT_LOCALE__ ?? "en";
  },
};

// TFile/TFolder: named exports required to resolve src/utils/vault-walk.ts (the eval
// exercises parseWikiSources only — walkFolder's `instanceof TFile/TFolder` checks are
// never invoked, so these placeholders only need to exist for esbuild's export check).
export class TFile {}
export class TFolder {}
