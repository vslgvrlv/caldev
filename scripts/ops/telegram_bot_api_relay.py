#!/usr/bin/env python3
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


UPSTREAM_BASE = os.environ.get("TELEGRAM_BOT_API_UPSTREAM", "https://api.telegram.org").rstrip("/")
LISTEN_HOST = os.environ.get("TELEGRAM_BOT_API_RELAY_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("TELEGRAM_BOT_API_RELAY_PORT", "18081"))
RELAY_TOKEN = os.environ.get("TELEGRAM_BOT_API_RELAY_TOKEN", "")


class RelayHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stdout.write("[telegram-relay] " + (fmt % args) + "\n")
        sys.stdout.flush()

    def do_POST(self):
        if RELAY_TOKEN and self.headers.get("X-Telegram-Relay-Token") != RELAY_TOKEN:
            payload = json.dumps({"ok": False, "description": "relay auth failed"}).encode("utf-8")
            self.send_response(403)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(content_length) if content_length > 0 else b""
        upstream_url = f"{UPSTREAM_BASE}{self.path}"
        req = Request(
            upstream_url,
            data=body,
            headers={"Content-Type": self.headers.get("Content-Type", "application/json")},
            method="POST",
        )

        try:
          with urlopen(req, timeout=15) as response:
              payload = response.read()
              self.send_response(response.getcode())
              self.send_header("Content-Type", response.headers.get("Content-Type", "application/json"))
              self.send_header("Content-Length", str(len(payload)))
              self.end_headers()
              self.wfile.write(payload)
        except HTTPError as error:
            payload = error.read()
            self.send_response(error.code)
            self.send_header("Content-Type", error.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except URLError as error:
            payload = json.dumps({"ok": False, "description": f"relay upstream failed: {error.reason}"}).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)


def main():
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), RelayHandler)
    print(f"telegram bot api relay listening on http://{LISTEN_HOST}:{LISTEN_PORT} -> {UPSTREAM_BASE}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
