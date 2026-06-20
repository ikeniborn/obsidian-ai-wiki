import { isAbsolute, join } from "path-browserify";
import { WIKI_ROOT } from "./wiki-path";

/** A vault folder is a valid domain source iff it is not the wiki output tree. */
export function isSelectableSourceFolder(path: string): boolean {
  return path !== WIKI_ROOT && !path.startsWith(`${WIKI_ROOT}/`);
}

/**
 * Returns updated source_paths after adding newPath with consolidation:
 * - If newPath is already covered by an existing ancestor → returns existing unchanged
 * - Removes entries that are descendants of newPath (they become redundant)
 * - Adds newPath
 */
export function consolidateSourcePaths(
  existing: string[],
  newPath: string,
  vaultRoot: string,
): string[] {
  const toAbs = (p: string): string => (isAbsolute(p) ? p : join(vaultRoot, p));
  const normed = (p: string): string => {
    const a = toAbs(p);
    return a.endsWith("/") ? a : a + "/";
  };

  const newNormed = normed(newPath);

  // Already covered by an existing ancestor?
  if (existing.some((sp) => newNormed.startsWith(normed(sp)))) {
    return existing;
  }

  // Remove descendants (paths that start with newNormed)
  const filtered = existing.filter((sp) => !normed(sp).startsWith(newNormed));

  return [...filtered, newPath];
}
