from __future__ import annotations

import base64
import json
import re
import time
import urllib.parse
from dataclasses import dataclass, field
from typing import Any

from .billing import calculate_billable_usage


SHARE_LINK_RE = re.compile(r"(?im)\b(vless|vmess|trojan|ss)://[^\s]+")


@dataclass
class Response:
    status: int
    body: str
    headers: dict[str, str] = field(default_factory=dict)


def build_clash_subscription(db: Any, token: str) -> Response:
    user = db.get_user_by_token(token)
    if not user:
        return Response(404, "not found\n", {"Content-Type": "text/plain; charset=utf-8"})
    if user["status"] != "active":
        return subscription_response([], 0, user.get("quota_bytes", 0), user.get("expire_at", 0), "Account inactive")

    usage_items = db.usage_for_user(user["id"])
    used = calculate_billable_usage(usage_items)
    quota = int(user.get("quota_bytes", 0) or 0)
    expire_at = int(user.get("expire_at", 0) or 0)
    if quota and used >= quota:
        return subscription_response([], used, quota, expire_at, "Traffic exhausted")
    if expire_at and expire_at < int(time.time()):
        return subscription_response([], used, quota, expire_at, "Expired")

    plan = db.get_plan(user["plan_id"])
    allowed_tags = set(plan["allowed_tags"] if plan else [])
    nodes = []
    for node in db.list_nodes(enabled_only=True):
        if allowed_tags and not (allowed_tags & set(node["tags"])):
            continue
        proxy = node_to_proxy(node)
        if proxy:
            nodes.append(proxy)
    return subscription_response(nodes, used, quota, expire_at, user["email"])


def subscription_response(nodes: list[dict[str, Any]], used: int, quota: int, expire_at: int, title: str) -> Response:
    group_name = "Proxy"
    names = [node["name"] for node in nodes]
    payload = {
        "mixed-port": 7890,
        "allow-lan": False,
        "mode": "rule",
        "log-level": "info",
        "proxies": nodes,
        "proxy-groups": [{"name": group_name, "type": "select", "proxies": names + ["DIRECT"]}],
        "rules": [f"MATCH,{group_name}"],
    }
    title_b64 = base64.b64encode(title.encode("utf-8")).decode("ascii")
    return Response(
        200,
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        {
            "Content-Type": "text/yaml; charset=utf-8",
            "Subscription-Userinfo": f"upload=0; download={used}; total={quota}; expire={expire_at}",
            "Profile-Title": title_b64,
            "Profile-Update-Interval": "12",
            "Cache-Control": "no-store",
        },
    )


def node_to_proxy(node: dict[str, Any]) -> dict[str, Any] | None:
    source = node["source_url"].strip()
    links = extract_links(source)
    if not links:
        return None
    proxy = share_link_to_proxy(links[0])
    if proxy:
        proxy["name"] = node["name"]
    return proxy


def extract_links(text: str) -> list[str]:
    if "://" in text:
        return [match.group(0) for match in SHARE_LINK_RE.finditer(text)]
    try:
        decoded = base64.b64decode(text + "=" * (-len(text) % 4)).decode("utf-8", errors="replace")
    except Exception:
        return []
    return [match.group(0) for match in SHARE_LINK_RE.finditer(decoded)]


def share_link_to_proxy(link: str) -> dict[str, Any] | None:
    if link.startswith("vless://"):
        return vless_to_proxy(link)
    if link.startswith("trojan://"):
        return trojan_to_proxy(link)
    return None


def vless_to_proxy(link: str) -> dict[str, Any]:
    parsed = urllib.parse.urlparse(link)
    query = urllib.parse.parse_qs(parsed.query)
    security = (first(query, "security") or "").lower()
    network = first(query, "type") or first(query, "network") or "tcp"
    proxy: dict[str, Any] = {
        "name": urllib.parse.unquote(parsed.fragment) or parsed.hostname or "vless",
        "type": "vless",
        "server": parsed.hostname or "",
        "port": parsed.port or 443,
        "uuid": urllib.parse.unquote(parsed.username or ""),
        "network": network,
        "udp": True,
    }
    if security and security != "none":
        proxy["tls"] = security in {"tls", "reality"}
    sni = first(query, "sni") or first(query, "servername")
    if sni:
        proxy["servername"] = sni
    if network == "ws":
        host = first(query, "host")
        path = urllib.parse.unquote(first(query, "path") or "/")
        proxy["ws-opts"] = {"path": path}
        if host:
            proxy["ws-opts"]["headers"] = {"Host": host}
    return {k: v for k, v in proxy.items() if v not in ("", None, {}, [])}


def trojan_to_proxy(link: str) -> dict[str, Any]:
    parsed = urllib.parse.urlparse(link)
    query = urllib.parse.parse_qs(parsed.query)
    return {
        "name": urllib.parse.unquote(parsed.fragment) or parsed.hostname or "trojan",
        "type": "trojan",
        "server": parsed.hostname or "",
        "port": parsed.port or 443,
        "password": urllib.parse.unquote(parsed.username or ""),
        "sni": first(query, "sni") or parsed.hostname or "",
        "udp": True,
    }


def first(query: dict[str, list[str]], key: str) -> str | None:
    values = query.get(key)
    return values[0] if values else None
