// Obsidian's `requestUrl`, re-exported so the network helpers can pull it in via
// a LOCAL dynamic `import("./request-url")`. esbuild inlines a local dynamic
// import and turns the external `obsidian` static import below into a runtime
// `require("obsidian")` — which Obsidian's renderer resolves. A dynamic
// `import("obsidian")` is instead emitted verbatim and fails at runtime with
// "Failed to resolve module specifier 'obsidian'". Keeping the import lazy (via
// a local module) also keeps page-similarity.ts / reranker.ts importable in the
// headless test runner without registering the obsidian stub, since this module
// only loads when a network call is actually made.
import { requestUrl } from "obsidian";

export { requestUrl };
