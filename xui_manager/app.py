from __future__ import annotations

import json
import mimetypes
import os
import time
import urllib.parse
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

from .billing import bytes_from_gb, usage_totals
from .db import Database
from .provisioning import ProvisioningService
from .subscription import Response, build_clash_subscription
from .usage_sync import UsageSyncService
from .xui_api import XuiClient


class XuiManagerApp:
    def __init__(
        self,
        db_path: str | Path,
        static_dir: str | Path | None = None,
        client_factory=XuiClient,
        now: Callable[[], float] | None = None,
    ):
        self.db = Database(db_path)
        self.db.init_schema()
        self.static_dir = Path(static_dir or Path(__file__).resolve().parents[1] / "static")
        self.client_factory = client_factory
        clock = now or time.time
        self.provisioning = ProvisioningService(self.db, client_factory, now=clock)
        self.usage_sync = UsageSyncService(self.db, self.provisioning, client_factory, now=clock)

    def handle_json(self, method: str, path: str, headers: dict[str, str], body: str) -> Response:
        try:
            payload = json.loads(body or "{}")
        except json.JSONDecodeError:
            return self.json_response({"error": "Invalid JSON"}, 400)
        try:
            if method == "GET" and path == "/api/plans":
                return self.json_response({"plans": self.db.list_plans(enabled_only=True)})
            if method == "POST" and path == "/api/register":
                user = self.db.register_user(payload["email"], payload["password"], int(payload["plan_id"]))
                provisioning = None
                if user["status"] == "active":
                    provisioning = self.provisioning.provision_user(user["id"])
                data = {"user": self.user_summary(user, headers)}
                if provisioning is not None:
                    data["provisioning"] = provisioning
                return self.json_response(data)
            if method == "POST" and path == "/api/login":
                user = self.db.authenticate(payload["email"], payload["password"])
                if not user:
                    return self.json_response({"error": "Invalid email or password"}, 401)
                session = self.db.create_session(user["id"])
                return self.json_response({"user": self.user_summary(user, headers)}, headers={"Set-Cookie": cookie_header(session)})
            if method == "POST" and path == "/api/logout":
                self.db.delete_session(session_token(headers))
                return self.json_response({"logged_out": True}, headers={"Set-Cookie": expired_cookie_header()})
            if method == "GET" and path == "/api/me":
                user = self.user_from_headers(headers)
                return self.json_response({"user": self.user_summary(user, headers) if user else None})
            if path.startswith("/api/admin/"):
                user = self.require_admin(headers)
                if isinstance(user, Response):
                    return user
                if method == "POST":
                    guard = self.require_admin_mutation_headers(headers)
                    if guard:
                        return guard
                return self.handle_admin(method, path, headers, payload)
        except KeyError as exc:
            return self.json_response({"error": f"Missing field: {exc.args[0]}"}, 400)
        except ValueError as exc:
            return self.json_response({"error": str(exc)}, 400)
        return self.json_response({"error": "Not found"}, 404)

    def handle_admin(self, method: str, path: str, headers: dict[str, str], payload: dict[str, Any]) -> Response:
        if method == "GET" and path == "/api/admin/users":
            return self.json_response({"users": [self.user_summary(user, headers) for user in self.db.list_users()]})
        if method == "POST" and path == "/api/admin/users/approve":
            existing = self.db.get_user(int(payload["user_id"]))
            if not existing:
                raise ValueError("user not found")
            if existing["status"] == "active" and not bool(payload.get("renew", False)):
                user = existing
            else:
                user = self.db.approve_user(int(payload["user_id"]))
                if bool(payload.get("renew", False)) and bool(payload.get("reset_usage", False)):
                    self.db.reset_managed_usage(user["id"])
            provisioning = self.provisioning.provision_user(user["id"])
            return self.json_response({"user": self.user_summary(user, headers), "provisioning": provisioning})
        if method == "POST" and path == "/api/admin/users/provision/retry":
            return self.json_response({"provisioning": self.provisioning.retry_user(int(payload["user_id"]))})
        if method == "POST" and path == "/api/admin/users/reconcile":
            return self.json_response({"reconcile": self.provisioning.reconcile_user(int(payload["user_id"]), bool(payload.get("apply", False)))})
        if method == "POST" and path == "/api/admin/users/status":
            return self.json_response({"user": self.user_summary(self.db.update_user_status(int(payload["user_id"]), payload["status"]), headers)})
        if method == "GET" and path == "/api/admin/plans":
            return self.json_response({"plans": self.db.list_plans()})
        if method == "POST" and path == "/api/admin/plans":
            args = (
                payload["name"],
                float(payload["quota_gb"]),
                int(payload["duration_days"]),
                tags_from_payload(payload.get("allowed_tags")),
                bool(payload.get("require_approval", True)),
                bool(payload.get("enabled", True)),
            )
            if payload.get("id"):
                return self.json_response({"plan": self.db.update_plan(int(payload["id"]), *args)})
            return self.json_response({"id": self.db.create_plan(*args)})
        if method == "POST" and path == "/api/admin/plans/delete":
            self.db.delete_plan(int(payload["id"]))
            return self.json_response({"deleted": True})
        if method == "GET" and path == "/api/admin/panels":
            return self.json_response({"panels": [public_panel(panel) for panel in self.db.list_panels()]})
        if method == "POST" and path == "/api/admin/panels":
            password = payload.get("password", "")
            if payload.get("id") and not password:
                existing = next((panel for panel in self.db.list_panels() if panel["id"] == int(payload["id"])), None)
                if not existing:
                    raise ValueError("panel not found")
                password = existing["password"]
            args = (
                payload["name"],
                payload["base_url"],
                payload.get("username", ""),
                password,
                payload.get("subscription_url", ""),
                bool(payload.get("verify_tls", True)),
                bool(payload.get("enabled", True)),
            )
            if payload.get("id"):
                return self.json_response({"panel": public_panel(self.db.update_panel(int(payload["id"]), *args))})
            return self.json_response({"id": self.db.create_panel(*args)})
        if method == "POST" and path == "/api/admin/panels/inbounds":
            panel = next((item for item in self.db.list_panels() if item["id"] == int(payload["panel_id"])), None)
            if not panel:
                raise ValueError("panel not found")
            client = self.client_factory(panel["base_url"], panel.get("username", ""), panel.get("password", ""), bool(panel.get("verify_tls", True)))
            client.login()
            inbounds = [public_inbound(item) for item in client.list_inbounds()]
            return self.json_response({"inbounds": inbounds})
        if method == "POST" and path == "/api/admin/panels/test":
            panel = next((item for item in self.db.list_panels() if item["id"] == int(payload["panel_id"])), None)
            if not panel:
                raise ValueError("panel not found")
            client = self.client_factory(panel["base_url"], panel.get("username", ""), panel.get("password", ""), bool(panel.get("verify_tls", True)))
            client.login()
            return self.json_response({"ok": True, "inbound_count": len(client.list_inbounds())})
        if method == "POST" and path == "/api/admin/panels/delete":
            self.db.delete_panel(int(payload["id"]))
            return self.json_response({"deleted": True})
        if method == "GET" and path == "/api/admin/nodes":
            return self.json_response({"nodes": self.db.list_nodes()})
        if method == "POST" and path == "/api/admin/nodes":
            panel_id = int(payload["panel_id"]) if payload.get("panel_id") else None
            args = (
                payload["name"],
                payload["source_url"],
                float(payload.get("rate", 1)),
                tags_from_payload(payload.get("tags")),
                bool(payload.get("enabled", True)),
                panel_id,
                int(payload.get("inbound_id") or 0),
                payload.get("mode", "static"),
            )
            if payload.get("id"):
                return self.json_response({"node": self.db.update_node(int(payload["id"]), *args)})
            return self.json_response({"id": self.db.create_node(*args)})
        if method == "POST" and path == "/api/admin/usage":
            upload = bytes_from_gb(float(payload.get("upload_gb") or 0))
            download = bytes_from_gb(float(payload.get("download_gb") or 0))
            self.db.record_usage(int(payload["user_id"]), int(payload["node_id"]), upload, download)
            user = self.db.get_user(int(payload["user_id"]))
            return self.json_response({"user": self.user_summary(user, headers)})
        if method == "POST" and path == "/api/admin/sync-usage":
            return self.json_response(self.usage_sync.sync_all())
        if method == "GET" and path == "/api/admin/settings":
            return self.json_response({"settings": {"sync_interval_seconds": self.db.get_setting("sync_interval_seconds", "300")}})
        if method == "POST" and path == "/api/admin/settings":
            for key, value in payload.items():
                self.db.set_setting(str(key), value)
            return self.json_response({"settings": {"sync_interval_seconds": self.db.get_setting("sync_interval_seconds", "300")}})
        return self.json_response({"error": "Not found"}, 404)

    def subscription(self, token: str) -> Response:
        return build_clash_subscription(self.db, token)

    def static_response(self, path: str) -> Response:
        if path in {"", "/"}:
            target = self.static_dir / "index.html"
        else:
            target = (self.static_dir / path.lstrip("/")).resolve()
            if not str(target).startswith(str(self.static_dir.resolve())):
                return Response(403, "forbidden\n", {"Content-Type": "text/plain; charset=utf-8"})
        if not target.exists() or not target.is_file():
            return Response(404, "not found\n", {"Content-Type": "text/plain; charset=utf-8"})
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        return Response(200, target.read_text(encoding="utf-8"), {"Content-Type": content_type + "; charset=utf-8"})

    def user_from_headers(self, headers: dict[str, str]) -> dict[str, Any] | None:
        return self.db.get_session_user(session_token(headers))

    def require_admin(self, headers: dict[str, str]) -> dict[str, Any] | Response:
        user = self.user_from_headers(headers)
        if not user or user.get("role") != "admin":
            return self.json_response({"error": "Admin required"}, 403)
        return user

    def require_admin_mutation_headers(self, headers: dict[str, str]) -> Response | None:
        content_type = headers.get("Content-Type", "")
        if content_type and "application/json" not in content_type.lower():
            return self.json_response({"error": "JSON required"}, 415)
        origin = headers.get("Origin") or ""
        referer = headers.get("Referer") or ""
        source = origin or referer
        if not source:
            return None
        source_host = urllib.parse.urlparse(source).netloc
        target_host = headers.get("X-Forwarded-Host") or headers.get("Host") or ""
        if source_host and target_host and source_host.lower() != target_host.lower():
            return self.json_response({"error": "Cross-origin admin request rejected"}, 403)
        return None

    def user_summary(self, user: dict[str, Any], headers: dict[str, str] | None = None) -> dict[str, Any]:
        data = public_user(user)
        totals = usage_totals(self.db, user["id"])
        used = totals["upload"] + totals["download"]
        quota = int(user.get("quota_bytes") or 0)
        data["used_bytes"] = used
        data["upload_bytes"] = totals["upload"]
        data["download_bytes"] = totals["download"]
        data["remaining_bytes"] = max(quota - used, 0) if quota else 0
        data["subscription_url"] = subscription_url(user["token"], headers or {}) if user.get("token") else ""
        return data

    def json_response(self, payload: dict[str, Any], status: int = 200, headers: dict[str, str] | None = None) -> Response:
        final_headers = {"Content-Type": "application/json; charset=utf-8"}
        if headers:
            final_headers.update(headers)
        return Response(status, json.dumps(payload, ensure_ascii=False) + "\n", final_headers)


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in user.items()
        if key not in {"password_hash"}
    }


def public_panel(panel: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in panel.items()
        if key != "password"
    } | {"has_password": bool(panel.get("password"))}


def public_inbound(inbound: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": int(inbound.get("id") or 0),
        "remark": str(inbound.get("remark") or ""),
        "port": int(inbound.get("port") or 0),
        "protocol": str(inbound.get("protocol") or ""),
        "enabled": bool(inbound.get("enable", inbound.get("enabled", True))),
    }


def cookie_header(session: str) -> str:
    return f"session={session}; Path=/; HttpOnly; SameSite=Lax"


def expired_cookie_header() -> str:
    return "session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"


def session_token(headers: dict[str, str]) -> str:
    jar = cookies.SimpleCookie(headers.get("Cookie", ""))
    morsel = jar.get("session")
    return morsel.value if morsel else ""


def tags_from_payload(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value).split(",") if item.strip()]


def subscription_url(token: str, headers: dict[str, str]) -> str:
    host = headers.get("X-Forwarded-Host") or headers.get("Host")
    if not host:
        return f"/sub/clash/{token}"
    proto = headers.get("X-Forwarded-Proto") or "http"
    return f"{proto}://{host}/sub/clash/{token}"


def create_app(db_path: str | Path) -> XuiManagerApp:
    return XuiManagerApp(db_path)


def make_handler(app: XuiManagerApp) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def do_HEAD(self) -> None:  # noqa: N802
            path = urllib.parse.urlparse(self.path).path
            if path.startswith("/api/"):
                self.write_response(app.handle_json("GET", path, self.header_map(), ""), include_body=False)
                return
            self.write_response(app.static_response(path), include_body=False)

        def do_GET(self) -> None:  # noqa: N802
            path = urllib.parse.urlparse(self.path).path
            if path.startswith("/sub/clash/"):
                token = path.rsplit("/", 1)[-1]
                self.write_response(app.subscription(token))
                return
            if path.startswith("/api/"):
                self.write_response(app.handle_json("GET", path, self.header_map(), ""))
                return
            self.write_response(app.static_response(path))

        def do_POST(self) -> None:  # noqa: N802
            path = urllib.parse.urlparse(self.path).path
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length).decode("utf-8") if length else ""
            self.write_response(app.handle_json("POST", path, self.header_map(), body))

        def write_response(self, response: Response, include_body: bool = True) -> None:
            data = response.body.encode("utf-8")
            self.send_response(response.status)
            for key, value in response.headers.items():
                self.send_header(key, str(value))
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if include_body:
                self.wfile.write(data)

        def header_map(self) -> dict[str, str]:
            return {key: value for key, value in self.headers.items()}

    return Handler


def run() -> None:
    data_dir = Path(os.environ.get("XUI_MANAGER_DATA", "/opt/xui-manager-panel/data"))
    app = XuiManagerApp(data_dir / "app.db")
    admin_email = os.environ.get("ADMIN_EMAIL")
    admin_password = os.environ.get("ADMIN_PASSWORD")
    if admin_email and admin_password:
        app.db.seed_admin(admin_email, admin_password)
    host = os.environ.get("LISTEN_HOST", "0.0.0.0")
    port = int(os.environ.get("LISTEN_PORT", "25888"))
    server = ThreadingHTTPServer((host, port), make_handler(app))
    print(f"xui-manager-panel listening on {host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
