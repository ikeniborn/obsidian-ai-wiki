// Runtime stand-in for `path-browserify`, used only by the eval harness (scripts/)
// running under tsx. `path-browserify` is CJS and its named exports are invisible
// to Node ESM, so a bare `import { basename } from "path-browserify"` throws at
// module-eval time. node:path provides the same API with real ESM named exports.
export * from "node:path";
