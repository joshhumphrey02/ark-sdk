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


def _optional_string(value: object) -> str | None:
    return value if isinstance(value, str) else None
