"""Alembic environment. The database URL comes from Settings (env ``TASSEL_DATABASE_URL``)."""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

import tassel.chat.tables  # noqa: F401  (declares the chat tables on Base's metadata)
import tassel.frames.tables  # noqa: F401  (declares the frames table on Base's metadata)
from tassel.config import Settings
from tassel.storage.migration_compat import reconcile_legacy_memory_revision
from tassel.storage.tables import Base

config = context.config
if config.config_file_name is not None:
    # Keep loggers that already exist, such as pytest's, when tests run migrations in-process.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata
database_url = Settings().database_url


def run_migrations_offline() -> None:
    context.configure(
        url=database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # A sync engine on purpose: psycopg's async mode can't run on Windows' default event loop.
    engine = create_engine(database_url, poolclass=pool.NullPool)
    with engine.connect() as connection:
        reconcile_legacy_memory_revision(connection)
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
