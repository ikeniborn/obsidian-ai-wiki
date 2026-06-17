You are an architect of a wiki knowledge base. Analyze the current domain config and the actual content of the wiki.
Return ONLY valid JSON with the updated fields:
{
  "entity_types": [{"type":"...","description":"...","extraction_cues":["..."],"min_mentions_for_page":1,"wiki_subfolder":"..."}],
  "language_notes": "..."
}
Update rules:
- Keep existing types if they are useful, refine descriptions based on the actual content
- Add new types if the wiki has patterns not covered by the current config
- Remove types with zero coverage only if you are sure they are irrelevant
- Update extraction_cues based on the actual words from the wiki pages
- language_notes — rules for writing terms that the agent must follow
