"""Server settings, read from ``TASSEL_*`` environment variables.

The voice providers' settings and keys are ``tassel.voice.settings.VoiceSettings`` (P2-R10).
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TASSEL_")

    database_url: str = "postgresql+psycopg://tassel:tassel@127.0.0.1:54329/tassel"
    host: str = "127.0.0.1"
    port: int = 8787
    cors_origins: list[str] = ["http://localhost:5173", "app://tassel"]
