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
  <h3>Capture daily life, steady the rhythm, and keep projects moving with you</h3>
  <p><strong>A local-first life assistant and companion.</strong></p>
  <p>It catches the pieces most likely to be missed: WeChat thoughts, reminders, todos, timeline facts, review clues, and scattered daily fragments, then turns them into steadier rhythm and more concrete project follow-through.</p>
  <p>
    <a href="#why-the-name">Why the Name</a> ·
    <a href="#quick-start">Quick Start</a> ·
    <a href="#what-it-can-do">Capabilities</a> ·
    <a href="./docs/commands.md">Commands</a> ·
    <a href="./docs/architecture.md">Architecture</a> ·
    <a href="./docs/release.md">Release</a>
  </p>
</div>

> This repository has diverged substantially from the original `cyberboss` README and usage model. Treat this repository’s `README`, `docs/`, and actual code as the current source of truth.

| Main interfaces | What it feels like | Current status |
| --- | --- | --- |
| WeChat + `codeksei` | a local life assistant for ADHD-friendly companionship, care, proactive capture, and rhythm calibration | `codeksei@0.1.1`, with compatibility for `cyberboss` / `CYBERBOSS_*` / `~/.cyberboss` |

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

## What It Helps With

- It proactively captures and organizes messy daily fragments before they disappear.
- Reminders, diary, timeline, and review can work together to help steady life rhythm over time.
- Project follow-through, fragment capture, and later organization stay on the same chain.
- WeChat and terminal sessions can share the same state so the care does not break when the surface changes.

## Who It Fits

- People who want help looking after messy daily life, reminders, and unfinished loops
- People with ADHD or executive-function friction who benefit from steady companionship and gentle external support
- People who want projects, daily capture, and review to live in one workflow
- People who want WeChat as the main interaction surface while keeping things local and editable

## What It Can Do

- `Diary`: todos, factual timeline, fragments, supplements, summaries, and gradual daily capture
- `Reminders`: reminder write and scheduling support for rhythm and follow-through
- `Review`: nightly / weekly / monthly review, with hybrid semantic extraction by default
- `Timeline`: event write, batch write, taxonomy lookup, build, preview, screenshot
- `WeChat bridge`: QR login, long polling, file send-back, shared-thread attach
- `Codex runtime`: shared `app-server`, thread/session binding, approvals, stop/resume
- `Durable notes`: `note:auto`, `note:maybe`, `note:sync`
- `Project support`: workspace bootstrap, project radar, shared-thread recovery by workspace

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

## Naming and Compatibility

`Codeksei` is now the primary public name, while legacy entrypoints remain for compatibility.

- Primary package name: `codeksei`
- Primary CLI name: `codeksei`
- Primary env prefix: `CODEKSEI_*`
- Primary state directory: `~/.codeksei`

Compatibility is still preserved for existing local setups:

- Legacy CLI: `cyberboss`
- Legacy env prefix: `CYBERBOSS_*`
- Legacy state directory: `~/.cyberboss`

Rules:

- New-prefixed env vars override legacy-prefixed env vars
- If `~/.codeksei` does not exist but `~/.cyberboss` does, the runtime reuses the legacy state directory
- Windows scheduled tasks are installed as `Codeksei Shared *` and remove legacy `Cyberboss Shared *` task names during reinstall

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
If you only want the timeline runtime and not the WeChat/life-assistant stack, you can use that upstream project directly.

## Upstream Acknowledgement

Thanks to [`WenXiaoWendy/cyberboss`](https://github.com/WenXiaoWendy/cyberboss) for open-sourcing the original repository.  
Codeksei grew from that base, but this version has been substantially reworked. Please treat this repository’s README, `docs/`, and actual code as the source of truth for current behavior.

## FAQ

### Can I install it with `npm install -g codeksei`?

You can.
Use that path when you want the base CLI quickly; clone the repository when you want the full shared-mode flow from this README, source-level customization, or shared-script debugging.

### Should I use `codeksei` or `cyberboss`?

New setups and current docs should use `Codeksei / codeksei / CODEKSEI_*`.  
The old naming still exists only as a compatibility layer for existing local state and scripts.

### How is shared mode different from `npm run start`?

`npm run start` / `npm run start:checkin` is better for minimal-path debugging.  
Shared mode is the default for daily use, WeChat + terminal continuity, recovery, and multi-window attach.

## License

This project is released under `AGPL-3.0-only`.  
If you modify it and provide it as a networked service to users, you must provide the corresponding source code to those users under AGPL terms.
