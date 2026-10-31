import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import patch

from holdem.agents import AgentError
from holdem.api_agent import OpenAICompatibleAgent
from holdem.engine import Action, Hand, Player


class ApiAgentTests(unittest.TestCase):
    def setUp(self):
        self.obs = Hand([Player('YOU', 500), Player('BOT', 500)]).observation(0)

    def test_url_and_explicit_configuration(self):
        for value in ('https://user:secret@example.test/v1', 'https://example.test/v1?x=1',
                      'https://example.test/v1#frag', 'http://example.test/v1'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                OpenAICompatibleAgent(value, 'model', 'secret')
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ValueError):
                OpenAICompatibleAgent.from_env()
        with patch.dict(os.environ, {'HOLDEM_API_BASE_URL': 'http://localhost:8000/v1',
                                     'HOLDEM_API_MODEL': 'local-model', 'HOLDEM_API_KEY': 'secret'}, clear=True):
            agent = OpenAICompatibleAgent.from_env()
            self.assertEqual(agent.label, 'api:local-model')

    def test_config_overrides_and_key_env(self):
        with patch.dict(os.environ, {'HOLDEM_API_BASE_URL': 'https://wrong.example/v1',
                                     'HOLDEM_API_MODEL': 'wrong', 'CUSTOM_KEY': 'k'}, clear=True):
            agent = OpenAICompatibleAgent.from_env('https://right.example/v1', 'chosen', key_env='CUSTOM_KEY')
        self.assertEqual(agent.url, 'https://right.example/v1/chat/completions')
        self.assertEqual(agent.model, 'chosen')

    def serve(self, response_body, status=200, content_length=True):
        captured = {}

        class Handler(BaseHTTPRequestHandler):
            def do_POST(inner):
                captured['path'] = inner.path
                captured['auth'] = inner.headers.get('Authorization')
                captured['request'] = json.loads(inner.rfile.read(int(inner.headers['Content-Length'])))
                inner.send_response(status)
                inner.send_header('Content-Type', 'application/json')
                if content_length:
                    inner.send_header('Content-Length', str(len(response_body)))
                inner.end_headers()
                inner.wfile.write(response_body)

            def log_message(inner, *args):
                pass

        server = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f'http://127.0.0.1:{server.server_port}/v1', captured

    def test_local_mock_http_decision_and_prompt_privacy(self):
        payload = json.dumps({'choices': [{'message': {'content': json.dumps(
            {'action': 'call', 'amount': 0, 'reason': 'price'})}}]}).encode()
        base_url, captured = self.serve(payload)
        agent = OpenAICompatibleAgent(base_url, 'mock-model', 'secret-key')
        result = agent.decide(self.obs)
        self.assertEqual(result.action, Action('call'))
        self.assertEqual(result.source, 'api:mock-model')
        self.assertEqual(captured['path'], '/v1/chat/completions')
        self.assertEqual(captured['auth'], 'Bearer secret-key')
        self.assertEqual(captured['request']['model'], 'mock-model')
        user_text = captured['request']['messages'][1]['content']
        self.assertIn('hole', user_text)
        for card in self.obs['hole']:
            self.assertIn(card, user_text)
        self.assertNotIn('hole', json.dumps(self.obs['players']))
        self.assertNotIn('Hand(', user_text)
        self.assertNotIn('api_key', user_text)

    def test_unknown_content_length_is_bounded_and_supported(self):
        payload = json.dumps({'choices': [{'message': {'content': json.dumps(
            {'action': 'call', 'amount': 0, 'reason': 'price'})}}]}).encode()
        base_url, _ = self.serve(payload, content_length=False)
        self.assertEqual(OpenAICompatibleAgent(base_url, 'm', 'secret').decide(self.obs).action,
                         Action('call'))

    def test_malformed_illegal_and_http_errors_raise_safe_error(self):
        bad_payloads = [b'not json', b'{"choices":[]}', b'{"choices":[{"message":{"content":{}}}]}',
                        json.dumps({'choices': [{'message': {'content': '{"action":"raise","amount":999999}'}}]}).encode()]
        for payload in bad_payloads:
            base_url, _ = self.serve(payload)
            with self.subTest(payload=payload), self.assertRaises(AgentError):
                OpenAICompatibleAgent(base_url, 'm', 'secret').decide(self.obs)
        body = b'key=secret-token upstream detail'
        base_url, _ = self.serve(body, status=500)
        with self.assertRaises(AgentError) as caught:
            OpenAICompatibleAgent(base_url, 'm', 'secret-token').decide(self.obs)
        self.assertNotIn('secret-token', str(caught.exception))
        self.assertNotIn('upstream detail', str(caught.exception))

    def test_redirect_is_refused(self):
        redirected_to = []
        class Redirect(BaseHTTPRequestHandler):
            def do_POST(inner):
                inner.send_response(302)
                inner.send_header('Location', redirect_target)
                inner.end_headers()
            def log_message(inner, *args):
                pass

        class Destination(BaseHTTPRequestHandler):
            def do_POST(inner):
                redirected_to.append(inner.headers.get('Authorization'))
                inner.send_response(200)
                inner.end_headers()
            def log_message(inner, *args):
                pass

        destination = HTTPServer(('127.0.0.1', 0), Destination)
        dest_thread = threading.Thread(target=destination.serve_forever, daemon=True)
        dest_thread.start()
        self.addCleanup(dest_thread.join)
        self.addCleanup(destination.server_close)
        self.addCleanup(destination.shutdown)
        redirect_target = f'http://127.0.0.1:{destination.server_port}/steal'
        server = HTTPServer(('127.0.0.1', 0), Redirect)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        agent = OpenAICompatibleAgent(f'http://127.0.0.1:{server.server_port}/v1', 'm', 'secret')
        with self.assertRaisesRegex(AgentError, 'redirect refused'):
            agent.decide(self.obs)
        self.assertEqual(redirected_to, [])


if __name__ == '__main__':
    unittest.main()
