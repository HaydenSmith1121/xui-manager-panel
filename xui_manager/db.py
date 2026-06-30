from __future__ import annotations

import json
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from .auth import hash_password, verify_password
from .billing import bytes_from_gb


class Database:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("pragma foreign_keys=on")
        return conn

    @contextmanager
    def session(self):
        conn = self.connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def init_schema(self) -> None:
        with self.session() as conn:
            conn.executescript(
                """
                create table if not exists plans (
                    id integer primary key autoincrement,
                    name text not null,
                    quota_bytes integer not null,
                    duration_days integer not null,
                    allowed_tags text not null default '[]',
                    require_approval integer not null default 1,
                    enabled integer not null default 1,
                    created_at integer not null
                );

                create table if not exists users (
                    id integer primary key autoincrement,
                    email text not null unique,
                    password_hash text not null,
                    role text not null default 'user',
                    status text not null default 'pending',
                    plan_id integer,
                    token text not null unique,
                    quota_bytes integer not null default 0,
                    expire_at integer not null default 0,
                    created_at integer not null,
                    approved_at integer not null default 0,
                    foreign key(plan_id) references plans(id)
                );

                create table if not exists panels (
                    id integer primary key autoincrement,
                    name text not null,
                    base_url text not null,
                    username text not null,
                    password text not null,
                    subscription_url text not null default '',
                    verify_tls integer not null default 1,
                    enabled integer not null default 1,
                    created_at integer not null
                );

                create table if not exists nodes (
                    id integer primary key autoincrement,
                    name text not null,
                    panel_id integer,
                    inbound_id integer not null default 0,
                    source_url text not null,
                    rate real not null default 1,
                    tags text not null default '[]',
                    enabled integer not null default 1,
                    created_at integer not null,
                    foreign key(panel_id) references panels(id)
                );

                create table if not exists usage_records (
                    id integer primary key autoincrement,
                    user_id integer not null,
                    node_id integer not null,
                    upload integer not null default 0,
                    download integer not null default 0,
                    updated_at integer not null,
                    unique(user_id, node_id),
                    foreign key(user_id) references users(id),
                    foreign key(node_id) references nodes(id)
                );

                create table if not exists sessions (
                    token text primary key,
                    user_id integer not null,
                    created_at integer not null,
                    foreign key(user_id) references users(id)
                );
                """
            )
            self._ensure_column(conn, "nodes", "inbound_id", "integer not null default 0")

    def _ensure_column(self, conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
        columns = [row["name"] for row in conn.execute(f"pragma table_info({table})")]
        if column not in columns:
            conn.execute(f"alter table {table} add column {column} {definition}")

    def seed_admin(self, email: str, password: str) -> dict[str, Any]:
        existing = self.get_user_by_email(email)
        if existing:
            return existing
        now = int(time.time())
        with self.session() as conn:
            cur = conn.execute(
                """
                insert into users(email, password_hash, role, status, token, created_at, approved_at)
                values (?, ?, 'admin', 'active', ?, ?, ?)
                """,
                (email, hash_password(password), secrets.token_urlsafe(24), now, now),
            )
            user_id = int(cur.lastrowid)
        return self.get_user(user_id)

    def create_plan(
        self,
        name: str,
        quota_gb: float,
        duration_days: int,
        allowed_tags: list[str],
        require_approval: bool,
        enabled: bool = True,
    ) -> int:
        name = name.strip()
        if not name:
            raise ValueError("plan name is required")
        with self.session() as conn:
            conn.execute("begin immediate")
            existing = conn.execute("select id from plans where lower(name)=lower(?)", (name,)).fetchone()
            if existing:
                raise ValueError("plan name already exists")
            cur = conn.execute(
                """
                insert into plans(name, quota_bytes, duration_days, allowed_tags, require_approval, enabled, created_at)
                values (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    name,
                    bytes_from_gb(quota_gb),
                    int(duration_days),
                    json.dumps(allowed_tags),
                    int(require_approval),
                    int(enabled),
                    int(time.time()),
                ),
            )
            return int(cur.lastrowid)

    def update_plan(
        self,
        plan_id: int,
        name: str,
        quota_gb: float,
        duration_days: int,
        allowed_tags: list[str],
        require_approval: bool,
        enabled: bool = True,
    ) -> dict[str, Any]:
        name = name.strip()
        with self.session() as conn:
            existing = conn.execute(
                "select id from plans where lower(name)=lower(?) and id<>?",
                (name, int(plan_id)),
            ).fetchone()
            if existing:
                raise ValueError("plan name already exists")
            conn.execute(
                """
                update plans
                set name=?, quota_bytes=?, duration_days=?, allowed_tags=?, require_approval=?, enabled=?
                where id=?
                """,
                (
                    name,
                    bytes_from_gb(quota_gb),
                    int(duration_days),
                    json.dumps(allowed_tags),
                    int(require_approval),
                    int(enabled),
                    int(plan_id),
                ),
            )
        plan = self.get_plan(plan_id)
        if not plan:
            raise ValueError("plan not found")
        return plan

    def delete_plan(self, plan_id: int) -> None:
        with self.session() as conn:
            in_use = conn.execute("select 1 from users where plan_id=? limit 1", (int(plan_id),)).fetchone()
            if in_use:
                raise ValueError("plan is in use")
            result = conn.execute("delete from plans where id=?", (int(plan_id),))
            if result.rowcount == 0:
                raise ValueError("plan not found")

    def list_plans(self, enabled_only: bool = False) -> list[dict[str, Any]]:
        sql = "select * from plans"
        params: tuple[Any, ...] = ()
        if enabled_only:
            sql += " where enabled=1"
        sql += " order by id"
        with self.session() as conn:
            return [self._decode_plan(row) for row in conn.execute(sql, params)]

    def get_plan(self, plan_id: int) -> dict[str, Any] | None:
        with self.session() as conn:
            row = conn.execute("select * from plans where id=?", (plan_id,)).fetchone()
            return self._decode_plan(row) if row else None

    def register_user(self, email: str, password: str, plan_id: int) -> dict[str, Any]:
        email = email.strip().lower()
        if "@" not in email:
            raise ValueError("invalid email")
        if len(password) < 6:
            raise ValueError("password too short")
        plan = self.get_plan(plan_id)
        if not plan or not plan["enabled"]:
            raise ValueError("plan not found")
        status = "pending" if plan["require_approval"] else "active"
        now = int(time.time())
        expire_at = now + plan["duration_days"] * 86400 if status == "active" else 0
        quota_bytes = plan["quota_bytes"] if status == "active" else 0
        approved_at = now if status == "active" else 0
        with self.session() as conn:
            cur = conn.execute(
                """
                insert into users(email, password_hash, status, plan_id, token, quota_bytes, expire_at, created_at, approved_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    email,
                    hash_password(password),
                    status,
                    plan_id,
                    secrets.token_urlsafe(24),
                    quota_bytes,
                    expire_at,
                    now,
                    approved_at,
                ),
            )
            user_id = int(cur.lastrowid)
        return self.get_user(user_id)

    def approve_user(self, user_id: int) -> dict[str, Any]:
        user = self.get_user(user_id)
        if not user:
            raise ValueError("user not found")
        plan = self.get_plan(user["plan_id"])
        if not plan:
            raise ValueError("plan not found")
        now = int(time.time())
        expire_at = now + plan["duration_days"] * 86400
        with self.session() as conn:
            conn.execute(
                """
                update users
                set status='active', quota_bytes=?, expire_at=?, approved_at=?
                where id=?
                """,
                (plan["quota_bytes"], expire_at, now, user_id),
            )
        return self.get_user(user_id)

    def update_user_status(self, user_id: int, status: str) -> dict[str, Any]:
        if status not in {"pending", "active", "disabled"}:
            raise ValueError("invalid status")
        with self.session() as conn:
            conn.execute("update users set status=? where id=?", (status, user_id))
        return self.get_user(user_id)

    def authenticate(self, email: str, password: str) -> dict[str, Any] | None:
        user = self.get_user_by_email(email.strip().lower())
        if user and verify_password(password, user["password_hash"]):
            return user
        return None

    def create_session(self, user_id: int) -> str:
        token = secrets.token_urlsafe(32)
        with self.session() as conn:
            conn.execute(
                "insert into sessions(token, user_id, created_at) values (?, ?, ?)",
                (token, user_id, int(time.time())),
            )
        return token

    def delete_session(self, token: str) -> None:
        if not token:
            return
        with self.session() as conn:
            conn.execute("delete from sessions where token=?", (token,))

    def get_session_user(self, token: str) -> dict[str, Any] | None:
        if not token:
            return None
        with self.session() as conn:
            row = conn.execute(
                "select users.* from sessions join users on users.id=sessions.user_id where sessions.token=?",
                (token,),
            ).fetchone()
            return self._decode_user(row) if row else None

    def get_user(self, user_id: int) -> dict[str, Any] | None:
        with self.session() as conn:
            row = conn.execute("select * from users where id=?", (user_id,)).fetchone()
            return self._decode_user(row) if row else None

    def get_user_by_email(self, email: str) -> dict[str, Any] | None:
        with self.session() as conn:
            row = conn.execute("select * from users where email=?", (email,)).fetchone()
            return self._decode_user(row) if row else None

    def get_user_by_token(self, token: str) -> dict[str, Any] | None:
        with self.session() as conn:
            row = conn.execute("select * from users where token=?", (token,)).fetchone()
            return self._decode_user(row) if row else None

    def list_users(self) -> list[dict[str, Any]]:
        with self.session() as conn:
            return [self._decode_user(row) for row in conn.execute("select * from users order by id")]

    def create_panel(
        self,
        name: str,
        base_url: str,
        username: str,
        password: str,
        subscription_url: str = "",
        verify_tls: bool = True,
        enabled: bool = True,
    ) -> int:
        base_url = normalize_panel_url(base_url)
        with self.session() as conn:
            conn.execute("begin immediate")
            existing = conn.execute("select id from panels where lower(base_url)=lower(?)", (base_url,)).fetchone()
            if existing:
                raise ValueError("panel address already exists")
            cur = conn.execute(
                """
                insert into panels(name, base_url, username, password, subscription_url, verify_tls, enabled, created_at)
                values (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (name, base_url, username, password, subscription_url, int(verify_tls), int(enabled), int(time.time())),
            )
            return int(cur.lastrowid)

    def update_panel(
        self,
        panel_id: int,
        name: str,
        base_url: str,
        username: str,
        password: str,
        subscription_url: str = "",
        verify_tls: bool = True,
        enabled: bool = True,
    ) -> dict[str, Any]:
        base_url = normalize_panel_url(base_url)
        with self.session() as conn:
            existing = conn.execute(
                "select id from panels where lower(base_url)=lower(?) and id<>?",
                (base_url, int(panel_id)),
            ).fetchone()
            if existing:
                raise ValueError("panel address already exists")
            conn.execute(
                """
                update panels
                set name=?, base_url=?, username=?, password=?, subscription_url=?, verify_tls=?, enabled=?
                where id=?
                """,
                (
                    name,
                    base_url,
                    username,
                    password,
                    subscription_url,
                    int(verify_tls),
                    int(enabled),
                    int(panel_id),
                ),
            )
        with self.session() as conn:
            row = conn.execute("select * from panels where id=?", (panel_id,)).fetchone()
            if not row:
                raise ValueError("panel not found")
            return dict(row)

    def delete_panel(self, panel_id: int) -> None:
        with self.session() as conn:
            in_use = conn.execute("select 1 from nodes where panel_id=? limit 1", (int(panel_id),)).fetchone()
            if in_use:
                raise ValueError("panel is in use")
            result = conn.execute("delete from panels where id=?", (int(panel_id),))
            if result.rowcount == 0:
                raise ValueError("panel not found")

    def list_panels(self) -> list[dict[str, Any]]:
        with self.session() as conn:
            return [dict(row) for row in conn.execute("select * from panels order by id")]

    def create_node(
        self,
        name: str,
        source_url: str,
        rate: float,
        tags: list[str],
        enabled: bool = True,
        panel_id: int | None = None,
        inbound_id: int = 0,
    ) -> int:
        with self.session() as conn:
            cur = conn.execute(
                """
                insert into nodes(name, panel_id, inbound_id, source_url, rate, tags, enabled, created_at)
                values (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (name, panel_id, int(inbound_id), source_url, float(rate), json.dumps(tags), int(enabled), int(time.time())),
            )
            return int(cur.lastrowid)

    def update_node(
        self,
        node_id: int,
        name: str,
        source_url: str,
        rate: float,
        tags: list[str],
        enabled: bool = True,
        panel_id: int | None = None,
        inbound_id: int = 0,
    ) -> dict[str, Any]:
        with self.session() as conn:
            conn.execute(
                """
                update nodes
                set name=?, panel_id=?, inbound_id=?, source_url=?, rate=?, tags=?, enabled=?
                where id=?
                """,
                (name, panel_id, int(inbound_id), source_url, float(rate), json.dumps(tags), int(enabled), int(node_id)),
            )
        with self.session() as conn:
            row = conn.execute("select * from nodes where id=?", (node_id,)).fetchone()
            if not row:
                raise ValueError("node not found")
            return self._decode_node(row)

    def list_nodes(self, enabled_only: bool = False) -> list[dict[str, Any]]:
        sql = "select * from nodes"
        if enabled_only:
            sql += " where enabled=1"
        sql += " order by id"
        with self.session() as conn:
            return [self._decode_node(row) for row in conn.execute(sql)]

    def record_usage(self, user_id: int, node_id: int, upload: int, download: int) -> None:
        now = int(time.time())
        with self.session() as conn:
            conn.execute(
                """
                insert into usage_records(user_id, node_id, upload, download, updated_at)
                values (?, ?, ?, ?, ?)
                on conflict(user_id, node_id) do update set
                    upload=excluded.upload,
                    download=excluded.download,
                    updated_at=excluded.updated_at
                """,
                (user_id, node_id, int(upload), int(download), now),
            )

    def usage_for_user(self, user_id: int) -> list[dict[str, Any]]:
        with self.session() as conn:
            rows = conn.execute(
                """
                select usage_records.*, nodes.rate, nodes.name as node_name
                from usage_records
                join nodes on nodes.id=usage_records.node_id
                where usage_records.user_id=?
                """,
                (user_id,),
            )
            return [dict(row) for row in rows]

    def _decode_plan(self, row: sqlite3.Row) -> dict[str, Any]:
        data = dict(row)
        data["allowed_tags"] = json.loads(data.get("allowed_tags") or "[]")
        data["require_approval"] = bool(data["require_approval"])
        data["enabled"] = bool(data["enabled"])
        return data

    def _decode_node(self, row: sqlite3.Row) -> dict[str, Any]:
        data = dict(row)
        data["tags"] = json.loads(data.get("tags") or "[]")
        data["enabled"] = bool(data["enabled"])
        return data

    def _decode_user(self, row: sqlite3.Row) -> dict[str, Any]:
        return dict(row)


def normalize_panel_url(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("panel address is required")
    return value.rstrip("/") + "/"
