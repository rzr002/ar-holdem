import json
import os
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from holdem.agents import AgentError, Decision
from holdem.engine import Action
from holdem.ar_session import Conflict, TableSession
from holdem.strategy import profile_for, skill_text


class CallingAgent:
    label = 'TEST / explicit deterministic opponent'

    def __init__(self):
        self.observations = []
        self.personalities = []

    def decide(self, obs, personality, cancel=None):
        self.observations.append(obs)
        self.personalities.append(personality)
        return Decision(Action('check' if 'check' in obs['legal']['actions'] else 'call'), 'test')


def wait_until(predicate, timeout=3):
    end = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > end:
            raise AssertionError('Background turn did not finish')
        time.sleep(.005)


class SessionTests(unittest.TestCase):
    def test_default_provider_is_real_lucas_and_codex_is_explicit(self):
        table = TableSession()
        self.addCleanup(table.close)
        self.assertEqual(table.mode, 'lucas')
        self.assertEqual(table.agent.label, 'LUCAS v16 / 本地')
        self.assertIsNone(table.agent.codex)
        self.assertEqual(len(table.players), 6)

        for requested, expected in (({'mode': 'codex'}, 'gpt-6-luna'),
                                    ({'mode': 'codex', 'model': 'custom-model'}, 'custom-model')):
            table = TableSession(**requested)
            self.addCleanup(table.close)
            self.assertEqual(table.agent.codex.model, expected)
            self.assertEqual(table.snapshot()['provider'], f'CODEX / {expected}')

    def test_api_provider_uses_explicit_configuration_without_requesting_endpoint(self):
        env = {'HOLDEM_API_BASE_URL': 'https://example.invalid/v1',
               'HOLDEM_API_MODEL': 'offline-test-model', 'HOLDEM_API_KEY': 'test-secret'}
        with patch.dict(os.environ, env, clear=False):
            table = TableSession(mode='api', api_timeout=4)
        self.addCleanup(table.close)
        self.assertEqual(table.agent.label, 'api:offline-test-model')
        self.assertEqual(table.agent.timeout, 4)
        self.assertEqual(table.mode, 'api')

    def test_api_mode_fails_clearly_when_configuration_is_missing(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, 'HOLDEM_API_BASE_URL is required'):
                TableSession(mode='api')

    def setUp(self):
        self.agent = CallingAgent()
        self.table = TableSession(agent=self.agent, mode='test', seed=42)
        self.addCleanup(self.table.close)

    def start_at_human(self):
        self.table.new_hand(self.table.snapshot()['revision'])
        wait_until(lambda: not self.table.snapshot()['thinking'])
        state = self.table.snapshot()
        self.assertEqual(state['actor'], 0)
        return state

    def finish_hand(self):
        for _ in range(100):
            wait_until(lambda: not self.table.snapshot()['thinking'])
            state = self.table.snapshot()
            if state['done']:
                return state
            self.assertEqual(state['actor'], 0)
            self.table.act(state['revision'], 'check' if 'check' in state['legal']['actions'] else 'call')
        self.fail('Hand did not finish')

    def test_ready_state_has_six_stable_seats(self):
        state = self.table.snapshot()
        self.assertEqual(state['table_size'], 6)
        self.assertEqual([p['seat'] for p in state['players']], list(range(6)))
        self.assertEqual([p['name'] for p in state['players']],
                         ['YOU', 'ATLAS', 'NOVA', 'ORION', 'LYRA', 'VEGA'])
        self.assertTrue(state['can_start'])
        self.assertEqual(state['small_blind'], 5)
        self.assertEqual(state['big_blind'], 10)
        self.assertIsNone(state['small_blind_seat'])
        self.assertIsNone(state['big_blind_seat'])

    def test_presentation_journal_replays_fast_actions_and_street_changes(self):
        started = self.table.new_hand(0)
        for _ in range(100):
            wait_until(lambda: not self.table.snapshot()['thinking'])
            latest = self.table.snapshot()
            if latest['done']:
                break
            self.table.act(latest['revision'], 'check' if 'check' in latest['legal']['actions'] else 'call')
        self.assertTrue(latest['done'])
        replay = self.table.snapshot(after_revision=0, session=started['session'])['presentation']
        frames = replay['frames']
        self.assertFalse(replay['reset'])
        self.assertEqual([frame['revision'] for frame in frames],
                         list(range(1, latest['revision'] + 1)))
        self.assertGreater(len(frames), 1)
        self.assertGreater(len({frame['street'] for frame in frames}), 1)
        self.assertTrue(all(frame['thinking'] ==
                            bool(not frame['done'] and frame['actor'] is not None and frame['actor'] != 0)
                            for frame in frames))
        self.assertTrue(all('hole' not in player for frame in frames for player in frame['players']))
        self.assertTrue(all(len(frame['hole']) == 2 for frame in frames))

    def test_presentation_journal_cursor_reset_and_detached_frames(self):
        started = self.table.new_hand(0)
        wait_until(lambda: not self.table.snapshot()['thinking'])
        state = self.table.snapshot()
        cursor = state['revision'] - 1
        replay = self.table.snapshot(after_revision=cursor, session=started['session'])
        self.assertFalse(replay['presentation']['reset'])
        self.assertEqual([frame['revision'] for frame in replay['presentation']['frames']], [state['revision']])
        replay['presentation']['frames'][0]['players'][0]['stack'] = -100
        self.assertNotEqual(self.table.snapshot()['players'][0]['stack'], -100)
        self.assertTrue(self.table.snapshot(after_revision=cursor, session='old-session')['presentation']['reset'])
        with self.table._lock:
            for _ in range(70):
                self.table.revision += 1
                self.table._record_revision()
        self.assertTrue(self.table.snapshot(after_revision=cursor, session=started['session'])['presentation']['reset'])

    def test_presentation_journal_bounds_history_and_rejects_bad_cursor(self):
        with self.table._lock:
            for _ in range(70):
                self.table.revision += 1
                self.table._record_revision()
        current = self.table.snapshot()
        reset = self.table.snapshot(after_revision=0, session=current['session'])['presentation']
        self.assertTrue(reset['reset'])
        recent = self.table.snapshot(after_revision=current['revision'] - 64, session=current['session'])
        self.assertFalse(recent['presentation']['reset'])
        self.assertEqual(len(recent['presentation']['frames']), 64)
        with self.assertRaises(ValueError):
            self.table.snapshot(after_revision=True, session=current['session'])

    def test_complete_hand_private_views_and_chip_conservation(self):
        state = self.table.new_hand(0)
        self.assertEqual(state['table_size'], 6)
        self.assertEqual((state['button'], state['small_blind_seat'], state['big_blind_seat']), (0, 1, 2))
        hero_hole = state['hole']
        total = sum(p['stack'] + p['committed'] for p in state['players'])
        self.assertEqual(total, 3000)
        for _ in range(100):
            wait_until(lambda: not self.table.snapshot()['thinking'])
            state = self.table.snapshot()
            if state['done']:
                break
            self.assertEqual(state['actor'], 0)
            self.assertEqual(len(state['hole']), 2)
            self.assertEqual(state['hole'], hero_hole)
            self.assertTrue(all('hole' not in p for p in state['players']))
            self.assertNotIn('deck', state)
            self.assertNotIn('review_board', state)
            self.assertIsNone(state['settlement'])
            self.assertNotIn('reveals', state)
            self.table.act(state['revision'], 'check' if 'check' in state['legal']['actions'] else 'call')
        self.assertTrue(state['done'])
        self.assertEqual(len(state['board']), 5)
        self.assertEqual(sum(p['stack'] for p in state['players']), total)
        self.assertEqual(len(state['net']), 6)
        self.assertEqual(sum(state['net']), 0)
        self.assertTrue(state['results'])
        self.assertEqual(state['source'], 'test')
        settlement = state['settlement']
        self.assertEqual(settlement['reason'], 'showdown')
        self.assertEqual(set(settlement['winners']),
                         {seat for pot in settlement['pots'] for seat in pot['winners']})
        self.assertEqual({entry['seat'] for entry in settlement['reveals']}, set(range(6)))
        self.assertTrue(all(len(entry['hole']) == 2 and entry['hand_name'] and entry['hand_label']
                            for entry in settlement['reveals']))
        self.assertEqual({obs['seat'] for obs in self.agent.observations}, {1, 2, 3, 4, 5})
        holes = {0: tuple(hero_hole)}
        profiles = {1: 'atlas', 2: 'nova', 3: 'blaze', 4: 'echo', 5: 'moss'}
        for obs, personality in zip(self.agent.observations, self.agent.personalities):
            self.assertIn(obs['seat'], profiles)
            self.assertEqual(personality, profiles[obs['seat']])
            self.assertEqual(profile_for(personality).key, personality)
            self.assertTrue(skill_text(personality))
            self.assertEqual(len(obs['players']), 6)
            self.assertEqual(len(obs['hole']), 2)
            self.assertEqual(tuple(obs['hole']), holes.setdefault(obs['seat'], tuple(obs['hole'])))
            self.assertTrue(set(obs['hole']).isdisjoint(obs['board']))
            self.assertTrue(all('hole' not in p for p in obs['players']))
            self.assertNotIn('deck', obs)
            self.assertNotIn('review_board', obs)
        self.assertEqual(len({card for hole in holes.values() for card in hole}), 12)
        self.assertTrue(set(state['board']).isdisjoint(card for hole in holes.values() for card in hole))
        again = self.table.new_hand(state['revision'])
        self.assertEqual(again['hand'], 2)
        self.assertIsNone(again['settlement'])
        self.assertEqual((again['button'], again['small_blind_seat'], again['big_blind_seat']), (1, 2, 3))
        self.assertGreater(again['revision'], state['revision'])

    def test_busted_seats_are_preserved_but_skipped_in_dealing_and_button_rotation(self):
        for seat in (1, 3):
            self.table.players[seat].stack = 0
        first = self.table.new_hand(0)
        self.assertEqual((first['button'], first['small_blind_seat'], first['big_blind_seat']), (0, 2, 4))
        self.assertEqual([p['seat'] for p in first['players']], list(range(6)))
        self.assertEqual([p['seat'] for p in first['players'] if p['dealt_in']], [0, 2, 4, 5])
        for seat in (1, 3):
            self.assertEqual(self.table.players[seat].hole, [])
        done = self.finish_hand()
        self.assertEqual({obs['seat'] for obs in self.agent.observations}, {2, 4, 5})
        self.assertTrue(all(event['seat'] not in (1, 3) for event in done['action_history']))
        self.assertEqual(sum(p['stack'] for p in done['players']), 2000)
        second = self.table.new_hand(done['revision'])
        self.assertEqual((second['button'], second['small_blind_seat'], second['big_blind_seat']), (2, 4, 5))
        done = self.finish_hand()
        third = self.table.new_hand(done['revision'])
        self.assertEqual((third['button'], third['small_blind_seat'], third['big_blind_seat']), (4, 5, 0))

    def test_heads_up_uses_funded_seat_ids_without_compacting_the_table(self):
        for seat in (1, 2, 3, 4):
            self.table.players[seat].stack = 0
        first = self.table.new_hand(0)
        self.assertEqual((first['button'], first['small_blind_seat'], first['big_blind_seat']), (0, 0, 5))
        done = self.finish_hand()
        self.assertEqual({obs['seat'] for obs in self.agent.observations}, {5})
        second = self.table.new_hand(done['revision'])
        self.assertEqual((second['button'], second['small_blind_seat'], second['big_blind_seat']), (5, 5, 0))
        self.assertEqual(len(second['players']), 6)

    def test_invalid_and_duplicate_actions_cannot_debit_chips(self):
        state = self.start_at_human()
        before = json.dumps(self.table.snapshot(), sort_keys=True)
        with self.assertRaises(ValueError):
            self.table.act(state['revision'], 'raise', 999999)
        self.assertEqual(json.dumps(self.table.snapshot(), sort_keys=True), before)
        with self.assertRaises(ValueError):
            self.table.act(state['revision'], 'raise', True)
        self.table.act(state['revision'], 'call')
        with self.assertRaises(Conflict):
            self.table.act(state['revision'], 'call')

    def test_model_error_keeps_turn_and_can_retry(self):
        class FailingAgent(CallingAgent):
            def decide(self, obs, personality, cancel=None):
                raise AgentError('model unavailable')
        state = self.start_at_human()
        self.table.agent = FailingAgent()
        committed = self.table.act(state['revision'], 'call')
        wait_until(lambda: bool(self.table.snapshot()['error']))
        state = self.table.snapshot()
        self.assertEqual(state['actor'], 1)
        self.assertFalse(state['thinking'])
        self.assertEqual(state['source'], 'test')
        self.assertEqual(state['players'], committed['players'])
        self.assertEqual(state['board'], committed['board'])
        self.assertEqual(state['action_history'], committed['action_history'])
        self.table.agent = self.agent
        self.table.retry(state['revision'])
        wait_until(lambda: not self.table.snapshot()['thinking'])
        self.assertFalse(self.table.snapshot()['error'])
        self.assertEqual(self.table.snapshot()['actor'], 0)
        history = self.table.snapshot()['action_history']
        self.assertEqual(sum(event['seat'] == 0 for event in history), 1)
        self.assertEqual(history[:len(committed['action_history'])], committed['action_history'])

    def test_late_seat_failure_preserves_private_turn_and_retries_once(self):
        class LateFailingAgent(CallingAgent):
            failed_observation = None

            def decide(self, obs, personality, cancel=None):
                if obs['seat'] == 5:
                    self.failed_observation = obs
                    raise AgentError('late-seat model unavailable')
                return super().decide(obs, personality, cancel)

        failing = LateFailingAgent()
        self.table.agent = failing
        self.table.new_hand(0)
        wait_until(lambda: bool(self.table.snapshot()['error']))
        state = self.table.snapshot()
        failed_obs = failing.failed_observation
        self.assertEqual(state['actor'], 5)
        self.assertFalse(state['thinking'])
        self.assertEqual([event['seat'] for event in state['action_history']], [3, 4])
        self.assertEqual(state['players'], failed_obs['players'])
        self.assertEqual(state['board'], failed_obs['board'])
        self.assertEqual(state['action_history'], failed_obs['action_history'])
        self.assertTrue(set(state['hole']).isdisjoint(failed_obs['hole']))
        self.table.agent = self.agent
        self.table.retry(state['revision'])
        wait_until(lambda: not self.table.snapshot()['thinking'])
        retried = self.table.snapshot()
        self.assertEqual(self.agent.observations[0], failed_obs)
        self.assertEqual(self.agent.personalities[0], 'moss')
        self.assertFalse(retried['error'])
        self.assertEqual(retried['actor'], 0)
        self.assertEqual([event['seat'] for event in retried['action_history']], [3, 4, 5])
        with self.assertRaises(Conflict):
            self.table.retry(state['revision'])

    def test_finishing_worker_cannot_also_play_the_next_hand(self):
        # Hold the old worker just after its settlement lock is released. A UI
        # can now press Next Hand before that worker has physically returned.
        settled, continue_old, started_next, duplicate, release_next = [threading.Event() for _ in range(5)]
        self.addCleanup(continue_old.set)
        self.addCleanup(release_next.set)
        table = self.table

        class SettlementGate:
            def __init__(self):
                self.lock = threading.RLock()
                self.used = False

            def __enter__(self):
                self.lock.acquire()

            def __exit__(self, *_args):
                gate = (not self.used and threading.current_thread().name == 'ar-holdem-turn'
                        and table.hand is not None and table.hand.done)
                if gate:
                    self.used = True
                self.lock.release()
                if gate:
                    settled.set()
                    continue_old.wait(2)

        class CountingAgent(CallingAgent):
            def __init__(self):
                super().__init__()
                self.next_calls = 0
                self.lock = threading.Lock()

            def decide(self, obs, personality, cancel=None):
                if obs['hand'] == 2:
                    with self.lock:
                        self.next_calls += 1
                        if self.next_calls > 1:
                            duplicate.set()
                    started_next.set()
                    release_next.wait(2)
                return super().decide(obs, personality, cancel)

        table._lock = SettlementGate()
        table.agent = CountingAgent()
        state = self.start_at_human()
        table.act(state['revision'], 'fold')
        self.assertTrue(settled.wait(1))
        state = table.snapshot()
        self.assertTrue(state['done'])
        table.new_hand(state['revision'])
        self.assertTrue(started_next.wait(1))
        continue_old.set()
        self.assertFalse(duplicate.wait(.2), 'old and new workers both requested a model decision')

    def test_internal_agent_error_does_not_expose_arbitrary_exception_text(self):
        class BrokenAgent(CallingAgent):
            def decide(self, obs, personality, cancel=None):
                raise RuntimeError('private credential: test-secret-value')
        state = self.start_at_human()
        self.table.agent = BrokenAgent()
        self.table.act(state['revision'], 'call')
        wait_until(lambda: bool(self.table.snapshot()['error']))
        state = self.table.snapshot()
        self.assertNotIn('test-secret-value', state['error'])
        self.assertIn('Retry', state['error'])
        self.assertEqual(state['actor'], 1)

    def test_malformed_agent_result_is_validated_before_mutating_the_hand(self):
        class MalformedAgent(CallingAgent):
            def decide(self, obs, personality, cancel=None):
                return type('MissingSource', (), {'action': Action('call')})()
        state = self.start_at_human()
        self.table.agent = MalformedAgent()
        committed = self.table.act(state['revision'], 'call')
        wait_until(lambda: bool(self.table.snapshot()['error']))
        failed = self.table.snapshot()
        self.assertEqual(failed['players'], committed['players'])
        self.assertEqual(failed['actor'], committed['actor'])
        self.assertEqual(failed['action_history'], committed['action_history'])

    def test_new_hand_rejected_during_live_play(self):
        state = self.start_at_human()
        with self.assertRaises(Conflict):
            self.table.new_hand(state['revision'])

    def test_closed_session_discards_late_agent_result(self):
        entered, release = threading.Event(), threading.Event()
        class SlowAgent(CallingAgent):
            def decide(self, obs, personality, cancel=None):
                entered.set()
                release.wait(2)
                return Decision(Action('call'), 'test')
        state = self.start_at_human()
        self.table.agent = SlowAgent()
        self.table.act(state['revision'], 'call')
        self.assertTrue(entered.wait(1))
        self.table.close()
        before = self.table.snapshot()
        release.set()
        time.sleep(.03)
        self.assertEqual(self.table.snapshot(), before)

    def test_close_waits_for_cancelled_agent_to_clean_up(self):
        entered, cleaned = threading.Event(), threading.Event()

        class CancellableAgent(CallingAgent):
            def decide(self, obs, personality, cancel=None):
                entered.set()
                cancel.wait(2)
                time.sleep(.03)  # Stand-in for terminating/reaping the CLI child.
                cleaned.set()
                raise InterruptedError('cancelled')

        state = self.start_at_human()
        self.table.agent = CancellableAgent()
        self.table.act(state['revision'], 'call')
        self.assertTrue(entered.wait(1))
        self.table.close()
        self.assertTrue(cleaned.is_set(), 'server exit must allow the daemon worker to reap its child')

    def test_revision_types_are_strict(self):
        for bad in (False, None, '0'):
            with self.assertRaises(ValueError):
                self.table.new_hand(bad)

    def test_lucas_plays_a_hand_and_observes_completed_hand_before_next(self):
        from holdem.lucas import LucasAgent
        table = TableSession(mode='lucas', seed=29)
        self.addCleanup(table.close)
        self.assertIsInstance(table.agent.local, LucasAgent)
        for _hand in range(2):
            state = table.new_hand(table.snapshot()['revision'])
            for _ in range(150):
                wait_until(lambda: not table.snapshot()['thinking'])
                state = table.snapshot()
                if state['done']:
                    break
                if state['actor'] == 0:
                    table.act(state['revision'], 'check' if 'check' in state['legal']['actions'] else 'call')
            self.assertTrue(table.snapshot()['done'], 'Lucas and the human policy must complete the hand')
            self.assertTrue(table.agent.local.sessions)
            self.assertEqual(table.snapshot()['provider'], 'LUCAS v16 / 本地')

    def test_uncontested_bridge_settlement_does_not_reveal_opponent_holes(self):
        class FoldingAgent(CallingAgent):
            def decide(self, obs, personality, cancel=None):
                self.observations.append(obs)
                self.personalities.append(personality)
                return Decision(Action('fold'), 'test')

        table = TableSession(agent=FoldingAgent(), mode='test', seed=8)
        self.addCleanup(table.close)
        state = table.new_hand(table.snapshot()['revision'])
        self.assertIsNone(state['settlement'])
        for _ in range(30):
            wait_until(lambda: not table.snapshot()['thinking'])
            state = table.snapshot()
            if state['done']:
                break
            self.assertEqual(state['actor'], 0)
            table.act(state['revision'], 'fold')
        state = table.snapshot()
        self.assertTrue(state['done'])
        self.assertEqual(state['settlement']['reason'], 'uncontested')
        self.assertEqual(len(state['settlement']['winners']), 1)
        self.assertEqual(state['settlement']['reveals'], [])
        self.assertTrue(all('hole' not in player for player in state['players']))

    def test_completed_hand_observation_skips_busted_seat_sessions_on_next_hand(self):
        class LucasLikeAgent(CallingAgent):
            def __init__(self):
                super().__init__()
                self.local = SimpleNamespace(sessions={1: object(), 2: object()})
                self.observed_seats = []

            def observe(self, obs):
                self.assert_dealt(obs)
                self.observed_seats.append(obs['seat'])

            @staticmethod
            def assert_dealt(obs):
                if not obs['players'][obs['seat']]['dealt_in']:
                    raise KeyError('Lucas seat is not dealt into this hand')

        agent = LucasLikeAgent()
        table = TableSession(agent=agent, mode='test', seed=14)
        self.addCleanup(table.close)

        def finish_hand():
            table.new_hand(table.snapshot()['revision'])
            for _ in range(150):
                wait_until(lambda: not table.snapshot()['thinking'])
                state = table.snapshot()
                if state['done']:
                    return state
                table.act(state['revision'], 'check' if 'check' in state['legal']['actions'] else 'call')
            self.fail('Hand did not finish')

        self.assertTrue(finish_hand()['done'])
        self.assertEqual(set(agent.observed_seats), {1, 2})
        table.players[1].stack = 0
        agent.observed_seats.clear()

        self.assertTrue(finish_hand()['done'])
        self.assertEqual(agent.observed_seats, [2])
        self.assertEqual(table.snapshot()['observation_warning'], '')

    def test_observer_failure_after_hand_settlement_does_not_stick_or_offer_retry(self):
        class BrokenObserver(CallingAgent):
            local = SimpleNamespace(sessions={1: object()})

            def observe(self, _obs):
                raise RuntimeError('statistics backend failure')

        table = TableSession(agent=BrokenObserver(), mode='test', seed=17)
        self.addCleanup(table.close)
        table.new_hand(table.snapshot()['revision'])
        for _ in range(150):
            wait_until(lambda: not table.snapshot()['thinking'])
            state = table.snapshot()
            if state['done']:
                break
            table.act(state['revision'], 'check' if 'check' in state['legal']['actions'] else 'call')

        state = table.snapshot()
        self.assertTrue(state['done'])
        self.assertFalse(state['thinking'])
        self.assertEqual(state['error'], '')
        self.assertIn('RuntimeError', state['observation_warning'])
        self.assertIn('hand completion', state['observation_warning'])


if __name__ == '__main__':
    unittest.main()
