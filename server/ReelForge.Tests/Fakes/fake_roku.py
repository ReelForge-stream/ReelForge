#!/usr/bin/env python3
"""A stand-in Roku for the TV-updater test: ECP device-info, and the developer installer behind Digest auth.
Usage: fake_roku.py <ecp_port> <installer_port> <password> <out_dir>. Writes received zips to out_dir/installed.zip."""
import hashlib, http.server, os, re, secrets, sys, threading

ECP, INST, PASSWORD, OUT = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3], sys.argv[4]
REALM, NONCE = "rokudev", secrets.token_hex(16)
md5 = lambda s: hashlib.md5(s.encode()).hexdigest()


class Ecp(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"<device-info><serial-number>X00TEST1234</serial-number><model-name>TCL 4K</model-name></device-info>"
        self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def log_message(self, *a): pass


class Installer(http.server.BaseHTTPRequestHandler):
    def authorized(self):
        h = self.headers.get("Authorization", "")
        if not h.startswith("Digest "):
            return False
        f = dict(re.findall(r'(\w+)="?([^",]+)"?', h[7:]))
        ha1 = md5(f"{f.get('username')}:{REALM}:{PASSWORD}")
        ha2 = md5(f"{self.command}:{f.get('uri')}")
        want = md5(f"{ha1}:{f.get('nonce')}:{f.get('nc')}:{f.get('cnonce')}:{f.get('qop')}:{ha2}") if f.get("qop") else md5(f"{ha1}:{f.get('nonce')}:{ha2}")
        return f.get("username") == "rokudev" and f.get("response") == want

    def challenge(self):
        self.send_response(401)
        self.send_header("WWW-Authenticate", f'Digest qop="auth", realm="{REALM}", nonce="{NONCE}"')
        self.send_header("Content-Length", "0"); self.end_headers()

    def reply(self, text):
        body = text.encode()
        self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_GET(self):
        if not self.authorized():
            return self.challenge()
        self.reply("<html>Development Application Installer</html>")

    def do_POST(self):
        data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if not self.authorized():
            return self.challenge()
        m = re.search(rb'name="?archive"?; filename="?[^"\r\n]*"?\r\n(?:[^\r\n]*\r\n)*?\r\n(.*)\r\n--', data, re.S)
        if not m or b'name="mysubmit"' not in data and b"name=mysubmit" not in data:
            return self.reply('<font color="red">Install Failure: no archive</font>')
        open(os.path.join(OUT, "installed.zip"), "wb").write(m.group(1))
        self.reply("<html><font color='red'>Application Received: 1234 bytes stored.</font> Install Success.</html>")

    def log_message(self, *a): pass


for port, handler in ((ECP, Ecp), (INST, Installer)):
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
print("ready", flush=True)
threading.Event().wait()
