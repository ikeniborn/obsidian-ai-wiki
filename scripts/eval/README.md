# Eval gold sets

Each `*.gold.json` is a **vault-specific** array of `{ q, gold }` pairs (~30–50
entries). `q` is a question; `gold` is the list of relevant pageId stems
(the same stems retrieval returns, e.g. `Ingest` for `Ingest.md`). A topic may
span pages, so `gold` can hold more than one id.

`example.gold.json` is a template — replace the questions and ids with ones that
reference your own vault, then run:

    npm run eval -- --vault /path/to/vault --gold scripts/eval/your-vault.gold.json

Gold files contain only questions + page ids — no vault content — so they are
safe to commit.
