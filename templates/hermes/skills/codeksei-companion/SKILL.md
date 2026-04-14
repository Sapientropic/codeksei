---
name: codeksei-companion
description: Use Codeksei's ADHD companion workflows from Hermes via the codeksei CLI.
version: 0.1.0
author: Sapientropic
license: AGPL-3.0-only
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [Companion, ADHD, Timeline, Diary, Review, Notes, Reminders]
---

# Codeksei Companion

Use this skill when Hermes should call Codeksei's companion/domain workflows instead of re-inventing them in free-form chat.

This skill is designed for **Hermes Hosted Mode**.

## When to Use

- The user wants to record a real time block, diary item, reminder, or durable note.
- The user wants a nightly/weekly/monthly review draft based on Codeksei's local data model.
- The user wants project radar or "where did I leave this thread/project?" support.
- The current host is Hermes, including Hermes-hosted Weixin.

## Important Boundary

- Hermes is the host/runtime/channel owner in this mode.
- Codeksei is the companion/domain workflow layer.
- Do not use this skill for host controls that Hermes already owns:
  - `/new`
  - `/model`
  - `/approve` / `/deny`
  - `/resume`
  - `/stop`
- Do not call `codeksei start`, `npm run shared:start`, `npm run shared:open`, or `npm run shared:watchdog` from this skill. Those are bridge-mode/operator entrypoints, not Hermes-hosted workflows.

## Quick Reference

```bash
codeksei doctor
codeksei timeline event --date YYYY-MM-DD --start HH:mm --end HH:mm --title "..."
codeksei diary write --section todo --state open --text "..."
codeksei reminder write --delay 30m --text "..."
codeksei note auto --project <slug> --kind recent --text "..."
codeksei review nightly
codeksei review weekly
codeksei review monthly
codeksei project radar --project <slug> --json
```

## Procedure

1. Confirm `codeksei` is available on PATH. If it is missing, tell the user you need the Codeksei CLI installed or the repo checked out first.
2. Prefer the narrowest CLI entrypoint that matches the task:
   - `timeline` for concrete time blocks
   - `diary` for lived notes / supplements / todo transitions
   - `reminder` for future nudges
   - `note` for durable memory
   - `review` for structured reflection
   - `project radar` for repo continuity
3. When the command returns JSON, use the returned facts directly instead of paraphrasing from memory.
4. If a command fails because local state or dependencies are missing, explain the missing prerequisite exactly and stop instead of guessing.

## Verification

- `codeksei doctor` should succeed.
- Non-TTY Codeksei commands should return JSON envelopes that Hermes can inspect.
- For write actions, confirm the CLI reported success before telling the user the workflow is complete.
