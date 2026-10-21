"""Database engine, session factory and declarative base."""

from collections.abc import Generator

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from .config import settings

# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------
# SQLite needs `check_same_thread=False` because FastAPI hands work to a
# threadpool. NullPool keeps each request on its own connection so no
# connection object is ever shared across threads.
_engine_kwargs: dict = {"future": True, "echo": False}
if settings.is_sqlite:
    _engine_kwargs |= {"connect_args": {"check_same_thread": False}, "poolclass": NullPool}
else:
    _engine_kwargs |= {"pool_pre_ping": True}

engine = create_engine(settings.database_url, **_engine_kwargs)

if settings.is_sqlite:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _connection_record):  # pragma: no cover
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def _apply_column_drift() -> None:
    """Add columns introduced after a database was first created.

    There is no migration tool in this project; ``ALTER TABLE ... ADD COLUMN``
    is supported by both SQLite and Postgres and keeps an existing local
    database working across schema additions.
    """
    from . import models  # noqa: F401, PLC0415

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue
        present = {col["name"] for col in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in present:
                continue
            ddl = column.type.compile(dialect=engine.dialect)
            with engine.begin() as conn:
                conn.execute(
                    text(f'ALTER TABLE {table.name} ADD COLUMN "{column.name}" {ddl}')
                )


def init_db() -> None:
    """Create all tables. Safe to call repeatedly."""
    from . import models  # noqa: F401  (ensure models are registered)

    Base.metadata.create_all(bind=engine)
    _apply_column_drift()


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a request-scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
