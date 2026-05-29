export const WIKI_STEM_PREFIX = "wiki";

// Domain ids allow lowercase letters, digits, `_`, and `-` (matches validateDomainId).
const DOMAIN_ID_CHARS = "a-z0-9_\\-";
// Entity slugs are lowercase only. PascalCase / camelCase inputs are split on case
// boundaries before lowercasing so `NeuralNetworks` → `neural_networks`.
const ENTITY_SLUG_CHARS = "a-z0-9_";

export const GENERIC_WIKI_STEM_REGEX = new RegExp(
  `^${WIKI_STEM_PREFIX}_[${DOMAIN_ID_CHARS}]+_[${ENTITY_SLUG_CHARS}]+$`,
);

const DOMAIN_ID_RE = new RegExp(`^[${DOMAIN_ID_CHARS}]+$`);

export function slugifyEntity(name: string): string {
  const stripped = name
    .normalize("NFD")
    .replace(/\p{M}+/gu, "");
  // Insert `_` at camelCase boundaries: lower/digit → upper, and acronym → CamelCase.
  const split = stripped
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2");
  const replaced = split.replace(/[^A-Za-z0-9]+/g, "_");
  const trimmed = replaced.replace(/^_+|_+$/g, "").toLowerCase();
  if (!trimmed) {
    throw new Error(`slugifyEntity: cannot derive slug from "${name}"`);
  }
  return trimmed;
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildWikiStem(domainId: string, entityName: string): string {
  if (!DOMAIN_ID_RE.test(domainId)) {
    throw new Error(`buildWikiStem: invalid domainId "${domainId}"`);
  }
  return `${WIKI_STEM_PREFIX}_${domainId}_${slugifyEntity(entityName)}`;
}

export function stemRegex(domainId: string): RegExp {
  if (!DOMAIN_ID_RE.test(domainId)) {
    throw new Error(`stemRegex: invalid domainId "${domainId}"`);
  }
  return new RegExp(`^${WIKI_STEM_PREFIX}_${escapeForRegex(domainId)}_[${ENTITY_SLUG_CHARS}]+$`);
}

export function isWikiStem(stem: string, domainId?: string): boolean {
  if (domainId !== undefined) {
    return stemRegex(domainId).test(stem);
  }
  return GENERIC_WIKI_STEM_REGEX.test(stem);
}
