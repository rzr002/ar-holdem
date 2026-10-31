import json
import os
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import patch

from holdem.ar_session import TableSession
from holdem.engine import Action


def wait_until(predicate, timeout=12):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.01)
    raise AssertionError('TableSession did not reach expected state')


class MockChatCompletions:
    def __init__(self, fail_first=0):
        self.requests = []
        self.fail_first = fail_first

        owner = self
        class Handler(BaseHTTPRequestHandler):
            def do_POST(inner):
                raw = inner.rfile.read(int(inner.headers['Content-Length']))
                request = json.loads(raw)
                user_message = request['messages'][1]['content']
                obs = json.loads(user_message.split('Observation JSON:', 1)[1].strip())
                owner.requests.append({
                    'auth': inner.headers.get('Authorization'),
                    'request': request,
                    'obs': obs,
                })
                if len(owner.requests) <= owner.fail_first:
                    inner.send_response(500)
                    body = b'upstream secret=super-secret do not leak'
                else:
                    legal = obs['legal']['actions']
                    choice = 'check' if 'check' in legal else 'call'
                    body = json.dumps({'choices': [{'message': {'content': json.dumps(
                        {'action': choice, 'amount': 0, 'reason': 'mock passive action'})}}]}).encode()
                    inner.send_response(200)
                inner.send_header('Content-Type', 'application/json')
                inner.send_header('Content-Length', str(len(body)))
                inner.end_headers()
                inner.wfile.write(body)

            def log_message(inner, *args):
                pass

        self.server = HTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f'http://127.0.0.1:{self.server.server_port}/v1'

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()


class ApiSessionTests(unittest.TestCase):
    def setUp(self):
        self.mock = MockChatCompletions()
        self.addCleanup(self.mock.close)
        self.env = patch.dict(os.environ, {
            'HOLDEM_API_BASE_URL': self.mock.base_url,
            'HOLDEM_API_MODEL': 'mock-poker-model',
            'HOLDEM_API_KEY': 'test-secret-key',
        })
        self.env.start()
        self.addCleanup(self.env.stop)

    def make_api_table(self, fail_first=0):
        self.mock.fail_first = fail_first
        table = TableSession(mode='api', seed=20261029, stack=500, api_timeout=2)
        self.addCleanup(table.close)
        return table

    def play_one_hand(self, table):
        state = table.new_hand(table.snapshot()['revision'])
        for _ in range(100):
            wait_until(lambda: not table.snapshot()['thinking'] or bool(table.snapshot()['error']))
            state = table.snapshot()
            self.assertFalse(state['error'], state['error'])
            if state['done']:
                return state
            self.assertEqual(state['actor'], 0)
            action = 'check' if 'check' in state['legal']['actions'] else 'call'
            state = table.act(state['revision'], action)
        self.fail('Hand did not complete within 100 human actions')

    def assert_private_views(self, records, expected_hands):
        self.assertTrue(records)
        seen = {}
        seats_by_hand = {}
        personalities = {1: 'atlas', 2: 'nova', 3: 'blaze', 4: 'echo', 5: 'moss'}
        for record in records:
            obs = record['obs']
            request = record['request']
            self.assertEqual(record['auth'], 'Bearer test-secret-key')
            self.assertEqual(request['model'], 'mock-poker-model')
            self.assertIn(f"Player style: {personalities[obs['seat']]}.", request['messages'][1]['content'])
            self.assertEqual(len(obs['hole']), 2)
            self.assertEqual(len(obs['players']), 6)
            self.assertTrue(all('hole' not in player for player in obs['players']))
            self.assertNotIn('deck', obs)
            self.assertNotIn('review_board', obs)
            self.assertTrue(set(obs['hole']).isdisjoint(obs['board']))
            key = (obs['hand'], obs['seat'])
            seen.setdefault(key, tuple(obs['hole']))
            self.assertEqual(seen[key], tuple(obs['hole']))
            seats_by_hand.setdefault(obs['hand'], set()).add(obs['seat'])
        for hand in expected_hands:
            self.assertEqual(seats_by_hand.get(hand), {1, 2, 3, 4, 5})
            holes = [seen[(hand, seat)] for seat in range(1, 6)]
            self.assertEqual(len({card for hole in holes for card in hole}), 10)

    def test_api_session_full_six_seat_hands_and_next_hand(self):
        table = self.make_api_table()
        first = self.play_one_hand(table)
        self.assertTrue(first['done'])
        self.assertEqual(sum(player['stack'] for player in first['players']), 3000)
        self.assertEqual(sum(first['net']), 0)
        self.assertTrue(first['results'])
        self.assertEqual(first['source'], 'api:mock-poker-model')

        second = self.play_one_hand(table)
        self.assertEqual(second['hand'], 2)
        self.assertEqual(sum(player['stack'] for player in second['players']), 3000)
        self.assertEqual(sum(second['net']), 0)
        self.assertEqual(second['source'], 'api:mock-poker-model')
        self.assert_private_views(self.mock.requests, {1, 2})

    def test_api_error_is_sanitized_and_revision_can_retry(self):
        table = self.make_api_table(fail_first=1)
        table.new_hand(table.snapshot()['revision'])
        wait_until(lambda: bool(table.snapshot()['error']))
        failed = table.snapshot()
        self.assertNotEqual(failed['actor'], 0)
        self.assertFalse(failed['thinking'])
        self.assertIn('API provider failed', failed['error'])
        self.assertNotIn('super-secret', failed['error'])
        self.assertNotIn('test-secret-key', failed['error'])
        self.assertEqual(failed['source'], '')
        history = list(failed['action_history'])
        players = list(failed['players'])

        retried = table.retry(failed['revision'])
        self.assertGreater(retried['revision'], failed['revision'])
        wait_until(lambda: table.snapshot()['actor'] == 0 or bool(table.snapshot()['error']))
        recovered = table.snapshot()
        self.assertFalse(recovered['error'])
        self.assertEqual(recovered['actor'], 0)
        self.assertEqual(recovered['action_history'][:len(history)], history)
        self.assertNotEqual(recovered['players'], players)
        self.assertEqual(recovered['source'], 'api:mock-poker-model')

    def test_default_mode_never_requests_configured_api_endpoint(self):
        table = TableSession(seed=19, stack=500)
        self.addCleanup(table.close)
        self.assertEqual(table.mode, 'lucas')
        table.new_hand(table.snapshot()['revision'])
        wait_until(lambda: table.snapshot()['actor'] == 0 or bool(table.snapshot()['error']))
        state = table.snapshot()
        self.assertFalse(state['error'], state['error'])
        self.assertEqual(state['actor'], 0)
        self.assertEqual(state['provider'], 'LUCAS v16 / 本地')
        self.assertEqual(self.mock.requests, [])


if __name__ == '__main__':
    unittest.main()
