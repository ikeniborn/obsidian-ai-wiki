# OS/Unix Reinit Domain Quality Report

## Scope

- Reinit session: `1784956783666`
- Source snapshot: `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/before/ОС/Unix`
- Generated vault: `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run`
- Sources: 22 Markdown notes
- Generated domain: 65 pages
- Query set: 10 questions fixed before execution

The accepted Query measurement used the production `AgentRunner`, the vault's effective
settings, the configured embedding and reranker endpoints, and a headless implementation
of Obsidian `requestUrl`. The earlier fallback run is retained as a control only: Node had
no Obsidian runtime module, so every embedding and reranker request failed locally.

## Reinit Execution

| Metric | Result |
|---|---:|
| Terminal state | done, 22/22 sources |
| Duration | 44m 23.8s |
| LLM calls / HTTP responses | 106 / 106 |
| HTTP 200 | 106/106 |
| Transport retries | 0 |
| Evidence-map structural repairs | 1 |
| Synthesis validation repairs | 2 |
| Input / output tokens | 406,601 / 278,472 |
| Pages created / updated | 65 / 12 |
| Synthesis calls | 81 |

The transport repair is accepted. All requests used complete buffered desktop-host
responses. The remaining failures are routing, content preservation, and grounding.

## Domain Audit

Deterministic page integrity passed for all 65 pages: YAML, canonical type-folder mapping,
resource existence, index records, aliases, markers, and H1 shape are valid.

| Metric | Result | Interpretation |
|---|---:|---|
| Sources with an attributed page | 21/22 (95.45%) | Reject: `npm.md` had zero effect |
| Declared identities resolved | 34/106 (32.08%) | Diagnostic; some consolidation is intentional |
| Exact command/config lines retained | 234/537 (43.58%) | Major procedural loss |
| Source URLs retained | 15/21 (71.43%) | Six source URLs lost |
| Technical values retained | 22/43 (51.16%) | Major exact-value loss |
| Unsupported generated URLs | 30 | Reject: citations absent from attributed sources |
| Unresolved WikiLinks | 2 | Both target deleted/consolidated `https_proxy` |
| Non-source self-links | 1 | Canonical self-link on `obsidian_desktop` |
| Pages timestamped with run date | 0/65 | Model selected eight unrelated 2025 dates |
| Status distribution | 61 stub, 4 developing | Mostly low-confidence output |

Exact-line preservation is a strict diagnostic, not a semantic recall score. It may count
formatting changes as misses. It is still decisive for commands, URLs, UUIDs, and numeric
configuration values, which should not be silently rewritten.

The strongest source-level failures are:

- `npm.md`: 0 pages and 0/8 technical lines retained.
- `Gitlab runner.md`: 2 pages, but 2/15 technical lines retained; download, chmod,
  `useradd`, service install, and service start commands disappeared.
- `ufw.md`: 5/24 technical lines retained; installation, default policy, numbered status,
  delete, and reload instructions disappeared.
- `Fail2Ban.md`: 53/216 technical lines and 6/19 technical values retained; the core
  Fail2Ban entity was not created, while generated pages introduced altered regexes and
  log paths.
- `network.md`: generated `iptables` prose and two documentation URLs that are absent from
  the command-only source.

## Query Evaluation

Gateway controls returned HTTP 200 for both `/embeddings` and `/rerank` in about 100 ms.
The accepted ten-question run had no embedding or reranker fallback.

| Metric | Result |
|---|---:|
| Completed answers | 10/10 |
| Retrieval hit on at least one expected page | 9/10 |
| Mean expected-page recall | 81.67% |
| Full expected-page coverage | 7/10 |
| Valid WikiLinks | 35/35 |
| Chat transport/schema/domain retries | 0 |
| Mean latency | 14.74s |
| Chat input / output tokens | 30,719 / 16,234 |
| Exact technical units grounded in selected pages | 153/202 (75.74%) |
| Exact technical units grounded in attributed sources | 153/202 (75.74%) |

The automatic required-fact score was 77.14%, but it is not an acceptance metric. It
counted negated text as success: the UFW answer listed missing commands under "not
described" and received a false 100%. Manual semantic review follows.

| Case | Retrieval | Manual result | Main finding |
|---|---:|---|---|
| Obsidian proxy on ALT Linux | 5/5 | Partial | Core procedure present; three added technical steps/claims are absent from source |
| NFS server/client | 5/5 | Partial | Complete flow, but permission changed and an outbound UFW rule was invented |
| AMDGPU and ROCm | 5/5 | Mostly pass | Complete; one extra `update-initramfs` command is unsupported |
| Fail2Ban, HAProxy, Docker | 4/4 | Reject | Security config contains altered regex, log path, and nftables instruction |
| GitLab Runner shell | 2/2 | Reject | Retrieval succeeded, but only 1/6 required installation actions survived |
| Linux cache/sysctl | 3/3 | Reject | Source SSD/HDD and expiry guidance omitted; new byte values invented |
| UFW firewall | 2/3 | Reject | Only 2/7 required actions are positively answered; five are merely negated |
| SSH key and server | 5/5 | Pass | Complete and source-faithful |
| systemd storage mounts | 2/4 | Reject | Actual WD Green UUID replaced by placeholder; unsupported admin commands added |
| npm, nvm, Node.js, clasp | 0/4 | Reject | Domain contains no relevant page; answer correctly reports insufficient context |

Strictly acceptable answers: 1/10. Four answers are useful only with review; six are
rejected for missing or unsupported operational instructions.

## Root Causes

1. Consolidation runs before ensuring the chosen parent has a server-owned path. For
   `npm.md`, routable children were consolidated first into `bashrc`, then `node-js`;
   neither parent had `serverOwnedCreatePath`, so both repaired responses became `SKIP`.
2. A source can finish successfully with validated evidence but zero mutations. No
   post-ingest coverage gate rejects this state.
3. Synthesis validates frame, schema, paths, and metadata shape, but not whether every
   evidence fact was carried into an action. Procedural commands are silently dropped.
4. Article Markdown remains generative. The model can add world knowledge, citations,
   dates, commands, regexes, and numeric values not present in evidence.
5. Query retrieval is healthy, but incomplete pages force the answer model either to
   decline or reconstruct missing instructions. No technical-output grounding gate stops
   reconstructed commands.

## Repair Order

### P0

1. Assign canonical create authority before consolidation. A consolidation parent must
   be an existing target or have a server-owned create path. Otherwise choose a routable
   evidence entity or keep bundles separate.
2. Add a per-source evidence ledger. Every validated fact/range must be assigned to a
   create/patch section or an explicit governed skip. Reject evidence-bearing zero-effect
   sources.
3. Preserve code, URLs, UUIDs, versions, IPs, and numeric settings exactly. Validate
   generated URLs against evidence and remove all model-authored citations outside the
   allowlist.
4. Make timestamp and status server-owned. Reconcile Related links against the final
   non-trash page registry after all creates, patches, merges, and deletes.
5. Validate Query code/config lines against packed context. Repair or omit unsupported
   operational instructions; do not count negated mentions as fact coverage.

### P1

1. Keep one domain-neutral source-primary coverage carrier for procedural notes, then
   create secondary reusable entity pages only when evidence supports them. This avoids
   hardcoded OS taxonomy while retaining complete procedures.
2. Add retrieval confidence telemetry and a no-relevant-context threshold. Do not tune
   embeddings or reranker before content coverage is fixed.
3. Reduce cost only after correctness: synthesis used 81 calls and normally produced
   under 4.3k output tokens despite a 16,384 ceiling. Use predicted per-call ceilings and
   capability-gated dynamic batching rather than a larger global budget.

## Verdict

Keep buffered desktop transport and the configured hybrid retrieval stack. Reject this
generated domain as a quality baseline. The next replay must first close path-authority,
evidence-coverage, and source-grounding failures; increasing token budgets or weakening
validation does not address them.
