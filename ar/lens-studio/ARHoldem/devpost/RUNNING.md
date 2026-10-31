# Run AR Hold’em from a fresh checkout

This guide covers the local Lens Studio desktop preview. Clone the [public repository](https://github.com/rzr002/ar-holdem) and run these commands from its root. It does not require physical SPECS glasses or publish the Lens. The bridge binds to loopback (`127.0.0.1`) and the preview must run on the same computer.

```bash
git clone https://github.com/rzr002/ar-holdem.git
cd ar-holdem
```

## 1. Prepare Python

Use Python 3.11 or later. From the repository root:

```bash
python3 --version
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements-lucas.txt
```

The pinned `eval7` dependency is needed by the default Lucas v16 opponent. The launcher automatically prefers `.venv/bin/python`. To use another Python, set `AR_HOLDEM_PYTHON` to that interpreter; Lucas mode still needs the `eval7` package installed in it.

## 2. Start the local game

From the repository root:

```bash
./ar/run.sh
```

The default is `--mode lucas`: five local, programmatic opponents, no account login and no API key. Lucas uses poker rules, hand-strength/equity evaluation and strategy logic. It is not an LLM, reinforcement-learning system, or a policy with downloaded model weights.

Keep the terminal open while playing. Stop the server with Ctrl+C. Game state is in memory; restarting starts a fresh table. To choose another port:

```bash
./ar/run.sh --port 8766
```

Then change the Lens component's `serverUrl` to `http://127.0.0.1:8766`.

## 3. Open the Lens Studio project

1. Install Lens Studio 5.22 or later; this project was prepared with Lens Studio 5.23.2.
2. Open `ar/lens-studio/ARHoldem/SpecsBaseTemplate.esproj`.
3. Use the SPECS Interactive Preview. The project is prepared to use Evening Room for contrast.
4. Confirm the main component's `serverUrl` is `http://127.0.0.1:8765` (or the port selected above).
5. Click `Deal`, then use preview mouse interaction to play. All chips are virtual.

Opponent cards remain concealed during betting. At showdown, only non-folded participants reveal their cards and English hand categories. The central result shows the main-pot winner and rank/kicker explanation; gold `WINNER` or `SPLIT WINNER` labels identify actual pot recipients, including side-pot winners whose net result is not positive. Uncontested hands reveal no opponent cards. `Next hand` clears the result labels and conceals opponents' cards again.

For scripted desktop hand interaction, run the included LEAF `ar-holdem-ik-reach` scenario with the local Lucas or another explicitly selected offline bridge. The scenario creates simulated SIK hands and performs a raycast/pinch that advances one legal human action. Position the preview camera at `(0, 0, 0)` facing the action buttons before running it; the test restores its starting camera pose afterward. Preview camera movement and simulated hands do not establish physical-glasses tracking or comfort.

If the local HTTP request is blocked, check the project setting **Allow Experimental API**. This local HTTP bridge is for same-computer preview. On glasses, `127.0.0.1` refers to the glasses themselves; real-device networking needs a separately reachable service and an appropriate secure endpoint.

## 4. Optional opponent modes

### Codex CLI

```bash
./ar/run.sh --mode codex
```

Requires an installed and configured Codex CLI. Default model: `gpt-6-luna`; override with `--model MODEL_ID`. Starting the bridge alone makes no model request. Requests begin on an opponent turn and use the configured account's allowance.

### OpenAI-compatible Chat Completions API

Set endpoint and model, then name the environment variable that contains your own key:

```bash
export HOLDEM_API_BASE_URL="https://api.example.invalid/v1"
export HOLDEM_API_MODEL="your-model-name"
# In Bash, enter the key without echoing it or storing it in this file:
read -s -p "API key: " HOLDEM_API_KEY; echo
export HOLDEM_API_KEY
./ar/run.sh --mode api
```

Replace the example URL/model with your provider's values. The key is read silently in the terminal and is never stored in this file; do not commit it or include it in screenshots, logs, issue reports or the public demo. Equivalent options are `--api-base-url URL`, `--api-model NAME`, and `--api-key-env ENV_NAME`; the default key variable is `HOLDEM_API_KEY`. `--api-timeout` accepts up to 120 seconds. Plain HTTP is accepted only for localhost/loopback URLs; remote API endpoints must use HTTPS. API mode is optional and is not called unless selected and an opponent turn occurs.

### Deterministic program modes

```bash
./ar/run.sh --mode strategic
./ar/run.sh --mode local
```

These modes are for repeatable/offline testing and are shown in the Lens as **OFFLINE TEST**. A failed Codex or API request pauses the same hand and offers retry; it does not silently switch modes.

## 5. Run backend checks

From the repository root:

```bash
.venv/bin/python -m unittest discover -s tests
```

These checks cover the Python engine and bridge. They do not by themselves prove Lens Studio rendering, preview interaction, physical-device behavior, or live external API availability. The current full-suite and native preview evidence should be reported separately for the exact revision being shared.

The current recorded hand and bounded media review are documented in `ar/demo/README.md`. They establish the behavior shown in that desktop-preview recording only. Check the public project description for the exact demonstrated outcome and limitations.

## Troubleshooting

- `eval7 is missing`: run the dependency install command above with the interpreter selected by the launcher.
- `Address already in use`: stop the bridge that owns the port, or choose a different `--port` and update `serverUrl`.
- API configuration error: verify the base URL, model name and key environment-variable name. Never paste secrets into the project files.
- Bridge restarted / stale state: refresh the preview connection before trying an action again.
- Stop the bridge using Ctrl+C in the terminal where it was started.
