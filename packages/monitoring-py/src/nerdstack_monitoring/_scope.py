"""What is known when an error happens: the user, tags, the request being
handled, and the breadcrumbs leading up to it.

One process-wide scope, and each request or job gets its own copy through
``contextvars``, so one request's user and breadcrumbs never reach another
request's error. Context variables follow ``asyncio`` tasks and threads
started with ``contextvars.copy_context``.
"""

from __future__ import annotations

import contextlib
import contextvars
from collections import deque
from datetime import datetime, timezone
from typing import Any

MAX_BREADCRUMBS = 100


class Scope:
    def __init__(self) -> None:
        self.user: dict[str, str] | None = None
        self.tags: dict[str, str] = {}
        self.breadcrumbs: deque[dict[str, Any]] = deque(maxlen=MAX_BREADCRUMBS)
        self.request: dict[str, Any] | None = None
        self.transaction: str | None = None

    def fork(self) -> Scope:
        scope = Scope()
        scope.user = dict(self.user) if self.user else None
        scope.tags = dict(self.tags)
        scope.breadcrumbs.extend(list(self.breadcrumbs)[-20:])
        return scope

    def add_breadcrumb(self, crumb: dict[str, Any]) -> None:
        crumb = {k: v for k, v in crumb.items() if v is not None}
        crumb.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
        self.breadcrumbs.append(crumb)

    # Small API handed to `with monitoring.new_scope() as scope:`.
    def set_user(self, user: dict[str, Any] | None) -> None:
        self.user = {k: str(v) for k, v in user.items() if v is not None and k in ("id", "username", "email")} if user else None

    def set_tag(self, key: str, value: object) -> None:
        self.tags[str(key)] = str(value)

    def set_transaction(self, name: str | None) -> None:
        self.transaction = name


_GLOBAL = Scope()
_current: contextvars.ContextVar[Scope | None] = contextvars.ContextVar("nerdstack_monitoring_scope", default=None)


def current_scope() -> Scope:
    return _current.get() or _GLOBAL


def push_scope(scope: Scope | None = None) -> contextvars.Token[Scope | None]:
    return _current.set(scope or current_scope().fork())


def pop_scope(token: contextvars.Token[Scope | None]) -> None:
    # Reset from another context (a scope left open across tasks): leave it.
    with contextlib.suppress(ValueError):
        _current.reset(token)


def reset_global_scope() -> None:
    """Tests only."""
    global _GLOBAL
    _GLOBAL = Scope()
    _current.set(None)
