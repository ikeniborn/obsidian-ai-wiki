export interface EntityType {
  type: string;
  description: string;
  extraction_cues: string[];
  min_mentions_for_page?: number;
  wiki_subfolder?: string;
}

export interface DomainEntry {
  id: string;
  name: string;
  wiki_folder: string;  // vault-relative, e.g. "!Wiki/os"
  source_paths?: string[];
  entity_types?: EntityType[];
  language_notes?: string;
}

export interface AddDomainInput {
  id: string;
  name: string;
  wikiFolder: string;  // vault-relative, e.g. "!Wiki/os"
}

/** Returns null if id is valid, or an error message string. */
export function validateDomainId(id: string): string | null {
  if (!id) return "ID домена пуст";
  if (!/^[\p{L}\p{N}_-]+$/u.test(id)) return "ID допускает только буквы/цифры/_/-";
  return null;
}
