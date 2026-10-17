"""The object store: the memory store for tests, and the S3 store against the local S3.

The S3 round trip needs the compose service (``docker compose up -d s3``). Every byte here is
synthetic.
"""

import secrets
import socket
from collections.abc import Iterator

import boto3
import pytest
from botocore.exceptions import ClientError
from botocore.stub import Stubber
from starlette.requests import Request

from tassel.app import create_app
from tassel.config import Settings
from tassel.frames.objects import (
    MemoryObjectStore,
    ObjectStoreError,
    S3ObjectStore,
    get_object_store,
    make_object_store,
    s3_client_config,
)

# The compose service `s3` and its dev credentials, which are not secrets.
LOCAL_S3 = {
    "endpoint_url": "http://127.0.0.1:7070",
    "region": "us-east-1",
    "access_key_id": "tassel",
    "secret_access_key": "tassel-dev-only",
}


def admin_client():
    """A client of our own, to check the bucket from outside the store."""
    return boto3.client(
        "s3",
        endpoint_url=LOCAL_S3["endpoint_url"],
        region_name=LOCAL_S3["region"],
        aws_access_key_id=LOCAL_S3["access_key_id"],
        aws_secret_access_key=LOCAL_S3["secret_access_key"],
        config=s3_client_config(),
    )


def bucket_exists(client, bucket: str) -> bool:
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError as error:
        if error.response["ResponseMetadata"]["HTTPStatusCode"] == 404:
            return False
        raise
    return True


@pytest.fixture(scope="session")
def s3_bucket() -> Iterator[str]:
    """This test run's bucket on the local S3. The store creates it; the fixture deletes it."""
    try:
        socket.create_connection(("127.0.0.1", 7070), timeout=2).close()
    except OSError:
        pytest.fail("Local S3 isn't running: docker compose up -d s3", pytrace=False)
    bucket = f"tassel-test-{secrets.token_hex(4)}"
    yield bucket
    client = admin_client()
    if not bucket_exists(client, bucket):
        return
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket):
        if objects := [{"Key": item["Key"]} for item in page.get("Contents", [])]:
            client.delete_objects(Bucket=bucket, Delete={"Objects": objects})
    client.delete_bucket(Bucket=bucket)


def stubbed_client():
    """A real boto3 client whose calls a Stubber answers, so nothing leaves the process."""
    return boto3.client(
        "s3",
        region_name="us-east-1",
        aws_access_key_id="stub",
        aws_secret_access_key="stub",
        config=s3_client_config(),
    )


def store_on(client) -> S3ObjectStore:
    return S3ObjectStore(**LOCAL_S3, bucket="tassel-stub", client_factory=lambda *a, **k: client)


@pytest.mark.asyncio
async def test_memory_store_roundtrip_and_prefix_delete():
    store = MemoryObjectStore()
    for key in ("a/1", "a/2", "b/1"):
        await store.put(key, key.encode(), "image/jpeg")
    assert await store.get("a/2") == b"a/2"

    assert await store.delete_prefix("a/") == 2
    assert await store.get("a/1") is None
    assert await store.get("b/1") == b"b/1"
    assert store.keys() == ["b/1"]


@pytest.mark.asyncio
async def test_memory_store_keeps_the_content_type():
    store = MemoryObjectStore()
    await store.put("a/full.jpg", b"jpeg", "image/jpeg")
    assert store.content_type("a/full.jpg") == "image/jpeg"
    assert store.content_type("a/crop.jpg") is None
    await store.delete_prefix("a/")
    assert store.content_type("a/full.jpg") is None


@pytest.mark.asyncio
async def test_s3_store_roundtrip_against_local_s3(s3_bucket):
    store = S3ObjectStore(**LOCAL_S3, bucket=s3_bucket, page_size=2)
    admin = admin_client()
    assert not bucket_exists(admin, s3_bucket)

    await store.put("p/0/full.jpg", b"\xff\xd8 synthetic 0", "image/jpeg")
    assert bucket_exists(admin, s3_bucket)  # created on the first put
    assert await store.get("p/0/full.jpg") == b"\xff\xd8 synthetic 0"
    head = admin.head_object(Bucket=s3_bucket, Key="p/0/full.jpg")
    assert head["ContentType"] == "image/jpeg"

    for n in range(1, 5):
        await store.put(f"p/{n}/full.jpg", f"synthetic {n}".encode(), "image/jpeg")
    await store.put("q/0/full.jpg", b"another session", "image/jpeg")

    assert await store.delete_prefix("p/") == 5  # three pages: 2, 2 and 1 keys
    assert await store.get("p/0/full.jpg") is None
    assert await store.get("p/4/full.jpg") is None
    assert await store.get("q/0/full.jpg") == b"another session"


def test_s3_store_is_lazy():
    calls = []
    S3ObjectStore(**LOCAL_S3, bucket="tassel-lazy", client_factory=lambda *a, **k: calls.append(1))
    assert calls == []


@pytest.mark.asyncio
async def test_s3_client_is_made_once_on_first_use_with_the_client_config():
    client = stubbed_client()
    calls = []

    def factory(*args, **kwargs):
        calls.append((args, kwargs))
        return client

    store = S3ObjectStore(**LOCAL_S3, bucket="tassel-stub", client_factory=factory)
    with Stubber(client) as stub:
        for _ in range(2):
            stub.add_client_error(
                "get_object",
                service_error_code="NoSuchKey",
                http_status_code=404,
                expected_params={"Bucket": "tassel-stub", "Key": "k"},
            )
        assert await store.get("k") is None
        assert await store.get("k") is None

    [(args, kwargs)] = calls
    config = kwargs.pop("config")
    assert args == ("s3",)
    assert kwargs == {
        "endpoint_url": "http://127.0.0.1:7070",
        "region_name": "us-east-1",
        "aws_access_key_id": "tassel",
        "aws_secret_access_key": "tassel-dev-only",
    }
    assert config.signature_version == "s3v4"
    assert config.s3 == {"addressing_style": "path"}
    assert config.request_checksum_calculation == "when_required"
    assert config.response_checksum_validation == "when_required"
    assert (config.connect_timeout, config.read_timeout) == (2, 10)
    assert config.retries == {"max_attempts": 3, "mode": "standard"}


@pytest.mark.asyncio
async def test_s3_store_creates_a_missing_bucket_on_first_put_and_checks_once():
    client = stubbed_client()
    store = store_on(client)
    with Stubber(client) as stub:
        stub.add_client_error(
            "head_bucket",
            service_error_code="404",
            http_status_code=404,
            expected_params={"Bucket": "tassel-stub"},
        )
        stub.add_response("create_bucket", {}, {"Bucket": "tassel-stub"})
        for key in ("k1", "k2"):
            stub.add_response(
                "put_object",
                {},
                {"Bucket": "tassel-stub", "Key": key, "Body": b"jpeg", "ContentType": "image/jpeg"},
            )
        await store.put("k1", b"jpeg", "image/jpeg")
        await store.put("k2", b"jpeg", "image/jpeg")
        stub.assert_no_pending_responses()


@pytest.mark.asyncio
async def test_s3_store_keeps_an_existing_bucket():
    client = stubbed_client()
    store = store_on(client)
    with Stubber(client) as stub:
        stub.add_response("head_bucket", {}, {"Bucket": "tassel-stub"})
        stub.add_response(
            "put_object",
            {},
            {"Bucket": "tassel-stub", "Key": "k", "Body": b"jpeg", "ContentType": "image/jpeg"},
        )
        await store.put("k", b"jpeg", "image/jpeg")
        stub.assert_no_pending_responses()


@pytest.mark.asyncio
async def test_s3_store_puts_when_another_process_created_the_bucket_first():
    client = stubbed_client()
    store = store_on(client)
    with Stubber(client) as stub:
        stub.add_client_error(
            "head_bucket",
            service_error_code="404",
            http_status_code=404,
            expected_params={"Bucket": "tassel-stub"},
        )
        stub.add_client_error(
            "create_bucket",
            service_error_code="BucketAlreadyOwnedByYou",
            http_status_code=409,
            expected_params={"Bucket": "tassel-stub"},
        )
        stub.add_response("head_bucket", {}, {"Bucket": "tassel-stub"})  # it is ours to use
        for key in ("k1", "k2"):
            stub.add_response(
                "put_object",
                {},
                {"Bucket": "tassel-stub", "Key": key, "Body": b"jpeg", "ContentType": "image/jpeg"},
            )
        await store.put("k1", b"jpeg", "image/jpeg")
        await store.put("k2", b"jpeg", "image/jpeg")
        stub.assert_no_pending_responses()


@pytest.mark.asyncio
async def test_s3_store_fails_a_put_into_someone_elses_bucket():
    client = stubbed_client()
    store = store_on(client)
    with Stubber(client) as stub:
        stub.add_client_error("head_bucket", service_error_code="404", http_status_code=404)
        stub.add_client_error(
            "create_bucket", service_error_code="BucketAlreadyExists", http_status_code=409
        )
        stub.add_client_error("head_bucket", service_error_code="403", http_status_code=403)
        with pytest.raises(ClientError, match="403"):
            await store.put("k", b"jpeg", "image/jpeg")


@pytest.mark.asyncio
async def test_s3_delete_prefix_fails_when_an_object_survives():
    # The session's rows must outlive a failed delete, so it can be retried.
    client = stubbed_client()
    store = store_on(client)
    with Stubber(client) as stub:
        stub.add_response(
            "list_objects_v2",
            {"Contents": [{"Key": "a/1"}, {"Key": "a/2"}], "IsTruncated": False},
            {"Bucket": "tassel-stub", "Prefix": "a/", "MaxKeys": 1000},
        )
        stub.add_response(
            "delete_objects",
            {
                "Deleted": [{"Key": "a/1"}],
                "Errors": [{"Key": "a/2", "Code": "AccessDenied", "Message": "Access Denied"}],
            },
            {"Bucket": "tassel-stub", "Delete": {"Objects": [{"Key": "a/1"}, {"Key": "a/2"}]}},
        )
        with pytest.raises(ObjectStoreError, match="1 of 2"):
            await store.delete_prefix("a/")


@pytest.mark.asyncio
async def test_s3_delete_prefix_of_a_missing_bucket_deletes_nothing():
    client = stubbed_client()
    store = store_on(client)
    with Stubber(client) as stub:
        stub.add_client_error(
            "list_objects_v2", service_error_code="NoSuchBucket", http_status_code=404
        )
        assert await store.delete_prefix("a/") == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["memory", "s3"])
async def test_delete_prefix_refuses_the_empty_prefix(kind):
    # An empty prefix would delete every learner's frames.
    def no_client(*args, **kwargs):
        raise AssertionError("no S3 call expected")

    if kind == "memory":
        store = MemoryObjectStore()
    else:
        store = S3ObjectStore(**LOCAL_S3, bucket="tassel-stub", client_factory=no_client)
    with pytest.raises(ValueError, match="prefix"):
        await store.delete_prefix("")


def test_settings_default_to_s3_on_the_local_s3(monkeypatch):
    monkeypatch.delenv("TASSEL_OBJECT_STORE", raising=False)
    for name in ("ENDPOINT_URL", "REGION", "BUCKET", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"):
        monkeypatch.delenv(f"TASSEL_S3_{name}", raising=False)
    settings = Settings()
    assert settings.object_store == "s3"
    assert settings.s3_endpoint_url == "http://127.0.0.1:7070"
    assert settings.s3_region == "us-east-1"
    assert settings.s3_bucket == "tassel-frames"
    assert settings.s3_access_key_id == "tassel"
    assert settings.s3_secret_access_key == "tassel-dev-only"


def test_make_object_store_picks_the_setting(monkeypatch):
    monkeypatch.setenv("TASSEL_OBJECT_STORE", "memory")
    assert isinstance(make_object_store(Settings()), MemoryObjectStore)

    store = make_object_store(Settings(object_store="s3", s3_bucket="tassel-elsewhere"))
    assert isinstance(store, S3ObjectStore)
    assert store.bucket == "tassel-elsewhere"


def test_create_app_puts_the_store_on_app_state():
    app = create_app(Settings(object_store="memory"))
    assert isinstance(app.state.object_store, MemoryObjectStore)
    request = Request({"type": "http", "app": app})
    assert get_object_store(request) is app.state.object_store
