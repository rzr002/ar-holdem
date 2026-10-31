"""Optional OpenAI-compatible Chat Completions opponent."""

import ipaddress
import json
import os
import socket
import urllib.error
import urllib.parse
import urllib.request

from .agents import AgentError, Decision, parse_decision

MAX_RESPONSE_BYTES = 1_000_000
DEFAULT_TIMEOUT = 30
MAX_TIMEOUT = 120


def _validated_base_url(value):
    try:
        parsed = urllib.parse.urlsplit(value)
        host = parsed.hostname
        port = parsed.port
    except (TypeError, ValueError):
        raise ValueError('Invalid API base URL') from None
    if (parsed.scheme not in ('https', 'http') or not host or
            parsed.username is not None or parsed.password is not None or
            parsed.query or parsed.fragment):
        raise ValueError('API base URL must use https or localhost http without credentials, query, or fragment')
    if parsed.scheme == 'http':
        local = host.lower() == 'localhost'
        try:
            local = local or ipaddress.ip_address(host).is_loopback
        except ValueError:
            pass
        if not local:
            raise ValueError('Plain HTTP is allowed only for localhost')
    path = parsed.path.rstrip('/')
    if path.endswith('/chat/completions'):
        endpoint = parsed._replace(path=path).geturl()
    else:
        endpoint = parsed._replace(path=path + '/chat/completions').geturl()
    return endpoint


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class OpenAICompatibleAgent:
    """Calls a configured OpenAI-compatible endpoint; errors leave the hand untouched."""

    def __init__(self, base_url, model, api_key, timeout=DEFAULT_TIMEOUT):
        if not isinstance(model, str) or not model.strip():
            raise ValueError('An explicit model is required')
        if not isinstance(api_key, str) or not api_key:
            raise ValueError('An API key is required')
        if timeout is None:
            timeout = DEFAULT_TIMEOUT
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 0 < timeout <= MAX_TIMEOUT:
            raise ValueError(f'timeout must be greater than 0 and at most {MAX_TIMEOUT} seconds')
        self.url = _validated_base_url(base_url)
        self.model = model
        self._api_key = api_key
        self.timeout = float(timeout)
        self.label = f'api:{model}'
        self._opener = urllib.request.build_opener(_NoRedirect())

    @classmethod
    def from_env(cls, base_url=None, model=None, key_env='HOLDEM_API_KEY', timeout=None):
        base_url = base_url if base_url is not None else os.environ.get('HOLDEM_API_BASE_URL')
        model = model if model is not None else os.environ.get('HOLDEM_API_MODEL')
        api_key = os.environ.get(key_env)
        if not base_url:
            raise ValueError('HOLDEM_API_BASE_URL is required for API mode')
        if not model:
            raise ValueError('HOLDEM_API_MODEL is required for API mode')
        if not api_key:
            raise ValueError(f'{key_env} is required for API mode')
        return cls(base_url, model, api_key, timeout=timeout)

    def decide(self, obs, personality='balanced', cancel=None):
        if cancel is not None and cancel.is_set():
            raise InterruptedError('API decision cancelled')
        # Observation originates from Hand.observation(seat); explicitly constrain
        # the request to public table data and this player's own hole cards.
        allowed = ('hand', 'seat', 'button', 'street', 'hole', 'board', 'pot',
                   'big_blind', 'current_bet', 'players', 'legal', 'history',
                   'action_history', 'blind_posts')
        public_obs = {key: obs[key] for key in allowed if key in obs}
        prompt = ('Choose exactly one legal poker action. Return a JSON object with '
                  'action (fold/check/call/raise/allin), integer amount (raise-to amount '
                  'for raise, otherwise 0), and a short reason. Never invent a legal action. '
                  f'Player style: {personality}. Observation JSON: '
                  + json.dumps(public_obs, ensure_ascii=False, separators=(',', ':')))
        body = json.dumps({'model': self.model,
                           'messages': [{'role': 'system', 'content': 'You are a poker opponent. Output only the requested JSON object.'},
                                        {'role': 'user', 'content': prompt}],
                           'temperature': 0,
                           'response_format': {'type': 'json_object'}},
                          ensure_ascii=False).encode('utf-8')
        request = urllib.request.Request(self.url, data=body, method='POST', headers={
            'Authorization': f'Bearer {self._api_key}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        })
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                declared_size = response.headers.get('Content-Length')
                if declared_size is not None:
                    try:
                        declared_size = int(declared_size)
                        if declared_size < 0:
                            raise AgentError('API response had invalid size metadata')
                        if declared_size > MAX_RESPONSE_BYTES:
                            raise AgentError('API response exceeded size limit')
                    except ValueError:
                        raise AgentError('API response had invalid size metadata') from None
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                if len(raw) > MAX_RESPONSE_BYTES:
                    raise AgentError('API response exceeded size limit')
        except urllib.error.HTTPError as exc:
            if 300 <= exc.code < 400:
                raise AgentError('API endpoint redirected; redirect refused') from None
            raise AgentError(f'API request failed with HTTP {exc.code}') from None
        except (urllib.error.URLError, TimeoutError, socket.timeout, OSError) as exc:
            # Never include exception text: urllib errors can contain sensitive URLs.
            if isinstance(exc, (TimeoutError, socket.timeout)):
                raise AgentError('API request timed out') from None
            raise AgentError('API request failed') from None
        if cancel is not None and cancel.is_set():
            raise InterruptedError('API decision cancelled')
        try:
            response = json.loads(raw.decode('utf-8'))
            content = response['choices'][0]['message']['content']
            decision_data = json.loads(content)
            action = parse_decision(decision_data, obs)
        except (UnicodeDecodeError, json.JSONDecodeError, KeyError, IndexError, TypeError, ValueError) as exc:
            raise AgentError('API returned a malformed or illegal decision') from None
        return Decision(action, self.label, str(decision_data.get('reason', ''))[:200])
