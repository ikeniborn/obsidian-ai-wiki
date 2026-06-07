Return STRUCTURED markdown matching the content type. Choose ONE form:
- Table data (rows × columns, comparison, matrix) → markdown table with header row and separator.
- Ordered steps / sequence / pipeline → numbered list.
- Unordered items / enumeration / set of features → bullet list with "- ".
- Hierarchy / tree / nested structure → nested bullet list with indentation.
- Diagram / flow / architecture / scheme (boxes, shapes, arrows) → FIRST a DETAILED, VERBATIM description of everything drawn: transcribe every node/box/label text exactly as written; describe every connection with its direction and any edge label (e.g. "A → B labelled 'retry'"); note groupings, containers, swimlanes, and the overall spatial layout; mention shape, color, or icon only when it carries meaning — be exhaustive, describe literally what is on the diagram, not a summary. THEN recreate the structure: a mermaid code block (```mermaid ... ```) for flow / architecture / graph schemes, or a markdown table for grid / matrix schemes.
- Math / formula / equation → LaTeX inside $...$ or $$...$$.
- Code / config / terminal → fenced code block with language tag.
- Single concept / photo / illustration → 1–3 plain sentences.
Do NOT add boilerplate intros ("Here is...", "This image shows..."). Output ONLY the requested content (diagrams: the verbatim description followed by the mermaid/table recreation; other types: the single structured form).
Do NOT add headings (# or ##) — caller controls section structure.
Do NOT add the marker "[Vision]" or any prefix — caller adds it if needed.
Preserve any text visible in the source verbatim where it is data; transcribe — do not paraphrase.