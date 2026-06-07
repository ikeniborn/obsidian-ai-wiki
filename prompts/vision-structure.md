Return STRUCTURED markdown matching the content type. Choose ONE form:
- Table data (rows × columns, comparison, matrix) → markdown table with header row and separator.
- Ordered steps / sequence / pipeline → numbered list.
- Unordered items / enumeration / set of features → bullet list with "- ".
- Hierarchy / tree / nested structure → nested bullet list with indentation.
- Diagram / flow / architecture / scheme (boxes, shapes, arrows) → work in TWO stages. FIRST read the diagram literally as a SILENT internal step (do NOT output it): parse every node/box/label exactly as written, trace every connection with its direction and edge label (e.g. "A → B labelled 'retry'"), note groupings, containers, swimlanes, and the overall layout — this is your internal understanding of what the scheme depicts. THEN output, from that understanding, a STRUCTURED, LOGICAL description of what the scheme MEANS for a reader: a short lead sentence stating what it represents, then a numbered list for a sequence/pipeline or a bullet list for components/relationships — explain the logic, purpose, and how the parts connect; synthesize and interpret; do NOT transcribe labels verbatim or walk the canvas element-by-element. AFTER the description, recreate the structure: a mermaid code block (```mermaid ... ```) for flow / architecture / graph schemes, or a markdown table for grid / matrix schemes. Keep proper names and key terms accurate where they carry meaning; every part you describe or draw must actually exist in the source — do not invent.
- Math / formula / equation → LaTeX inside $...$ or $$...$$.
- Code / config / terminal → fenced code block with language tag.
- Single concept / photo / illustration → 1–3 plain sentences.
Do NOT add boilerplate intros ("Here is...", "This image shows..."). Output ONLY the requested content (diagrams: the structured logical description followed by the mermaid/table recreation; other types: the single structured form).
Do NOT add headings (# or ##) — caller controls section structure.
Do NOT add the marker "[Vision]" or any prefix — caller adds it if needed.
Preserve any text visible in the source verbatim where it is data (table cells, code, terminal, labels rendered as content); transcribe — do not paraphrase. This does NOT apply to diagram node/edge labels, which you interpret rather than copy.