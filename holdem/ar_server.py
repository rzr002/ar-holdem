"""Local-only JSON bridge. Run: python3 -m holdem.ar_server [--mode strategic]."""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from urllib.parse import parse_qs, urlsplit

from .ar_session import DEFAULT_MODEL, Conflict, TableSession


def make_server(table, port=8765):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def local_host(self):
            # Loopback binding alone does not stop browser DNS rebinding.
            allowed = {'127.0.0.1', 'localhost',
                       f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
            if self.headers.get('Host', '').lower() not in allowed:
                self.send_json(403, {'error': 'Use the bridge through localhost or 127.0.0.1'})
                return False
            return True

        def send_json(self, status, body):
            raw = json.dumps(body, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            if not self.local_host():
                return
            parsed = urlsplit(self.path)
            if parsed.path != '/state':
                self.send_json(404, {'error': 'Not found'})
                return
            try:
                query = parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True)
            except ValueError:
                self.send_json(400, {'error': 'Invalid state cursor'})
                return
            if not set(query).issubset({'after_revision', 'session'}) or any(
                    len(values) != 1 for values in query.values()):
                self.send_json(400, {'error': 'Invalid state cursor'})
                return
            if not query:
                self.send_json(200, table.snapshot())
                return
            if set(query) != {'after_revision', 'session'}:
                self.send_json(400, {'error': 'after_revision and session must be provided together'})
                return
            try:
                raw_revision = query['after_revision'][0]
                if not raw_revision.isdecimal():
                    raise ValueError('after_revision must be a non-negative integer')
                state = table.snapshot(int(raw_revision), query['session'][0])
            except ValueError as error:
                self.send_json(400, {'error': str(error)})
                return
            self.send_json(200, state)

        def do_POST(self):
            if not self.local_host():
                return
            # No browser CORS permission: arbitrary websites cannot send JSON or read hole cards.
            if self.headers.get_content_type() != 'application/json':
                self.send_json(415, {'error': 'application/json required'})
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 4096:
                    raise ValueError('JSON body must be 1–4096 bytes')
                try:
                    data = json.loads(self.rfile.read(length))
                except RecursionError:
                    raise ValueError('JSON nesting is too deep') from None
                if not isinstance(data, dict):
                    raise ValueError('JSON object required')
                if data.get('session') != table.session:
                    raise Conflict('Bridge restarted; refresh the table')
                path = urlsplit(self.path).path
                if path == '/new':
                    state = table.new_hand(data.get('revision'))
                elif path == '/action':
                    state = table.act(data.get('revision'), data.get('action'), data.get('amount', 0))
                elif path == '/retry':
                    state = table.retry(data.get('revision'))
                else:
                    self.send_json(404, {'error': 'Not found'})
                    return
                self.send_json(200, state)
            except Conflict as error:
                self.send_json(409, {'error': str(error), 'state': table.snapshot()})
            except (ValueError, UnicodeDecodeError) as error:
                self.send_json(400, {'error': str(error)})

    return ThreadingHTTPServer(('127.0.0.1', port), Handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=('lucas', 'codex', 'strategic', 'local', 'api'), default='lucas')
    parser.add_argument('--model', default=DEFAULT_MODEL,
                        help=f'Codex model ID (default: {DEFAULT_MODEL})')
    parser.add_argument('--api-base-url', default=None, help='OpenAI-compatible API base URL (default: HOLDEM_API_BASE_URL)')
    parser.add_argument('--api-model', default=None, help='API model (default: HOLDEM_API_MODEL)')
    parser.add_argument('--api-key-env', default='HOLDEM_API_KEY', help='Environment variable holding API key')
    parser.add_argument('--api-timeout', type=float, default=30, help='API request timeout in seconds')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    try:
        table = TableSession(mode=args.mode, model=args.model, api_base_url=args.api_base_url,
                             api_model=args.api_model, api_key_env=args.api_key_env,
                             api_timeout=args.api_timeout)
    except (ValueError, ImportError) as error:
        parser.error(f'{args.mode} provider configuration failed: {error}')
    server = make_server(table, args.port)
    print(f'AR Hold’em bridge http://127.0.0.1:{server.server_port} | {table.agent.label}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        table.close()
        server.server_close()


if __name__ == '__main__':
    main()
