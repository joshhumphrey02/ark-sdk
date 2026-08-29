from __future__ import annotations

from typing import Any


def create_s3_client(
    *,
    access_key_id: str,
    secret_access_key: str,
    endpoint_url: str = "https://ark.nerdstackgrp.com/s3",
    region_name: str = "auto",
    **kwargs: Any,
) -> Any:
    """Create a path-style boto3 S3 client configured for Ark.

    Install the optional dependency with ``pip install nerdstack-ark[s3]``.
    Ark credentials authenticate only against Ark and are not provider keys.
    """
    try:
        import boto3  # type: ignore[import-not-found]
        from botocore.config import Config  # type: ignore[import-not-found]
    except ImportError as error:
        raise ImportError(
            "S3 support requires boto3; install it with 'pip install nerdstack-ark[s3]'"
        ) from error

    config = kwargs.pop("config", None)
    if config is None:
        config = Config(signature_version="s3v4", s3={"addressing_style": "path"})
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        region_name=region_name,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        config=config,
        **kwargs,
    )
