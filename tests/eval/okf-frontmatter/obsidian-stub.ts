// Minimal `obsidian` stub for the out-of-vault okf-frontmatter eval.
// The only symbol the eval's import tree pulls from `obsidian` is `requestUrl`
// (in src/page-similarity.ts, via the splitSections check added for Task 5b). The
// deterministic splitSections check never calls it — this stub only needs to exist.
export function requestUrl(): never {
  throw new Error("requestUrl is not available in the okf-frontmatter eval");
}
