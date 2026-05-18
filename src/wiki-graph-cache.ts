import { buildWikiGraph, type WikiGraph } from "./wiki-graph";

type CacheEntry = { hash: string; graph: WikiGraph };

function hashPages(pages: Map<string, string>): string {
  const parts: string[] = [];
  const keys = [...pages.keys()].sort();
  for (const k of keys) parts.push(`${k}:${pages.get(k)!.length}`);
  return parts.join("|");
}

export class GraphCache {
  private store = new Map<string, CacheEntry>();

  get(domainId: string, pages: Map<string, string>): { graph: WikiGraph; fromCache: boolean } {
    const hash = hashPages(pages);
    const hit = this.store.get(domainId);
    if (hit && hit.hash === hash) return { graph: hit.graph, fromCache: true };
    const graph = buildWikiGraph(pages);
    this.store.set(domainId, { hash, graph });
    return { graph, fromCache: false };
  }

  invalidate(domainId: string): void {
    this.store.delete(domainId);
  }

  clear(): void {
    this.store.clear();
  }
}

export const graphCache = new GraphCache();
