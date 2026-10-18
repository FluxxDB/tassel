"""Create a missing local development database; never reset or truncate an existing one."""

import os

from sqlalchemy import create_engine, make_url, text


def main():
    url = make_url(
        os.environ.get(
            "TASSEL_DATABASE_URL",
            "postgresql+psycopg://tassel:tassel@127.0.0.1:54329/tassel",
        )
    )
    if url.host not in {"127.0.0.1", "localhost"}:
        return
    name = url.database
    if not name or (name != "tassel" and not name.startswith("tassel_")):
        raise ValueError(
            "Refusing to create a database outside the Tassel development namespace"
        )
    engine = create_engine(url.set(database="tassel"), isolation_level="AUTOCOMMIT")
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


if __name__ == "__main__":
    main()
