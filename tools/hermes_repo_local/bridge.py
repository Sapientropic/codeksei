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
import inspect
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional


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


def _origin_from_env() -> Dict[str, str]:
    thread_id = (
        os.environ.get("HERMES_SESSION_THREAD_ID", "")
        or os.environ.get("HERMES_CRON_AUTO_DELIVER_THREAD_ID", "")
    )
    return {
        "platform": str(os.environ.get("HERMES_SESSION_PLATFORM", "")).strip(),
        "chat_id": str(os.environ.get("HERMES_SESSION_CHAT_ID", "")).strip(),
        "thread_id": str(thread_id or "").strip(),
        "user_id": str(os.environ.get("HERMES_SESSION_USER_ID", "")).strip(),
        "user_name": str(os.environ.get("HERMES_SESSION_USER_NAME", "")).strip(),
        "chat_name": str(os.environ.get("HERMES_SESSION_CHAT_NAME", "")).strip(),
        "chat_type": "dm",
    }


def _resolve_origin_context(hermes_home: Path, session_key: str) -> Dict[str, Any]:
    # Repo-local cron/reminder writes only need origin at create/update time.
    # Once the job is stored, Hermes runtime delivery resolves `deliver="origin"`
    # from the persisted job.origin payload instead of reloading live session state.
    if session_key:
        try:
            entry = _load_session_entry(hermes_home, session_key)
            return {
                "origin": _normalize_origin(entry.get("origin") or {}),
                "session_id": str(entry.get("session_id") or "").strip(),
                "session_key": str(entry.get("session_key") or session_key or "").strip(),
            }
        except Exception:
            pass

    origin = _origin_from_env()
    if origin.get("platform") and origin.get("chat_id"):
        return {
            "origin": origin,
            "session_id": "",
            "session_key": session_key,
        }

    raise RuntimeError(
        "missing Hermes origin context; need HERMES_SESSION_KEY + sessions.json or cron/session env routing metadata"
    )


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


def _handle_send_file(request: Dict[str, Any], origin_context: Dict[str, Any]) -> Dict[str, Any]:
    payload = request.get("payload") or {}
    if not isinstance(payload, dict):
        raise RuntimeError("send_file payload must be an object")
    file_path = str(payload.get("file_path") or "").strip()
    if not file_path:
        raise RuntimeError("send_file payload is missing file_path")
    resolved_path = str(Path(file_path).expanduser().resolve())
    if not Path(resolved_path).is_file():
        raise RuntimeError(f"file not found: {resolved_path}")

    origin = origin_context["origin"]
    send_result = asyncio.run(_send_file_async(origin, resolved_path))
    mirrored = _mirror_media_delivery(origin, resolved_path)
    return {
        "file_path": resolved_path,
        "send_result": send_result,
        "session_key": str(origin_context.get("session_key") or request.get("session_key") or ""),
        "session_id": str(origin_context.get("session_id") or ""),
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


def _handle_create_reminder(request: Dict[str, Any], origin_context: Dict[str, Any]) -> Dict[str, Any]:
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

    origin = origin_context["origin"]
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
        "session_key": str(origin_context.get("session_key") or request.get("session_key") or ""),
        "session_id": str(origin_context.get("session_id") or ""),
        "origin": origin,
    }


def _normalize_iso_timestamp(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).isoformat()
    except ValueError:
        return ""


def _parse_iso_datetime(value: Any) -> Optional[datetime]:
    text = _normalize_iso_timestamp(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _is_future_job(job: Dict[str, Any], now: datetime) -> bool:
    next_run = _parse_iso_datetime(job.get("next_run_at"))
    return bool(next_run and next_run > now)


def _normalize_checkin_role(value: Any) -> str:
    text = str(value or "").strip().lower()
    return text if text in {"wake", "recovery"} else ""


def _normalize_job_env(value: Any) -> Dict[str, str]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise RuntimeError("sync_checkin_cron payload env must be an object")
    normalized: Dict[str, str] = {}
    for raw_key, raw_value in value.items():
        key = str(raw_key or "").strip()
        if not key:
            continue
        normalized[key] = str(raw_value if raw_value is not None else "")
    return normalized


def _build_checkin_job_updates(
    *,
    due_at_iso: str,
    env: Dict[str, str],
    name: str,
    origin: Dict[str, str],
    prompt: str,
    role: str,
    sender_id: str,
    target_key: str,
    workspace_root: str,
) -> Dict[str, Any]:
    from cron.jobs import parse_schedule

    schedule = parse_schedule(due_at_iso)
    # Keep origin/deliver on every update so bare cron runs can still deliver
    # to the original Weixin chat without needing a session lookup at send time.
    return {
        "codeksei_checkin_role": role,
        "codeksei_checkin_target_key": target_key,
        "codeksei_sender_id": sender_id,
        "codeksei_workspace_root": workspace_root,
        "deliver": "origin",
        "enabled": True,
        "env": env,
        "name": name,
        "origin": {
            "platform": origin["platform"],
            "chat_id": origin["chat_id"],
            "chat_name": origin.get("chat_name") or None,
            "thread_id": origin.get("thread_id") or None,
        },
        "paused_at": None,
        "paused_reason": None,
        "prompt": prompt,
        "schedule": schedule,
        "schedule_display": schedule.get("display", due_at_iso),
        "skill": "codeksei-companion",
        "skills": ["codeksei-companion"],
        "state": "scheduled",
    }


def _supports_kwarg(func: Any, name: str) -> bool:
    try:
        return name in inspect.signature(func).parameters
    except (TypeError, ValueError):
        return False


def _create_checkin_job(
    *,
    create_job: Any,
    deliver: str,
    env: Dict[str, str],
    name: str,
    origin: Dict[str, str],
    prompt: str,
    skills: list[str],
    due_at_iso: str,
) -> Dict[str, Any]:
    kwargs: Dict[str, Any] = {
        "prompt": prompt,
        "schedule": due_at_iso,
        "name": name,
        "repeat": 1,
        "deliver": deliver,
        "origin": origin,
        "skills": skills,
    }
    # Hermes upstream releases before the cron-env patch do not accept an
    # `env` kwarg on create_job. Hosted check-in commands now self-bootstrap
    # from codeksei.config.json, so we degrade gracefully instead of failing
    # the whole re-arm flow on an older Hermes checkout.
    if env and _supports_kwarg(create_job, "env"):
        kwargs["env"] = env
    return create_job(**kwargs)


def _update_checkin_job(
    *,
    job_id: str,
    updates: Dict[str, Any],
    update_job: Any,
) -> Dict[str, Any]:
    try:
        return update_job(job_id, updates)
    except TypeError as exc:
        if "env" not in updates or "env" not in str(exc):
            raise
        fallback_updates = dict(updates)
        fallback_updates.pop("env", None)
        return update_job(job_id, fallback_updates)


def _handle_sync_checkin_cron(request: Dict[str, Any], origin_context: Dict[str, Any]) -> Dict[str, Any]:
    from cron.jobs import create_job, list_jobs, remove_job, update_job

    payload = request.get("payload") or {}
    if not isinstance(payload, dict):
        raise RuntimeError("sync_checkin_cron payload must be an object")

    due_at_iso = _normalize_iso_timestamp(payload.get("due_at_iso"))
    env = _normalize_job_env(payload.get("env"))
    prompt = str(payload.get("prompt") or "").strip()
    role = _normalize_checkin_role(payload.get("role"))
    target_key = str(payload.get("target_key") or "").strip()
    workspace_root = str(payload.get("workspace_root") or "").strip()
    sender_id = str(payload.get("sender_id") or "").strip()
    name = str(payload.get("name") or "").strip()

    if not due_at_iso:
        raise RuntimeError("sync_checkin_cron payload is missing due_at_iso")
    if not prompt:
        raise RuntimeError("sync_checkin_cron payload is missing prompt")
    if not role:
        raise RuntimeError("sync_checkin_cron payload role must be wake or recovery")
    if not target_key:
        raise RuntimeError("sync_checkin_cron payload is missing target_key")
    if not workspace_root:
        raise RuntimeError("sync_checkin_cron payload is missing workspace_root")
    if not sender_id:
        raise RuntimeError("sync_checkin_cron payload is missing sender_id")
    if not name:
        raise RuntimeError("sync_checkin_cron payload is missing name")

    origin = origin_context["origin"]
    if not origin["platform"] or not origin["chat_id"]:
        raise RuntimeError("current Hermes session is missing origin platform/chat_id")

    now = datetime.now().astimezone()
    managed_jobs = []
    for job in list_jobs(include_disabled=True):
        if not isinstance(job, dict):
            continue
        if str(job.get("codeksei_checkin_target_key") or "").strip() != target_key:
            continue
        if not _is_future_job(job, now):
            continue
        managed_jobs.append(job)

    desired_job = None
    stale_jobs = []
    for job in managed_jobs:
        job_role = _normalize_checkin_role(job.get("codeksei_checkin_role"))
        if job_role == role and desired_job is None:
            desired_job = job
            continue
        stale_jobs.append(job)

    updates = _build_checkin_job_updates(
        due_at_iso=due_at_iso,
        env=env,
        name=name,
        origin=origin,
        prompt=prompt,
        role=role,
        sender_id=sender_id,
        target_key=target_key,
        workspace_root=workspace_root,
    )
    created = False
    if desired_job:
        job = _update_checkin_job(
            job_id=str(desired_job.get("id") or "").strip(),
            updates=updates,
            update_job=update_job,
        )
    else:
        created = True
        created_job = _create_checkin_job(
            create_job=create_job,
            deliver="origin",
            env=env,
            name=name,
            origin={
                "platform": origin["platform"],
                "chat_id": origin["chat_id"],
                "chat_name": origin.get("chat_name") or None,
                "thread_id": origin.get("thread_id") or None,
            },
            prompt=prompt,
            skills=["codeksei-companion"],
            due_at_iso=due_at_iso,
        )
        job = _update_checkin_job(
            job_id=str(created_job.get("id") or "").strip(),
            updates=updates,
            update_job=update_job,
        )

    removed_job_ids = []
    # Only prune stale future jobs after the desired wake/recovery job already
    # exists. Duplicates are acceptable for one sync cycle; removing the old
    # recovery wake first can strand hosted check-in with zero future jobs if
    # create/update fails midway.
    for stale_job in stale_jobs:
        job_id = str(stale_job.get("id") or "").strip()
        if not job_id:
            continue
        try:
            remove_job(job_id)
            removed_job_ids.append(job_id)
        except Exception:
            continue

    if not job:
        raise RuntimeError("failed to create or update Hermes hosted checkin cron job")

    return {
        "created": created,
        "deliver": str(job.get("deliver") or ""),
        "job_id": str(job.get("id") or ""),
        "name": str(job.get("name") or ""),
        "next_run_at": str(job.get("next_run_at") or ""),
        "removed_job_ids": removed_job_ids,
        "session_key": str(origin_context.get("session_key") or request.get("session_key") or ""),
        "session_id": str(origin_context.get("session_id") or ""),
        "origin": origin,
    }


def main() -> int:
    try:
        request = _load_request()
        _ensure_repo_imports(str(request.get("repo_root") or ""))
        hermes_home = _resolve_hermes_home(request)
        session_key = _resolve_session_key(request)
        origin_context = _resolve_origin_context(hermes_home, session_key)

        action = str(request.get("action") or "").strip()
        if action == "send_file":
            return _emit({"ok": True, "data": _handle_send_file(request, origin_context)})
        if action == "create_reminder":
            return _emit({"ok": True, "data": _handle_create_reminder(request, origin_context)})
        if action == "sync_checkin_cron":
            return _emit({"ok": True, "data": _handle_sync_checkin_cron(request, origin_context)})
        return _error(f"unsupported bridge action: {action}", code="validation_error", exit_code=2)
    except Exception as exc:  # pragma: no cover - exercised via Node contract tests
        return _error(str(exc))


if __name__ == "__main__":
    raise SystemExit(main())
