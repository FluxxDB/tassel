"""Create a missing local development database; never reset or truncate an existing one.

``python -m tassel.scripts.ensure_database`` creates the database ``TASSEL_DATABASE_URL`` names,
when it lives on this machine's Postgres (loopback) or on the Compose service ``db``. The server
container runs it at every start (``tassel.scripts.container``), and ``pnpm dev --host-server``
on the host.
"""

from sqlalchemy import create_engine, make_url, text

from tassel.config import Settings

LOCAL_HOSTS = frozenset({"127.0.0.1", "localhost", "db"})


def database_to_create(url: str) -> str | None:
    """The database to create if it's missing, or None for a Postgres that isn't ours."""
    parsed = make_url(url)
    if parsed.host not in LOCAL_HOSTS:
        return None
    name = parsed.database
    if not name or (name != "tassel" and not name.startswith("tassel_")):
        raise ValueError("Refusing to create a database outside the Tassel development namespace")
    return name


def ensure_database(url: str) -> None:
    name = database_to_create(url)
    if name is None:
        return
    engine = create_engine(make_url(url).set(database="tassel"), isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            exists = connection.scalar(
                text("SELECT 1 FROM pg_database WHERE datname=:name"), {"name": name}
            )
            if not exists:
                connection.exec_driver_sql(
                    "CREATE DATABASE " + engine.dialect.identifier_preparer.quote(name)
                )
    finally:
        engine.dispose()


def main() -> None:
    ensure_database(Settings().database_url)


if __name__ == "__main__":
    main()
