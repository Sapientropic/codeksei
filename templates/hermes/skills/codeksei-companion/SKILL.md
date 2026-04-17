---
name: codeksei-companion
description: Use Codeksei's ADHD companion workflows from Hermes via the codeksei CLI.
version: 0.2.0
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
- The user is new enough that Hermes should start or continue the Codeksei onboarding conversation instead of pretending it already knows them.
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
codeksei channel send-file --path /绝对路径
codeksei timeline event --date YYYY-MM-DD --start HH:mm --end HH:mm --title "标题" (--event-node <id> | --subcategory <id>) [其他参数]
codeksei timeline screenshot --send [--user <wechatUserId>] [--output /绝对路径] [其他 timeline screenshot 参数]
codeksei diary write --section todo --state open --text "内容"
codeksei reminder write --delay 30m --text "提醒内容" [--delivery direct|proactive]
codeksei companion remember --user <wechat_user_id> --workspace /绝对路径 --source host_user_turn [--text "内容" | --stdin]
codeksei note auto (--project <slug> | --scope <name>) --kind <kind> [--text "内容" | --stdin]
codeksei onboarding start --user <wechat_user_id>
codeksei onboarding step --user <wechat_user_id> --session <sessionId> [--text "内容" | --stdin]
codeksei onboarding status --user <wechat_user_id>
codeksei review nightly
codeksei review weekly
codeksei review monthly
codeksei project radar --project <slug> --json
codeksei context briefing --user <wechatUserId> --workspace /absolute/workspace --mode proactive
codeksei host seed-proactive --provider hermes --user <wechatUserId> --workspace /absolute/workspace
codeksei host claim-checkin --provider hermes --user <wechatUserId> --workspace /absolute/workspace
codeksei host settle-checkin --provider hermes --user <wechatUserId> --workspace /absolute/workspace --lease <leaseId> --result silent --sleep-for <duration>
```

## Procedure

1. Confirm `codeksei` is available on PATH. If it is missing, tell the user you need the Codeksei CLI installed or the repo checked out first.
2. Prefer the narrowest CLI entrypoint that matches the task:
   - `channel send-file` for explicit local artifact send-back
   - `timeline` for concrete time blocks and dashboard screenshots
   - `diary` for lived notes / supplements / todo transitions
   - `reminder` for user-visible nudges or future proactive wakes
   - `companion remember` for ongoing durable memory updates after onboarding
   - `note` for durable memory
   - `onboarding` for first-activation / profile-building chat turns
   - `review` for structured reflection
   - `project radar` for repo continuity
   - `context briefing` for inspecting the current proactive/review handoff board
   - `host seed-proactive / claim-checkin / settle-checkin` for hosted proactive checkin
3. When a command returns JSON, use the returned facts directly instead of paraphrasing from memory.
4. If a command fails because local state or dependencies are missing, explain the missing prerequisite exactly and stop instead of guessing.
5. Hosted send-back / reminder / proactive commands depend on the active Hermes session plus the sibling `hermes-agent` repo-local checkout. If `codeksei host doctor --provider hermes` says repo-local is missing, fix that first instead of improvising another delivery path.

## Default Routing

Use this decision order unless the user explicitly asks for something narrower:

1. If the user is new, profile context is obviously thin, or you need to learn support style/boundaries before acting, call `onboarding status` first. If status is `not_started`, call `onboarding start`; if status is `in_progress` or `followup_needed`, route the latest user reply through `onboarding step` instead of freehand profiling in chat.
2. If you need current proactive/review handoff context, call `context briefing` instead of reading raw notes or guessing from memory.
3. If the user just said something that should change future support style, timing, boundaries, current-state understanding, or likely next steps, persist it through `onboarding step` when onboarding is still active; otherwise call `companion remember` instead of leaving it only in Hermes chat memory.
4. If the task is a hosted proactive wake, do not invent your own scheduler loop: use `host seed-proactive / claim-checkin / settle-checkin` as the default contract.
5. Only skip Codeksei CLI when Hermes already owns the surface completely, such as host-native thread controls or approval actions.

## Hosted Proactive Checkin

Preferred host contract:

```bash
codeksei host seed-proactive --provider hermes --user <wechatUserId> --workspace /absolute/workspace
codeksei host claim-checkin --provider hermes --user <wechatUserId> --workspace /absolute/workspace
codeksei host settle-checkin --provider hermes --user <wechatUserId> --workspace /absolute/workspace --lease <leaseId> --result silent --sleep-for <duration>
```

Flow:

0. Hermes hosted proactive wakes now receive a fresh Codeksei context board via the cron job's pre-run script. Treat that Script Output block as the current-state handoff, not as raw vault data.
1. `host seed-proactive` creates or repairs the first future wake when Hermes needs a one-shot job to exist.
2. `host claim-checkin` asks Codeksei whether a proactive pass is due.
3. If status is `claimed`, Hermes must use `payload.text` as the task instruction and keep `lease.id` for completion.
4. If status is `in_progress`, another proactive pass already owns the lease; Hermes should stay silent and let the recovery wake remain armed.
5. After the proactive pass finishes, Hermes must call `host settle-checkin` with `sent_message|silent|backstage_only`.
6. Use `result=failed` only when Hermes could not finish the delegated pass truthfully; Codeksei will keep recovery ownership and surface a partial result instead of faking completion.
7. Choose --sleep-for based on the user's current state and time of day: shorter during active daytime, longer during sleep or late-night quiet hours.

Reminder note:

- Default `reminder write` is for user-visible reminders.
- Use `codeksei reminder write --delivery proactive ...` when the text is internal follow-up context that should re-enter the proactive checkin chain later instead of being sent directly to the user.
- If the user says something that should affect future proactive judgement, do not leave it only in chat memory: route it through `companion remember`, or through `onboarding step` if onboarding is still active.

Compatibility note:

- `codeksei operator hermes sync-checkin` and `codeksei system checkin-*` still exist as compatibility building blocks.
- New host integrations should prefer `host seed-proactive / claim-checkin / settle-checkin` instead of stitching the old tick/ack/complete flow by hand.

## Verification

- `codeksei doctor` should succeed.
- `codeksei host doctor --provider hermes` should report the Hermes repo-local prerequisites and companion skill state clearly.
- Non-TTY Codeksei commands should return JSON envelopes that Hermes can inspect.
- For write actions, confirm the CLI reported success before telling the user the workflow is complete.
