from __future__ import annotations

from typing import Any

import httpx


class ArkError(Exception):
    """A normalized Ark REST or upload error."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status: int | None = None,
        request_id: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        # Kept as an attribute, not just handed to Exception. The README
        # documents `error.message`, and only `str(error)` actually worked --
        # so every caller following the docs hit an AttributeError inside
        # their own error handler, which is the worst possible place for one.
        self.message = message
        self.status = status
        self.request_id = request_id
        self.details = details

    @property
    def retryable(self) -> bool:
        return self.code in {"NETWORK_ERROR", "RATE_LIMITED"} or (
            self.status is not None and self.status >= 500
        )


def error_from_response(response: httpx.Response) -> ArkError:
    try:
        body = response.json()
    except ValueError:
        body = {}
    raw_error = body.get("error") if isinstance(body, dict) else None
    envelope = raw_error if isinstance(raw_error, dict) else {}
    status_codes = {
        400: "INVALID_ARGUMENT",
        401: "UNAUTHORIZED",
        402: "QUOTA_EXCEEDED",
        403: "INSUFFICIENT_SCOPE",
        404: "NOT_FOUND",
        429: "RATE_LIMITED",
    }
    return ArkError(
        str(envelope.get("code") or status_codes.get(response.status_code, "INTERNAL_ERROR")),
        str(
            envelope.get("message")
            or (raw_error if isinstance(raw_error, str) else None)
            or f"Request failed with status {response.status_code}"
        ),
        status=response.status_code,
        request_id=_optional_string(envelope.get("requestId")),
        details=envelope.get("details") if isinstance(envelope.get("details"), dict) else None,
    )


def network_error(error: httpx.HTTPError) -> ArkError:
    return ArkError("NETWORK_ERROR", str(error) or "Network request failed")


def upload_error(status: int, *, part_number: int | None = None) -> ArkError:
    if status in {401, 403}:
        return ArkError(
            "UPLOAD_EXPIRED",
            "The upload authorization expired before the transfer finished. Please retry.",
            status=status,
        )
    if status == 413:
        return ArkError(
            "FILE_TOO_LARGE",
            "The file is larger than this upload allows.",
            status=status,
        )
    label = f"part {part_number} " if part_number is not None else ""
    return ArkError("UPLOAD_FAILED", f"Upload {label}failed with status {status}", status=status)


def invalid_argument(message: str) -> ArkError:
    return ArkError("INVALID_ARGUMENT", message)


def invalid_response(message: str) -> ArkError:
    """A 2xx body the SDK could not make sense of.

    Coercing an unrecognised shape to an empty list is what turned a one-line
    parsing bug into a workflow that could never succeed: `list()` reported no
    folders, `create()` then refused because the folder was already there, and
    nothing anywhere raised. Failing loudly here means the next such mismatch
    is a stack trace pointing at the response, not a silent wrong answer.
    """
    return ArkError("INVALID_RESPONSE", message)


def _optional_string(value: object) -> str | None:
    return value if isinstance(value, str) else None
