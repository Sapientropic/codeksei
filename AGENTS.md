# AGENTS.md

## Scope

This file is the repo-root contract for `codeksei`.

It exists so the repository remains self-describing even when opened directly as
its own workspace. Do not assume a parent workspace `AGENTS.md` will also be
loaded.

Do not mirror higher-level global instructions here. Keep this file limited to
repo-local truth, contributor boundaries, and the parts most likely to drift if
future agents rely on chat memory alone.

## Durable Truth Order

Read these in order when you first enter this repo:

1. `AGENTS.md`
   - repo-local routing, public/private boundary, and maintenance rules
2. `README.md`
   - public overview, install path, main commands, naming/compatibility story
3. `docs/commands.md`
   - command surface, compatibility details, public-facing usage expectations
4. `docs/architecture.md`
   - module boundaries, shared-mode structure, persistence model
5. `docs/release.md`
   - public repo / npm / release workflow truth

When a task changes compatibility, managed markers, bootstrap behavior, or
shared-mode lifecycle, also read the relevant source of truth in:

- `src/core/branding.js`
- `src/core/review.js`
- `src/core/note-sync.js`
- `src/core/workspace-bootstrap.js`
- `templates/`
- matching tests under `tests/`

## Repo-Specific Rules

- This repository is public. Do not push local-machine cleanup, private vault
  routing, personal absolute paths, or workstation-specific state changes into
  the public repo unless the shipped product behavior genuinely depends on them.
- Public docs and new examples should default to `Codeksei / codeksei /
  CODEKSEI_*`.
- Legacy `cyberboss / CYBERBOSS_* / ~/.cyberboss` mentions are allowed only for
  explicit compatibility, migration explanation, or upstream acknowledgement.
- Do not remove legacy compatibility logic unless you can verify it is safe
  across CLI entrypoints, env reads, state-dir fallback, managed markers, and
  existing tests.
- If a task is really about the private Website vault or local runtime state,
  keep those edits in that workspace. Do not silently turn private cleanup into
  a public repo change.

## Change Discipline

This repo has several shared contracts where a tiny rename can break runtime
behavior even if one file looks correct.

Before changing any of the following, do a repo-wide search for producer,
consumer, docs, and tests:

- naming and branding
- env prefixes and state-dir fallback
- managed marker prefixes
- workspace bootstrap read order
- shared-mode routing, watchdog, or background-task naming
- review / note / timeline command examples

Do not infer semantics from names alone. Verify the write path, read path, and
tests together.

## Validation

- Default validation: `npm run check`
- If you touch review or managed-marker behavior, also run:
  `node --test tests/review.test.js tests/note-sync.test.js`
- Before release-facing changes, prefer the repo's real scripts and docs over
  chat memory summaries.

## Documentation Hygiene

- Keep one canonical explanation per rule. Use this file for repo policy,
  README/docs for public behavior, and code comments for non-obvious local
  implementation constraints.
- If a compatibility rule is already explained in README/docs, do not restate
  the full prose here unless this file needs an extra repo-maintainer boundary.
- If a repo task produces local-only cleanup conclusions, keep them out of this
  public repo unless they change shipped behavior or contributor guidance.
