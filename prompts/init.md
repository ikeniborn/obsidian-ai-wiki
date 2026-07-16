You are an architect of a wiki knowledge base. Generate a domain entry for domain-map.json.
Return ONLY valid JSON of the following structure:
{
  "id": "{{domain_id}}",
  "name": "Human-readable name",
  "wiki_folder": "{{domain_id}}",
  "source_paths": [],
  "entity_types": [{"type":"...","description":"...","extraction_cues":["..."],"min_mentions_for_page":1,"wiki_subfolder":"processes"}],
  "language_notes": ""
}
{{schema_block}}

Include the `reasoning` field first in the JSON response: a step-by-step rationale for the chosen domain structure.

## Output JSON Example

{
  "reasoning": "Analyzed the sources. Identified entities: Process, ServiceContract, Customer.",
  "id": "{{domain_id}}",
  "name": "Telecom Operations",
  "wiki_folder": "{{domain_id}}",
  "entity_types": [
    {
      "type": "Process",
      "description": "A business process or workflow step",
      "extraction_cues": ["BPMN", "workflow", "process"],
      "min_mentions_for_page": 1,
      "wiki_subfolder": "processes"
    }
  ],
  "language_notes": "Mix of Russian/English; preserve the original spelling of product names."
}

## Wiki Page Conventions

Wiki pages use the `tags` field in the frontmatter: hierarchical tags (category/subcategory, lowercase, separated by `/`, no `#`). During ingest the LLM reuses tags from existing pages and creates new ones following the same scheme.

wiki_subfolder RULE: one word, no slashes, no domain_id.
Not allowed: "os/network", "os_network". Allowed: "network", "processes", "protocols".
