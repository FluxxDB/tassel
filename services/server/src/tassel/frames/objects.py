"""Where frame images live: a private S3-compatible bucket, or memory in unit tests.

Keys are ``learners/{learner}/sessions/{session}/frames/{frame}/full.jpg`` (and ``crop.jpg``),
so a session or a whole learner can be deleted by prefix.
"""

import threading
from collections.abc import Callable
from typing import Any, Protocol

import anyio.to_thread
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi import Request

from tassel.config import Settings


def s3_client_config() -> Config:
    """The boto3 client config, new for each client: boto3 rewrites ``retries`` in place.

    Path-style addressing suits local Versity and Vultr. "when_required" keeps put_object free
    of the CRC32 trailers that boto3 >= 1.36 adds by default, which some S3-compatible stores
    reject (boto3#4392). delete_objects sends a CRC32 regardless; Versity accepts it.
    ``max_attempts`` counts retries, so a call is tried at most 4 times.
    """
    return Config(
        signature_version="s3v4",
        s3={"addressing_style": "path"},
        request_checksum_calculation="when_required",
        response_checksum_validation="when_required",
        connect_timeout=2,
        read_timeout=10,
        retries={"max_attempts": 3, "mode": "standard"},
    )


class ObjectStoreError(Exception):
    """The store couldn't finish an operation, for example when objects survive a delete."""


class ObjectStore(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> None: ...
    async def get(self, key: str) -> bytes | None: ...
    async def delete_prefix(self, prefix: str) -> int: ...  # how many objects it deleted


def _check_prefix(prefix: str) -> None:
    if not prefix:
        # An empty prefix would match every learner's frames.
        raise ValueError("delete_prefix needs a non-empty prefix")


class MemoryObjectStore:
    """A store in this process, for unit tests."""

    def __init__(self) -> None:
        self._objects: dict[str, tuple[bytes, str]] = {}

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        self._objects[key] = (bytes(data), content_type)

    async def get(self, key: str) -> bytes | None:
        found = self._objects.get(key)
        return None if found is None else found[0]

    async def delete_prefix(self, prefix: str) -> int:
        _check_prefix(prefix)
        doomed = [key for key in self._objects if key.startswith(prefix)]
        for key in doomed:
            del self._objects[key]
        return len(doomed)

    def keys(self) -> list[str]:
        return sorted(self._objects)

    def content_type(self, key: str) -> str | None:
        found = self._objects.get(key)
        return None if found is None else found[1]


def _status(error: ClientError) -> int | None:
    return error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")


def _is_missing(error: ClientError) -> bool:
    """A 404: no such key, or no such bucket."""
    return _status(error) == 404


class S3ObjectStore:
    """A bucket on an S3-compatible store, through boto3.

    The client is made on first use, so starting the app makes no network call. Every boto3
    call runs in a worker thread, off the event loop.
    """

    def __init__(
        self,
        *,
        endpoint_url: str | None,
        region: str,
        bucket: str,
        access_key_id: str,
        secret_access_key: str,
        page_size: int = 1000,
        client_factory: Callable[..., Any] = boto3.client,
    ) -> None:
        self.bucket = bucket
        self._client_options = {
            "endpoint_url": endpoint_url,
            "region_name": region,
            "aws_access_key_id": access_key_id,
            "aws_secret_access_key": secret_access_key,
        }
        self._page_size = page_size
        self._client_factory = client_factory
        # Both first-use steps may run in two worker threads at once.
        self._client: Any = None
        self._client_lock = threading.Lock()
        self._bucket_checked = False
        self._bucket_lock = threading.Lock()

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        await anyio.to_thread.run_sync(self._put, key, data, content_type)

    async def get(self, key: str) -> bytes | None:
        return await anyio.to_thread.run_sync(self._get, key)

    async def delete_prefix(self, prefix: str) -> int:
        _check_prefix(prefix)
        return await anyio.to_thread.run_sync(self._delete_prefix, prefix)

    # The blocking halves, run in worker threads.

    def _s3(self) -> Any:
        with self._client_lock:
            if self._client is None:
                self._client = self._client_factory(
                    "s3", **self._client_options, config=s3_client_config()
                )
            return self._client

    def _ensure_bucket(self, client: Any) -> None:
        with self._bucket_lock:
            if self._bucket_checked:
                return
            try:
                client.head_bucket(Bucket=self.bucket)
            except ClientError as error:
                if not _is_missing(error):
                    raise
                self._create_bucket(client)
            self._bucket_checked = True

    def _create_bucket(self, client: Any) -> None:
        try:
            # No LocationConstraint: Versity runs in us-east-1, where S3 refuses one.
            client.create_bucket(Bucket=self.bucket)
        except ClientError as error:
            if _status(error) != 409:
                raise
            # Another process created it first. Go on only if it is ours to use: a bucket
            # someone else owns fails here (403).
            client.head_bucket(Bucket=self.bucket)

    def _put(self, key: str, data: bytes, content_type: str) -> None:
        client = self._s3()
        self._ensure_bucket(client)
        client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

    def _get(self, key: str) -> bytes | None:
        try:
            response = self._s3().get_object(Bucket=self.bucket, Key=key)
        except ClientError as error:
            if _is_missing(error):
                return None
            raise
        body = response["Body"]
        try:
            return body.read()
        finally:
            body.close()

    def _delete_prefix(self, prefix: str) -> int:
        client = self._s3()
        pages = client.get_paginator("list_objects_v2").paginate(
            Bucket=self.bucket, Prefix=prefix, PaginationConfig={"PageSize": self._page_size}
        )
        deleted = 0
        try:
            for page in pages:
                keys = [{"Key": item["Key"]} for item in page.get("Contents", [])]
                if not keys:
                    continue
                result = client.delete_objects(Bucket=self.bucket, Delete={"Objects": keys})
                if errors := result.get("Errors"):
                    raise ObjectStoreError(
                        f"{len(errors)} of {len(keys)} objects under {prefix!r} weren't deleted"
                        f" ({errors[0].get('Code')})"
                    )
                deleted += len(result.get("Deleted", []))
        except ClientError as error:
            if _is_missing(error):  # no bucket yet: nothing was ever stored
                return deleted
            raise
        return deleted


def make_object_store(settings: Settings) -> ObjectStore:
    if settings.object_store == "memory":
        return MemoryObjectStore()
    return S3ObjectStore(
        endpoint_url=settings.s3_endpoint_url,
        region=settings.s3_region,
        bucket=settings.s3_bucket,
        access_key_id=settings.s3_access_key_id,
        secret_access_key=settings.s3_secret_access_key,
    )


def get_object_store(request: Request) -> ObjectStore:
    """FastAPI dependency: the store that ``create_app`` put on ``app.state``."""
    return request.app.state.object_store
