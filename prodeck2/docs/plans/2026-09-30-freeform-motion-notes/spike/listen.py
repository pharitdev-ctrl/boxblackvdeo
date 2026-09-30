import http.server, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        open(sys.argv[2], "a").write(f"{self.client_address[0]} GET {self.path}\n")
        self.send_response(200); self.send_header("Content-Type","text/html"); self.end_headers(); self.wfile.write(b"<html><body>hit</body></html>")
    do_POST = do_GET
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("0.0.0.0", int(sys.argv[1])), H).serve_forever()
