# Codeksei

[![CI](https://github.com/Sapientropic/codeksei/actions/workflows/ci.yml/badge.svg)](https://github.com/Sapientropic/codeksei/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/codeksei)](https://www.npmjs.com/package/codeksei)
[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-111111.svg)](https://github.com/Sapientropic/codeksei/blob/main/LICENSE)

[中文 README](./README.md)

> A local-first life-assistant agent bridge that connects WeChat, Codex runtime, timeline, diary, review, durable notes, and workspace continuity into one ongoing personal workflow.

`Codeksei` is not a hosted SaaS, and it is not a stateless personality shell.  
It is a local operational layer for keeping state, reconnecting context, and moving work forward across WeChat, terminal sessions, and workspace tools.

> This repository has diverged substantially from the original `cyberboss` README and usage model. Treat this repository’s `README`, `docs/`, and actual code as the current source of truth.

## At a Glance

| Item | What it means |
| --- | --- |
| Positioning | Local-first personal life-assistant bridge |
| Main interfaces | WeChat + `codeksei` CLI |
| Core value | Shared thread, shared state, low-friction re-entry |
| Current package | `codeksei@0.1.0` |
| Compatibility layer | `cyberboss` / `CYBERBOSS_*` / `~/.cyberboss` |

## Why It Is More Than a Chat Shell

- It is designed for continuity, not one-off prompts.
- WeChat and terminal sessions can attach to the same shared thread.
- `timeline`, `diary`, `review`, and `note` are built-in workflows, not afterthought scripts.
- State and tooling stay local, auditable, and modifiable.

## Who It Fits

- People who want WeChat to be the main interaction surface
- People who need the agent to remember thread state, unfinished work, and review clues
- People who prefer local control over hosted products
- People who benefit from low-friction re-entry, especially when executive function is the bottleneck

## Current Capabilities

| Area | What it currently does |
| --- | --- |
| WeChat bridge | QR login, long polling, file send-back, shared-thread attach |
| Codex runtime | Shared `app-server`, thread/session binding, approvals, stop/resume |
| Timeline | Event write, batch write, taxonomy lookup, build, preview, screenshot |
| Diary | Todo, factual timeline, fragments, supplements, summaries |
| Review | nightly / weekly / monthly, with hybrid semantic extraction by default |
| Durable notes | `note:auto`, `note:maybe`, `note:sync` |
| Workspace continuity | workspace bootstrap, project radar, shared-thread recovery by workspace |

## Quick Start

### 1. Fastest install path

If you just want to install and use it:

```bash
npm install -g codeksei
```

If you want source-level customization, debugging, or local script changes:

```bash
git clone https://github.com/Sapientropic/codeksei.git
cd codeksei
npm install
```

### 2. Minimum env setup

Runtime env lookup order:

1. `.env` in the current project directory
2. `.env` in the current state directory

Recommended minimum variables:

```dotenv
CODEKSEI_USER_NAME=YourName
CODEKSEI_USER_GENDER=female
CODEKSEI_ALLOWED_USER_IDS=bridge_observed_sender_id
CODEKSEI_WORKSPACE_ROOT=/absolute/path/to/your/workspace
```

Useful optional variables:

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

Shared mode is the default operational path:

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

Most frequently used terminal commands:

- `npm run login`
- `npm run accounts`
- `npm run shared:start`
- `npm run shared:open`
- `npm run shared:status`
- `npm run shared:watchdog`
- `npm run background:install`
- `npm run background:uninstall`
- `npm run doctor`
- `npm run help`

Common WeChat commands:

- `/bind /absolute/path`
- `/status`
- `/new`
- `/reread`
- `/switch <threadId>`
- `/stop`
- `/yes`
- `/always`
- `/no`
- `/model`
- `/model <id>`
- `/help`

More detailed references:

- [docs/commands.md](./docs/commands.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/release.md](./docs/release.md)

## Naming and Compatibility

`Codeksei` is now the primary public name.

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

### Why not just `npm install -g codeksei`?

You can. `codeksei@0.1.0` is already on npm.  
Use npm if you only want to install it; clone the repository when you want customization, debugging, or source-level changes.

### Should I use `codeksei` or `cyberboss`?

New setups and current docs should use `Codeksei / codeksei / CODEKSEI_*`.  
The old naming still exists only as a compatibility layer for existing local state and scripts.

### How is shared mode different from `npm run start`?

`npm run start` / `npm run start:checkin` is better for minimal-path debugging.  
Shared mode is the default for daily use, WeChat + terminal continuity, recovery, and multi-window attach.

## License

This project is released under `AGPL-3.0-only`.  
If you modify it and provide it as a networked service to users, you must provide the corresponding source code to those users under AGPL terms.
