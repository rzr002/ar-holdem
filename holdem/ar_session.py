"""Thread-safe, human-seat-only adapter for the spatial poker client."""

import random
from collections import deque
from copy import deepcopy
import threading
import uuid

from .agents import AgentError, Decision, ResilientAgent
from .engine import Action, Hand, Player

DEFAULT_MODEL = 'gpt-6-luna'
PRESENTATION_HISTORY = 64


# Seat identities stay stable even when a player runs out of chips. The final
# three display names reuse established strategy skills rather than silently
# falling back to the human/balanced profile for unknown persona keys.
SEATS = (
    ('YOU', 'you'),
    ('ATLAS', 'atlas'),
    ('NOVA', 'nova'),
    ('ORION', 'blaze'),
    ('LYRA', 'echo'),
    ('VEGA', 'moss'),
)


class Conflict(ValueError):
    """The client used an old revision or an unavailable operation."""


class TableSession:
    def __init__(self, agent=None, mode='lucas', seed=None, stack=500, model=DEFAULT_MODEL,
                 api_base_url=None, api_model=None, api_key_env='HOLDEM_API_KEY', api_timeout=30):
        if mode not in ('lucas', 'codex', 'local', 'strategic', 'api', 'test') or (mode == 'test' and agent is None):
            raise ValueError('Select lucas, codex, local, strategic or api explicitly')
        self.mode = mode
        if agent is not None:
            self.agent = agent
        elif mode == 'api':
            from .api_agent import OpenAICompatibleAgent
            self.agent = OpenAICompatibleAgent.from_env(
                base_url=api_base_url, model=api_model, key_env=api_key_env, timeout=api_timeout)
        else:
            self.agent = ResilientAgent(mode, model=model, timeout=90)
        self.session = uuid.uuid4().hex
        self.players = [Player(name, stack) for name, _profile in SEATS]
        self.rng = random.Random(seed)
        self.hand = None
        self.revision = 0
        self.error = self.source = ''
        self.observation_warning = ''
        self._thinking = self._closed = False
        self._lock = threading.RLock()
        self._cancel = threading.Event()
        self._worker = None
        self._initial_stacks = [p.stack for p in self.players]
        # Complete, human-seat snapshots let a polling client replay every
        # committed revision without reconstructing or inventing game state.
        self._presentation = deque(maxlen=PRESENTATION_HISTORY)

    def _check(self, revision):
        if type(revision) is not int:
            raise ValueError('revision must be an integer')
        if self._closed or revision != self.revision:
            raise Conflict('State changed; refresh before acting')

    def _snapshot_locked(self):
        state = self.hand.observation(0) if self.hand else {
            'hand': 0, 'seat': 0, 'button': 0, 'street': 'ready', 'hole': [], 'board': [],
            'pot': 0, 'big_blind': 10, 'players': [
                {'seat': i, 'name': p.name, 'stack': p.stack, 'bet': 0, 'committed': 0,
                 'folded': False, 'dealt_in': False} for i, p in enumerate(self.players)],
            'legal': {'actions': []}, 'history': [], 'action_history': []}
        done = bool(self.hand and self.hand.done)
        state.update(session=self.session, revision=self.revision, mode=self.mode,
                     table_size=len(self.players),
                     small_blind=self.hand.small_blind if self.hand else 5,
                     small_blind_seat=self.hand.sb if self.hand else None,
                     big_blind_seat=self.hand.bb if self.hand else None,
                     provider=self.agent.label, source=self.source, error=self.error,
                     observation_warning=self.observation_warning,
                     thinking=self._thinking, actor=self.hand.actor if self.hand else None,
                     done=done, results=list(self.hand.results) if done else [],
                     settlement=deepcopy(self.hand.settlement) if done else None,
                     net=[p.stack - self._initial_stacks[i] for i, p in enumerate(self.players)]
                     if done else [],
                     can_start=not self._closed and (self.hand is None or done) and
                     self.players[0].stack > 0 and sum(p.stack > 0 for p in self.players) >= 2)
        # Live hole cards stay private; only eligible showdown cards are disclosed in settlement.
        return state

    def _record_revision(self):
        """Save one detached, privacy-filtered visible state for this revision."""
        self._presentation.append(deepcopy(self._snapshot_locked()))

    def snapshot(self, after_revision=None, session=None):
        with self._lock:
            state = self._snapshot_locked()
            if after_revision is None and session is None:
                return state
            if type(after_revision) is not int or after_revision < 0:
                raise ValueError('after_revision must be a non-negative integer')
            presentation = {'frames': [], 'reset': True}
            if session == self.session and after_revision <= self.revision and self._presentation:
                oldest = self._presentation[0]['revision'] if self._presentation else self.revision + 1
                if after_revision >= oldest - 1:
                    presentation = {
                        'frames': [deepcopy(frame) for frame in self._presentation
                                   if frame['revision'] > after_revision],
                        'reset': False,
                    }
            state['presentation'] = presentation
            return state

    def new_hand(self, revision):
        with self._lock:
            self._check(revision)
            if not self.snapshot()['can_start']:
                raise Conflict('Finish the current hand first; funded human and opponent required')
            button = self.hand.next_button() if self.hand else 0
            number = self.hand.number + 1 if self.hand else 1
            self._initial_stacks = [p.stack for p in self.players]
            self.hand = Hand(self.players, button=button, rng=self.rng, number=number)
            self.error = self.source = ''
            self.observation_warning = ''
            self.revision += 1
            self._schedule()
            self._record_revision()
            return self.snapshot()

    def act(self, revision, kind, amount=0):
        with self._lock:
            self._check(revision)
            if self.hand is None or self.hand.done or self.hand.actor != 0 or self._thinking:
                raise Conflict('Wait for your turn')
            if not isinstance(kind, str) or type(amount) is not int:
                raise ValueError('Action and integer raise-to amount required')
            self.hand.act(Action(kind, amount))
            self.error = ''
            self.revision += 1
            self.observation_warning = ''
            self._observe_completed_hand()
            self._schedule()
            self._record_revision()
            return self.snapshot()

    def retry(self, revision):
        with self._lock:
            self._check(revision)
            if not self.error or self._thinking or self.hand is None or self.hand.done or self.hand.actor == 0:
                raise Conflict('No failed opponent turn to retry')
            self.error = ''
            self.revision += 1
            self._schedule()
            self._record_revision()
            return self.snapshot()

    def _schedule(self):
        if self.hand and not self.hand.done and self.hand.actor != 0:
            self._thinking = True
            self._worker = threading.Thread(target=self._opponents, name='ar-holdem-turn', daemon=True)
            self._worker.start()

    def _observe_completed_hand(self):
        if not (self.hand and self.hand.done and hasattr(self.agent, 'observe')):
            return
        # Skip stale policy sessions for seats no longer dealt into this hand.
        # Lucas compacts dealt-in seats, so observing a busted seat would raise
        # after the hand has already settled.
        sessions = getattr(getattr(self.agent, 'local', None), 'sessions', {})
        warnings = []
        for observed_seat in tuple(sessions):
            if not isinstance(observed_seat, int) or not 0 <= observed_seat < len(self.hand.players):
                continue
            if not self.hand.players[observed_seat].hole:
                continue
            try:
                # Each session receives only its own private cards plus public history.
                self.agent.observe(self.hand.observation(observed_seat))
            except Exception as error:
                # The poker action is already committed. Keep the table settled
                # and report learning-state failure separately from retryable turns.
                warnings.append(f'seat {observed_seat}: {type(error).__name__}')
        self.observation_warning = ('Lucas history update failed after hand completion (' +
                                    ', '.join(warnings) + '). The hand is complete.') if warnings else ''

    def _opponents(self):
        while True:
            with self._lock:
                if self._closed or self.hand.done or self.hand.actor == 0:
                    self._thinking = False
                    return
                revision, seat = self.revision, self.hand.actor
                obs = self.hand.observation(seat)
            try:
                decision = self.agent.decide(obs, SEATS[seat][1], cancel=self._cancel)
                if (not isinstance(decision, Decision) or not isinstance(decision.action, Action)
                        or not isinstance(decision.source, str)):
                    raise ValueError('Malformed opponent decision')
                with self._lock:
                    if self._closed or self._cancel.is_set() or self.revision != revision:
                        return
                    self.hand.act(decision.action)
                    self.source = decision.source
                    self.revision += 1
                    self.observation_warning = ''
                    self._observe_completed_hand()
                    # Finish this worker atomically with the action. Otherwise a
                    # fast Next Hand request could give the old worker a new
                    # hand to play alongside the newly scheduled worker.
                    if self.hand.done or self.hand.actor == 0:
                        self._thinking = False
                        self._record_revision()
                        return
                    self._record_revision()
            except Exception as error:
                with self._lock:
                    if not self._closed and self.revision == revision:
                        if isinstance(error, AgentError):
                            if self.mode == 'codex':
                                self.error = 'Codex request failed. Check Codex login, model and network, then Retry.'
                            elif self.mode == 'api':
                                self.error = 'API provider failed. Check API configuration, model and network, then Retry.'
                            elif self.mode == 'lucas':
                                self.error = f'Lucas v16 failed: {error}'
                            else:
                                self.error = f'{self.agent.label} failed: {error}'
                        elif isinstance(error, ValueError):
                            self.error = 'Opponent returned an invalid move. The hand is unchanged; Retry.'
                        else:
                            self.error = 'Opponent could not act. The hand is unchanged; Retry.'
                        self._thinking = False
                        self.revision += 1
                        self._record_revision()
                return

    def close(self):
        with self._lock:
            self._closed = True
            self._cancel.set()
            self._thinking = False
            worker = self._worker
        # CodexAgent observes cancellation and terminates/reaps its subprocess.
        # Give that cleanup time to finish before the server's main thread exits.
        if worker is not None and worker is not threading.current_thread():
            worker.join(timeout=2)
