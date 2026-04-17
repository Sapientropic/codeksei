# Codeksei

<div align="center">
  <p>
    <a href="./README.md">中文 README</a>
  </p>
  <p>
    <a href="https://github.com/Sapientropic/codeksei/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Sapientropic/codeksei/actions/workflows/ci.yml/badge.svg"></a>
    <a href="https://www.npmjs.com/package/codeksei"><img alt="npm version" src="https://img.shields.io/npm/v/codeksei"></a>
    <a href="./LICENSE"><img alt="License: AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-111111.svg"></a>
  </p>
  <p><a href="https://zread.ai/Sapientropic/codeksei" target="_blank"><img src="https://img.shields.io/badge/Ask_Zread-_.svg?style=for-the-badge&color=00b0aa&labelColor=000000&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQuOTYxNTYgMS42MDAxSDIuMjQxNTZDMS44ODgxIDEuNjAwMSAxLjYwMTU2IDEuODg2NjQgMS42MDE1NiAyLjI0MDFWNC45NjAxQzEuNjAxNTYgNS4zMTM1NiAxLjg4ODEgNS42MDAxIDIuMjQxNTYgNS42MDAxSDQuOTYxNTZDNS4zMTUwMiA1LjYwMDEgNS42MDE1NiA1LjMxMzU2IDUuNjAxNTYgNC45NjAxVjIuMjQwMUM1LjYwMTU2IDEuODg2NjQgNS4zMTUwMiAxLjYwMDEgNC45NjE1NiAxLjYwMDFaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00Ljk2MTU2IDEwLjM5OTlIMi4yNDE1NkMxLjg4ODEgMTAuMzk5OSAxLjYwMTU2IDEwLjY4NjQgMS42MDE1NiAxMS4wMzk5VjEzLjc1OTlDMS42MDE1NiAxNC4xMTM0IDEuODg4MSAxNC4zOTk5IDIuMjQxNTYgMTQuMzk5OUg0Ljk2MTU2QzUuMzE1MDIgMTQuMzk5OSA1LjYwMTU2IDE0LjExMzQgNS42MDE1NiAxMy43NTk5VjExLjAzOTlDNS42MDE1NiAxMC42ODY0IDUuMzE1MDIgMTAuMzk5OSA0Ljk2MTU2IDEwLjM5OTlaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik0xMy43NTg0IDEuNjAwMUgxMS4wMzg0QzEwLjY4NSAxLjYwMDEgMTAuMzk4NCAxLjg4NjY0IDEwLjM5ODQgMi4yNDAxVjQuOTYwMUMxMC4zOTg0IDUuMzEzNTYgMTAuNjg1IDUuNjAwMSAxMS4wMzg0IDUuNjAwMUgxMy43NTg0QzE0LjExMTkgNS42MDAxIDE0LjM5ODQgNS4zMTM1NiAxNC4zOTg0IDQuOTYwMVYyLjI0MDFDMTQuMzk4NCAxLjg4NjY0IDE0LjExMTkgMS42MDAxIDEzLjc1ODQgMS42MDAxWiIgZmlsbD0iI2ZmZiIvPgo8cGF0aCBkPSJNNCAxMkwxMiA0TDQgMTJaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00IDEyTDEyIDQiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K&logoColor=ffffff" alt="zread"/></a></p>
  <h3>A local-first companion that helps time hold shape and brings daily life and project threads back within reach</h3>
  <p><strong>It keeps timeline, diary, reminders, reviews, and project continuity inside one local-first companion core, then attaches that core to whichever host bridge you want.</strong></p>
  <p>Codeksei is not just a chat box waiting for prompts, and it is not a second agent runtime. It helps capture what happened, reconnect loose threads, leave reminders, and make project re-entry gentler while keeping state, logs, and life traces local by default. WeChat is now only a first-party adapter, not the whole product identity.</p>
  <p>
    <a href="#agent-quickstart">Agent Quickstart</a> ·
    <a href="#setup">SETUP</a> ·
    <a href="#mode-specific-bring-up">Mode-Specific Bring-Up</a> ·
    <a href="#a-day-with-codeksei">A Day With Codeksei</a> ·
    <a href="#what-it-can-do">Capabilities</a> ·
    <a href="#why-the-name">Why the Name</a> ·
    <a href="./CHANGELOG.md">Changelog</a> ·
    <a href="./docs/commands.md">Commands</a> ·
    <a href="./docs/architecture.md">Architecture</a>
  </p>
</div>

- **What it is**: a local-first, `daemon-first / host-attachable` companion engine; for humans it is a companion assistant, and for hosts it is an attachable domain layer
- **CLI contract**: `codeksei help`, `codeksei schema`, and `codeksei host manifest` are the public discovery surface; non-TTY runs default to JSON, `stdout` carries results, and `stderr` carries diagnostics
- **Recommended start**: complete shared `SETUP` first, then choose `Codex Mode` or `Hosted Mode`

<a id="agent-quickstart"></a>

## Agent Quickstart

If you are an external agent, do not infer internal seams from long README prose. The recommended entry is:

1. Read `CODEKSEI_HOSTKIT.json` in the repo root first
2. Treat the README as human-facing guidance, and treat `HOSTKIT + codeksei host manifest/bootstrap/doctor/smoke` as the machine entrypoint
3. Prefer `Hosted Mode` by default
4. Treat `host bootstrap` as “Codeksei attachment/bootstrap completed”, not as proof that Hermes gateway or live Weixin bring-up is already complete

- `CODEKSEI_HOSTKIT.json` now also carries minimal entrypoint/workflow hints, enough for a new host to discover the default onboarding / companion-memory / context-briefing route; `codeksei host manifest` remains the richer dynamic source of truth

Recommended order:

```bash
npx -y codeksei@latest host manifest
npx -y codeksei@latest host bootstrap --provider hermes --ensure-daemon
npx -y codeksei@latest host doctor --provider hermes
npx -y codeksei@latest host smoke --provider hermes
```

- `operator hermes *` remains a compatibility entrypoint, not the new primary entrypoint
- The README handles human onboarding; the machine contract lives in `CODEKSEI_HOSTKIT.json`, `codeksei host manifest`, and the public CLI schema

## Host Modes

Codeksei is now positioned as a **daemon-first / host-attachable / companion engine**, not a CLI tied to one fixed host.

- `Codex Mode`
  Current default path: `Codeksei first-party Weixin adapter + Codex runtime`
- `Hosted Mode`
  Hermes owns the agent loop and host-side messaging surface; Codeksei exposes timeline, diary, reminder, review, note, and project radar through its CLI / skill surface
- `Proactive context layer`
  Hosted proactive wakes read a Codeksei-managed context board by default. It is aggregated from checkin state, today's diary, companion notes, project radar, and workspace continuity, then injected by a Hermes cron `script` right before runtime instead of requiring raw vault scans
- External hosts should attach through the `host attachment contract`:
  `codeksei host manifest`, `codeksei host bootstrap`, `codeksei host doctor`, `codeksei host smoke`, `codeksei host seed-proactive`, `codeksei host claim-checkin`, `codeksei host settle-checkin`

<a id="setup"></a>

## SETUP

This section only covers shared installation, contract discovery, and basic CLI verification. It does not force you to choose `Codex Mode` or `Hosted Mode` first.

### Common prerequisites

- `Node.js >= 22`
- Default machine entry at the repo root: `CODEKSEI_HOSTKIT.json`
- Canonical host config filename: `codeksei.config.json`

### Install paths

1. Run it ephemerally without creating a global install:

```bash
npx -y codeksei@latest
```

2. Install the CLI globally first:

```bash
npm install -g codeksei
```

3. Clone the repository when you want source, scripts, templates, and the full repo docs:

```bash
git clone https://github.com/Sapientropic/codeksei.git
cd codeksei
npm install
```

### Minimum verification

After installation, make sure the CLI and machine contract are both discoverable:

```bash
codeksei help
codeksei schema
codeksei host manifest
```

If you are using the `npx` path and do not have a global `codeksei` binary on `PATH`, run the same subcommands through `npx -y codeksei@latest ...`.

### SETUP boundaries

- A successful setup only means the CLI, public schema, and host attachment contract / hostkit are discoverable
- It does not mean `Codex Mode` has already logged in
- It also does not mean `Hosted Mode` is already live-attached to Hermes gateway / host bridge
- It definitely does not mean reminders, check-ins, repo-local shims, or hosted send-back are all ready yet

<a id="mode-specific-bring-up"></a>

## Mode-Specific Bring-Up

After `SETUP`, choose the bring-up path that matches how you want to run Codeksei.

### Codex Mode

Use this when you want Codeksei to own the repo's existing shared-thread path.

```bash
git clone https://github.com/Sapientropic/codeksei.git
cd codeksei
npm install
npm run login
npm run shared:start
```

Notes:

- Codex Mode keeps its first-party Weixin adapter protocol version aligned with Tencent's official `@tencent-weixin/openclaw-weixin@2.1.8`
- International / overseas WeChat login can still be region-gated; if the phone-side scan fails with a generic network error, verify account/client eligibility first

Common follow-up commands:

```bash
npm run shared:open
npm run shared:status
```

### Hosted Mode

Use this when you already have Hermes runtime / gateway / official Weixin and want Codeksei to attach as a companion workflow surface.

```bash
codeksei host manifest
codeksei host bootstrap --provider hermes --ensure-daemon
codeksei host doctor --provider hermes
codeksei host smoke --provider hermes
```

Boundaries:

- `host manifest -> bootstrap -> doctor -> smoke` is the current primary path
- `operator hermes *` remains a compatibility entrypoint, not the new primary path
- `host bootstrap` only means Codeksei attachment/bootstrap is complete; it does not mean Hermes gateway or live Weixin bring-up is complete
- Live gateway, official Weixin, approvals, and the runtime loop are still owned by Hermes
- External agents should not infer internal TypeScript seams from README prose; they should attach through the host attachment contract

<a id="a-day-with-codeksei"></a>

## A Day With Codeksei

- **At the start of the day**: you might only say “I’m starting now” or “Where did that thread stop yesterday?” It brings back reminders, recent state, project context, and the most reachable next move so you do not have to restart from blankness.
- **While moving through the day**: you drop thoughts, todos, finished time blocks, and fragments into chat. It keeps what matters: some things become diary, some become timeline, some become reminders for later, and your head does not have to keep brute-forcing memory.
- **You look up and half the day seems gone**: you ask “What did I even do?” or “Why does today feel like a blur again?” It turns time blocks, switches, and surviving clues back into a timeline so the day has shape again.
- **You go quiet for a while**: it does not rush to jump in. It weighs whether this is the moment to check in, follow up, write something down first, leave a reminder for later, or simply stay with the thread quietly.
- **You return to a project and your mind goes blank for a second**: you say “Continue this” or “Where exactly am I stuck?” It follows the same thread, project context, and recent actions until the way back in becomes visible again.
- **You stall, switch, or want to disappear for a bit**: you say “I’m scattered,” “I want to avoid this,” or “I don’t know what to do first.” It narrows things back to one reachable move, and may quietly leave a reminder or close a loose loop.
- **The day is closing**: you let it help you close out before sleep, before leaving, or after a work block. It compresses the day into timeline, review, and a gentler way back in tomorrow.

> `Proactive help` feels more like having something gently keep watch over the day.
>
> It keeps hold of time, loose threads, and what already happened. It shows up when it should, leaves anchors behind, and knows how to stay quietly present too.

## What It Can Do

- `Timeline`: time blocks, switches, and lived facts become anchors for memory and time sense instead of fading into a blur
- `Diary`: todos, fragments, supplements, summaries, and timeline-linked facts for daily traces that want to stay
- `Check-ins`: proactive wake-ups and background care. Messaging is only one output path; Codeksei can also reread context, clean up backstage state, update diary/timeline, or leave a reminder before deciding whether it should surface. It owns proactive trigger generation, the `tick -> ack -> complete` schedule truth, and the next wake decision written in `checkin-complete`; Codex Mode wraps that truth with a local poller, while Hosted Mode only executes a managed wake/recovery job set and still defers the true next wake to Codeksei
- `Onboarding`: first activation can happen as a conversational interview instead of a form. Long-term truth lands in the companion note and is then projected through the context board; when there is no Obsidian/workspace schema, Codeksei can fall back to a local companion profile under the state dir
- `Companion memory`: the system keeps updating after first activation. When a user's new self-description, correction, support preference, boundary, or near-term task should change future companionship judgement, route it through `companion remember` instead of leaving it only in host chat memory
- `Context board`: the controlled context layer for proactive judgement. It turns checkin state, today's facts, active threads, cautions, and re-entry handles into a prompt-ready briefing; Hosted Mode refreshes and injects that board at cron runtime instead of scanning raw vault files
- `Reminders`: reminder write and scheduling support for rhythm and follow-through. In Hosted Mode the default is a user-visible reminder; use `reminder write --delivery proactive` when the text should become a future proactive wake instead of a direct message
- `Review`: nightly / weekly / monthly review, with hybrid semantic extraction by default
- `Project support`: workspace bootstrap, project radar, and shared-thread recovery by workspace so re-entry does not always start from scratch; local git remains the first truth and GitHub activity is only a fallback continuity signal
- `WeChat bridge`: owned by Codeksei in Codex Mode; Hosted Mode should use the host's own bridge
- `Runtime host`: Codex Mode currently defaults to Codex; Hosted Mode lets the host own agent/runtime/approval/model switching
- `Durable notes`: `note:auto`, `note:maybe`, `note:sync`

## Who It Fits

- People who want help looking after messy daily life, reminders, and unfinished loops
- People with ADHD or executive-function friction who benefit from steady companionship and gentle external support
- People whose days blur together and are hard to reconstruct afterward
- People whose project thread feels severed after even a small interruption
- People who want something that proactively checks in and helps carry the thread instead of waiting to be manually reopened every time
- People who want projects, daily capture, and review to live in one workflow
- People who want WeChat as the main interaction surface while keeping things local and editable

<a id="why-the-name"></a>

## Why the Name

<div align="center">
  <p><strong>One name, held in two moods.</strong></p>
</div>

- `Code`: the quiet shorthand of everyday life. Fleeting thoughts, paused threads, and the texture you meant to remember all leave a trace here.
- `-ksei`: taken from the latter half of `Aleksei`. Here it carries an image of care, help, and companionship, like someone walking beside you without making a show of it.

<div align="center">
  <p><em>Your threads are watched over, and returning can still feel warm and continuous.</em></p>
</div>

## CLI Contract

- `codeksei help`
  Only exposes the public finite CLI by default instead of mixing in shared / maintainer / background surfaces
- `codeksei schema`
  Returns the structured public CLI contract for agents and automation
- `codeksei host manifest`
  Returns the host attachment manifest / hostkit machine entrypoint
- `codeksei host doctor`
  Shows daemon, attachment, and provider recipe readiness
- `codeksei operator help`
  Shows bootstrap, shared, background, and maintainer operator surfaces
- `codeksei operator schema`
  Returns the structured schema for operator / bootstrap surfaces
- Non-TTY runs default to a JSON envelope; TTY runs default to text
- `stderr` is for diagnostics; `stdout` is for result data
- Shared global flags:
  `--format json|text`, `--verbose`, `--workspace-root /absolute/path`

## Codex Mode Runtime Config

Codex Mode still uses a deliberate two-stage environment-loading contract:

1. Keep any environment variables already present in the current process
2. Load `.env` from the current project directory
3. Recompute the state directory from the now-active `CODEKSEI_STATE_DIR`, then load `.env` from that state directory

Earlier values win. Later `.env` files only fill missing keys and never overwrite keys that already exist. That means a repo `.env` is allowed to define `CODEKSEI_STATE_DIR`, and the state-dir `.env` path is recalculated only after the repo `.env` has been loaded.

<details>
<summary>Show common optional environment variables</summary>

```dotenv
CODEKSEI_ACCOUNT_ID=
CODEKSEI_RUNTIME_ENDPOINT=ws://127.0.0.1:8765
CODEKSEI_RUNTIME_COMMAND=codex
CODEKSEI_HERMES_COMMAND=hermes
CODEKSEI_REVIEW_SEMANTIC_HOST=auto
CODEKSEI_COMPANION_SEMANTIC_HOST=
CODEKSEI_COMPANION_SEMANTIC_MODEL=
CODEKSEI_COMPANION_SEMANTIC_TIMEOUT_MS=15000
CODEKSEI_ONBOARDING_SEMANTIC_HOST=
CODEKSEI_ONBOARDING_SEMANTIC_MODEL=
CODEKSEI_ONBOARDING_SEMANTIC_TIMEOUT_MS=15000
CODEKSEI_CODEX_ENDPOINT=ws://127.0.0.1:8765
CODEKSEI_WEIXIN_REPLY_MODE=stream
CODEKSEI_WEIXIN_ROUTE_TAG=
CODEKSEI_WEIXIN_PROTOCOL_CLIENT_VERSION=2.1.8
CODEKSEI_TIMEZONE=Asia/Shanghai
CODEKSEI_TIMELINE_LOCALE=zh-CN
CODEKSEI_DIARY_DIR=/absolute/path/to/your/vault/diary
CODEKSEI_TIMELINE_STATE_DIR=/absolute/path/to/your/vault/.codex/timeline
CODEKSEI_WORKSPACE_BOOTSTRAP_CONFIG=/absolute/path/to/your/workspace-bootstrap.json
CODEKSEI_PROJECT_RADAR_CONFIG=/absolute/path/to/your/workspace/.codex/code-projects.json
CODEKSEI_DURABLE_NOTE_SCHEMA_CONFIG=/absolute/path/to/your/workspace/.codex/durable-note-schema.json
CODEKSEI_REVIEW_SCHEMA_CONFIG=/absolute/path/to/your/workspace/.codex/review-schema.json
CODEKSEI_SHARED_USE_BUNDLED_CODEX_BINARY=1
CODEKSEI_SHARED_DISABLE_PLUGINS=0
CODEKSEI_SHARED_DISABLE_SHELL_SNAPSHOT=0
```

</details>

Notes:

- `CODEKSEI_WEIXIN_REPLY_MODE=stream` now behaves more like a hybrid stream: it prefers natural sentence boundaries or completed blocks so unfinished final sentences are not split into multiple WeChat bubbles
- `CODEKSEI_WEIXIN_REPLY_MODE=settled` still means “wait until the whole turn settles”: only the latest visible final reply is sent
- The Weixin bridge now exposes only one official `v2` adapter; the issue #4 media gap is handled as an internal legacy media fallback instead of a second public adapter
- `CODEKSEI_WEIXIN_PROTOCOL_CLIENT_VERSION` now defaults to Tencent's official `@tencent-weixin/openclaw-weixin@2.1.8`; only override it when you have source-backed upstream evidence to do so
- International / overseas WeChat login can still be gated by Tencent's regional rollout; Tencent's public docs say Hong Kong is supported while other regions are still rolling out
- `CODEKSEI_RUNTIME` / `CODEKSEI_CHANNEL_PROVIDER` decide whether the current runtime is `Codex Mode` or `Hosted Mode`
- `CODEKSEI_RUNTIME_ENDPOINT` / `CODEKSEI_RUNTIME_COMMAND` are the new host-neutral runtime ingress; legacy `CODEKSEI_CODEX_*` variables still remain for compatibility
- `CODEKSEI_REVIEW_SEMANTIC_HOST=auto|codex|hermes|deterministic` lets you pin the semantic review host explicitly; default is `auto`
- `CODEKSEI_COMPANION_SEMANTIC_HOST=auto|codex|hermes|deterministic` lets ongoing companion-memory extraction pick a dedicated semantic host; when left blank it follows the default host decision
- `CODEKSEI_COMPANION_SEMANTIC_MODEL` can pin a cheaper model just for ongoing companion-memory extraction
- `CODEKSEI_COMPANION_SEMANTIC_TIMEOUT_MS` defaults to `15000`; timeouts fall back to deterministic extraction so backstage memory updates do not block the host
- `CODEKSEI_ONBOARDING_SEMANTIC_HOST=auto|codex|hermes|deterministic` lets onboarding extraction pick a dedicated semantic host; when left blank it follows the default host decision
- `CODEKSEI_ONBOARDING_SEMANTIC_MODEL` can pin a cheaper model just for hidden onboarding extraction
- `CODEKSEI_ONBOARDING_SEMANTIC_TIMEOUT_MS` defaults to `15000`; timeouts fall back to deterministic extraction so activation turns stay responsive
- `CODEKSEI_USER_NAME` is a display/persona field, not a routing id
- `CODEKSEI_ALLOWED_USER_IDS` must use the exact sender ids observed by the bridge; the easiest path is `codeksei accounts`, or `npm run accounts` when you are already in a repo checkout
- WeChat persona / continuity instructions default to `templates/weixin-instructions.md`; use `weixin-instructions.local.md` in the state directory only when you need a local overlay
- If you use multiple workspaces in shared mode, set `CODEKSEI_WORKSPACE_ROOT` before startup
- `CODEKSEI_TIMEZONE` is optional; when set, it becomes the single local-time contract for reminder / diary / review / timeline flows
- `CODEKSEI_TIMELINE_LOCALE` is optional; it currently switches timeline dashboard copy, date formatting, and demo data between `zh-CN` and `en`
- `CODEKSEI_HERMES_REPO_ROOT` is optional; if the default sibling checkout `../hermes-agent` is not available in Hosted Mode, point it at the repo-local upstream checkout explicitly
- The Hermes native cron-env passthrough patch now ships as an optional Codeksei asset; see [docs/hermes-cron-env-patch.md](./docs/hermes-cron-env-patch.md) for applicability and `git apply` usage
- If `CODEKSEI_TIMEZONE` is unset, Codeksei first reuses any non-legacy timezone already declared by the timeline state; otherwise it falls back to the system timezone
- Legacy `Asia/Shanghai` timeline state can auto-migrate to the unified timezone the next time you run a timeline command
- `CODEKSEI_TIMELINE_STATE_DIR` points at the Codeksei timeline data root; the current primary layout stores runtime files under `timeline/*.json`
- The `.env` loading order is intentionally two-stage: repo `.env` first, then state-dir `.env` after `CODEKSEI_STATE_DIR` has been resolved; this is also why `dotenv` still remains a runtime dependency
- Keep `.env` local and out of version control

## Windows Background Tasks

If you want Codex Mode to auto-start after login and heal quickly after unlock or sleep recovery:

```powershell
npm run background:install
```

Remove them:

```powershell
npm run background:uninstall
```

## Common Commands

This small set is enough to get started:

Terminal:

```bash
codeksei doctor
codeksei help
codeksei schema
codeksei host manifest
codeksei host bootstrap --provider hermes --ensure-daemon
codeksei host doctor
codeksei host smoke --provider hermes
codeksei companion remember --user <wechat_user_id> --workspace /absolute/workspace --source host_user_turn --stdin
codeksei onboarding start --user <wechat_user_id>
codeksei onboarding status --user <wechat_user_id>
codeksei context briefing --user <wechat_user_id> --workspace /absolute/workspace --mode proactive
codeksei review weekly --help
```

Terminal (repo shared scripts):

```bash
npm run login
npm run accounts
npm run shared:start
npm run shared:open
npm run shared:status
```

WeChat:

```text
/bind /absolute/path
/status
/new
/reread
/switch <threadId>
/stop
/yes
/always
/no
/model
/model <id> [effort]
/effort
/effort <level>
/checkin
/checkin <min>-<max>
/checkin reset
/help
```

Terminal:

```bash
codeksei system checkin --show
codeksei system checkin --range 3-60
codeksei system checkin --reset
codeksei host seed-proactive --provider hermes --user <wechat_user_id> --workspace /absolute/workspace
codeksei host claim-checkin --provider hermes --user <wechat_user_id> --workspace /absolute/workspace
codeksei host settle-checkin --provider hermes --user <wechat_user_id> --workspace /absolute/workspace --lease <leaseId> --result silent --sleep-for <duration>
codeksei system checkin-trigger --user <wechat_user_id> --workspace /absolute/workspace
codeksei system checkin-tick --user <wechat_user_id> --workspace /absolute/workspace
codeksei system checkin-tick --user <wechat_user_id> --workspace /absolute/workspace --ack <triggerId>
codeksei system checkin-complete --user <wechat_user_id> --workspace /absolute/workspace --trigger <triggerId> --result silent --sleep-for <duration>
codeksei operator hermes sync-checkin --user <wechat_user_id> --workspace /absolute/workspace
codeksei context briefing --user <wechat_user_id> --workspace /absolute/workspace --mode review
```

More detailed references:

- [docs/commands.md](./docs/commands.md)
- [docs/timeline-integration.md](./docs/timeline-integration.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/hermes-cron-env-patch.md](./docs/hermes-cron-env-patch.md) `Optional Hosted Mode patch`

If you maintain this repository, the current quality-gate split is:

- `npm run check`: source-only guardrails and typechecks; it does not rebuild `dist/`
- `npm run coverage:critical`: the owner-focused coverage gate for `config`, `weixin delivery text`, `runtime turn`, and `stream delivery`; this stays in `verify`, not in `check`
- `npm run verify`: runs `check`, then explicitly rebuilds published runtime artifacts, runs built-runtime tests, and finishes with `npm run pack:dry-run`
- `npm run build`: use this only when you intentionally want to refresh the published runtime artifacts

That split is intentional: do not rely on `prepare` or implicit `npm pack` lifecycle hooks to rebuild the package for you anymore.

Two dependency/tooling choices are also intentionally kept:

- `playwright-core` remains a runtime dependency because `timeline screenshot` is a public runtime capability, not just a maintainer script; browser lookup order is `CODEKSEI_SCREENSHOT_CHROME_PATH` -> Playwright managed browser path -> system Chrome/Chromium/Edge
- `check` still treats repo-specific AST/type guards as the canonical lint truth; this round does not add Prettier or a whole-repo ESLint gate

If you are opening the codebase for the first time, start with `docs/architecture.md` before drilling into directories.

## Local State and Public Boundary

Primary state directory:

```text
~/.codeksei
```

Typical runtime contents:

- `accounts/`
- `sessions.json`
- `sync-buffers/`
- `weixin-instructions.local.md`
- `weixin-operations.local.md`
- `workspace-bootstrap.json`
- `reminder-queue.json`
- `system-message-queue.json`
- `system-message-dead-letter.json`
- `timeline-screenshot-queue.json`
- `diary/`
- `timeline/`
- `logs/`

The continuity-critical state files currently covered are `sessions.json`, `reminder-queue.json`, `system-message-queue.json`, and `timeline-screenshot-queue.json`. Those files now use atomic writes, and if JSON parsing succeeds but the critical schema is broken, or if the file itself is corrupt, the runtime moves the original file aside as `*.corrupt-<timestamp>.json` before falling back to an empty default state.

If you set `CODEKSEI_DIARY_DIR` or `CODEKSEI_TIMELINE_STATE_DIR`, business data is stored there and the state directory keeps runtime files only.

The default persona / operations templates still ship from the repository under `templates/`; `*.local.md` files in the state directory are overlays for your own machine, not the only source of truth.

The repository and npm package are meant to contain code, scripts, templates, and docs only. Your accounts, sessions, logs, personal `.env`, and local business data should stay outside version control.

## Upstream Acknowledgement

Thanks to [`WenXiaoWendy/cyberboss`](https://github.com/WenXiaoWendy/cyberboss) for open-sourcing the original repository.  
Codeksei grew from that starting point, and the project is grateful for it.

## FAQ

### Can I install it with `npm install -g codeksei`?

You can. Use that path when you want the base CLI quickly; clone the repository when you want the full Codex Mode flow from this README, source-level customization, or shared-script debugging.

### How is shared mode different from `npm run start`?

`npm run start` / `npm run start:checkin` is better for minimal-path debugging.  
Shared mode is the default for day-to-day use, WeChat + terminal continuity, recovery, and multi-window attach.

## License

This project is released under `AGPL-3.0-only`.  
If you modify it and provide it as a networked service to users, you must provide the corresponding source code to those users under AGPL terms.
