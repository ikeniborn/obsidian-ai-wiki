// The audit helper is plain JavaScript; declare the surface the test imports so
// the suite typechecks without converting the script itself.
declare module "*/audit-snippets.mjs" {
  export const commandStart: RegExp;
  export function stripTrailingContinuation(value: string): string;
  export function normalizedText(value: string): string;
  export function unique(values: string[]): string[];
  export function extractTechnicalSnippets(markdown: string): string[];
}
