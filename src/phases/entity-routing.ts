import type { DomainEntry, EntityType } from "../domain";
import { buildWikiStem } from "../wiki-stem";
import { effectiveSubfolder } from "../wiki-path";

/** Extracted entity carrying (optionally) its type — the source of truth for routing. */
export interface RoutingEntity {
  name: string;
  type?: string;
}

/**
 * Given the wiki stems that still lack a resolvable domain type, return an
 * assignment `stem -> type`. Types outside the domain's `entity_types` are
 * ignored by the caller. Injected so the routing core stays pure/testable; the
 * ingest phase supplies an LLM-backed implementation.
 */
export type TypeClassifier = (stems: string[]) => Promise<Map<string, string>>;

export interface RouteResult<T> {
  /** Pages whose path was rewritten into their entity type's subfolder. */
  routed: T[];
  /** Pages with no valid domain type after all classifier rounds — NOT written. */
  rejected: { page: T; reason: string }[];
}

function stemOf(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/, "");
}

/**
 * Deterministically route each synthesised page into its entity type's
 * subfolder and validate that every page has a valid domain type BEFORE it is
 * written. The LLM-chosen subfolder is ignored — weak local models copy the
 * prompt's example path for every page, so routing is decided server-side.
 *
 * Resolution order for a page's type:
 *   1. the extracted entity matching the page stem (`wiki_<domain>_<slug>`),
 *      when its type is one of the domain's `entity_types`;
 *   2. up to `maxClassifyRounds` calls to `classify`, which re-asks the model to
 *      assign each still-unresolved stem a type from the domain's list.
 * A page still unresolved after that is REJECTED (never dumped into a generic
 * `entities/` bucket). The subfolder is `effectiveSubfolder(entityType)` —
 * the type's `wiki_subfolder`, or the sanitized type name when absent.
 */
export async function routeAndValidatePages<T extends { path: string }>(
  pages: T[],
  entities: RoutingEntity[],
  domain: DomainEntry,
  wikiVaultPath: string,
  classify: TypeClassifier,
  maxClassifyRounds = 2,
): Promise<RouteResult<T>> {
  const typeToEt = new Map<string, EntityType>();
  for (const et of domain.entity_types ?? []) typeToEt.set(et.type, et);

  const stemToType = new Map<string, string>();
  for (const e of entities) {
    if (!e.type || !typeToEt.has(e.type)) continue;
    let stem: string;
    try { stem = buildWikiStem(domain.id, e.name); } catch { continue; }
    stemToType.set(stem, e.type);
  }

  const unresolvedStems = (): string[] =>
    pages.map((p) => stemOf(p.path)).filter((s) => !stemToType.has(s));

  for (let round = 0; round < maxClassifyRounds && unresolvedStems().length > 0; round++) {
    let assignments: Map<string, string>;
    try {
      assignments = await classify(unresolvedStems());
    } catch {
      break; // classifier failed — remaining pages will be rejected below
    }
    for (const [stem, type] of assignments) {
      if (typeToEt.has(type)) stemToType.set(stem, type);
    }
  }

  const knownTypes = [...typeToEt.keys()].join(", ") || "(none defined)";
  const routed: T[] = [];
  const rejected: { page: T; reason: string }[] = [];
  for (const p of pages) {
    const stem = stemOf(p.path);
    const type = stemToType.get(stem);
    if (!type) {
      rejected.push({ page: p, reason: `no valid entity type (expected one of: ${knownTypes})` });
      continue;
    }
    const sub = effectiveSubfolder(typeToEt.get(type)!);
    routed.push({ ...p, path: `${wikiVaultPath}/${sub}/${stem}.md` });
  }
  return { routed, rejected };
}
