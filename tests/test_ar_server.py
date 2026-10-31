import http.client
import json
import threading
import time
import unittest

from holdem.agents import Decision
from holdem.ar_server import make_server
from holdem.ar_session import TableSession
from holdem.engine import Action


class CallingAgent:
    label = 'TEST / deterministic'

    def decide(self, obs, personality, cancel=None):
        return Decision(Action('check' if 'check' in obs['legal']['actions'] else 'call'), 'test')


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.table = TableSession(agent=CallingAgent(), mode='test', seed=4)
        self.server = make_server(self.table, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.table.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(1)

    def request(self, method, path, data=None, body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=2)
        request_headers = headers.copy() if headers else {}
        if data is not None:
            body = json.dumps(data)
            request_headers.setdefault('Content-Type', 'application/json')
        try:
            connection.request(method, path, body=body, headers=request_headers)
            response = connection.getresponse()
            raw = response.read()
            return response.status, dict(response.getheaders()), json.loads(raw)
        finally:
            connection.close()

    def payload(self, **extra):
        state = self.table.snapshot()
        return {'session': state['session'], 'revision': state['revision'], **extra}

    def wait_for_human(self):
        end = time.monotonic() + 3
        while self.table.snapshot()['thinking']:
            if time.monotonic() > end:
                self.fail('Background turn did not finish')
            time.sleep(.005)
        return self.table.snapshot()

    def test_state_and_new_are_json_without_cache_or_browser_cors(self):
        status, headers, state = self.request('GET', '/state')
        self.assertEqual(status, 200)
        self.assertIn('application/json', headers['Content-Type'])
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertNotIn('Access-Control-Allow-Origin', headers)
        self.assertEqual(state['mode'], 'test')
        self.assertEqual(state['table_size'], 6)
        self.assertEqual([p['name'] for p in state['players']],
                         ['YOU', 'ATLAS', 'NOVA', 'ORION', 'LYRA', 'VEGA'])
        self.assertIsNone(state['small_blind_seat'])
        self.assertIsNone(state['big_blind_seat'])
        status, _, state = self.request('POST', '/new', self.payload())
        self.assertEqual(status, 200)
        self.assertEqual(len(state['players']), 6)
        self.assertEqual((state['button'], state['small_blind_seat'], state['big_blind_seat']), (0, 1, 2))
        self.assertEqual(len(state['hole']), 2)
        self.assertNotIn('deck', state)
        self.assertTrue(all('hole' not in player for player in state['players']))

    def test_state_cursor_returns_ordered_presentation_frames(self):
        initial = self.table.snapshot()
        status, _, reset = self.request('GET', f"/state?after_revision=0&session={initial['session']}")
        self.assertEqual(status, 200)
        self.assertTrue(reset['presentation']['reset'])
        self.assertEqual(reset['presentation']['frames'], [])
        status, _, started = self.request('POST', '/new', self.payload())
        self.assertEqual(status, 200)
        self.wait_for_human()
        status, _, replay = self.request(
            'GET', f"/state?after_revision=0&session={started['session']}")
        self.assertEqual(status, 200)
        self.assertEqual([frame['revision'] for frame in replay['presentation']['frames']],
                         list(range(1, replay['revision'] + 1)))
        self.assertTrue(replay['presentation']['frames'])
        status, _, failure = self.request('GET', '/state?after_revision=0')
        self.assertEqual(status, 400)
        self.assertIn('error', failure)

    def test_stale_revision_and_wrong_session_return_refresh_state(self):
        old = self.payload()
        self.request('POST', '/new', old)
        self.wait_for_human()
        status, _, failure = self.request('POST', '/action', {**old, 'action': 'call'})
        self.assertEqual(status, 409)
        self.assertEqual(failure['state']['revision'], self.table.snapshot()['revision'])
        status, _, failure = self.request('POST', '/new', {**self.payload(), 'session': 'previous-server'})
        self.assertEqual(status, 409)
        self.assertIn('refresh', failure['error'])

    def test_invalid_requests_leave_the_hand_unchanged(self):
        self.request('POST', '/new', self.payload())
        self.wait_for_human()
        before = self.table.snapshot()
        cases = [
            ('/action', {'action': 'check'}),
            ('/action', {'action': 'raise', 'amount': True}),
            ('/action', {'action': 'raise', 'amount': 999999}),
            ('/action', {'action': []}),
            ('/action', {'action': 'call', 'revision': False}),
        ]
        for path, values in cases:
            with self.subTest(values=values):
                status, _, _ = self.request('POST', path, {**self.payload(), **values})
                self.assertEqual(status, 400)
                self.assertEqual(self.table.snapshot(), before)

    def test_malformed_or_oversized_json_is_rejected(self):
        for body in ('{', '[]', 'null', '{"amount": NaN}', 'x' * 4097, b'\xff', '[' * 1500 + ']' * 1500):
            with self.subTest(body=str(body)[:30]):
                status, _, failure = self.request('POST', '/new', body=body, headers={'Content-Type': 'application/json'})
                self.assertIn(status, (400, 409))
                self.assertIn('error', failure)
                self.assertEqual(self.table.snapshot()['revision'], 0)
        status, _, _ = self.request('POST', '/new', body='{}', headers={'Content-Type': 'text/plain'})
        self.assertEqual(status, 415)

    def test_unknown_routes_are_not_successful(self):
        for method in ('GET', 'POST'):
            status, _, _ = self.request(method, '/unknown', self.payload() if method == 'POST' else None)
            self.assertEqual(status, 404)

    def test_browser_dns_rebinding_host_cannot_read_private_state(self):
        self.request('POST', '/new', self.payload())
        status, _, state = self.request('GET', '/state', headers={'Host': 'untrusted.example'})
        self.assertEqual(status, 403)
        self.assertNotIn('hole', state)

    def test_two_concurrent_clicks_commit_once(self):
        self.request('POST', '/new', self.payload())
        self.wait_for_human()
        payload = self.payload(action='call')
        barrier = threading.Barrier(3)
        results = []
        def click():
            barrier.wait()
            results.append(self.request('POST', '/action', payload)[0])
        workers = [threading.Thread(target=click) for _ in range(2)]
        for worker in workers:
            worker.start()
        barrier.wait()
        for worker in workers:
            worker.join(2)
        self.assertEqual(sorted(results), [200, 409])
        hero_actions = [a for a in self.table.snapshot()['action_history'] if a['seat'] == 0]
        self.assertEqual(len(hero_actions), 1)

    def test_http_play_completes_a_six_seat_hand_with_private_state(self):
        self.request('POST', '/new', self.payload())
        for _ in range(20):
            self.wait_for_human()
            status, _, state = self.request('GET', '/state')
            self.assertEqual(status, 200)
            self.assertEqual(state['table_size'], 6)
            self.assertTrue(all('hole' not in p for p in state['players']))
            self.assertNotIn('deck', state)
            self.assertNotIn('review_board', state)
            if state['done']:
                break
            self.assertEqual(state['actor'], 0)
            action = 'check' if 'check' in state['legal']['actions'] else 'call'
            status, _, _ = self.request('POST', '/action', {
                'session': state['session'], 'revision': state['revision'], 'action': action})
            self.assertEqual(status, 200)
        self.assertTrue(state['done'])
        self.assertEqual({event['seat'] for event in state['action_history']}, set(range(6)))
        self.assertEqual(sum(p['stack'] for p in state['players']), 3000)
        self.assertEqual(len(state['net']), 6)
        self.assertEqual(sum(state['net']), 0)


if __name__ == '__main__':
    unittest.main()
