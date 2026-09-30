# python3 plog.py <port> <logfile> : a stand-in proxy that writes down the first line of whatever connects, then hangs up
import socketserver, sys
class H(socketserver.StreamRequestHandler):
    def handle(self):
        try: line = self.rfile.readline(2000).decode("latin1").strip()
        except Exception as e: line = f"(unreadable: {e})"
        open(sys.argv[2], "a").write(line + "\n")
socketserver.ThreadingTCPServer.allow_reuse_address = True
socketserver.ThreadingTCPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
