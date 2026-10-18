"""Recognize the memory prototype's old revision without discarding any learner data."""

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection


def reconcile_legacy_memory_revision(connection: Connection) -> None:
    """0004 used to mean learner memory in the avatar checkout; it now means board actions.

    Only relabel the unambiguous old layout. Alembic then adds the missing board column and
    applies the ordinary merged migrations. All saved notes and settings remain untouched.
    """
    schema = inspect(connection)
    tables = set(schema.get_table_names())
    if {"alembic_version", "sessions", "learner_memory", "memory_extractions"} <= tables:
        revisions = set(connection.scalars(text("SELECT version_num FROM alembic_version")))
        columns = {column["name"] for column in schema.get_columns("sessions")}
        if revisions == {"0004"} and "board_actions" not in columns:
            connection.execute(
                text(
                    "UPDATE alembic_version SET version_num = 'learner_memory_01' "
                    "WHERE version_num = '0004'"
                )
            )
    # End inspection's implicit transaction before Alembic opens its migration transaction.
    connection.commit()
