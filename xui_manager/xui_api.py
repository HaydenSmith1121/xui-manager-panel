from __future__ import annotations

import json
import ssl
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar
from typing import Any


class XuiApiError(RuntimeError):
    pass


class XuiClient:
    def __init__(self, base_url: str, username: str, password: str, verify_tls: bool = True, timeout: int = 15):
        self.base_url = base_url.rstrip("/") + "/"
        self.username = username
        self.password = password
        self.timeout = timeout
        self.context = None if verify_tls else ssl._create_unverified_context()
        self.cookies = CookieJar()
        handlers: list[Any] = [urllib.request.HTTPCookieProcessor(self.cookies)]
        if self.context:
            handlers.append(urllib.request.HTTPSHandler(context=self.context))
        self.opener = urllib.request.build_opener(*handlers)

    def login(self) -> None:
        body = urllib.parse.urlencode({"username": self.username, "password": self.password}).encode("utf-8")
        response = self._request("login", data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            payload = json.loads(response)
        except json.JSONDecodeError:
            payload = {}
        if payload and payload.get("success") is False:
            raise XuiApiError(payload.get("msg") or "x-ui login failed")

    def list_inbounds(self) -> list[dict[str, Any]]:
        response = self._request("panel/api/inbounds/list")
        payload = json.loads(response)
        if payload.get("success") is False:
            raise XuiApiError(payload.get("msg") or "x-ui inbounds list failed")
        items = payload.get("obj") or []
        return items if isinstance(items, list) else []

    def _request(self, path: str, data: bytes | None = None, headers: dict[str, str] | None = None) -> str:
        url = urllib.parse.urljoin(self.base_url, path)
        request = urllib.request.Request(url, data=data, headers=headers or {})
        with self.opener.open(request, timeout=self.timeout) as response:
            return response.read().decode("utf-8", errors="replace")


def sync_usage_from_xui(db: Any) -> dict[str, Any]:
    users = [user for user in db.list_users() if user.get("role") == "user"]
    users_by_email = {user["email"].lower(): user for user in users}
    nodes_by_panel = group_nodes(db.list_nodes(), "panel_id")
    updated = 0
    errors: list[str] = []

    for panel in db.list_panels():
        if not panel.get("enabled") or panel["id"] not in nodes_by_panel:
            continue
        try:
            client = XuiClient(panel["base_url"], panel.get("username", ""), panel.get("password", ""), bool(panel.get("verify_tls", True)))
            client.login()
            inbounds = client.list_inbounds()
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{panel['name']}: {exc}")
            continue

        nodes = nodes_by_panel[panel["id"]]
        for node in nodes:
            inbound = find_inbound(inbounds, node)
            if not inbound:
                continue
            for stat in inbound.get("clientStats") or []:
                email = str(stat.get("email") or "").strip().lower()
                user = users_by_email.get(email)
                if not user:
                    continue
                db.record_usage(user["id"], node["id"], int(stat.get("up") or 0), int(stat.get("down") or 0))
                updated += 1

    return {"updated": updated, "errors": errors}


def group_nodes(nodes: list[dict[str, Any]], key: str) -> dict[int, list[dict[str, Any]]]:
    grouped: dict[int, list[dict[str, Any]]] = {}
    for node in nodes:
        value = node.get(key)
        if value:
            grouped.setdefault(int(value), []).append(node)
    return grouped


def find_inbound(inbounds: list[dict[str, Any]], node: dict[str, Any]) -> dict[str, Any] | None:
    inbound_id = int(node.get("inbound_id") or 0)
    if inbound_id:
        for inbound in inbounds:
            if int(inbound.get("id") or 0) == inbound_id:
                return inbound
    node_name = str(node.get("name") or "").strip()
    for inbound in inbounds:
        if str(inbound.get("remark") or "").strip() == node_name:
            return inbound
    return None
