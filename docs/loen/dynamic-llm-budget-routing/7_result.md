# Dynamic LLM Budget Routing Result

In progress.

Current recommendation:

- Use `undici-request-adapter` for this endpoint/model; `off` hangs before HTTP.
- Do not set reinit/init output budget to `4096` for os-unix synthesis. It caps nested evidence mapping and synthesis, causing repeated repair loops.
- Use `16384` output budget for this os-unix/model workload unless a later 8192 run proves equivalent.
- Keep `synthesisMaxEntityBatchSize = 2`.
- Use dynamic input budget for synthesis repair. Observed repair prompts reached `60238` estimated input tokens; `32768` is too low for this workload.
- Do not rely only on `65536`. The 65536 run removed budget overflow, but still failed on repeated synthesis schema errors for `etc-exports`.

Final pipeline should combine:

- endpoint transport compatibility: `undici-request-adapter`;
- output budget: `16384` for init/reinit ingest/synthesis on this workload;
- input budget: dynamic, with provider ceiling up to `65536` when needed;
- synthesis batch size: `2`, with split-to-1 on validation/context failure;
- repair strategy: compact/targeted synthesis repair once estimated repair prompt exceeds a threshold or after the first schema failure;
- strict validation retained.

Dynamic budget status:

- Production code already supports configured global/per-operation input and output budgets.
- Production code already shrinks effective input budget on provider context errors.
- Production code now supports `repairInputBudgetTokens` as a native structured-repair input ceiling for `init` and `ingest`.
- Production code now passes that repair ceiling into synthesis structured-output retries, so normal prompt packing can stay smaller while repair calls can use a larger ceiling.
- Full targeted synthesis repair is still a follow-up: the current patch solves budget overflow, but schema-obedience failures such as invalid `sections[].operation` still need smaller targeted repair tasks.
