"""REST client: one retry for a request that never reached the panel, none for an answer."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import aiohttp
import pytest

from custom_components.controlfreak.api import CannotConnect, ControlFreakApi

HEALTH = {"name": "ControlFreak", "status": "healthy", "version": "1.0.13"}


class _Resp:
    def __init__(self, body: Any) -> None:
        self._body = body

    def raise_for_status(self) -> None:
        return None

    async def json(self, content_type: str | None = None) -> Any:
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class _Session:
    """Each GET takes the next outcome: an exception is raised, anything else is the body."""

    def __init__(self, *outcomes: Any) -> None:
        self.outcomes = list(outcomes)
        self.calls = 0

    async def get(self, url: str) -> _Resp:
        self.calls += 1
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome if isinstance(outcome, _Resp) else _Resp(outcome)


def _api(session: _Session) -> ControlFreakApi:
    return ControlFreakApi(session, "panel.test", 8000)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "lost",
    [TimeoutError(), aiohttp.ClientConnectionError(), aiohttp.ServerDisconnectedError()],
)
async def test_one_lost_request_is_retried(lost: Exception) -> None:
    session = _Session(lost, HEALTH)
    assert await _api(session).async_get_health() == HEALTH
    assert session.calls == 2


async def test_two_lost_requests_fail() -> None:
    session = _Session(TimeoutError(), TimeoutError(), HEALTH)
    with pytest.raises(CannotConnect, match=r"GET /health failed: TimeoutError"):
        await _api(session).async_get_health()
    assert session.calls == 2


@pytest.mark.parametrize(
    "answer",
    [
        aiohttp.ClientResponseError(MagicMock(), (), status=500),
        _Resp(ValueError("not json")),
    ],
)
async def test_an_answer_is_not_retried(answer: Any) -> None:
    session = _Session(answer, HEALTH)
    with pytest.raises(CannotConnect):
        await _api(session).async_get_health()
    assert session.calls == 1
