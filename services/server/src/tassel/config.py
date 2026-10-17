"""Server settings, read from ``TASSEL_*`` environment variables."""

from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TASSEL_")

    database_url: str = "postgresql+psycopg://tassel:tassel@127.0.0.1:54329/tassel"
    host: str = "127.0.0.1"
    port: int = 8787
    cors_origins: list[str] = ["http://localhost:5173", "app://tassel"]
    providers: Literal["fake", "live"] = "fake"

    # Frame images. "s3" defaults to the compose service `s3` (local Versity); "memory" is for
    # unit tests. The dev values are not secrets. Versity checks the region inside each
    # request's signature, so s3_region must equal the service's VGW_REGION.
    # On Vultr: https://<cluster>.vultrobjects.com, and the cluster as the region, e.g. "ewr1".
    object_store: Literal["memory", "s3"] = "s3"
    s3_endpoint_url: str | None = "http://127.0.0.1:7070"
    s3_region: str = "us-east-1"
    s3_bucket: str = "tassel-frames"
    s3_access_key_id: str = "tassel"
    s3_secret_access_key: str = "tassel-dev-only"

    # Upload limits: a full frame, its crop, and the least time between a session's frames.
    frame_max_bytes: int = 8 * 1024 * 1024
    crop_max_bytes: int = 2 * 1024 * 1024
    frame_min_interval_s: float = 1.0
