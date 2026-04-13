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
  <p><a href="https://zread.ai/Sapientropic/codeksei" target="_blank"><img src="https://img.shields.io/badge/Ask_Zread-_.svg?style=for-the-badge&color=00b0aa&labelColor=000000&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQuOTYxNTYgMS42MDAxSDIuMjQxNTZDMS44ODgxIDEuNjAwMSAxLjYwMTU2IDEuODg2NjQgMS42MDE1NiAyLjI0MDFWNC45NjAxQzEuNjAxNTYgNS4zMTM1NiAxLjg4ODEgNS42MDAxIDIuMjQxNTYgNS42MDAxSDQuOTYxNTZDNS4zMTUwMiA1LjYwMDEgNS42MDE1NiA1LjMxMzU2IDUuNjAxNTYgNC45NjAxVjIuMjQwMUM1LjYwMTU2IDEuODg2NjQgNS4zMTUwMiAxLjYwMDEgNC45NjE1NiAxLjYwMDFaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00Ljk2MTU2IDEwLjM5OTlIMi4yNDE1NkMxLjg4ODEgMTAuMzk5OSAxLjYwMTU2IDEwLjY4NjQgMS42MDE1NiAxMS4wMzk5VjEzLjc1OTlDMS42MDE1NiAxNC4xMTM0IDEuODg4MSAxNC4zOTk5IDIuMjQxNTYgMTQuMzk5OUg0Ljk2MTU2QzUuMzE1MDIgMTQuMzk5OSA1LjYwMTU2IDE0LjExMzQgNS42MDE1NiAxMy43NTk5VjExLjAzOTlDNS42MDE1NiAxMC42ODY0IDUuMzE1MDIgMTAuMzk5OSA0Ljk2MTU2IDEwLjM5OTlaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik0xMy43NTg0IDEuNjAwMUgxMS4wMzg0QzEwLjY4NSAxLjYwMDEgMTAuMzk4NCAxLjg4NjY0IDEwLjM5ODQgMi4yNDAxVjQuOTYwMUMxMC4zOTg0IDUuMzEzNTYgMTAuNjg1IDUuNjAwMSAxMS4wMzg0IDUuNjAwMUgxMy43NTg0QzE0LjExMTkgNS42MDAxIDE0LjM5ODQgNS42MDE1NiA1LjMxMzU2IDUuNjAwMSAxMS4wMzg0IDUuNjAwMUgxMy43NTg0QzE0LjExMTkgNS42MDAxIDE0LjM5ODQgNS4zMTM1NiAxNC4zOTg0IDQuOTYwMVYyLjI0MDFDMTQuMzk4NCAxLjg4NjY0IDE0LjExMTkgMS42MDAxIDEzLjc1ODQgMS42MDAxWiIgZmlsbD0iI2ZmZiIvPgo8cGF0aCBkPSJNNCAxMkwxMiA0TDQgMTJaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00IDEyTDEyIDQiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K&logoColor=ffffff" alt="zread"/></a></p>
  <h3>A local-first companion that helps time hold shape and brings daily life and project threads back within reach</h3>
  <p><strong>It uses WeChat as the main entry and connects timeline, diary, reminders, reviews, and project continuity in one shared thread.</strong></p>
  <p>Codeksei is not just a chat box that waits for prompts. It can help capture what happened, reconnect loose threads, leave reminders, and make it easier to step back into a project while keeping state and logs local by default.</p>
  <p>
    <a href="#try-codeksei">Try It</a> ·
    <a href="#a-day-with-codeksei">A Day With Codeksei</a> ·
    <a href="#quick-start">Quick Start</a> ·
    <a href="#what-it-can-do">Capabilities</a> ·
    <a href="#why-the-name">Why the Name</a> ·
    <a href="./docs/commands.md">Commands</a> ·
    <a href="./docs/architecture.md">Architecture</a>
  </p>
</div>

- **What it is**: a local-first companion that connects daily capture, reminders, reviews, and project continuity through WeChat + `codeksei`
- **Who it fits**: people whose sense of time slips, whose project thread breaks easily, and who want help keeping loose ends in view
- **How to try it**: start with `npm install -g codeksei` for the base CLI, then move into shared mode when you want the fuller experience

<a id="try-codeksei"></a>

## Try It First

If you want the shortest path to see whether Codeksei fits your workflow, start here:

```bash
npm install -g codeksei
codeksei help
```

If you want the fuller shape right away, with WeChat and the terminal attached to the same shared thread:

```bash
git clone https://github.com/Sapientropic/codeksei.git
cd codeksei
npm install
npm run login
npm run shared:start
```

- `Start with the base CLI`: check the command surface, confirm local setup, and feel the product boundary first
- `Move into shared mode`: experience continuity, proactive help, reminders, and project re-entry together
- `Send feedback after trying it`: use [GitHub Issues](https://github.com/Sapientropic/codeksei/issues) to tell us what felt most useful, what felt awkward, and where Codeksei should be more proactive or more restrained

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
- `Check-ins`: random wake-ups and proactive help; it can message, stay quiet, write something down first, update diary/timeline, or leave a reminder for later before deciding whether it should step in
- `Reminders`: reminder write and scheduling support for rhythm and follow-through
- `Review`: nightly / weekly / monthly review, with hybrid semantic extraction by default
- `Project support`: workspace bootstrap, project radar, and shared-thread recovery by workspace, so re-entry does not always start from scratch
- `WeChat bridge`: QR login, long polling, file send-back, shared-thread attach
- `Codex runtime`: shared `app-server`, thread/session binding, approvals, stop/resume
- `Durable notes`: `note:auto`, `note:maybe`, `note:sync`

## Why the Name

<div align="center">
  <p><strong>One name, held in two moods.</strong></p>
</div>

- `Code`: the quiet shorthand of everyday life. Fleeting thoughts, paused threads, and the texture you meant to remember all leave a trace here.
- `-ksei`: taken from the latter half of `Aleksei`. Here it carries an image of care, help, and companionship, like someone walking beside you without making a show of it.

<div align="center">
  <p><em>Your threads are watched over, and returning can still feel warm and continuous.</em></p>
</div>

## Who It Fits

- People who want help looking after messy daily life, reminders, and unfinished loops
- People with ADHD or executive-function friction who benefit from steady companionship and gentle external support
- People whose days blur together and are hard to reconstruct afterward
- People whose project thread feels severed after even a small interruption
- People who want something that proactively checks in and helps carry the thread, instead of waiting to be manually reopened every time
- People who want projects, daily capture, and review to live in one workflow
- People who want WeChat as the main interaction surface while keeping things local and editable

## Quick Start

### 1. Choose your install path

If you want the full shared-mode path described in this README, clone the repository and use `npm run ...`:

```bash
git clone https://github.com/Sapientropic/codeksei.git
cd codeksei
npm install
```

If you only want the base CLI first:

```bash
npm install -g codeksei
codeksei help
```

Notes:

- The command examples below assume a repo checkout and `npm run ...`
- Global install is a good way to try the base CLI; shared-mode scripts are most straightforward from the repository checkout

### 2. Minimum env setup

Runtime env is filled in two stages:

1. Existing process environment stays in place first
2. Load `.env` from the current project directory
3. Recompute the state directory from the now-active `CODEKSEI_STATE_DIR`, then load `.env` from that state directory

Earlier values win. Later `.env` files only fill missing keys and do not overwrite values that already exist. That means a repo `.env` is allowed to define `CODEKSEI_STATE_DIR`, and the state-dir `.env` path is recalculated only after the repo `.env` has been loaded.

Minimum usable variables:

```dotenv
CODEKSEI_USER_NAME=YourName
CODEKSEI_USER_GENDER=female
CODEKSEI_ALLOWED_USER_IDS=bridge_observed_sender_id
CODEKSEI_WORKSPACE_ROOT=/absolute/path/to/your/workspace
```

<details>
<summary>Show common optional environment variables</summary>

```dotenv
CODEKSEI_ACCOUNT_ID=
CODEKSEI_CODEX_ENDPOINT=ws://127.0.0.1:8765
CODEKSEI_WEIXIN_ADAPTER=v2
CODEKSEI_WEIXIN_REPLY_MODE=stream
CODEKSEI_WEIXIN_ROUTE_TAG=
CODEKSEI_WEIXIN_PROTOCOL_CLIENT_VERSION=2.1.1
CODEKSEI_TIMEZONE=Asia/Shanghai
CODEKSEI_DIARY_DIR=/absolute/path/to/your/vault/diary
CODEKSEI_TIMELINE_STATE_DIR=/absolute/path/to/your/vault/.codex/timeline
CODEKSEI_WORKSPACE_BOOTSTRAP_CONFIG=/absolute/path/to/workspace-bootstrap.json
CODEKSEI_PROJECT_RADAR_CONFIG=/absolute/path/to/.codex/code-projects.json
CODEKSEI_DURABLE_NOTE_SCHEMA_CONFIG=/absolute/path/to/.codex/durable-note-schema.json
CODEKSEI_REVIEW_SCHEMA_CONFIG=/absolute/path/to/.codex/review-schema.json
CODEKSEI_SHARED_USE_BUNDLED_CODEX_BINARY=1
CODEKSEI_SHARED_DISABLE_PLUGINS=0
CODEKSEI_SHARED_DISABLE_SHELL_SNAPSHOT=0
```

</details>

Notes:

- `CODEKSEI_WEIXIN_REPLY_MODE=stream` now behaves more like a hybrid stream: it prefers natural sentence boundaries or completed blocks, so unfinished final sentences do not get split into multiple WeChat bubbles
- `CODEKSEI_WEIXIN_REPLY_MODE=settled` still means “wait until the whole turn settles”: only the latest visible final reply is sent
- `CODEKSEI_USER_NAME` is a display/persona field for chat, not a routing id
- `CODEKSEI_ALLOWED_USER_IDS` must use the exact sender ids observed by the bridge; the easiest way to find them is `npm run accounts`
- WeChat persona / continuity instructions now default to the repo template at `templates/weixin-instructions.md`; use `weixin-instructions.local.md` in the state directory only when you need a local overlay
- If you use multiple workspaces in shared mode, set `CODEKSEI_WORKSPACE_ROOT` before starting
- `CODEKSEI_TIMEZONE` is optional; when set, it becomes the single local-time contract for reminder / diary / review / timeline flows
- If `CODEKSEI_TIMEZONE` is unset, Codeksei first reuses any non-legacy timezone already declared by the timeline state; otherwise it falls back to the system timezone
- Legacy `Asia/Shanghai` timeline state can be auto-migrated to the unified timezone the next time you run a timeline command
- `CODEKSEI_TIMELINE_STATE_DIR` points at the Codeksei timeline data root; the current primary layout stores runtime files under `timeline/*.json`
- Keep `.env` local; do not commit it into the repository

### 3. Login

```bash
npm run login
```

### 4. Start shared mode

Shared mode is the better day-to-day path when you want WeChat and terminal sessions attached to the same thread:

```bash
npm run shared:start
```

Attach the current WeChat-bound shared thread:

```bash
npm run shared:open
```

Check status:

```bash
npm run shared:status
```

### 5. Install Windows background tasks

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
npm run login
npm run accounts
npm run shared:start
npm run shared:open
npm run shared:status
npm run doctor
npm run help
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
```

More detailed references:

- [docs/commands.md](./docs/commands.md)
- [docs/architecture.md](./docs/architecture.md)

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

The continuity-critical state files currently covered are `sessions.json`, `reminder-queue.json`, `system-message-queue.json`, and `timeline-screenshot-queue.json`. Those files now use atomic writes, and if JSON parsing or the critical top-level schema is invalid, the original file is moved aside as `*.corrupt-<timestamp>.json` before startup falls back to an empty default state.

If you set `CODEKSEI_DIARY_DIR` or `CODEKSEI_TIMELINE_STATE_DIR`, business data is stored there and the state directory keeps runtime files only.

The default persona / operations templates still ship from the repository under `templates/`; `*.local.md` files in the state directory are overlays for your own machine, not the only source of truth.

The repository and npm package are meant to contain code, scripts, templates, and docs only. Your accounts, sessions, logs, personal `.env`, and local business data should stay outside version control.

## Upstream Acknowledgement

Thanks to [`WenXiaoWendy/cyberboss`](https://github.com/WenXiaoWendy/cyberboss) for open-sourcing the original repository.  
Codeksei grew from that starting point, and the project is grateful for it.

## FAQ

### Can I install it with `npm install -g codeksei`?

You can.
Use that path when you want the base CLI quickly; clone the repository when you want the full shared-mode flow from this README, source-level customization, or shared-script debugging.

### How is shared mode different from `npm run start`?

`npm run start` / `npm run start:checkin` is better for minimal-path debugging.  
Shared mode is the default for daily use, WeChat + terminal continuity, recovery, and multi-window attach.

## License

This project is released under `AGPL-3.0-only`.  
If you modify it and provide it as a networked service to users, you must provide the corresponding source code to those users under AGPL terms.
