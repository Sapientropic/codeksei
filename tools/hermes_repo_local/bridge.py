#!/usr/bin/env python3
"""Thin Hermes repo-local bridge for Codeksei hosted workflows.

This shim intentionally stays small:
- resolve the active Hermes session via HERMES_SESSION_KEY + sessions.json
- send a local file back to the current Weixin origin chat
- create a one-shot Hermes cron reminder that delivers to origin

It does not re-implement Hermes delivery, context_token, or cron internals.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict


def _emit(payload: Dict[str, Any], exit_code: int = 0) -> int:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()
    return exit_code


def _error(message: str, code: str = "bridge_error", exit_code: int = 1) -> int:
    return _emit(
        {
            "ok": False,
            "error": {
                "code": code,
                "message": message,
            },
        },
        exit_code=exit_code,
    )


def _load_request() -> Dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("bridge request is empty")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("bridge request must be a JSON object")
    return payload


def _ensure_repo_imports(repo_root: str) -> None:
    if not repo_root:
        return
    normalized = str(Path(repo_root).resolve())
    if normalized not in sys.path:
        sys.path.insert(0, normalized)


def _resolve_session_key(request: Dict[str, Any]) -> str:
    return str(request.get("session_key") or os.environ.get("HERMES_SESSION_KEY", "")).strip()


def _resolve_hermes_home(request: Dict[str, Any]) -> Path:
    raw = str(request.get("hermes_home") or os.environ.get("HERMES_HOME", "")).strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return (Path.home() / ".hermes").resolve()


def _load_session_entry(hermes_home: Path, session_key: str) -> Dict[str, Any]:
    if not session_key:
        raise RuntimeError("missing HERMES_SESSION_KEY; repo-local bridge needs an active Hermes session")
    sessions_index = hermes_home / "sessions" / "sessions.json"
    if not sessions_index.exists():
        raise RuntimeError(f"Hermes sessions index not found: {sessions_index}")
    data = json.loads(sessions_index.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError(f"invalid Hermes sessions index: {sessions_index}")
    entry = data.get(session_key)
    if not isinstance(entry, dict):
        raise RuntimeError(f"active Hermes session not found in sessions.json for key: {session_key}")
    origin = entry.get("origin")
    if not isinstance(origin, dict):
        raise RuntimeError(f"Hermes session {session_key} is missing origin metadata")
    return entry


def _normalize_origin(origin: Dict[str, Any]) -> Dict[str, str]:
    return {
        "platform": str(origin.get("platform") or "").strip(),
        "chat_id": str(origin.get("chat_id") or "").strip(),
        "thread_id": str(origin.get("thread_id") or "").strip(),
        "user_id": str(origin.get("user_id") or "").strip(),
        "user_name": str(origin.get("user_name") or "").strip(),
        "chat_name": str(origin.get("chat_name") or "").strip(),
        "chat_type": str(origin.get("chat_type") or "").strip(),
    }


def _resolve_weixin_platform_config() -> Any:
    from gateway.config import Platform, load_gateway_config

    config = load_gateway_config()
    platform_config = config.platforms.get(Platform.WEIXIN)
    if not platform_config or not getattr(platform_config, "enabled", False):
        raise RuntimeError("Hermes Weixin platform is not configured/enabled")
    return platform_config


def _mirror_media_delivery(origin: Dict[str, str], file_path: str) -> bool:
    from gateway.mirror import mirror_to_session
    from tools.send_message_tool import _describe_media_for_mirror

    description = _describe_media_for_mirror([(file_path, False)])
    if not description:
        description = "[Sent document attachment]"
    return bool(
        mirror_to_session(
            origin["platform"],
            origin["chat_id"],
            description,
            source_label="codeksei",
            thread_id=origin["thread_id"] or None,
        )
    )


async def _send_file_async(origin: Dict[str, str], file_path: str) -> Dict[str, Any]:
    from gateway.platforms.weixin import check_weixin_requirements, send_weixin_direct

    if origin["platform"].lower() != "weixin":
        raise RuntimeError(
            f"repo-local file send currently only supports Hermes Weixin sessions; got {origin['platform'] or '(empty)'}"
        )
    if not check_weixin_requirements():
        raise RuntimeError("Hermes Weixin adapter requirements are missing (need aiohttp + cryptography)")

    platform_config = _resolve_weixin_platform_config()
    result = await send_weixin_direct(
        extra=getattr(platform_config, "extra", {}) or {},
        token=getattr(platform_config, "token", None),
        chat_id=origin["chat_id"],
        message="",
        media_files=[(file_path, False)],
    )
    if isinstance(result, dict) and result.get("error"):
        raise RuntimeError(str(result.get("error")))
    return result if isinstance(result, dict) else {"success": True}


def _handle_send_file(request: Dict[str, Any], session_entry: Dict[str, Any]) -> Dict[str, Any]:
    payload = request.get("payload") or {}
    if not isinstance(payload, dict):
        raise RuntimeError("send_file payload must be an object")
    file_path = str(payload.get("file_path") or "").strip()
    if not file_path:
        raise RuntimeError("send_file payload is missing file_path")
    resolved_path = str(Path(file_path).expanduser().resolve())
    if not Path(resolved_path).is_file():
        raise RuntimeError(f"file not found: {resolved_path}")

    origin = _normalize_origin(session_entry.get("origin") or {})
    send_result = asyncio.run(_send_file_async(origin, resolved_path))
    mirrored = _mirror_media_delivery(origin, resolved_path)
    return {
        "file_path": resolved_path,
        "send_result": send_result,
        "session_key": str(session_entry.get("session_key") or request.get("session_key") or ""),
        "session_id": str(session_entry.get("session_id") or ""),
        "origin": origin,
        "mirrored": mirrored,
    }


def _build_reminder_name(origin: Dict[str, str], text: str, due_at_iso: str, workspace_root: str, sender_id: str) -> str:
    digest = hashlib.sha256(
        "|".join([
            workspace_root.strip(),
            sender_id.strip() or origin.get("user_id", "").strip(),
            text.strip(),
            due_at_iso.strip(),
        ]).encode("utf-8")
    ).hexdigest()[:10]
    preview = " ".join(text.split())
    if len(preview) > 24:
        preview = preview[:21].rstrip() + "..."
    name = f"ck-reminder-{digest} {preview}".strip()
    return name[:50]


def _build_reminder_prompt(text: str) -> str:
    return (
        "[SYSTEM: This reminder was scheduled by Codeksei. "
        "When this cron job runs, respond with exactly the reminder body below. "
        "Do not add greeting, explanation, markdown, quote marks, or any extra text.]\n\n"
        f"{text.strip()}"
    )


def _handle_create_reminder(request: Dict[str, Any], session_entry: Dict[str, Any]) -> Dict[str, Any]:
    from cron.jobs import create_job

    payload = request.get("payload") or {}
    if not isinstance(payload, dict):
        raise RuntimeError("create_reminder payload must be an object")

    due_at_iso = str(payload.get("due_at_iso") or "").strip()
    reminder_text = str(payload.get("text") or "").strip()
    workspace_root = str(payload.get("workspace_root") or "").strip()
    explicit_sender_id = str(payload.get("sender_id") or "").strip()
    if not due_at_iso:
        raise RuntimeError("create_reminder payload is missing due_at_iso")
    if not reminder_text:
        raise RuntimeError("create_reminder payload is missing text")

    origin = _normalize_origin(session_entry.get("origin") or {})
    if not origin["platform"] or not origin["chat_id"]:
        raise RuntimeError("current Hermes session is missing origin platform/chat_id")

    job = create_job(
        prompt=_build_reminder_prompt(reminder_text),
        schedule=due_at_iso,
        name=_build_reminder_name(origin, reminder_text, due_at_iso, workspace_root, explicit_sender_id),
        repeat=1,
        deliver="origin",
        origin={
            "platform": origin["platform"],
            "chat_id": origin["chat_id"],
            "chat_name": origin["chat_name"] or None,
            "thread_id": origin["thread_id"] or None,
        },
    )
    return {
        "job_id": str(job.get("id") or ""),
        "name": str(job.get("name") or ""),
        "deliver": str(job.get("deliver") or ""),
        "next_run_at": str(job.get("next_run_at") or ""),
        "session_key": str(session_entry.get("session_key") or request.get("session_key") or ""),
        "session_id": str(session_entry.get("session_id") or ""),
        "origin": origin,
    }


def main() -> int:
    try:
        request = _load_request()
        _ensure_repo_imports(str(request.get("repo_root") or ""))
        hermes_home = _resolve_hermes_home(request)
        session_key = _resolve_session_key(request)
        session_entry = _load_session_entry(hermes_home, session_key)
        session_entry.setdefault("session_key", session_key)

        action = str(request.get("action") or "").strip()
        if action == "send_file":
            return _emit({"ok": True, "data": _handle_send_file(request, session_entry)})
        if action == "create_reminder":
            return _emit({"ok": True, "data": _handle_create_reminder(request, session_entry)})
        return _error(f"unsupported bridge action: {action}", code="validation_error", exit_code=2)
    except Exception as exc:  # pragma: no cover - exercised via Node contract tests
        return _error(str(exc))


if __name__ == "__main__":
    raise SystemExit(main())
