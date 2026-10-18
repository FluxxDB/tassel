"""docker-compose.yml's server service must keep up with the server's settings.

Every setting the server reads reaches the container (passed through from the launcher's
environment, or set for the container), except provider keys, which reach it only inside the
provider settings file, and host paths, which mean nothing in the container.
"""

from pathlib import Path

import yaml

from tassel.config import Settings
from tassel.vision.settings import VisionSettings
from tassel.voice.settings import VoiceSettings

REPO_DIR = Path(__file__).resolve().parents[4]
COMPOSE = yaml.safe_load((REPO_DIR / "docker-compose.yml").read_text(encoding="utf-8"))

# Read only from the provider settings file the container mounts.
FILE_ONLY = {
    "DEEPGRAM_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "ELEVENLABS_API_KEY",
    "ANTHROPIC_API_KEY",
    "VULTR_INFERENCE_API_KEY",
}
# Paths on the host, for logs and tuning files; host-server runs (--host-server) still read them.
HOST_PATHS = {"TASSEL_VOICE_METRICS_LOG", "TASSEL_VISION_LOG", "TASSEL_THRESHOLDS_PATH"}


def setting_names() -> set[str]:
    names = set()
    for settings in (Settings, VoiceSettings, VisionSettings):
        prefix = settings.model_config.get("env_prefix", "")
        for name, field in settings.model_fields.items():
            names.add(field.validation_alias or f"{prefix}{name}".upper())
    return names


def server_environment() -> dict[str, str | None]:
    entries = COMPOSE["services"]["server"]["environment"]
    return {
        entry.split("=", 1)[0]: (entry.split("=", 1)[1] if "=" in entry else None)
        for entry in entries
    }


def test_every_server_setting_reaches_the_container_except_keys_and_host_paths():
    environment = server_environment()
    missing = setting_names() - FILE_ONLY - HOST_PATHS - environment.keys()
    assert not missing, f"Add these to the server's environment in docker-compose.yml: {missing}"
    assert not (FILE_ONLY & environment.keys()), "Keys reach the container only in the file"


def test_the_container_reaches_db_and_s3_by_service_name_with_their_dev_credentials():
    environment = server_environment()
    defaults = Settings.model_construct()
    assert "@db:5432/" in environment["TASSEL_DATABASE_URL"]
    assert environment["TASSEL_S3_ENDPOINT_URL"] == "http://s3:7070"
    s3 = COMPOSE["services"]["s3"]["environment"]
    assert s3["ROOT_ACCESS_KEY"] == defaults.s3_access_key_id
    assert s3["ROOT_SECRET_KEY"] == defaults.s3_secret_access_key
    assert s3["VGW_REGION"] == defaults.s3_region
    db = COMPOSE["services"]["db"]["environment"]
    assert f"{db['POSTGRES_USER']}:{db['POSTGRES_PASSWORD']}@" in environment["TASSEL_DATABASE_URL"]


def test_the_container_listens_on_the_port_its_mapping_and_healthcheck_use():
    server = COMPOSE["services"]["server"]
    environment = server_environment()
    port = Settings.model_construct().port
    assert environment["TASSEL_HOST"] == "0.0.0.0"
    assert environment["TASSEL_PORT"] == str(port)
    assert server["ports"] == [f"127.0.0.1:${{TASSEL_PORT:-{port}}}:{port}"]
    assert f"127.0.0.1:{port}/v1/health" in " ".join(server["healthcheck"]["test"])
