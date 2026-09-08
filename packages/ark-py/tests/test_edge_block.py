"""A challenge page from a CDN in front of Ark must not read as a token problem.

Regression test for a real incident: a customer's Netlify functions were
challenged by Cloudflare bot protection, and the SDK reported the 403 as
INSUFFICIENT_SCOPE. Their developer spent hours auditing token scopes for a
request that never reached Ark at all.
"""

import httpx

from ark_py.errors import error_from_response

CHALLENGE_BODY = "<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>"


def _response(status, body, content_type, headers=None):
    return httpx.Response(
        status,
        content=body,
        headers={"content-type": content_type, **(headers or {})},
    )


def test_html_challenge_is_reported_as_an_edge_block():
    error = error_from_response(
        _response(403, CHALLENGE_BODY, "text/html; charset=UTF-8", {"cf-ray": "a376f9d70bd71709-CMH"})
    )
    assert error.code == "BLOCKED_BY_EDGE"
    assert error.status == 403
    # The ray id is the only handle on the block in the Cloudflare event log,
    # so it has to survive into the error rather than be discarded.
    assert error.details == {"cfRay": "a376f9d70bd71709-CMH"}
    assert "cf-ray a376f9d70bd71709-CMH" in error.message


def test_edge_block_is_retryable():
    error = error_from_response(_response(403, CHALLENGE_BODY, "text/html"))
    assert error.retryable is True


def test_a_genuine_scope_failure_is_untouched():
    body = '{"error": {"code": "INSUFFICIENT_SCOPE", "message": "Token lacks scope"}}'
    error = error_from_response(_response(403, body, "application/json"))
    assert error.code == "INSUFFICIENT_SCOPE"
    assert error.retryable is False


def test_non_html_403_keeps_the_status_mapping():
    error = error_from_response(_response(403, "nope", "text/plain"))
    assert error.code == "INSUFFICIENT_SCOPE"


def test_html_on_an_unrelated_status_is_not_an_edge_block():
    # A 500 HTML page is an origin fault, not a challenge; calling it an edge
    # block would point the developer at Cloudflare for an Ark bug.
    error = error_from_response(_response(500, "<html>oops</html>", "text/html"))
    assert error.code == "INTERNAL_ERROR"


def test_html_503_is_an_edge_block():
    error = error_from_response(_response(503, CHALLENGE_BODY, "text/html"))
    assert error.code == "BLOCKED_BY_EDGE"
