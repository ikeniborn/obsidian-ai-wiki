---
review:
  spec_hash: 9bdb452768578146
  last_run: 2026-07-28
  chain:
    intent: n/a
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: CRITICAL
      section: "2.1 Facet coverage in context selection"
      section_hash: 0ec895ab6fa48b3c
      fragment: "Facets are derived deterministically from the question text with no model call."
      text: "\"Distinguishable facet\" had no definition, so the selection rule was not implementable as written."
      fix: "Facets defined as the tokens of the existing tokenizeLexical, ordered by first occurrence in the question."
      verdict: fixed
      verdict_at: 2026-07-27
    - id: F-002
      phase: clarity
      severity: CRITICAL
      section: "1.1 Attribution on shared pages"
      section_hash: null
      fragment: "the page gains X in `resource` and in its `## Sources` section"
      text: "No component or timing was named for adding the attribution, leaving ownership ambiguous between the gate and page synthesis."
      fix: "Named the gate in src/phases/ingest.ts as the owner, routing pages through reconcilePageProvenance in the same apply step."
      verdict: fixed
      verdict_at: 2026-07-27
      note: "Section retired by the 2026-07-27 amendment; the recorded fix no longer matches the body, which now states ingest.ts is unchanged."
    - id: F-003
      phase: consistency
      severity: WARNING
      section: "1.4 Line-continuation artifact"
      section_hash: 667e351af61d1d0b
      fragment: "Comparison drops only a trailing shell line continuation"
      text: "The rule did not say whether it applies to the product gate, the audit, or both; a one-sided change would make the audit disagree with the gate."
      fix: "Stated that the rule applies identically in findMissingSynthesisEvidence and audit-domain-quality.mjs."
      verdict: fixed
      verdict_at: 2026-07-27
    - id: F-004
      phase: clarity
      severity: WARNING
      section: "Phase 0: Deterministic Reproduction"
      section_hash: 6b0b39349dc8a93c
      fragment: null
      text: "Phase 0 had no explicit done criterion."
      fix: "Added: every class has a failing test against HEAD or is recorded as unreproducible."
      verdict: fixed
      verdict_at: 2026-07-27
      note: "Section changed by the F-012 fix (class 2 restated); re-verified 2026-07-27 - the done criterion is still present and unchanged in meaning."
    - id: F-005
      phase: clarity
      severity: WARNING
      section: "Live Verification Protocol"
      section_hash: ebca1120fc97ac9a
      fragment: null
      text: "The protocol listed steps but no pass condition for the live run."
      fix: "Added an explicit pass condition and the rule that a failed run does not close the register item."
      verdict: fixed
      verdict_at: 2026-07-27
      note: "Section changed by deferred item 3 (beforeRoot prerequisites); re-verified 2026-07-27 - pass condition intact. Confirmed against the scripts: audit-domain-quality.mjs:10-11 and audit-query-grounding.mjs:9-10 both default beforeRoot to dirname(runRoot)/before, audit-page-integrity.mjs takes only domainId and vaultRoot."
    - id: F-006
      phase: consistency
      severity: INFO
      section: "Phase 1: TD-1"
      section_hash: b005ec7c6f52caab
      fragment: "every accepted ledger item of X"
      text: "Terminology drifted between \"accepted ledger item\", \"evidence item\", and \"exact snippet\"."
      fix: "Standardized on \"ledger item\" and \"technical snippet\"."
      verdict: fixed
      verdict_at: 2026-07-27
    - id: F-007
      phase: coverage
      severity: CRITICAL
      section: "Reproduction results (2026-07-27)"
      section_hash: ab0b7ea5ab8630ed
      fragment: "The same probe isolated the three genuinely unrepresented items"
      text: 'Reproduction results claims the probe isolated exactly three genuinely unrepresented items (NFS Server.md code:203-203, code:217-217, storage.md code:33-37). The cited audit evidence conflict-validation-split-live-domain-quality-1785096684125.json also lists missing snippets from two further sources that the spec never mentions: ОС/Unix/AltLinux/Настройка прокси.md (~/.local/share/applications/obsidian.desktop) and ОС/Unix/Сервисы/network.md (sudo apt install network-manager, sudo nmcli dev show). None of the retained classes (1 erosion, 2 prose, 3 continuation) accounts for them, so the Phase 1 acceptance item "Zero unrepresented ledger items across the fixed 22-source os-unix corpus" cannot be reached by the work now in scope.'
      fix: 'Either probe and classify the obsidian.desktop and network.md items and add a covering class, or state explicitly why they are excluded from the acceptance measurement.'
      verdict: fixed
      verdict_at: 2026-07-27
      note: 'Problem now assigns the three items to an out-of-scope ledger-selection group and Discovered Debt records them; Phase 1 acceptance names them as the permitted residual. Re-verified 2026-07-27 after the section changed: extractSynthesisEvidenceLedger produces 5 items for Настройка прокси.md and 6 for network.md, and no item of either covers obsidian.desktop, sudo apt install network-manager or sudo nmcli dev show.'
    - id: F-008
      phase: coverage
      severity: CRITICAL
      section: "Problem"
      section_hash: 9ee5a43b7d7ce94f
      fragment: "evidence absent from the vault although its source's gate passed (7 items)"
      text: 'The Problem decomposition (7 absent + 3 continuation + 2 prose = 12) is inherited from the register and is never reconciled with Reproduction results, which names only three genuinely unrepresented items. Both counts are written as "items" with no statement that 7 counts audit snippets over 537 candidates while 3 counts ledger items over 323, so a reader cannot tell which of the 12 audit mismatches each retained class must fix, nor what unit the Phase 1 acceptance is measured in.'
      fix: 'Restate the decomposition in one unit (audit snippet or ledger item), give the mapping between the two, and make Phase 1 acceptance name the unit it counts.'
      verdict: fixed
      verdict_at: 2026-07-27
      note: 'Problem now defines both units, gives a 12-snippet decomposition table with a ledger-item column, and Phase 1 acceptance is split by unit. Re-verified 2026-07-27 after the section changed, by re-running both extractors over the 22 sources: 537 candidate snippets with exactly 12 missing, and 323 ledger items with exactly 3 unrepresented. The table rows reconcile: 6 + 1 + 2 + 3 = 12 snippets, and the 3 ledger items of row 1 are the only unrepresented ones. Re-opened and re-closed 2026-07-27 after the Problem section changed again (51a73b5aa20a3a23 -> 8769051d34428bd0): the unit definitions, the decomposition table and the unit-split acceptance all survive the edit unchanged.'
    - id: F-009
      phase: coverage
      severity: WARNING
      section: "Problem"
      section_hash: 9ee5a43b7d7ce94f
      fragment: "evidence that differs from its vault form only by a shell line continuation (3 items)"
      text: 'The amendment rewrote this clause to attribute exactly 3 items to a trailing shell line continuation. The audit evidence shows 4 missing snippets ending in a continuation (echo LABEL=WDGREEN, echo LABEL=WDRED, mount -a, systemctl daemon-reload) and df -h with none. Dropping the attribution half of the original clause left df -h without a covering class while under-counting the continuation group.'
      fix: 'Recount the continuation group against the evidence file and assign df -h to a class explicitly.'
      verdict: fixed
      verdict_at: 2026-07-27
      note: 'Continuation group recounted to exactly 1 snippet and df -h reassigned to the erosion group. Re-reproduced 2026-07-27 after the section changed: over the 5 pages listing storage.md in resource (du, fdisk, mkfs_ext4, etc_fstab, systemd_mount_unit), only "systemctl daemon-reload && \" flips under continuation stripping, on wiki_os-unix_systemd_mount_unit.md; df -h, "mount -a && \" and both echo LABEL lines match under neither comparison.'
    - id: F-010
      phase: coverage
      severity: WARNING
      section: "Scope and Boundaries"
      section_hash: e9a32974218c6c5b
      fragment: "The source-wide evidence gate in `src/phases/ingest.ts` is unchanged"
      text: 'The register docs/loen/dynamic-llm-budget-routing/tech-debt.md still lists "retain source attribution when a shared canonical page represents evidence from multiple sources" among the TD-1 required fixes. The spec retires that class as unreproducible but never records the register requirement as superseded, so the spec and the register disagree on what closing TD-1 requires.'
      fix: 'Add a line stating that the register TD-1 attribution requirement is superseded by the measured unattributedCarrier = 0 result, or update the register in the same change.'
      verdict: fixed
      verdict_at: 2026-07-27
      note: 'Scope and Boundaries now carries a register-reconciliation paragraph declaring the attribution requirement superseded and assigning the register rewrite to the implementation plan. Verified independently: none of the 3 unrepresented ledger items is carried by any non-attributed page, so unattributedCarrier = 0 holds. tech-debt.md still shows the old text; its rewrite is the plan task, not a spec defect.'
    - id: F-011
      phase: coverage
      severity: WARNING
      section: "1.1 Evidence preservation across cross-source page updates"
      section_hash: 9c748301ac3a829d
      fragment: "it reads the evidence block of `existing`, keeps the entries that are absent from the new content"
      text: 'The carry-over can only restore an evidence block that is present in existing. For storage.md code:33-37 the block appears on no page of the domain in any form, and reconcileSynthesisEvidence throws TypeError when a current-ledger item is left unresolved, so that item was never appended on any pass. Section 1.1 names class 1 as the cause of all three unrepresented items while the described mechanism covers only the drop-on-rewrite case.'
      fix: 'Show, in the class 1 red test, that the storage.md item reaches reconcileSynthesisEvidence with the block present in existing, or split the never-appended case into its own class.'
      verdict: fixed
      verdict_at: 2026-07-27
      note: 'Section 1.1 now states the inference chain (gate contract at ingest.ts:1553 + terminal status done + absent now), names the per-page slice technicalEvidenceByEntityKey, and admits no intermediate snapshot exists; Risks states the red test drives reconcileSynthesisEvidence directly with a foreign evidence block in existing. Code references verified: ingest.ts:1553 is the gate call, and reconcileSynthesisEvidence(content, existing, ledger, language) throws TypeError at synthesis-evidence-ledger.ts:416.'
    - id: F-012
      phase: coverage
      severity: CRITICAL
      section: "1.3 Prose false positives"
      section_hash: 29d2f1c55f220072
      fragment: "stops treating a complete natural-language sentence as a technical snippet when its only technical content is inline code spans"
      text: 'The stated cause of the prose class is wrong for both baseline items, so neither the red test nor the fix would work. Measured against audit-domain-quality.mjs and the source: both prose snippets are emitted by the unfenced commandStart branch (line 102), because commandStart (line 90) is case-insensitive and matches the leading word "Mount" of "Mount all filesystems listed in `/etc/fstab`." (NFS Server.md:230, unfenced) and "Mount the NFS share from the server." (NFS Server.md:164, unfenced). The second sentence has no inline code span at all, while the control sentence "Save the `/etc/fstab` file." does have one and is not extracted (commandStart = false). A Phase 0 class-2 red test built literally from the spec ("an English sentence whose only technical content is an inline code span") would not reproduce the defect, and the §1.3 rule would remove neither item, so the Phase 1 acceptance "Zero prose false positives (baseline 2)" is unreachable.'
      fix: 'Restate Phase 0 class 2 and §1.3 in terms of the measured cause - a case-insensitive command-keyword head match applied to a capitalized natural-language sentence - and name the discriminator that keeps real command lines (mount -a, systemctl daemon-reload) extracted.'
      verdict: fixed
      verdict_at: 2026-07-27
      note: 'Phase 0 class 2 and §1.3 now name the unfenced commandStart branch as the cause and a lowercase command head as the discriminator. Independently reproduced 2026-07-27 by re-running the audit extractor over the 22 sources with the i flag and without it: candidate set 537 -> 535, dropped set is exactly ["Mount all filesystems listed in `/etc/fstab`.", "Mount the NFS share from the server."], added set empty. Source lines confirmed in the run vault: NFS Server.md:158 and :224 carry the two sentences, :220 carries the control line "Save the `/etc/fstab` file." which the commandStart branch does not emit.'
    - id: F-013
      phase: coverage
      severity: WARNING
      section: "Phase 1 acceptance"
      section_hash: af9165c22972b0dc
      fragment: "`technicalSnippetPreservation` at or above 534/537 = 0.9944"
      text: 'The acceptance fraction is arithmetically unreachable given §1.3. §1.3 makes extractTechnicalSnippets stop emitting the 2 prose lines, so they leave the candidate set instead of becoming preserved and the denominator falls to 535. Baseline 525 preserved + 6 restored by §1.1 + 1 matched by §1.4 = 532 of 535 = 0.99439, not 534/537 = 0.994413. Compared as an unrounded ratio, "at or above 0.9944" therefore fails on a fully successful run; it passes only against the 4-dp rounded technicalSnippetPreservation field the audit writes.'
      fix: 'State the target as 532/535 (or as "no residual mismatch other than the 3 ledger-selection snippets") and say explicitly whether the comparison is against the rounded technicalSnippetPreservation field.'
      verdict: fixed
      verdict_at: 2026-07-27
      note: 'Acceptance now states technicalSnippetsPreserved 532 of 535 and pins the pass condition to the exact content of missingTechnicalSnippets, explicitly not the rounded field. Arithmetic re-verified 2026-07-27: with a case-sensitive command head the candidate set is 535 and 525 are preserved at HEAD, leaving 10 missing = 6 erosion (§1.1) + 1 continuation (§1.4) + 3 ledger-selection; 525 + 6 + 1 = 532. The stated non-discrimination also holds: 532/535 = 0.994392 and 534/537 = 0.994413 both round to 0.9944.'
    - id: F-014
      phase: coverage
      severity: WARNING
      section: "Reproduction results (2026-07-27)"
      section_hash: ab0b7ea5ab8630ed
      fragment: "`NFS Server.md` `code:203-203`, `NFS Server.md` `code:217-217`, `storage.md` `code:33-37`"
      text: 'Re-running the product code (extractSynthesisEvidenceLedger + findMissingSynthesisEvidence) over the 22 sources and the final vault confirms the counts the spec claims - 323 ledger items, exactly 3 unrepresented, no unattributed carrier - but not the identifiers. The three items are NFS Server.md code:209-209, NFS Server.md code:223-223 and storage.md code:31-35, in the kind:startLine-endLine form the gate emits at ingest.ts:1559. storage.md lines 33-37 are a different, partly preserved span. The same wrong id is repeated in Problem ("storage.md code:33-37 is a single five-line fenced block").'
      fix: 'Replace the three ids with code:209-209, code:223-223 and code:31-35 in both Problem and Reproduction results.'
      verdict: wontfix
      verdict_at: 2026-07-27
      note: 'Rejected - the finding is wrong and the spec ids are correct. Re-measured 2026-07-27 by running the product code directly over the run vault: extractSynthesisEvidenceLedger yields 20 ledger items for ОС/Unix/Ubuntu/Jammy/NFS Server.md and 26 for ОС/Unix/Сервисы/storage.md, and findMissingSynthesisEvidence against all 76 pages of !Wiki/os-unix returns exactly code:203-203, code:217-217 and code:33-37; corpus-wide the same run gives 22 sources, 323 ledger items, 3 unrepresented, same ids. The proposed ids are impossible: startLine is an absolute 1-based file line (synthesis-evidence-ledger.ts:152-153), NFS Server.md:209 is prose ("- `defaults`: A set of default mount options...") and :223 is blank, while storage.md:33-37 is exactly the five-line echo/echo/systemctl/mount/df block the spec describes.'
    - id: F-015
      phase: coverage
      severity: WARNING
      section: "Problem"
      section_hash: 9ee5a43b7d7ce94f
      fragment: "which `NFS Server.md` legitimately produced from its own lines 189 and 235"
      text: 'The paragraph added for deferred item 2 cites the wrong source lines. In the run vault ОС/Unix/Ubuntu/Jammy/NFS Server.md carries "df -h" at line 183 and "sudo mount -a" at line 229; lines 189 and 235 are blank. The citation is shifted by +6, the same offset the rejected F-014 used, so the document now mixes two line-numbering bases for one file: §1.3 and Reproduction results use verified absolute numbering (158, 203, 217, 220, 224) while this sentence does not. The substantive claim itself is correct - wiki_os-unix_nfs_kernel_server.md lists only NFS Server.md in resource and carries both commands.'
      fix: 'Change "lines 189 and 235" to "lines 183 and 229". Note that the page carries "sudo mount -a", not the snippet form "mount -a && \", if that distinction is meant to be exact.'
      verdict: fixed
      verdict_at: 2026-07-27
      note: 'Fixed by the amendment that changed the section. Re-verified 2026-07-27 by direct read of the run vault: ОС/Unix/Ubuntu/Jammy/NFS Server.md line 183 is "df -h" and line 229 is "sudo mount -a", and the body now cites exactly those two numbers plus the qualified-vs-snippet distinction. The document is now on one line-numbering base - 158, 183, 203, 217, 220, 224 and 229 all confirmed against the file. The distinction the fix asked for was added but is stated inconsistently; see F-020.'
    - id: F-016
      phase: coverage
      severity: CRITICAL
      section: "2.1 Facet coverage in context selection"
      section_hash: 0ec895ab6fa48b3c
      fragment: "The function receives the question text as an additional argument."
      text: '§2.1 mandates a signature change to selectQueryContextChunks, but Scope and Boundaries enumerates TD-2 product code as exactly two files - src/phases/query-grounding-validator.ts and the context selection in src/phases/query-budget.ts - while the function has two call sites in neither of them: src/phases/query.ts:372 and src/phases/query-cross-domain.ts:165, both calling selectQueryContextChunks(reranked.chunks, contextLimit). The cross-domain query path is not mentioned anywhere in the spec. Honored literally, the scope leaves §2.1 unreachable from production, so the Phase 2 acceptance "Macro required-fact coverage at or above 92.904%" cannot be produced by the scoped change. tests/query-parity.test.ts runs the same source-text assertions over both files but only checks that "selectQueryContextChunks(" appears after "rerankChunks(" and never inspects the argument list, so a one-sided change leaves the two query pipelines silently divergent while "the existing suite stays green" still holds.'
      fix: 'Add src/phases/query.ts and src/phases/query-cross-domain.ts to the TD-2 in-scope list and state whether the cross-domain path receives facet reservation as well; if it deliberately does not, record that as an explicit boundary and say what keeps the query-parity contract meaningful.'
      verdict: fixed
      verdict_at: 2026-07-28
      note: 'Scope now lists both call sites, states that both pipelines get facet reservation, and records why tests/query-parity.test.ts cannot catch a one-sided change. Variable names verified against the source: query.ts:302 sets const question = args[0]?.trim() and the call at query.ts:372 is in its scope; query-cross-domain.ts:108 sets const q = question.trim() and the call is at query-cross-domain.ts:165. Both call sites currently pass two arguments.'
    - id: F-017
      phase: coverage
      severity: WARNING
      section: "Phase 2 acceptance"
      section_hash: 4168729c9b219750
      fragment: "Macro required-fact coverage at or above 92.904%."
      text: 'Problem names three candidate causes of the TD-2 loss - "context selection, answer compression, or grounding sanitation" - and Phase 2 supplies a requirement for the first (§2.1) and the third (§2.2, §2.3) but none for answer compression, which is also absent from the Out of scope list. Unlike Phase 1, whose acceptance is tied to a measured 12-snippet / 3-ledger-item decomposition, the five omitted fact groups are never decomposed across classes 4-6, so nothing in the document shows that the three scoped fixes recover the 1.095 points from 91.809% to 92.904%. The register carries the same compression cause and likewise omits it from its required fixes, so the gap is inherited rather than introduced - but the spec adds a register-reconciliation paragraph for TD-1 and none for TD-2.'
      fix: 'Either add a requirement covering answer compression or list it under Out of scope with the reason, and state which of the five omitted fact groups each of classes 4-6 is expected to recover.'
      verdict: fixed
      verdict_at: 2026-07-28
      note: 'Problem gained a per-case decomposition table, answer compression is now an explicit Out of scope entry with a fallback, and Phase 2 acceptance repeats the mapping with its arithmetic. Independently re-measured 2026-07-28 from evidence/os-unix-query-quality-conflict-validation-split-live-1785096684125.json: exactly 5 failing required-fact groups over 10 cases - amd-driver-rocm (5 groups, 0.8), ssh-key-and-server (7 groups, 0.7143, two failures), systemd-storage-mounts (6 groups, 0.8333), linux-cache-sysctl (6 groups, 0.8333) - macro 91.809, matching the spec. The gap is 1.095 and the smallest per-group gain is 100/7/10 = 1.429 from ssh-key-and-server, the largest group count among the affected cases, so "recovering any one of the five clears it" holds. Every named carrier page is in its case foundPages. The row-level attribution is a separate defect; see F-022.'
    - id: F-018
      phase: clarity
      severity: WARNING
      section: "2.2 Support validation before deletion"
      section_hash: e2683424bcdeb490
      fragment: "the fix lands in `extractTechnicalUnits` or `findUnsupportedTechnicalUnits`"
      text: '§2.2 states no rule. It offers two candidate mechanisms ("whitespace normalization of multi-line fenced units, or containsExactNumber for numeric units") and two candidate fix sites joined by "or", deferring both choices to Phase 0 case 5. §1.3 states its rule outright ("the command-head match becomes case-sensitive") and §2.3 enumerates exactly what is removed; §2.2 has no comparable definition of done and cannot be implemented or reviewed as written. Its premise checks out - query-answer.ts:198 sets selectedChunks to packed.selected and line 452 builds selectedContext from renderContextChunks(selectedChunks) - which makes the register requirement "validate sanitizer support against the exact selected article, heading, and body before deletion" a no-op and leaves §2.2 with no substantive content of its own.'
      fix: 'Either state the comparison rule §2.2 changes, or mark §2.2 explicitly conditional on the Phase 0 case-5 result and say what happens to the Phase 2 acceptance if class 5 proves unreproducible.'
      verdict: fixed
      verdict_at: 2026-07-28
      note: '§2.2 now states one rule with a named cause, a fail-closed guard, and an explicit status against Phase 2 acceptance. Both code claims verified 2026-07-28: the path collector at query-grounding-validator.ts:152 is /(?<![\p{L}\p{N}])(?:~|\.{1,2})?\/(?:[A-Za-z0-9._~+@%=-]+\/)*[A-Za-z0-9._~+@%=-]+/gu with . inside the class and no clean function, and node confirms it captures "/etc/modprobe.d/amdgpu.conf." including the sentence-final period; the url collector at line 149 carries exactly the quoted normalizer (value) => value.replace(/[.,;:!?)}\]]+$/g, ""). The rule as stated is implementable.'
    - id: F-019
      phase: consistency
      severity: WARNING
      section: "Reproduction results (2026-07-27)"
      section_hash: ab0b7ea5ab8630ed
      fragment: "each of the five snippets of `code:33-37` was matched verbatim and again after continuation stripping"
      text: 'Read as a result, this sentence says all five snippets of the storage.md block matched, which contradicts the next two sentences ("Only systemctl daemon-reload && \ flips" and "df -h, mount -a && \ and both echo LABEL=... lines stay absent under both comparisons") and the Problem table, which puts 6 snippets in the erosion row and 1 in the continuation row. The intended reading is procedural - each snippet was tested twice - but "was matched" states an outcome. A reader taking the sentence at face value would size the §1.4 continuation class at five snippets instead of one.'
      fix: 'Rephrase to "was compared verbatim and again after continuation stripping".'
      verdict: fixed
      verdict_at: 2026-07-28
      note: 'Applied verbatim - the sentence now reads "was compared verbatim and again after continuation stripping", which no longer contradicts the two sentences that follow or the Problem table.'
    - id: F-020
      phase: consistency
      severity: INFO
      section: "Problem"
      section_hash: 9ee5a43b7d7ce94f
      fragment: "`df -h` and `mount -a && \\`, do occur elsewhere in the domain"
      text: 'Verified in the run vault: !Wiki/os-unix/applications/wiki_os-unix_nfs_kernel_server.md carries "df -h" at lines 91 and 173 and "sudo mount -a" at lines 85 and 179. The snippet form "mount -a && \" occurs on no page of the domain under either comparison, exactly as Reproduction results states. The clause therefore asserts occurrence for a snippet that does not occur; the parenthetical that follows corrects it for the mount case, so the meaning stays recoverable, but the two halves of the sentence disagree.'
      fix: 'Narrow the claim to df -h, or rephrase to "occur in a related form elsewhere in the domain".'
      verdict: fixed
      verdict_at: 2026-07-28
      note: 'Narrowed to df -h. The clause now reads "One of the six snippets in the first row, df -h, does occur elsewhere in the domain" and states separately that the page carries sudo mount -a while the snippet form mount -a && \ occurs on no page. Matches the vault: wiki_os-unix_nfs_kernel_server.md lines 91 and 173 carry df -h, lines 85 and 179 carry sudo mount -a.'
    - id: F-021
      phase: clarity
      severity: WARNING
      section: "Testing"
      section_hash: edc8d238d9b17ec2
      fragment: "The two existing anchor and sibling tests must stay green, which bounds how far the distribution may shift."
      text: '§2.1 does not say whether the new question argument is required or optional, and the bound stated here depends on the answer. tests/query-budget.test.ts calls selectQueryContextChunks with two arguments at lines 371, 379, 380, 381 and 382. If the argument is required, all five calls must be edited and the bound becomes whatever question text the edit passes; if it is optional and defaults to no facets, the two tests pass unchanged and bound nothing. Either way "must stay green" is not a determinate acceptance criterion. The tension is real: facet slots are taken from Math.floor(limit / 3), the same allocation the test "selectQueryContextChunks reserves post-reranker slots for anchor siblings" asserts against.'
      fix: 'State whether the question argument is required or optional and, if the existing tests are updated, give the question text they pass so the bound is reproducible.'
      verdict: fixed
      verdict_at: 2026-07-28
      note: '§2.1 now declares the question an optional third parameter defaulting to the empty string, with an empty question yielding no facets so a two-argument call keeps current behavior; Testing restates the bound on that basis and adds the new test as a third-argument call. The five existing two-argument calls in tests/query-budget.test.ts (lines 371, 379, 380, 381, 382) can therefore stay unedited, which makes "must stay green" determinate.'
    - id: F-022
      phase: coverage
      severity: CRITICAL
      section: "Problem"
      section_hash: 9ee5a43b7d7ce94f
      fragment: "the answer line reads `- **** – максимальное время …`: the unit was deleted and its emphasis span left empty"
      text: 'The new decomposition table assigns the fifth omitted fact group - linux-cache-sysctl / vm.dirty_expire_centisecs - to §2.3, and Phase 2 acceptance repeats "one by §2.3", but §2.3 cannot recover it. §2.3 only removes residue: it turns "- **** – максимальное время …" into "- – максимальное время …", and the required-fact string vm.dirty_expire_centisecs is still absent from the answer, so requiredFactPasses for that group still fails and the macro number does not move. Verified in the recorded answer: the literal vm.dirty_expire_centisecs does not occur anywhere in it. §2.2, the class that actually stops a false deletion, is explicitly declared in the same document not to be one of the five and "not a source of the recovery", so no requirement in this spec closes the fifth group. Worse, §2.2 could not close it either as written: its rule is path-specific (strip trailing . from path units) while vm.dirty_expire_centisecs is an inline_code unit with no trailing period. And §2.1 cannot close it: the carrier page wiki_os-unix_vm_dirty_expire_centisecs.md contains the literal exactly once, on line 14, its H1 - never in any section body - while renderContextChunks (page-similarity.ts:1351) emits only a delimiter line carrying "article: <articleId>, heading: <heading>" plus chunk.body, and the articleId is the underscore form wiki_os-unix_vm_dirty_expire_centisecs. No chunk of that page can put the dotted literal into the selected context, so the deletion was correct fail-closed behavior and selecting more of that article changes nothing. The other four rows do not share this problem - their facts sit in body content (amdgpu_pro.md:88 and :91, ssh.md:64, sshd.md:41, systemd_mount_unit.md:50/:144/:145) well past each H1 - so the acceptance stays arithmetically reachable via §2.1 alone, but the table misstates the cause of one fifth of its own evidence and a plan built on it would write a §2.3 test asserting a recovery that cannot happen.'
      fix: 'Reclassify the linux-cache-sysctl row. Either mark it out of scope as an upstream page-content defect (the page never restates its own title in a body section, so the term is unreachable from any selected chunk) and drop it from the recovery mapping, or add the requirement that actually closes it and say which. Then reconcile the §2.2 status paragraph, which currently asserts none of the five belongs to it.'
      verdict: fixed
      verdict_at: 2026-07-28
      note: 'Resolved by adding §2.4 rather than by reclassification, and the new attribution is verified end to end. grep over /tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run/!Wiki/os-unix returns exactly one occurrence of the literal - line 14, the # title of configurations/wiki_os-unix_vm_dirty_expire_centisecs.md; the source cache.md carries it on lines 22 and 44; splitSections (page-similarity.ts:242) opens with stripFrontmatterAndTitle so the title reaches no chunk; the case foundChunks contain that articleId with heading "## Основные характеристики" at 0.5942; groundingSanitizations is 1 and the literal is absent from the recorded answer. §2.4 keeps the unit, the required-fact check is answerText.includes(normalized(alternative)) (eval-domain-queries.ts:152), so the group flips and linux-cache-sysctl (6 required facts) contributes +1.667 - above the +1.095 gap on its own.'
    - id: F-023
      phase: coverage
      severity: INFO
      section: "2.3 Markdown repair after sanitation"
      section_hash: 000a908890c9087c
      fragment: "removes empty emphasis spans (`**`, `*`, `__`, `_`), empty list items, and empty code labels created by removal"
      text: 'The same recorded linux-cache-sysctl answer that supplies the §2.3 evidence carries a second residue the enumerated list does not cover: "время жизни грязных страниц ()", an empty parenthesis pair left where an inline unit was removed. cleanSanitizedProseLine already collapses whitespace inside brackets (the ([([])[ \t]+ and [ \t]+([)\]]) replacements) but leaves the empty pair standing. Phase 2 acceptance requires "No malformed Markdown after sanitation"; an empty () is not malformed Markdown, so the acceptance is not at risk, but the closed list in §2.3 and the observed residue set do not match.'
      fix: 'Either add empty bracket pairs to the §2.3 list or state that they are out of its scope because they are prose artefacts rather than Markdown defects.'
      verdict: fixed
      verdict_at: 2026-07-28
      note: 'Empty parenthesis pairs are now in the §2.3 closed list, and §2.3 states the list is closed against the residue observed in the recorded answer. See F-025 for the third residue in that same answer, which the list still does not cover.'
    - id: F-024
      phase: coverage
      severity: WARNING
      section: "Scope and Boundaries"
      section_hash: e9a32974218c6c5b
      fragment: "Rewriting the register's TD-1 classification, required-fix list, and acceptance to match this spec is an explicit task of the implementation plan"
      text: 'The Register reconciliation paragraph covers TD-1 only, and this amendment opens the same gap on the TD-2 side. docs/loen/dynamic-llm-budget-routing/tech-debt.md lists four TD-2 required fixes (facet coverage, sanitizer support validation, empty emphasis/list/code-label removal, fail-closed grounding) and three candidate causes, one of which is answer compression. The spec now adds a fifth requirement the register does not name - §2.4 title-only support, the only fix that recovers the fifth omitted fact group - declares answer compression out of scope as not among the measured causes, and extends the sanitation list with empty parenthesis pairs. Nothing instructs the plan to rewrite the register TD-2 entry, so on the same reasoning the spec applies to TD-1 ("so the two documents do not stay in disagreement about what closes TD-1"), TD-2 would be closed against a required-fix list that omits the fix that closes it and retains a cause the spec has measured away.'
      fix: 'Extend the Register reconciliation paragraph to TD-2: record §2.4 as an added required fix, answer compression as a superseded cause, and the widened sanitation list, and make rewriting the register TD-2 entry an explicit plan task exactly as for TD-1.'
      verdict: fixed
      verdict_at: 2026-07-28
      note: 'Register reconciliation is now a lead-in plus two bullets, and the lead-in makes rewriting both entries an explicit plan task. The TD-2 bullet names all three divergences I listed - answer compression as a measured-out cause, the missing §2.4, and the narrower sanitation item - and states the entry is rewritten to the four classes §2.1-§2.4. Checked against tech-debt.md:39-63, which still carries the four old required fixes and the compression cause.'
    - id: F-025
      phase: coverage
      severity: WARNING
      section: "2.3 Markdown repair after sanitation"
      section_hash: 000a908890c9087c
      fragment: "The list is closed against the residue actually observed in the recorded `linux-cache-sysctl` answer, which contains both"
      text: 'The closure claim is contradicted by the spec''s own measurement two sections earlier. Reproduction results records three residues in that answer - "- **** –", "время жизни грязных страниц ()" and "а – уменьшен" - and I reproduced all three verbatim from the recorded evidence file. §2.3 names the first two and its closed list covers them, but the third (an inline unit removed mid-sentence, leaving "поэтому пороги могут быть ниже, а – уменьшен") matches none of the four listed categories: it is not an empty emphasis span, an empty parenthesis pair, an empty list item, or an empty code label. Phase 2 acceptance is not at risk, because a dangling clause is well-formed Markdown, but the section asserts a completeness it does not have and a plan author would size the §2.3 test set against two residues where the evidence shows three.'
      fix: 'Either add the mid-sentence dangling-clause case to the list, or restate the closure as "closed against the malformed-Markdown residue observed", naming the third residue as prose damage that sanitation is not required to repair.'
      verdict: fixed
      verdict_at: 2026-07-28
      note: 'The second option was taken: the closure is now scoped to the *malformed* residue, and the third residue is named and excluded with its reason - the removal left well-formed Markdown with incomplete prose, which no deterministic repair can restore ("§2.3 repairs Markdown, it does not rewrite sentences"). All three residues are now accounted for and the section no longer claims more completeness than the evidence supports.'
    - id: F-026
      phase: coverage
      severity: WARNING
      section: "Testing"
      section_hash: edc8d238d9b17ec2
      fragment: "§2.4 title-only support with all three of its guards"
      text: 'The three items listed under "all three of its guards" are the id-form match (the positive case, not a guard), the two-segment guard, and fail-closed. §2.4 states "Two guards keep the rule narrow, and both are required" and names them as the at-least-one-underscore rule and "The rule never applies to kind === \"number\"; numbers keep containsExactNumber unchanged". The number guard therefore has no test in the Testing section although §2.4 calls it required, and it is not redundant with the two-segment guard: a numeric unit such as 1.5 has the id form 1_5, which passes the two-segment check. The existing code path it protects is real - findUnsupportedTechnicalUnits branches on unit.kind === "number" into containsExactNumber (query-grounding-validator.ts:197-199).'
      fix: 'List a fourth §2.4 test for the kind === "number" guard and align the count with §2.4 ("two guards" plus the positive case and the fail-closed case), so the enumeration does not silently drop a required guard.'
      verdict: fixed
      verdict_at: 2026-07-28
      note: 'The substantive half is closed: Testing now lists the number-guard test (a number unit 1.5 whose id form 1_5 would pass the two-segment check stays governed by containsExactNumber and is still reported when the context lacks it), and the non-redundancy argument is written into §2.4 beside the guard. The count half is not: Testing says "the positive case and all three of its guards" and counts fail-closed as the third, while §2.4 says "Two guards keep the rule narrow, and both are required" and treats fail-closed separately - see F-031.'
    - id: F-027
      phase: clarity
      severity: INFO
      section: "Scope and Boundaries"
      section_hash: e9a32974218c6c5b
      fragment: "shifts every token estimate, which the Non-Action on Query ceilings and the acceptance item on unchanged final context size both forbid here"
      text: '"Final context size" carries two different meanings in the document, and the out-of-scope justification depends on the second. §2.1 uses it for the chunk count ("The anchor count is therefore unchanged, contextLimit is unchanged, and the final context size is unchanged"), while this entry uses it for the rendered token size, since carrying titles into renderContextChunks leaves the chunk count untouched. Read with the §2.1 meaning, neither the acceptance item nor the Non-Action ("Do not change Query input/output ceilings", which are limits rather than measured usage) forbids the alternative, and the entry''s stated reason does not hold.'
      fix: 'Define the term once - either "the number of selected chunks" or "the rendered context size in tokens" - and use it consistently in §2.1, the acceptance list, and this entry; if the alternative is barred for a different reason (cost, uniform blast radius), state that reason.'
      verdict: fixed
      verdict_at: 2026-07-28
      note: 'The entry no longer rests on the ambiguous term: it now names the mechanism (a changed delimiter line changes the rendered token size of every chunk and therefore the packing decisions) and adds the parenthetical that the acceptance item counts selected chunks, not tokens, and is not the reason. The term is used in one sense throughout. The code citation added with the rewrite is itself wrong - see F-030.'
    - id: F-028
      phase: clarity
      severity: INFO
      section: "2.2 Support validation before deletion"
      section_hash: e2683424bcdeb490
      fragment: "and Phase 0 case 5 pinned the branch"
      text: 'Phase 0 numbers seven failure *classes* and every other back-reference uses that word (§2.4 "Measured cause (Problem, class 7)", Reproduction results "Class 4/5/6", Risks "A class from Phase 0"). This sentence alone says "case", the same word the document uses throughout for the ten query cases ("the fixed ten-case corpus", "the recorded linux-cache-sysctl answer"), so "Phase 0 case 5" reads as a query case rather than failure class 5.'
      fix: 'Use "class" here as everywhere else: "Phase 0 class 5 pinned the branch".'
      verdict: fixed
      verdict_at: 2026-07-28
      note: 'Applied verbatim; "case" now appears only in its query-case sense throughout the document.'
    - id: F-029
      phase: consistency
      severity: INFO
      section: "2.4 Title-only support"
      section_hash: 3847332d77b5a76a
      fragment: "A single-segment unit such as `ratio` would otherwise be declared supported by `wiki_os-unix_vm_dirty_ratio`, which proves nothing."
      text: 'The guard is stated to exclude matches that prove nothing, but it excludes only the one-segment case. A two-segment truncation of the same id - dirty_ratio against a selected wiki_os-unix_vm_dirty_ratio - is a trailing segment run, passes the at-least-one-underscore check, and is declared supported, although the real parameter is vm.dirty_ratio and dirty_ratio names nothing. The direction of the rule does bound the damage (the unit must be a suffix of the id, so a longer invented string such as /etc/ssh/ssh_config cannot match a shorter id), and the Risks entry accepts the widening in general terms, so this is an accuracy note on the rationale rather than a defect in the rule.'
      fix: 'Either state the guard''s purpose as "requires at least two segments so that a bare final segment cannot match", which is what it does, or make the bound explicit (for example, require the matched run to cover the id''s article-specific tail).'
      verdict: fixed
      verdict_at: 2026-07-28
      note: 'A new paragraph now records the residual width instead of overstating the guard: the suffix direction is declared deliberate, dirty_ratio against a selected wiki_os-unix_vm_dirty_ratio is named as accepted, and the reason tightening to equality is rejected is given - vm.dirty_expire_centisecs is itself a strict suffix of wiki_os-unix_vm_dirty_expire_centisecs, so full equality would drop the case the rule exists for. Verified against the vault id.'
    - id: F-030
      phase: coverage
      severity: WARNING
      section: "Scope and Boundaries"
      section_hash: e9a32974218c6c5b
      fragment: "the packing decisions in `selectQueryContextChunks`, whose per-chunk estimate is `estimatedTokens(renderContextChunks([chunk]))`"
      text: 'The mechanism added for F-027 cites the wrong function. `selectQueryContextChunks` spans src/phases/query-budget.ts:92-123 and performs no token estimation at all - it selects by count only (contextLimit, anchors, Math.floor(limit / 3) siblings, global tail) and never calls estimatedTokens or renderContextChunks, so a changed delimiter line cannot change any decision it makes. The per-chunk estimate at line 147 belongs to `packQueryChunks` (line 126), the separate exported function that builds ContextUnits and drops them to fit the input budget after selection. The out-of-scope conclusion still holds under the corrected attribution - packQueryChunks re-estimates every unit from the rendered chunk text - but as written the sentence contradicts §2.1, which describes the same function as one whose anchor and sibling arithmetic is purely count-based, and would send a plan author looking for a token estimate that is not there.'
      fix: 'Name `packQueryChunks` as the function whose packing decisions shift, keeping the line-147 citation, and leave `selectQueryContextChunks` out of this sentence.'
      verdict: fixed
      verdict_at: 2026-07-28
      note: 'The entry now attributes the packing decisions to packQueryChunks with the line-147 estimate, and the parenthetical rules out both non-reasons, including selectQueryContextChunks at query-budget.ts:92-124 as count-only. Re-verified in the source: the function body ends at line 124, packQueryChunks starts at 126, and the only estimatedTokens(renderContextChunks([chunk])) call is at 147 inside it.'
    - id: F-031
      phase: clarity
      severity: INFO
      section: "Testing"
      section_hash: edc8d238d9b17ec2
      fragment: "§2.4 title-only support with the positive case and all three of its guards"
      text: 'The substantive half of F-026 is fixed - the number-guard test is listed - but the count still disagrees with §2.4. Testing enumerates four items and calls three of them guards (two-segment, number, fail-closed); §2.4 says "Two guards keep the rule narrow, and both are required" and lists only the two-segment and number rules under that heading, describing fail-closed separately as preserved behavior. Nothing is missing from the test list; only the word "guards" is counted differently in the two sections.'
      fix: 'Say "the positive case, both guards, and the fail-closed case" in Testing, or promote fail-closed to a third guard in §2.4.'
      verdict: fixed
      verdict_at: 2026-07-28
      note: 'Testing now reads "§2.4 title-only support in four tests - the positive case ..., both guards of §2.4 (...), and the fail-closed case (...)", so the word "guard" counts two in both sections and the test list is unchanged in substance.'
---

# Exact Evidence Reconciliation and Query Grounding - Design

Date: 2026-07-27
Status: proposed
Register: `docs/loen/dynamic-llm-budget-routing/tech-debt.md` (TD-1, TD-2)
Live baseline: Obsidian reinit session `1785096684125`
Test vault: `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run`

## Problem

The live baseline completed 22/22 sources with zero retries, but two quality gaps remain
open in the register.

TD-1: the domain quality audit reported 12 exact-string mismatches out of 537 candidate
technical snippets.

Two units are in play and this spec keeps them apart. An **audit snippet** is one line or
fenced line produced by `extractTechnicalSnippets` in `audit-domain-quality.mjs` and
checked only against the pages that list the snippet's source in `resource`; the baseline
counts 537 of them with 12 mismatches. A **ledger item** is one entry of the synthesis
evidence ledger, the unit the product gate enforces; the same corpus holds 323 of them
with 3 unrepresented. One ledger item can span several audit snippets - `storage.md`
`code:33-37` is a single five-line fenced block that the audit splits into five snippets.

Measured against the vault, the 12 audit mismatches decompose as follows.

| Group | Snippets | Ledger items | Handled by |
| --- | --- | --- | --- |
| Absent from the source's attributed pages although the source's gate passed | 6 | 3 | §1.1 |
| Present on an attributed page but only without its trailing ` && \` | 1 | 0 | §1.4 |
| English prose misread as a technical snippet | 2 | 0 | §1.3 |
| Present in the source but never accepted into any ledger | 3 | 0 | out of scope |

One of the six snippets in the first row, `df -h`, does occur elsewhere in the domain - on
`wiki_os-unix_nfs_kernel_server.md`, which `NFS Server.md` legitimately produced from its
own line 183. That page also carries `sudo mount -a` (line 229), the qualified form, which
is not the snippet form `mount -a && \`; the snippet form occurs on no page of the domain.
Both are absent from the pages attributed to `storage.md`, and the five-line block they
belong to occurs nowhere, which is why they count against `storage.md`.

The last group - `~/.local/share/applications/obsidian.desktop` from
`ОС/Unix/AltLinux/Настройка прокси.md`, `sudo apt install network-manager` and
`sudo nmcli dev show` from `ОС/Unix/Сервисы/network.md` - is a ledger *selection* gap, not
a preservation gap: `extractSynthesisEvidenceLedger` never produces an item covering them,
so no gate ever required them. It is recorded under Discovered Debt.

TD-2: the fixed ten-query replay completed 10/10 with zero retries and zero invalid
WikiLinks, but macro required-fact coverage was 91.809%, below the accepted 92.904% gate.
All five omitted fact groups exist in generated pages, so the loss is downstream of
synthesis. Measured against the baseline evidence file
`evidence/os-unix-query-quality-conflict-validation-split-live-1785096684125.json` and the
final vault, the five groups decompose as follows - the carrier page is the page that holds
the fact, and every carrier was already in the case's `foundPages`, so retrieval reached
the right article in all five.

| Case | Omitted fact group | Carrier page | Evidence in the recorded answer | Handled by |
| --- | --- | --- | --- | --- |
| `amd-driver-rocm` | `/etc/modprobe.d/amdgpu.conf` | `wiki_os-unix_amdgpu_pro.md` | the answer cites only `/etc/X11/xorg.conf.d/20-amdgpu.conf`; the modprobe path never appears | §2.1 |
| `ssh-key-and-server` | `ssh-keygen -t ed25519` | `wiki_os-unix_ssh.md` | the answer carries `~/.ssh/id_ed25519` but no key-generation command | §2.1 |
| `ssh-key-and-server` | `systemctl restart sshd` | `wiki_os-unix_sshd.md` | the answer edits `/etc/ssh/sshd_config` and never restarts the service | §2.1 |
| `systemd-storage-mounts` | `systemctl enable` / `systemctl start` | `wiki_os-unix_systemd_mount_unit.md` | the answer carries `systemctl daemon-reload` from the same page, without the enable/start pair | §2.1 |
| `linux-cache-sysctl` | `vm.dirty_expire_centisecs` | `wiki_os-unix_vm_dirty_expire_centisecs.md` | the answer line reads `- **** – максимальное время …`: the unit was deleted and its emphasis span left empty | §2.4 |

Four of the five are one section of an article the selection already anchored, which is
§2.1. The fifth is different in kind and neither §2.1 nor §2.3 can recover it, which the
next paragraph establishes by measurement. Answer compression is therefore not among the
measured causes and is out of scope (see Scope and Boundaries).

The fifth group is a deletion of a **supported** fact. The literal
`vm.dirty_expire_centisecs` occurs exactly once in the whole domain: line 14 of
`configurations/wiki_os-unix_vm_dirty_expire_centisecs.md`, its `#` title. `splitSections`
(`src/page-similarity.ts:242`) opens with `stripFrontmatterAndTitle`, so no chunk of that
page - or of any page - carries the dotted form, and `renderContextChunks`
(`src/page-similarity.ts:1351`) puts only the underscored article id
(`article: wiki_os-unix_vm_dirty_expire_centisecs`) into the delimiter line. The model wrote
the parameter (it is in the source, `ОС/Unix/Сервисы/cache.md:44`), the exact comparison in
`findUnsupportedTechnicalUnits` found no dotted occurrence, and the unit was deleted. So
§2.1 cannot help - the carrier chunk `## Основные характеристики` was already selected, at
rank 0.594 - and §2.3 only clears the residue the deletion left, leaving the required fact
still absent from the answer. The page does support the fact; the context representation
loses it. That is §2.4.

## Scope and Boundaries

In scope:

- TD-1 product code: `src/phases/synthesis-evidence-ledger.ts`. The source-wide evidence
  gate in `src/phases/ingest.ts` is unchanged - the retired attribution class was its only
  reason to change.
- TD-1 measurement code: `scripts/loen-dynamic-budget-routing/audit-domain-quality.mjs`.
- TD-2 product code: `src/phases/query-grounding-validator.ts`, its four call sites in
  `src/phases/query-answer.ts` (lines 456, 475, 522, 611, which pass the selected article
  ids for §2.4), the context selection in
  `src/phases/query-budget.ts`, and both call sites of `selectQueryContextChunks` -
  `src/phases/query.ts:372` (single-domain) and `src/phases/query-cross-domain.ts:165`
  (cross-domain). Both pass their question text, so both pipelines get facet reservation;
  the cross-domain path is not excluded. A one-sided change would leave the two pipelines
  divergent without any test noticing: `tests/query-parity.test.ts` asserts only that
  `selectQueryContextChunks(` appears after `rerankChunks(` in both files and never inspects
  the argument list, so the parity contract is kept by changing both call sites, not by the
  existing assertions.
- New file: `scripts/loen-dynamic-budget-routing/os-mac-query-quality-cases.json`.

Register reconciliation: `docs/loen/dynamic-llm-budget-routing/tech-debt.md` disagrees with
this spec on both items, and rewriting both entries is an explicit task of the
implementation plan so the two documents do not stay in disagreement about what closes them.

- TD-1: the register lists "retain source attribution when a shared canonical page
  represents evidence from multiple sources" among the fixes. That requirement is
  superseded by the measured `unattributedCarrier = 0` result under Reproduction results.
  Its classification, required-fix list, and acceptance are rewritten to match this spec.
- TD-2: the register's entry predates the per-group decomposition in Problem. It names
  answer compression as a candidate cause, which this spec measures out and puts out of
  scope; it does not know §2.4 (title-only support), the class that closes the fifth group;
  and its sanitation item is narrower than the closed list in §2.3. The entry is rewritten
  to the four classes §2.1-§2.4 with the five-group decomposition as its evidence.

Out of scope:

- Answer compression, the third candidate cause named in Problem. The per-group
  decomposition there attributes all five omitted fact groups to §2.1 and §2.4, and the
  answer-length and output-ceiling settings are covered by the Non-Action on Query
  ceilings, so no requirement is written for compression here. If the live run of Phase 2
  misses the 92.904% gate while every §2.1 and §2.4 test is green, compression is the next
  hypothesis and gets its own spec.
- Carrying page titles into the rendered context (changing `renderContextChunks` or
  `SelectedChunk`). It would fix class 7 at the source but rewrites the delimiter line of
  every chunk in both pipelines, which changes the rendered token size of every query and
  therefore the packing decisions in `packQueryChunks`, whose per-chunk estimate is
  `estimatedTokens(renderContextChunks([chunk]))` (`src/phases/query-budget.ts:147`).
  The Non-Action on Query ceilings bars that here. (Neither reason is the acceptance item
  on "unchanged final context size", nor `selectQueryContextChunks`: that function -
  `src/phases/query-budget.ts:92-124`, the one §2.1 changes - selects by count alone and
  never estimates tokens, so titles would not move its output.) §2.4 is the bounded
  alternative: the rendered context is byte-for-byte untouched and only the support check
  learns the ids of the chunks already in it.
- `technicalValuePreservation`, `declaredEntityCoverage`, and the ledger-selection gap
  (see Discovered Debt).
- TD-3 (conflict-regeneration integration trigger) and TD-4 (init terminal status after a
  successful file retry).
- Every item in Non-Actions.

## Phase 0: Deterministic Reproduction

No fix is written before a failing test reproduces its cause. This is a hard precondition,
not a preference: the source-wide evidence gate at `src/phases/ingest.ts:1553` passed
during the live baseline even though the audit later found unrepresented evidence, so the
leak cannot be pinned by reading the code alone.

Phase 0 delivers one red test per failure class, built from the real os-unix corpus and
the recorded baseline evidence files:

TD-1 classes:

1. Evidence erosion on cross-source page update: a canonical page carries the evidence
   block of source A; a later source B whose synthesis rewrites the same page drops that
   block, and nothing restores it because A's gate has already passed and
   `reconcileSynthesisEvidence` only ever re-appends items of the ledger it is called with.
2. Prose false positive: a capitalized English sentence whose first word coincides with a
   command name (`Mount ...`), emitted as a technical snippet by the unfenced branch of
   `extractTechnicalSnippets` because `commandStart` is case-insensitive.
3. Line-continuation artifact: a command that differs from its ledger form only by a
   trailing ` && \` or `\`.

TD-2 classes:

4. Facet omission: a question with two distinguishable facets where the selected context
   covers the correct article but omits the section holding the second facet.
5. False unsupported: a technical unit present in the selected context that
   `findUnsupportedTechnicalUnits` reports as unsupported.
6. Malformed sanitation output: a sanitized line that retains an empty emphasis span such
   as `****`.
7. Title-only support: a technical unit whose only occurrence in the domain is the `#`
   title of a page whose chunk is in the selected context, reported as unsupported because
   the rendered context carries that title only as an underscored article id.

Each test states the observed wrong behavior, not the intended fix. A class whose red test
cannot be produced from real data is reported as unreproducible and its fix is dropped from
this spec rather than written blind.

Phase 0 is done when every class above either has a test that fails against current `HEAD`
with the failure message naming the observed value, or is recorded as unreproducible with
the data that was searched.

### Reproduction results (2026-07-27)

Two classes carried by earlier revisions of this spec were probed against the real os-unix
corpus (22 sources, 323 ledger items, final vault at
`/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run/!Wiki/os-unix`) and are retired as
unreproducible. Their fixes are dropped rather than written blind.

- Shared-page attribution (a page satisfying a ledger item of source X without listing X
  in `resource`): measured `unattributedCarrier = 0` over all 323 items against all pages
  of the domain. No page in the domain carries another source's ledger item without that
  source's attribution, so the attribution rule would change nothing on real data.
- Per-line coverage (a multi-line item whose collapsed join is present while an individual
  line is not): measured `crossPage = 0` and `headRepresentedStrictMissing = 0` over the
  same 323 items. The premise was a misreading of the current code:
  `findMissingSynthesisEvidence` joins the units with `\n` and then collapses whitespace,
  which requires the whole block to appear contiguously - a partially copied block already
  fails. A per-line rule would be strictly weaker than what ships today and is barred by
  the Non-Action on weakening exact-grounding validation.

The same probe isolated the three genuinely unrepresented ledger items - `NFS Server.md`
`code:203-203`, `NFS Server.md` `code:217-217`, `storage.md` `code:33-37` - which appear on
no page of the domain in any form, with or without continuation stripping. The identifiers
are `${kind}:${startLine}-${endLine}` as `extractSynthesisEvidenceLedger` assigns them and
the gate prints them at `ingest.ts:1559`; they are reproduced by running that extractor
over the source file and `findMissingSynthesisEvidence` over every page of
`!Wiki/os-unix`. The candidate
holder page `!Wiki/os-unix/configurations/wiki_os-unix_etc_fstab.md` lists
`resource: [NFS Server.md, storage.md, usb.md]` and has no `## Точные технические данные`
section at all, while the baseline session records `storage.md → создано 4, обновлено 1`
and `usb.md → создано 3, обновлено 2`. Attribution is intact and the evidence is absent:
the leak is erosion on update, which is why class 1 replaced the two retired classes.

The audit-side classification in Problem rests on the same probe. Over the five pages that
list `ОС/Unix/Сервисы/storage.md` in `resource`, each of the five snippets of
`code:33-37` was compared verbatim and again after continuation stripping. Only
`systemctl daemon-reload && \` flips - `wiki_os-unix_systemd_mount_unit.md` carries
`systemctl daemon-reload` without the continuation. `df -h`, `mount -a && \` and both
`echo LABEL=...` lines stay absent under both comparisons, so they belong to the erosion
group, not to the continuation group. The class-3 continuation group is therefore exactly
one snippet, not three.

The four TD-2 classes were probed the same way against current `HEAD` and all four
reproduce, so none is dropped. Class 4: with a nine-slot limit the selector spends six
slots on anchors and fills the sibling third before any facet check, so a chunk that is the
only carrier of an uncovered facet loses its slot to the global tail. Class 5: the `path`
collector returns `/etc/modprobe.d/amdgpu.conf.` for a path that ends a sentence, and the
same probe confirms the fail-closed case still reports an absent path. Class 6:
`cleanSanitizedProseLine` turns
``- **`vm.dirty_expire_centisecs`** – максимальное время …`` into `- **** – максимальное
время …`, and a numbered item whose only content was the removed unit is left as a bare
`1.`. The recorded baseline answer for `linux-cache-sysctl` contains the first of those two
residues verbatim.

Class 7 was measured on the same recorded case. `grep` over the final vault returns exactly
one occurrence of `vm.dirty_expire_centisecs` in `!Wiki/os-unix`, the `#` title on line 14
of `configurations/wiki_os-unix_vm_dirty_expire_centisecs.md`; the source
`ОС/Unix/Сервисы/cache.md` carries it on lines 22 and 44. The case's `foundChunks` include
`{ articleId: "wiki_os-unix_vm_dirty_expire_centisecs", heading: "## Основные
характеристики", score: 0.594 }`, so the carrier page was selected, and the recorded answer
shows the deletion residue in three places (`- **** –`, `время жизни грязных страниц ()`,
`а – уменьшен`) with `groundingSanitizations: 1`. The deletion was correct behavior against
the context it was given and wrong against the vault, which is the class-7 failure.

## Phase 1: TD-1 - Exact Evidence Classification and Reconciliation

Invariant: for each source X, every ledger item of X appears verbatim on a page that lists
X in its `resource` frontmatter. "Ledger item" is the only term used for an entry of the
synthesis evidence ledger.

### 1.1 Evidence preservation across cross-source page updates

A page's existing evidence block survives a rewrite by a later source. Today
`reconcileSynthesisEvidence(content, existing, ledger, language)` re-appends only the items
of `ledger`, and `src/phases/ingest.ts` passes it the per-page slice
`technicalEvidenceByEntityKey.get(entityKey)` of the source currently being ingested. When
source B's synthesis rewrites a page created by source A and the rewritten body drops A's
`## Точные технические данные` block, nothing restores it: B's slice never contains A's
items, and A's gate already passed on the previous vault state. The evidence is lost
silently, with every gate green.

Why the three unrepresented items are erosion and not items that were never written: the
source-wide gate at `ingest.ts:1553` fails the source unless every ledger item is present
in `representedTechnicalEvidence`, which is built from the pages about to be written plus
already-attributed pages. `NFS Server.md` and `storage.md` both reached terminal status
`done` in the baseline, so each of their items was present in persisted content at the end
of their own run, and is absent from the vault now. Something between the two states
removed it, and the only writer that touches an existing page is a later source's apply
step. The intermediate vault state was not snapshotted, so this is inference from the gate
contract plus the final state, not a recorded observation - see Risks.

Ownership and timing: `reconcileSynthesisEvidence` in
`src/phases/synthesis-evidence-ledger.ts` already receives `existing`, the page content
before the rewrite. It gains a carry-over step that runs before the current-ledger
reconciliation - it reads the evidence block of `existing`, keeps the entries that are
absent from the new content, and appends them into the same
`## Точные технические данные` section alongside the current source's missing items. The
carry-over uses the comparison of §1.4, so a re-emitted entry that differs only by a
trailing line continuation is not duplicated. Order is stable: carried-over entries keep
their relative order from `existing` and precede the current source's newly appended
entries. No signature change beyond what already exists, and zero additional model calls.

The final re-verification inside `reconcileSynthesisEvidence` keeps its current meaning -
it throws `TypeError` when an item of the current ledger is still unresolved. Carried-over
entries are appended, not validated against the current ledger, because they belong to a
different source.

### 1.2 Per-line coverage (retired - unreproducible)

Retired on 2026-07-27; see Reproduction results. `findMissingSynthesisEvidence` already
requires the whole multi-line block to appear contiguously, so the per-line rule would
have weakened validation instead of strengthening it. No code changes for this item.

### 1.3 Prose false positives

Measured cause: `commandStart` in `audit-domain-quality.mjs:90` carries the `i` flag, so
the unfenced branch at line 102 matches any line starting with a command keyword in any
case. `NFS Server.md:158` (`Mount the NFS share from the server.`) and
`NFS Server.md:224` (``Mount all filesystems listed in `/etc/fstab`.``) are emitted as
technical snippets on that branch. Inline code spans are not the trigger - the first
sentence contains none, while the control line `NFS Server.md:220`
(``Save the `/etc/fstab` file.``) contains one and is not emitted, because `Save` is not a
command keyword.

The rule: the command-head match becomes case-sensitive. Shell commands are lowercase, a
capitalized head marks a sentence. The inline-code, fenced, and assignment branches are
untouched, so paths and configuration lines keep their current detection.

Measured effect over the fixed 22-source corpus: the candidate set drops from 537 to 535
snippets, and the two removed entries are exactly the two prose sentences above. No other
snippet is lost. Reproduce with the extractor copy used by the audit; the plan pins this as
the acceptance check for the change.

This is a measurement fix. Product classification in `unfencedTechnicalLine` already
rejects these lines because it requires a command-like head, and is not changed.

### 1.4 Line-continuation artifact

Comparison drops only a trailing shell line continuation (` && \` or `\`) before matching,
because that token comes from the source's own formatting rather than from the technical
operation. `sudo` and other qualifiers are not normalized away, and no other
transformation of command text is introduced.

Measured scope: one audit snippet, `systemctl daemon-reload && \` from `storage.md`, whose
attributed page `wiki_os-unix_systemd_mount_unit.md` carries the same command without the
continuation. The other four snippets of that block are absent under both comparisons and
belong to §1.1.

The rule applies in two places and must be identical in both: the product comparison used
by `findMissingSynthesisEvidence` in `src/phases/synthesis-evidence-ledger.ts`, and the
snippet comparison in `audit-domain-quality.mjs`. A mismatch between them would make the
audit disagree with the gate it measures.

### Phase 1 acceptance

Measured in ledger items:

- Zero unrepresented ledger items across the fixed 22-source os-unix corpus (baseline 3 of
  323).

Measured in audit snippets. The candidate count moves from 537 to 535 because §1.3 removes
the two prose lines from the candidate set rather than preserving them, so the acceptance
ratio is stated against the new denominator:

- Zero prose false positives (baseline 2), with `summary.technicalSnippets` equal to 535.
- Zero mismatches caused only by a trailing line continuation (baseline 1).
- `technicalSnippetsPreserved` equal to 532 of 535, and the `missingTechnicalSnippets`
  list across all sources contains exactly the three ledger-selection snippets named in
  Problem. Any other residual mismatch fails this acceptance and is reported with its
  snippet text. The ratio is checked as this list, not as the rounded
  `technicalSnippetPreservation` field, which reports 0.9944 for both 532/535 and 534/537
  and so cannot discriminate.

Unconditional:

- 100% source URL preservation (baseline 21/21).
- No additional LLM request, retry, or token-ceiling increase.

## Phase 2: TD-2 - Query Context Coverage and Grounding Sanitation

### 2.1 Facet coverage in context selection

`selectQueryContextChunks` currently spends two thirds of the context limit on anchors,
one anchor chunk per distinct article, one third on siblings of those anchors, and the
remainder on global rank. A broad question therefore spends slots on article diversity
while a second section of the correct article - the one holding the exact path or command
- is never selected.

The selection reserves a slot for each question facet that no already-selected chunk
covers, before sibling fill and before the global tail. A facet slot goes to the
highest-ranked chunk that covers that facet.

Facet definition (deterministic, no model call): the facets of a question are the tokens
produced by the existing `tokenizeLexical` (`src/lexical-retrieval.ts:76`) - lowercased,
split on non-letter/digit characters, tokens of two characters or fewer dropped unless
they mix a letter and a digit, stopwords dropped. No new tokenizer is introduced. A chunk
covers a facet when its text, tokenized the same way, contains that token. Facets are
processed in order of first occurrence in the question text, so selection is stable for a
given question.

Budget: facet slots are taken from the sibling allocation (`Math.floor(limit / 3)`), never
from the anchor allocation. The anchor count is therefore unchanged, `contextLimit` is
unchanged, and the final context size is unchanged - only the distribution inside the
sibling third changes.

Signature: the question text is an **optional** third parameter defaulting to the empty
string. An empty question yields no facets, so a two-argument call keeps today's behavior
exactly. This is what keeps the two existing selector tests in `tests/query-budget.test.ts`
meaningful without editing them: they call the function with two arguments, assert the
current anchor and sibling distribution, and must stay green unchanged, which bounds the
change to questions that actually carry an uncovered facet. Both production call sites pass
their question - `question` in `src/phases/query.ts:372`, the trimmed `q` in
`src/phases/query-cross-domain.ts:165` - so no production path relies on the default.

### 2.2 Support validation before deletion

The grounding context already matches what the model saw: `selectedContext` is built from
`packed.selected`, the same chunks rendered into the user message, which makes the
register's stated fix ("validate sanitizer support against the exact selected article,
heading, and body before deletion") a no-op. A supported term is still deleted through the
comparison itself, and Phase 0 class 5 pinned the branch.

Measured cause: the `path` collector in `extractTechnicalUnits` carries `.` inside its
character class, so a path that ends a sentence is captured together with the sentence-final
period. `/etc/modprobe.d/amdgpu.conf.` is then compared against a context containing
`/etc/modprobe.d/amdgpu.conf`, reported unsupported, and deleted, truncating the sentence.

The rule: path units drop trailing `.` characters before the support check, exactly as the
`url` collector in the same list already strips trailing punctuation with
`(value) => value.replace(/[.,;:!?)}\]]+$/g, "")`. The fix lands in `extractTechnicalUnits`,
on the collector, not in `findUnsupportedTechnicalUnits`; the comparison itself stays exact.

Fail-closed behavior is preserved: a unit stays unsupported when any of its lines is
absent from the selected context, and a path the context does not contain is still reported
(with the period stripped: `/etc/invented/path.conf`). Widening the match to a looser
comparison is not acceptable.

Status against Phase 2 acceptance: this class is real and reproducible, but it is not one
of the five omitted fact groups decomposed in Problem, so it is a correctness fix rather
than a source of the 91.809% → 92.904% recovery. It stays in scope because it runs the same
deletion path that §2.4 corrects, and a truncated sentence is a defect on its own.

### 2.3 Markdown repair after sanitation

`cleanSanitizedProseLine` removes empty links and collapses whitespace, and a line made
entirely of residue is already dropped. Residue inside a surviving line is not removed:
`Use **** to mount.` remains. The function gains a pass that removes, in this closed list,
empty emphasis spans (`**`, `*`, `__`, `_`), empty parenthesis pairs left where a removed
unit was the only content of a parenthetical, empty list items, and empty code labels
created by removal. The list is closed against the *malformed* residue observed in the
recorded `linux-cache-sysctl` answer: an empty emphasis span (`- **** – максимальное время
…`) and an empty parenthesis pair (`время жизни грязных страниц ()`). The same answer holds
a third residue, `а – уменьшен`, where an inline unit was removed mid-sentence and left a
dangling clause. It is deliberately not in the list: the result is well-formed Markdown and
only the prose is incomplete, which no deterministic repair can restore. §2.3 repairs
Markdown, it does not rewrite sentences.

Status against Phase 2 acceptance: §2.3 removes residue, it never restores a deleted fact,
so no omitted fact group is attributed to it and it contributes nothing to the coverage
number. It is required because sanitation must not leave malformed Markdown behind on the
deletions that remain correct.

### 2.4 Title-only support

Measured cause (Problem, class 7): a page's `#` title never reaches the rendered context.
`splitSections` strips it before chunking and `renderContextChunks` emits it only as the
underscored article id in the delimiter line. A unit whose sole occurrence in the domain is
such a title is therefore deleted even though the selected page is exactly the page that
documents it.

The rule: a unit is supported when its **id form** equals the id form of a selected
chunk's `articleId`, or is a trailing `_`-delimited segment run of it. The id form of a
string is: NFC-normalized, lowercased, every run of characters outside `[a-z0-9]` replaced
by a single `_`, leading and trailing `_` trimmed. `vm.dirty_expire_centisecs` →
`vm_dirty_expire_centisecs`; `wiki_os-unix_vm_dirty_expire_centisecs` →
`wiki_os_unix_vm_dirty_expire_centisecs`, which ends with `_vm_dirty_expire_centisecs`, so
the unit is supported.

The match direction matters and is deliberate: the unit must be a *suffix* of the id, never
the reverse. A shorter unit that is a trailing segment run of a selected id still passes -
`dirty_ratio` against `wiki_os-unix_vm_dirty_ratio` is supported. That is the accepted
residual width of the rule, not an accident: such a unit names the same page the answer
already cites, and tightening to full equality would drop the case the rule exists for
(`vm.dirty_expire_centisecs` is itself a strict suffix of its page id).

Two guards keep the rule narrow, and both are required:

- The unit's id form must contain at least one `_`, i.e. at least two segments. A
  single-segment unit such as `ratio` would otherwise be declared supported by
  `wiki_os-unix_vm_dirty_ratio`, which proves nothing.
- The rule never applies to `kind === "number"`; numbers keep `containsExactNumber`
  unchanged. This guard is not implied by the previous one: a version-like `1.5` has id
  form `1_5`, which passes the two-segment check.

Fail-closed behavior is preserved: the comparison is against the article ids of the chunks
actually selected for this answer, never against the vault or any wider list, so an
invented `/etc/invented/path.conf` (id form `etc_invented_path_conf`) matches no selected
id and stays unsupported. The exact-substring check in `findUnsupportedTechnicalUnits` is
unchanged; the id-form check is an additional way to be supported, evaluated only after it
fails.

Against the Non-Action "do not weaken exact-grounding validation": this is not a looser
comparison of the unit against the context text. It is an exact comparison against a second
piece of the selected context that the renderer already prints on the delimiter line - the
article id - under a total normalization both sides go through. No fuzzy, prefix, edit-
distance, or similarity matching is introduced, and a unit that matches neither the context
text nor a selected id is still deleted.

Signature: `findUnsupportedTechnicalUnits(answer, selectedContext, articleIds)` takes an
**optional** third parameter defaulting to `[]`, so every existing two-argument call keeps
today's behavior exactly. `src/phases/query-answer.ts` already builds
`knownStems = new Set(selectedChunks.map((chunk) => chunk.articleId))` at line 451, before
the first call at line 456; all four call sites in that file (lines 456, 475, 522, 611)
pass `[...knownStems]`.

### Phase 2 acceptance

- 10/10 fixed cases complete with zero model repair and zero invalid WikiLinks.
- Macro required-fact coverage at or above 92.904%. The five omitted fact groups are
  decomposed in Problem: four are expected to be recovered by §2.1 (`amd-driver-rocm`
  `/etc/modprobe.d/amdgpu.conf`; `ssh-key-and-server` `ssh-keygen -t ed25519` and
  `systemctl restart sshd`; `systemd-storage-mounts` `systemctl enable` / `systemctl start`)
  and one by §2.4 (`linux-cache-sysctl` `vm.dirty_expire_centisecs`). The gate needs
  +1.095 points, and the smallest single group is worth +1.429 (one of seven groups in
  `ssh-key-and-server`, divided across ten cases), so recovering any one of the five clears
  it arithmetically - which is why the acceptance stays the macro number on the live run
  rather than a count of recovered groups. Each still-missing group is reported by case and
  fact.
- No malformed Markdown after sanitation.
- Unchanged Query input/output ceilings and unchanged final context size.

## Testing

- Phase 0 red tests, as defined above, in a dedicated test file.
- Focused coverage for `src/phases/synthesis-evidence-ledger.ts`: carry-over of an earlier
  source's evidence block across a rewrite, no duplication when the block is re-emitted,
  and continuation normalization.
- `tests/ingest-synthesis.test.ts`: the existing source-wide gate tests stay green,
  proving the gate keeps its current behavior.
- Focused coverage for the audit snippet extractor: the two `Mount ...` sentences are not
  emitted, ``Save the `/etc/fstab` file.`` keeps producing its inline-code snippet, real
  lowercase command lines are still emitted, and a snippet matches a page line that lacks
  the trailing ` && \`.
- `tests/query-budget.test.ts`: facet reservation, added as one new test that passes a
  question as the third argument. The five existing two-argument calls stay unedited, and
  the two existing anchor and sibling tests must stay green - determinate because the
  question parameter is optional and an empty question yields no facets (§2.1), so those
  tests exercise the unchanged path and bound the shift to questions carrying an uncovered
  facet.
- Focused coverage for `src/phases/query-grounding-validator.ts`: the false-unsupported
  path case with its fail-closed guard (a path absent from the context is still reported),
  Markdown repair with a guard that real emphasis, glob patterns such as `docs/**/*.ts`,
  and snake_case identifiers survive the repair pass, plus the empty-parenthesis residue
  case, and §2.4 title-only support in four tests - the positive case
  (`vm.dirty_expire_centisecs` against a selected `wiki_os-unix_vm_dirty_expire_centisecs`
  is supported), both guards of §2.4 (a bare `ratio` against a selected
  `wiki_os-unix_vm_dirty_ratio` stays unsupported under the two-segment guard; a `number`
  unit `1.5`, whose id form `1_5` would otherwise pass that check, stays governed by
  `containsExactNumber` and is still reported when the context lacks it), and the
  fail-closed case (`/etc/invented/path.conf` matching no selected id stays unsupported).
  One test calls the function with two arguments to prove the optional parameter keeps
  today's behavior.

Every Phase 0 test turns green, every test above passes, and the existing suite stays
green before the live run starts.

## Live Verification Protocol

The steps run in this order.

1. Create the baseline snapshot at `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/before` by
   copying the current vault state. No such snapshot exists today, and
   `audit-domain-quality.mjs` and `audit-query-grounding.mjs` both default `beforeRoot` to
   `dirname(runRoot)/before`, so neither can run without it. `audit-page-integrity.mjs`
   takes only `domainId` and `vaultRoot` and needs no snapshot.
2. Build the plugin and report the `cp` command and the expected `dist/main.js` SHA-256.
3. The user copies `dist/main.js`, `dist/manifest.json`, and `dist/styles.css` into the
   test vault plugin directory, verifies the SHA-256, and restarts Obsidian.
4. The user starts one clean force-reinit of `os-unix`, then a separate force-reinit of
   `os-mac`.
5. The user signals completion. Log reading starts only on that signal - no background
   watcher and no timed polling.
6. Run `analyze-agent-session.mjs`, then `audit-domain-quality.mjs`,
   `audit-page-integrity.mjs`, and `audit-query-grounding.mjs`, and compare against
   baseline session `1785096684125`.

The live run passes when os-unix completes 22/22 sources with terminal status `done`, page
integrity reports zero YAML, canonical-path, alias, provenance, or H1 failures, and both
Phase 1 and Phase 2 acceptance lists hold on the produced evidence files. Any acceptance
item that fails is reported with its measured value; a failed live run does not close the
register item.

## Second Domain: os-mac

`audit-domain-quality.mjs` hardcodes `sourceRoot = path.join(beforeRoot, "ОС", "Unix")`.
The source path becomes a CLI argument with the current value as its default, so the same
script serves both domains.

A new `scripts/loen-dynamic-budget-routing/os-mac-query-quality-cases.json` covers the 16
pages of that domain in the existing case format (`id`, `question`, `expectedPages`,
`requiredFacts`).

os-mac gates are diagnostic, not blocking. The domain has one source file, so it barely
exercises cross-source attribution on shared canonical pages, which is the core of TD-1.
That part of the invariant stays covered only by os-unix.

## Discovered Debt (Out of Scope)

Recorded from the baseline audit, not fixed here, and not currently in the register:

- `technicalValuePreservation` 0.5581 (24/43 values preserved).
- `declaredEntityCoverage` 0.3679 (39/106 declared entities covered).
- Ledger selection gap: `extractSynthesisEvidenceLedger` accepts no item covering
  `~/.local/share/applications/obsidian.desktop`
  (`ОС/Unix/AltLinux/Настройка прокси.md`, 5 ledger items), `sudo apt install
  network-manager` or `sudo nmcli dev show` (`ОС/Unix/Сервисы/network.md`, 6 ledger
  items), although all three are present in the source text. No gate can protect evidence
  that never enters a ledger, so this is a selection problem in the extractor and needs its
  own investigation before the audit can reach 537/537.

All three are wider than the preservation gap that TD-1 addresses, and each needs its own
investigation.

## Non-Actions

- Do not increase the 65,536 ingest input ceiling. Maximum provider-reported live input
  was 18,221 tokens.
- Do not increase synthesis batch size above the tested weak-model default of `1`.
- Do not weaken schema, canonical path, alias, page-hash, section-authority, WikiLink, or
  exact-grounding validation.
- Do not encode os-unix or os-mac benchmark vocabulary into production logic.
- Do not change Query input/output ceilings or the final context size.

## Risks

- A class from Phase 0 may prove unreproducible from real data. It is then reported and
  dropped, not fixed speculatively. Two classes already did: shared-page attribution and
  per-line coverage, both retired under Reproduction results.
- Class 1 is inferred from final vault state plus the baseline session log, not from a
  recorded intermediate state - no snapshot exists between sources. Its red test therefore
  drives `reconcileSynthesisEvidence` directly with an `existing` page that carries a
  foreign evidence block, which is the exact input the ingest loop produces on a
  cross-source update. If the live run still reports unrepresented items after the fix,
  the remaining cause is elsewhere and is reported with its measured value.
- Facet reservation spends part of the sibling third, so a case that depends on an
  adjacent sibling section may lose it. The existing `query-budget` tests and the fixed
  ten-case corpus catch this; the anchor allocation is never touched.
- §2.4 accepts a unit on the strength of a selected article's id rather than its body, so a
  model that names a selected page's title while stating something false about it keeps the
  title. That is the existing contract of the grounding check, which validates exact
  technical strings and never claims semantic correctness; the two-segment guard and the
  restriction to ids of chunks already selected bound the widening. If the live run shows
  new invented units surviving, the class is reported with the measured units and reverted
  rather than loosened further.
