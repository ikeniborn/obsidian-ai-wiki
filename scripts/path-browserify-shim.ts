// Runtime stand-in for `path-browserify`, used only by the eval harness (scripts/)
// running under tsx. `path-browserify` is CJS and its named exports are invisible
// to Node ESM, so a bare `import { basename } from "path-browserify"` throws at
// module-eval time. node:path provides the same API.
//
// node:path uses `export =`, so `export * from "node:path"` is rejected by tsc
// (TS2498). Re-export the named members src/ actually imports from path-browserify
// (basename, dirname, join, isAbsolute, relative) so both tsc and tsx resolve them.
export { basename, dirname, join, isAbsolute, relative } from "node:path";
