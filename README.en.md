# Codeksei

<div align="center">
  <p>
    <a href="./README.md">中文 README</a>
  </p>
  <p>
    <a href="https://github.com/Sapientropic/codeksei/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Sapientropic/codeksei/actions/workflows/ci.yml/badge.svg"></a>
    <a href="https://www.npmjs.com/package/codeksei"><img alt="npm version" src="https://img.shields.io/npm/v/codeksei"></a>
    <a href="https://github.com/Sapientropic/codeksei/blob/main/LICENSE"><img alt="License: AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-111111.svg"></a>
  </p>
  <h3>It keeps time from blurring, checks in on its own, and helps days and projects come back into shape</h3>
  <p><strong>A local-first companion that stays present and lends a hand first.</strong></p>
  <p>What often breaks first is not the task itself, but your sense of time, the loose thread, and the energy to begin again. Codeksei shows up when it should, and turns what already happened into timeline anchors and memory traces, so you do not have to keep restarting from fog.</p>
  <p>
    <a href="#a-day-with-codeksei">A Day With Codeksei</a> ·
    <a href="#quick-start">Quick Start</a> ·
    <a href="#what-it-can-do">Capabilities</a> ·
    <a href="#why-the-name">Why the Name</a> ·
    <a href="./docs/commands.md">Commands</a> ·
    <a href="./docs/architecture.md">Architecture</a> ·
    <a href="./docs/release.md">Release</a>
  </p>
</div>

| Where you meet it | What it takes off your plate | What you gradually get back |
| --- | --- | --- |
| WeChat + `codeksei` | keeps hold of time, memory anchors, and when to show up | days that blur less easily, and projects that are easier to step back into |

## A Day With Codeksei

| When this happens often | You might say | What it quietly does first | What gets lighter |
| --- | --- | --- | --- |
| At the start of the day | “I’m starting now.” / “Where did that thread stop yesterday?” | It brings back reminders, recent state, project context, and the most reachable next move | You do not have to restart from blankness |
| While moving through the day | You drop thoughts, todos, finished time blocks, and sudden fragments into chat | It keeps what matters: some things become diary, some become timeline, some become reminders for later | Your head does not have to keep brute-forcing memory |
| You look up and half the day seems gone | “What did I even do?” / “Why does today feel like a blur again?” | It turns time blocks, switches, and surviving clues back into a timeline so the day has shape again | Less distortion, less blankness, less shame |
| You have gone quiet for a while | You may not say anything at all, or the line may simply go silent | It weighs whether to check in, follow up, leave a reminder for later, write something down first, or stay quiet | The companionship does not depend on you manually summoning it every time |
| You return to a project and your mind goes blank for a second | “Continue this.” / “Where exactly am I stuck?” | It follows the same thread, project context, and recent actions until the way back in becomes visible again | Re-entry does not require carrying the whole context stack alone |
| You stall, switch, or want to disappear for a bit | “I’m scattered.” / “I want to avoid this.” / “I don’t know what to do first.” | It narrows things back to one reachable move, and may quietly leave a reminder or close a loose loop | Switching costs less, and the whole thread is less likely to collapse |
| The day is closing | You let it help you close out before sleep, before leaving, or after a work block | It compresses the day into timeline, review, and a gentler way back in tomorrow | The thread is still there when you return, and so is the sense of time |

> `Proactive help` is not just more frequent messages.
>
> It keeps hold of time, loose threads, and what already happened. It shows up when it should, and leaves anchors behind so the day does not dissolve into blur.

## What It Can Do

- `Timeline`: time blocks, switches, and lived facts become anchors for memory and time sense instead of fading into a blur
- `Diary`: todos, fragments, supplements, summaries, and timeline-linked facts for daily traces that want to stay
- `Check-ins`: random wake-ups and proactive help; it can message, stay quiet, write something down first, update diary/timeline, or leave a reminder for later
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

| `Code` | `-ksei` |
| --- | --- |
| The quiet shorthand of everyday life.<br>Fleeting thoughts, paused threads, and the texture you meant to remember. | Taken from the latter half of `Aleksei`.<br>Here it carries an image of care, help, and companionship. |

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

Runtime env lookup order:

1. `.env` in the current project directory
2. `.env` in the current state directory

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

- Legacy `CYBERBOSS_*` variables still work, but new setups should use `CODEKSEI_*`
- `CODEKSEI_USER_NAME` is a display/persona field for chat, not a routing id
- `CODEKSEI_ALLOWED_USER_IDS` must use the exact sender ids observed by the bridge; the easiest way to find them is `npm run accounts`
- The first successful run will generate `weixin-instructions.md` in the state directory
- If you use multiple workspaces in shared mode, set `CODEKSEI_WORKSPACE_ROOT` before starting
- `CODEKSEI_TIMEZONE` is optional; when set, it becomes the single local-time contract for reminder / diary / review / timeline flows
- If `CODEKSEI_TIMEZONE` is unset, Codeksei first reuses any non-legacy timezone already declared by the timeline state; otherwise it falls back to the system timezone
- Legacy `Asia/Shanghai` timeline state can be auto-migrated to the unified timezone the next time you run a timeline command
- `CODEKSEI_TIMELINE_STATE_DIR` is the timeline-for-agent state root; the current primary layout stores runtime files under `timeline/*.json`
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
/model <id>
/help
```

More detailed references:

- [docs/commands.md](./docs/commands.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/release.md](./docs/release.md)

## If You Are Coming From `cyberboss`

New setups and current docs use `Codeksei / codeksei / CODEKSEI_*`.

If your local setup still runs on the old name, the compatibility layer is still there:

- the `cyberboss` CLI still works
- `CYBERBOSS_*` variables are still read, with `CODEKSEI_*` taking priority
- if `~/.codeksei` does not exist but `~/.cyberboss` does, the runtime keeps reusing the old state
- Windows scheduled tasks install as `Codeksei Shared *` and clean up legacy `Cyberboss Shared *` names during reinstall

## Local State and Public Boundary

Primary state directory:

```text
~/.codeksei
```

Legacy-compatible state directory:

```text
~/.cyberboss
```

Typical runtime contents:

- `accounts/`
- `sessions.json`
- `sync-buffers/`
- `weixin-instructions.md`
- `workspace-bootstrap.json`
- `reminder-queue.json`
- `system-message-queue.json`
- `timeline-screenshot-queue.json`
- `diary/`
- `timeline/`
- `logs/`

If you set `CODEKSEI_DIARY_DIR` or `CODEKSEI_TIMELINE_STATE_DIR`, business data is stored there and the state directory keeps runtime files only.

The repository and npm package are meant to contain code, scripts, templates, and docs only. Your accounts, sessions, logs, personal `.env`, and local business data should stay outside version control.

## Timeline Can Be Used Separately

Codeksei builds its timeline layer on top of [`timeline-for-agent`](https://github.com/WenXiaoWendy/timeline-for-agent).  
If you only want the timeline runtime and not the WeChat/companion stack, you can use that upstream project directly.

## Upstream Acknowledgement

Thanks to [`WenXiaoWendy/cyberboss`](https://github.com/WenXiaoWendy/cyberboss) for open-sourcing the original repository.  
Codeksei grew from that starting point, and the project is grateful for it.

## FAQ

### Can I install it with `npm install -g codeksei`?

You can.
Use that path when you want the base CLI quickly; clone the repository when you want the full shared-mode flow from this README, source-level customization, or shared-script debugging.

### Should I use `codeksei` or `cyberboss`?

New setups and current docs should use `Codeksei / codeksei / CODEKSEI_*`.
If your machine already runs `cyberboss`, the existing compatibility layer is enough; there is no need for a rushed migration.

### How is shared mode different from `npm run start`?

`npm run start` / `npm run start:checkin` is better for minimal-path debugging.  
Shared mode is the default for daily use, WeChat + terminal continuity, recovery, and multi-window attach.

## License

This project is released under `AGPL-3.0-only`.  
If you modify it and provide it as a networked service to users, you must provide the corresponding source code to those users under AGPL terms.
