# Before starting work

- Run `/iwiki-query` to find `docs/wiki/` sections relevant to your task. Read them to understand the design intent before writing code.

# Post-task checklist (REQUIRED — do not skip)

After EVERY task, before responding to the user:

- [ ] Update `docs/wiki/` via `iwiki:iwiki-ingest <changed-source>` if you added or changed any functionality, architecture, tests, or behavior
- [ ] Run `/iwiki-lint` — no broken `[[refs]]`, no orphan or stale pages
- [ ] Do not skip these steps. Do not consider your task done until both are complete.

---

# Branch workflow rules (REQUIRED — do not violate without approval)

These rules govern all development. They must NOT be broken without explicit user agreement.

1. **All development happens in `dev/*` branches** (e.g. `dev/cjk-filename-read`). Create the branch from an up-to-date `master`: `git checkout master && git pull`, then `git checkout -b dev/<topic>`.
2. **There is no standalone `dev` branch.** Do not create, use, or push a bare `dev` branch — only the `dev/*` namespace.
3. **`dev/*` branches merge back into `master`** via a pull request targeting `master`.

Do not deviate from this flow (e.g. committing directly to `master`, or reviving a bare `dev` branch) without first confirming with the user.
