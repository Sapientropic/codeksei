# Codeksei

[![CI](https://github.com/Sapientropic/codeksei/actions/workflows/ci.yml/badge.svg)](https://github.com/Sapientropic/codeksei/actions/workflows/ci.yml)

[中文 README](./README.md)

Codeksei is a local-first life-assistant agent bridge.  
It connects Codex runtime, WeChat messaging, timeline, diary, review, durable notes, and workspace continuity into one operational loop so the agent can keep state, reconnect context, and carry work forward instead of acting like a stateless chat shell.

This repository is no longer a lightly modified fork whose original README still applies. The current codebase has been heavily reshaped around shared app-server lifecycle management, WeChat v2 routing and delivery hardening, timeline/diary/review tooling, durable note routing, workspace bootstrap, and project radar. The documentation below describes this repository as it exists today.

## What It Is

- A personal, locally deployed life-assistant bridge, not a hosted SaaS.
- A runtime that links WeChat conversations, Codex threads, timeline events, diaries, reviews, and lightweight project memory.
- A system designed for real continuity and low-friction re-entry, especially when executive function is the bottleneck.

## Current Capabilities

- WeChat bridge: QR login, long polling, file send-back, shared thread attach
- Codex runtime: shared `app-server`, thread/session binding, approvals, stop/resume
- Timeline: event write, batch write, taxonomy lookup, build/serve/screenshot
- Diary: Todo, factual timeline, fragments, supplements, summaries
- Review: nightly / weekly / monthly, with hybrid semantic pass by default
- Durable notes: `note:auto`, `note:maybe`, `note:sync`
- Workspace continuity: workspace bootstrap, project radar, shared-thread recovery

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

- New-prefixed env vars override legacy-prefixed env vars.
- If `~/.codeksei` does not exist but `~/.cyberboss` does, the runtime will reuse the legacy state directory.
- Windows scheduled tasks are installed as `Codeksei Shared *` and remove legacy `Cyberboss Shared *` task names during reinstall.

## Quick Start

### 1. Clone and install

The default path is still to clone and run locally. The repository now includes GitHub Actions CI and an npm publish workflow, but until the first package release exists, clone-based local usage remains the primary install path:

```bash
git clone https://github.com/Sapientropic/codeksei.git
cd codeksei
npm install
```

### 2. Configure env vars

Recommended minimum setup:

```dotenv
CODEKSEI_USER_NAME=YourName
CODEKSEI_USER_GENDER=female
CODEKSEI_ALLOWED_USER_IDS=your-wechat-user-id
CODEKSEI_WORKSPACE_ROOT=/absolute/path/to/your/workspace
```

Useful optional variables:

```dotenv
CODEKSEI_ACCOUNT_ID=
CODEKSEI_CODEX_ENDPOINT=ws://127.0.0.1:8765
CODEKSEI_WEIXIN_ADAPTER=v2
CODEKSEI_WEIXIN_REPLY_MODE=stream
CODEKSEI_DIARY_DIR=/absolute/path/to/your/vault/diary
CODEKSEI_TIMELINE_STATE_DIR=/absolute/path/to/your/vault/.codex/timeline
CODEKSEI_WORKSPACE_BOOTSTRAP_CONFIG=/absolute/path/to/workspace-bootstrap.json
CODEKSEI_PROJECT_RADAR_CONFIG=/absolute/path/to/.codex/code-projects.json
CODEKSEI_DURABLE_NOTE_SCHEMA_CONFIG=/absolute/path/to/.codex/durable-note-schema.json
CODEKSEI_REVIEW_SCHEMA_CONFIG=/absolute/path/to/.codex/review-schema.json
```

Legacy `CYBERBOSS_*` variables still work, but new setups should move to `CODEKSEI_*`.

### 3. Login

```bash
npm run login
```

### 4. Start shared mode

Shared mode is the default operational path:

```bash
npm run shared:start
```

Attach your current WeChat-bound thread from the terminal:

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

Most frequently used local commands:

- `npm run login`
- `npm run accounts`
- `npm run shared:start`
- `npm run shared:open`
- `npm run shared:status`
- `npm run shared:watchdog`
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

## Release and CI

The repository now includes GitHub Actions CI and an npm publish workflow.  
The canonical release instructions, required secrets, tag rules, and slug-migration constraints live in:

- [docs/release.md](./docs/release.md)

## Local State

Primary state directory:

```text
~/.codeksei
```

Legacy-compatible state directory:

```text
~/.cyberboss
```

Typical contents:

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

## Timeline Can Be Used Separately

Codeksei builds its timeline layer on top of [`timeline-for-agent`](https://github.com/WenXiaoWendy/timeline-for-agent).  
If you only want the timeline runtime and not the WeChat/life-assistant stack, you can use that upstream project directly.

## Upstream Acknowledgement

Thanks to [`WenXiaoWendy/cyberboss`](https://github.com/WenXiaoWendy/cyberboss) for open-sourcing the original repository.  
Codeksei grew from that base, but this version has been substantially reworked. Please treat this repository’s README, `docs/`, and actual code as the source of truth for current behavior.

## FAQ

### Why not `npm install codeksei` directly?

Because the primary install path is still local clone + run.  
CI and npm publish automation are now in place, but the first public release still requires `NPM_TOKEN` and a release/tag flow.

## License

This project is released under `AGPL-3.0-only`.  
If you modify it and provide it as a networked service to users, you must provide the corresponding source code to those users under AGPL terms.
