import io
import json
import socket
import unittest
import urllib.error
import urllib.parse

from xui_manager.xui_api import XuiApiError, XuiClient


BASE = "https://panel.example.com/"
UUID = "11111111-2222-4333-8444-555555555555"
EMAIL = "xum-u2-p1-i1"


def api_response(obj):
    return json.dumps(obj).encode("utf-8")


def inbound_with_clients(*clients, stats=None):
    return {
        "id": 1,
        "remark": "primary",
        "settings": json.dumps({"clients": list(clients)}),
        "clientStats": list(stats or []),
    }


def client_record(client_uuid=UUID, email=EMAIL, flow="xtls-rprx-vision", expire_ms=1_800_000_000_000, enabled=True):
    return {
        "id": client_uuid,
        "email": email,
        "flow": flow,
        "limitIp": 0,
        "totalGB": 0,
        "expiryTime": expire_ms,
        "enable": enabled,
        "tgId": "",
        "subId": "",
        "reset": 0,
    }


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def read(self):
        if isinstance(self.body, bytes):
            return self.body
        return str(self.body).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class FakeOpener:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def open(self, request, timeout=0):
        self.requests.append((request, timeout))
        if not self.responses:
            raise AssertionError("unexpected request")
        response = self.responses.pop(0)
        if callable(response):
            response = response(request)
        if isinstance(response, BaseException):
            raise response
        return FakeResponse(response)


def fake_opener(responses):
    return FakeOpener(responses)


def request_path(request):
    return urllib.parse.urlparse(request.full_url).path.lstrip("/")


def request_form(request):
    body = request.data.decode("utf-8")
    return urllib.parse.parse_qs(body)


class XuiClientTests(unittest.TestCase):
    def test_successful_login_list_and_get_inbound(self):
        inbound = inbound_with_clients(client_record(), stats=[{"email": EMAIL, "up": 10, "down": 20}])
        opener = fake_opener(
            [
                api_response({"success": True, "msg": "", "obj": None}),
                api_response({"success": True, "msg": "", "obj": [inbound]}),
                api_response({"success": True, "msg": "", "obj": inbound}),
            ]
        )
        client = XuiClient(BASE, "admin", "secret", opener=opener)

        client.login()
        inbounds = client.list_inbounds()
        fetched = client.get_inbound(1)

        self.assertEqual([request_path(req) for req, _ in opener.requests], ["login", "panel/api/inbounds/list", "panel/api/inbounds/get/1"])
        self.assertEqual(inbounds[0]["id"], 1)
        self.assertEqual(fetched["remark"], "primary")
        self.assertEqual(client.find_client(fetched, EMAIL)["id"], UUID)

    def test_add_vless_client_posts_form_and_verifies_by_readback(self):
        stored = client_record()
        opener = fake_opener(
            [
                api_response({"success": True, "msg": "", "obj": None}),
                api_response({"success": True, "msg": "", "obj": None}),
                api_response({"success": True, "msg": "", "obj": inbound_with_clients(stored)}),
            ]
        )
        client = XuiClient(BASE, "admin", "secret", opener=opener)
        client.login()

        created = client.add_vless_client(
            inbound_id=1,
            client_uuid=UUID,
            email=EMAIL,
            flow="xtls-rprx-vision",
            expire_at=1_800_000_000,
        )

        form = request_form(opener.requests[1][0])
        settings = json.loads(form["settings"][0])
        self.assertEqual(request_path(opener.requests[1][0]), "panel/api/inbounds/addClient")
        self.assertEqual(form["id"], ["1"])
        self.assertEqual(settings["clients"], [stored])
        self.assertEqual(created["id"], UUID)
        self.assertNotIn("secret", repr(client))

    def test_update_vless_client_posts_form_and_verifies_by_readback(self):
        stored = client_record(flow="", expire_ms=0, enabled=False)
        opener = fake_opener(
            [
                api_response({"success": True, "msg": "", "obj": None}),
                api_response({"success": True, "msg": "", "obj": None}),
                api_response({"success": True, "msg": "", "obj": inbound_with_clients(stored)}),
            ]
        )
        client = XuiClient(BASE, "admin", "secret", opener=opener)
        client.login()

        updated = client.update_vless_client(
            inbound_id=1,
            client_uuid=UUID,
            email=EMAIL,
            flow="",
            expire_at=0,
            enabled=False,
        )

        form = request_form(opener.requests[1][0])
        settings = json.loads(form["settings"][0])
        self.assertEqual(request_path(opener.requests[1][0]), f"panel/api/inbounds/updateClient/{UUID}")
        self.assertEqual(form["id"], ["1"])
        self.assertEqual(settings["clients"], [stored])
        self.assertEqual(updated["enable"], False)

    def test_empty_mutation_response_is_verified_by_readback(self):
        stored = client_record()
        opener = fake_opener(
            [
                api_response({"success": True, "msg": "", "obj": None}),
                b"",
                api_response({"success": True, "msg": "", "obj": inbound_with_clients(stored)}),
            ]
        )
        client = XuiClient(BASE, "admin", "secret", opener=opener)
        client.login()

        created = client.add_vless_client(
            inbound_id=1,
            client_uuid=UUID,
            email=EMAIL,
            flow="xtls-rprx-vision",
            expire_at=1_800_000_000,
        )

        self.assertEqual(created["email"], EMAIL)
        self.assertEqual(request_path(opener.requests[2][0]), "panel/api/inbounds/get/1")

    def test_json_failure_messages_are_converted_to_xui_api_error(self):
        client = XuiClient(BASE, "admin", "secret", opener=fake_opener([api_response({"success": False, "msg": "permission denied"})]))

        with self.assertRaisesRegex(XuiApiError, "permission denied"):
            client.login()

    def test_transport_http_url_and_json_errors_are_converted_and_redacted(self):
        failures = [
            socket.timeout(f"timed out secret {UUID}"),
            urllib.error.URLError(f"bad cookie=sessionid; secret {UUID}"),
            urllib.error.HTTPError(
                BASE + "panel/api/inbounds/list",
                502,
                "bad gateway",
                {},
                io.BytesIO(f"raw body secret cookie {UUID}".encode("utf-8")),
            ),
            b"{not-json secret cookie 11111111-2222-4333-8444-555555555555",
        ]
        for failure in failures:
            with self.subTest(failure=type(failure).__name__):
                client = XuiClient(BASE, "admin", "secret", opener=fake_opener([failure]))
                with self.assertRaises(XuiApiError) as raised:
                    client.list_inbounds()
                message = str(raised.exception)
                self.assertNotIn("secret", message)
                self.assertNotIn("cookie", message.lower())
                self.assertNotIn(UUID, message)
                self.assertNotIn("raw body", message)

    def test_client_traffic_returns_up_down_from_client_stats(self):
        inbound = inbound_with_clients(
            client_record(),
            stats=[{"email": "other@example.com", "up": 1, "down": 2}, {"email": EMAIL, "up": 123, "down": 456}],
        )
        client = XuiClient(BASE, "admin", "secret", opener=fake_opener([api_response({"success": True, "msg": "", "obj": [inbound]})]))

        self.assertEqual(client.client_traffic(EMAIL), {"up": 123, "down": 456})


if __name__ == "__main__":
    unittest.main()
