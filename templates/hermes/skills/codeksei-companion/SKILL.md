---
name: codeksei-companion
description: Use Codeksei's ADHD companion workflows from Hermes via the codeksei CLI.
version: 0.3.0
author: Sapientropic
license: AGPL-3.0-only
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [Companion, ADHD, Timeline, Diary, Review, Notes, Reminders]
---

# Codeksei Companion

Use this skill when Hermes should call Codeksei's companion/domain workflows instead of re-inventing them in free-form chat.

This skill is designed for **Hosted Mode / Hermes recipe**.

## What This Skill Is For

- Staying with the user's actual day instead of treating them like a generic chat thread.
- Preserving continuity: current state, time blocks, project status, support preferences, and nightly closeout.
- Running proactive check-ins without letting the cron child become the long-term relationship owner.

## Important Boundary

- Hermes is the host/runtime/channel owner in this mode.
- Codeksei is the companion/domain workflow layer.
- Codeksei owns proactive judgment. Hosts should consume `proactiveDecision` from `host claim-checkin` instead of re-deciding the intervention level from raw context.
- The proactive cron child only observes, nudges lightly, and leaves a structured handoff.
- The main session remains the owner of final continuity judgment and next-wake judgment.
- Do not use this skill for host controls that Hermes already owns: `/new`, `/model`, `/approve`, `/deny`, `/resume`, `/stop`.
- Do not call `codeksei start`, `npm run shared:start`, `npm run shared:open`, or `npm run shared:watchdog` from this skill.

## Quick Reference

```bash
codeksei doctor
codeksei channel send-file --path /绝对路径
codeksei timeline event --date YYYY-MM-DD --start HH:mm --end HH:mm --title "标题" (--event-node <id> | --subcategory <id>) [其他参数]
codeksei timeline screenshot [--output /绝对路径] [其他 timeline screenshot 参数]
codeksei diary write --section todo --state open --text "内容"
codeksei reminder write --delay 30m --text "提醒内容"
codeksei companion remember --user <wechat_user_id> --workspace /绝对路径 --source host_user_turn [--text "内容" | --stdin]
codeksei note auto (--project <slug> | --scope <name>) --kind <kind> [--text "内容" | --stdin]
codeksei onboarding start --user <wechat_user_id>
codeksei onboarding step --user <wechat_user_id> [--session <sessionId>] [--text "内容" | --stdin]
codeksei onboarding status --user <wechat_user_id>
codeksei review nightly
codeksei review weekly
codeksei review monthly
codeksei project radar --project <slug> --json
codeksei context briefing --user <wechatUserId> --workspace /absolute/workspace --mode proactive
codeksei context inspect --user <wechatUserId> --workspace /absolute/workspace --mode proactive
codeksei capabilities status --provider hermes --user <wechatUserId> --workspace /absolute/workspace
codeksei pulse today --user <wechatUserId> --workspace /absolute/workspace
codeksei pulse generate --user <wechatUserId> --workspace /absolute/workspace --focus "..."
codeksei pulse feedback --kind like|dislike|hide|save|task --card <pulseCardId> --topic "..."
codeksei host seed-proactive --provider hermes --user <wechatUserId> --workspace /absolute/workspace
codeksei host claim-checkin --provider hermes --user <wechatUserId> --workspace /absolute/workspace
codeksei host settle-checkin --provider hermes --user <wechatUserId> --workspace /absolute/workspace --lease <leaseId> --result sent_message --create-handoff --message "..." --observed-state "..." --followup-context "..." --bookkeeping-action "timeline|done|..."
codeksei host finalize-checkin --provider hermes --user <wechatUserId> --workspace /absolute/workspace --lease <leaseId> --sleep-for 2h
```

## Default Routing

Use this decision order unless the user explicitly asks for something narrower:

1. If the user is new, profile context is thin, or you need to learn support style and boundaries before acting, call `onboarding status` first. If status is `not_started`, call `onboarding start`; if status is `in_progress` or `followup_needed`, route the latest user reply through `onboarding step` instead of freehand profiling in chat.
2. If you need current proactive/review context, call `context briefing` instead of reading raw notes or guessing from memory.
   If that briefing shows a pending proactive handoff, absorb it before replying and finish the turn with `host finalize-checkin` instead of leaving the lease hanging.
3. If the host or user needs to know why something is usable or blocked, call `capabilities status` instead of inferring from config alone.
4. If the user asks what is worth continuing today, call `pulse today` or `pulse generate` and present the cards as visible curation, not as an automatic wake.
5. If the user just said something that should change future support style, boundaries, timing, or likely re-entry behavior, persist it through `onboarding step` when onboarding is still active; otherwise call `companion remember`.
6. If the task is a hosted proactive wake, use the hosted contract: `host seed-proactive / claim-checkin / settle-checkin --create-handoff / finalize-checkin`.
7. Only skip Codeksei CLI when Hermes already owns the surface completely.

## Governance And Pulse

- `capabilities status` is the read-only governance view. It distinguishes configured command surface from currently available session capability, including host profile support, prerequisites, side effects, and blocked reasons.
- `context inspect` is the explainability view for context assembly. Use it when the host needs to show which sources entered the current handoff, which were excluded, whether a pending proactive handoff exists, and whether context packs matched.
- `pulse today` / `pulse generate` produce at most three deterministic curation cards from diary, timeline, companion memory, context board, project radar, reminders, reviews, check-in handoff, capability status, and prior feedback.
- A capability-status signal means the capability is callable or blocked. It is not evidence that fresh external facts have already been fetched.
- `pulse feedback` writes local feedback only. It does not train a remote model; `like` and `save` raise future scores, `dislike` and `hide` lower future scores, while `task` keeps a cross-day open loop.
- Pulse is not a proactive send layer. Do not auto-send Pulse cards to Weixin unless a higher-level workflow explicitly asks for visible curation.

## Proactive Default

- The goal is not just to remind. The goal is to keep track of what the user is doing now and avoid losing the thread.
- If you already know what they are doing, do not throw that away and collapse back into abstract chat.
- If you do not know whether they are still on the same line, prefer one short check-in question over long silent guessing.
- `SILENT` is not the default safe answer. Use it only when you clearly know this is a bad moment to interrupt.
- Even when you stay silent, ask whether this round should still leave continuity behind through timeline, diary, project note, companion memory, or review.
- When `host claim-checkin` returns `proactiveDecision`, treat its `interventionLevel`, `suggestedMessage`, `outputModality`, `backstageActions`, and `nextWakePolicy` as the Codeksei core decision. You may adapt wording lightly for the channel, but do not invent a different schedule truth.

## Proactive Decision Contract

- `interventionLevel=silent`: do not send a user-visible message.
- `interventionLevel=backstage_only`: prefer the listed `backstageActions`; leave a handoff and keep the user undisturbed.
- `interventionLevel=state_check`: ask one short state-confirming question if surfacing is allowed.
- `interventionLevel=light_nudge`: send at most one natural low-pressure line.
- `interventionLevel=offer_next_step`: offer the smallest re-entry step, not a full plan.
- `interventionLevel=push_forward`: only act firmly when Codeksei returned it with high confidence; never upgrade to this level yourself.
- If `outputModality=voice`, the host may use its own voice/TTS path only when the channel and user preference allow it. Codeksei does not require voice delivery.
- When settling/finalizing, pass `--decision-id` and optional `--response-outcome` / `--feedback-text` so Codeksei can learn from the result.

## Continuity First

When something becomes clear enough, default to writing it down instead of waiting for the user to remember the command later:

- Clear time block / cutover / completion block: write `diary` or `timeline`.
- Clear project current state / recent actions / next step: run `project radar`, then update a project note with `note auto`.
- Corrected support preference / boundary / accompaniment style: call `companion remember`.
- Night closeout / obvious end-of-day: prefer `review nightly`.

## Hosted Proactive Checkin

Preferred host contract:

```bash
codeksei host seed-proactive --provider hermes --user <wechatUserId> --workspace /absolute/workspace
codeksei host claim-checkin --provider hermes --user <wechatUserId> --workspace /absolute/workspace
codeksei host settle-checkin --provider hermes --user <wechatUserId> --workspace /absolute/workspace --lease <leaseId> --result silent --create-handoff --observed-state "..." --followup-context "..."
codeksei host finalize-checkin --provider hermes --user <wechatUserId> --workspace /absolute/workspace --lease <leaseId> --sleep-for 2h
```

Flow:

1. `host seed-proactive` creates or repairs the future wake/recovery/guard job set.
2. The cron child receives a pre-run Script Output block that already includes `claim-checkin` truth and the current Codeksei context board.
3. The cron child should do one short observational pass only: regain the user's current state, send one short message if appropriate, and/or do continuity bookkeeping.
4. The cron child must persist exactly one structured handoff with `host settle-checkin --create-handoff`.
5. On the next natural main-session turn, read `context briefing`, absorb any pending proactive handoff, and use `host finalize-checkin` to make the true next-wake decision.
6. If the main session does not take over in time, Codeksei daemon recovery will fall back and keep the lease from hanging forever.

## Bookkeeping Heuristics

- If a real time block is now clear, default to `timeline` / `diary` before you move on.
- If the user's current project state is now clear, default to `project radar` + `note auto` instead of leaving it as chat-only context.
- If the user corrected how they want to be supported, default to `companion remember`.
- If the user is clearly ending the day, default to `review nightly` instead of only sending a warm line.

## Verification

- `codeksei doctor` should succeed.
- `codeksei host doctor --provider hermes` should report repo-local prerequisites and skill state clearly.
- Non-TTY Codeksei commands should return JSON envelopes that Hermes can inspect.
- For write actions, confirm the CLI reported success before telling the user the workflow is complete.
