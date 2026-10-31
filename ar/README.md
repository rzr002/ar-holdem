# AR Hold’em local preview

This prototype connects a native SPECS Lens to the existing Python Hold’em rules engine. The six-player table has one human seat (`YOU`) and five computer opponents, in fixed seat order: `YOU`, `ATLAS`, `NOVA`, `ORION`, `LYRA`, `VEGA`. All chips are virtual. The default opponent is Lucas v16, a local program strategy; it is not an LLM or a trained model.

For a clean checkout, setup and provider options, see [RUNNING.md](lens-studio/ARHoldem/devpost/RUNNING.md).

## Start the bridge

Python 3.11+ is required. The launcher prefers this checkout's `.venv` and runs the default Lucas opponent:

```bash
./ar/run.sh
```

The launcher can be invoked by its absolute path from another directory. If `.venv` is absent it uses `python3`; set `AR_HOLDEM_PYTHON` to choose another interpreter.

The default `lucas` mode runs locally and needs no Codex account or API key. To opt into Codex, use `./ar/run.sh --mode codex` (default model `gpt-6-luna`; override with `--model MODEL_ID`). To use an OpenAI-compatible endpoint, use `--mode api` and configure its URL, model and key environment variable; see RUNNING.md. Requests start only when a dealt hand reaches an opponent turn.

Other explicit local program modes are available for testing:

```bash
./ar/run.sh --mode strategic
# Faster Monte Carlo alternative:
./ar/run.sh --mode local
```

The JSON state carries `mode` and `provider`; the Lens labels test modes as **OFFLINE TEST**. A failed Codex/API decision never switches provider automatically. Stop the bridge with Ctrl+C. The table is held in memory and a restart creates a fresh session.

### Optional process-only proxy

The launcher preserves existing `HTTP_PROXY` / `HTTPS_PROXY` settings and always bypasses the proxy for localhost. To explicitly use the existing local proxy from this machine's setup:

```bash
AR_HOLDEM_PROXY=http://127.0.0.1:PORT ./ar/run.sh
```

Replace `PORT` with the port of a proxy you operate. This sets proxy variables only for the bridge and its child model processes. It does not change system, shell, Git or Lens Studio settings. Omit `AR_HOLDEM_PROXY` when your network settings already work.

Keep this terminal open while playing. Ctrl+C stops this process; the launcher does not install a background service or terminate any other running bridge. If port 8765 is occupied, stop the bridge in its own terminal or use `--port 8766` and update the Lens `serverUrl` accordingly.

## Open the native Lens

1. Open `ar/lens-studio/ARHoldem/SpecsBaseTemplate.esproj` in Lens Studio.
2. Use the SPECS / Interactive preview. Evening Room is the prepared high-contrast view; Sunlit Room also works.
3. Project Settings → **Allow Experimental API** is needed for the local HTTP connection. Save after enabling it. The prepared project already has this setting.
4. The main component's `serverUrl` input defaults to `http://127.0.0.1:8765`. If using `--port`, change this input to match.
5. Use the Lens controls to deal, act, retry a failed opponent turn and start the next hand.

During a hand, each opponent panel shows chips, the latest action and concealed private cards. The active seat is highlighted; `THINKING` indicates a pending opponent decision. Seat markers use the engine's actual positions: `D` = dealer button, `SB` = small blind, `BB` = big blind. A heads-up dealer may also carry `SB`.

At showdown, only the dealt-in players who have not folded reveal their cards. Each revealed player shows an English hand category; the main-pot summary includes the winner and an English explanation of the decisive ranks or kickers. Actual main-pot and side-pot recipients receive gold `WINNER` or `SPLIT WINNER` labels, including a side-pot winner whose overall hand net is zero or negative. Split pots and side-pot winners are represented separately from net profit. An uncontested hand reveals no opponent cards. The next hand clears the result labels and conceals opponent cards again.

If the human stack reaches zero, the current table ends with `Table finished`; restarting the local bridge creates a fresh stack. The Lens does not offer an illegal next hand when `can_start` is false.

The included `ar-holdem-ik-reach` LEAF scenario drives simulated SIK hands through a raycast and pinch in the desktop preview. It advances one legal human action. Start the preview camera at the player's origin `(0, 0, 0)` facing the action buttons; a camera behind the table cannot represent the intended reach. The scenario restores its starting camera pose when it finishes. This is desktop input simulation, not physical hand-tracking evidence.

The recording scenarios `ar-holdem-gesture-demo` and `ar-holdem-full-demo` add visible simulated SIK hands and a short camera sweep. The full flow then uses legal check/call actions to reach settlement. It starts another hand only when the bridge permits one; busting is a valid ending.

This connection is for a desktop preview on the same computer. `127.0.0.1` on glasses would refer to the glasses, so physical-device use needs a separately reachable service. Experimental HTTP is not a Snap publication configuration; a published networked Lens would need a suitable HTTPS endpoint.

## API contract

The server binds only to `127.0.0.1`. Access it with a `localhost` or `127.0.0.1` Host header. It does not grant browser cross-origin access and responses are not cached.

| Request | Body | Result |
| --- | --- | --- |
| `GET /state` | none | Human-seat snapshot |
| `POST /new` | `session`, `revision` | Deal the first/next hand when permitted |
| `POST /action` | `session`, `revision`, `action`, optional `amount` | Apply one legal human action |
| `POST /retry` | `session`, `revision` | Retry the failed opponent turn |

POST bodies must be JSON objects with `Content-Type: application/json`, at most 4096 bytes. `amount` is an integer **raise-to total for the current street**, not an additional increment. The engine determines call and all-in amounts.

Read `session` and `revision` from the latest state before sending a command. A stale revision, old server session or unavailable operation returns HTTP 409 with the current `state`; refresh the view instead of replaying the action blindly. Invalid values return 400, unsupported content types 415 and unknown routes 404.

Snapshots include `table_size: 6`, six permanent seat records, public chip totals, community cards, the human's own `hole`, legal human actions, `thinking`, `error`, `done`, `results`, `net` amounts and `can_start`. `button`, `small_blind_seat` and `big_blind_seat` identify dealer and blind positions; blind seats are `null` before the first hand. Eliminated players retain their seat records. During play, only the human's private cards enter this snapshot; each opponent receives its own separate private observation. Neither the undealt deck nor the post-hand review board is exposed.

`settlement` is `null` until the hand ends. Its completed value contains `reason` (`showdown` or `uncontested`), `winners`, `reveals`, `pots` and `refunds`. `reveals` contains seat IDs, two cards, English `hand_name` and `hand_label` only for showdown participants; it is empty for an uncontested result. Each pot records its index, amount, winners and per-seat awards. `winners` is the union of pot recipients; a seat receiving only an unmatched-bet refund is not a winner. The Lens validates these structures and rejects early reveals, folded-player reveals, invalid or duplicate cards, and inconsistent awards. Older bridges without `settlement` retain the previous summary and do not reveal opponent cards.

## Tests and current demo

On the current local revision, 147 Python tests passed in 16.939 seconds and the Node presentation test passed. This is backend/client test evidence, not a fresh native Lens Studio or headset check.

Run backend checks with `python3 -m unittest discover -s tests`. Test counts and native preview results should be reported for the exact revision being released. Historical verification records in `verification/` describe their dated revisions and are not current-release claims.

The current demo is [a 58-second recording](demo/ARHoldem-demo-paced-20261031.mp4) from the SPECS desktop preview. It uses the native LEAF `DefaultLeafInteractor` and UIKit buttons, against the default local Lucas opponent. YOU holds `6h Ah`; the board is `3h 6c Ac 3s 8s`; YOU wins with two pair and ends at 536 chips (`NET +36`). It is not physical hand-tracking evidence and contains no external model API call. See [demo notes](demo/README.md) and the [video script](lens-studio/ARHoldem/devpost/VIDEO_SCRIPT.md). The video has not been uploaded. The public repository URL is [github.com/rzr002/ar-holdem](https://github.com/rzr002/ar-holdem); confirm anonymous access to its latest contents before relying on it.

## Existing code and new work

The engine, strategy helpers, agent adapters and terminal UI were copied into this independent repository from `terminal-holdem` commit `c954a16484e88fd21aec420a4e0c768584c96a05`; `ar/SOURCE_PROVENANCE.json` records the copy. The AR bridge, Lens interface and API adapter are tracked as AR-specific work. The new project does not need the old checkout at runtime. Keep this distinction in the competition submission.

## Native preview verification (2026-10-28)

The earlier **three-seat** version compiled in Lens Studio 5.23.2 and passed five LEAF scenarios with strategic test opponents: world-anchored layout, a native button action, a complete hand and next hand, illegal-action guards, and simulated hand interaction. These are historical results, not proof of the six-seat update.

The earlier **six-seat** version compiled and passed all five native LEAF scenarios: spatial layout, human action, complete offline hand and next hand, illegal-action guards, and simulated hand interaction. The action scenario also checks all six seats, ten hidden opponent cards during play and the engine's actual dealer/blind markers. Results are in `verification/six-seat-native-results.json`; `verification/six-seat-offline.png` shows the tested layout. Final visual inspection confirmed all five opponent panels, human/community cards and controls are visible.

The bridge was then restarted in real `codex` mode and the native preview reconnected at hand 0, with six 500-chip seats and Deal enabled. This ready state is recorded in `verification/six-seat-live-ready.json` and `verification/six-seat-live-ready.png`; it does not claim a six-seat real-model hand has been played.

These tests do not claim physical glasses testing. The real Codex smoke above is separate from the deterministic native interaction tests.

## Historical six-seat Luna verification (2026-10-29)

This is a recorded test of an earlier Codex-default revision. The current default is local Lucas; this result does not describe today's default behavior.

The real Codex CLI was explicitly configured with `gpt-6-luna` and low reasoning effort. A bounded HTTP integration run completed one six-seat hand through preflop, flop, turn and river to settlement, then dealt hand 2 and reached the human turn. All five opponents returned actual Codex decisions; no offline fallback or retries occurred. The human test driver used legal check/call actions.

- 21 successful model decisions (19 in hand 1, 2 in hand 2), 0 failures.
- End-to-end duration: 330.72 seconds. Per-decision median: 14.02 seconds; mean: 15.72 seconds; range: 11.42–46.69 seconds. These timings include local strategy preparation and Codex CLI overhead; they are not provider-only inference latency.
- Initial and final chip total: 3,000. First-hand net sums to zero; final stacks were `[460, 640, 490, 460, 460, 490]`.
- Hand 2 correctly moved D/SB/BB to seats 1/2/3 and reached YOU's turn.
- Private observations were checked; no hole cards, prompts or credentials were written to the result file.

Evidence: `verification/six-seat-luna-real.json`. The test specifies the requested model ID and records real Codex success; it does not independently attest the backend model identity or measure billed cost. Model failure/retry is covered by deterministic regression tests, not by an induced live outage. The native LEAF tests remain offline-only.

Native preview reconnected to the real hand-2 state and was visually checked (`verification/six-seat-luna-next-hand.png`). The bounded verification bridge was then stopped; the normal launcher was started with its new Luna default and left at a fresh six-seat Deal screen (`verification/six-seat-luna-ready.json` / `.png`).

## Visual model update (2026-10-29)

Playing cards now use rounded, thin ivory meshes, mirrored rank indexes and vector suit geometry (red hearts/diamonds, navy spades/clubs). Suit rendering does not depend on font glyph coverage. Concealed cards show a blue patterned back; undealt slots use only an outline. Meshes/materials are shared by card dimensions and suit, and artwork state does not change the private-observation contract.

Chip colors represent denominations consistently across all seats: purple 500, blue 100, green 25, red 5, ivory 1. Each balance is represented exactly by a bounded inventory of visible discs with separate edges, contrasting edge blocks, inlays and top-face numerals. The pure `splitChipAmount` helper was checked for every integer balance 0–3000: all values conserved, at most 21 discs and 9 per stack; invalid amounts rejected. The table has a beveled rail, inner felt field and fine betting lines. The pot rack was shifted right of the cards to avoid the human status label.

The patterned object previously visible behind the hand belongs to the simulation room, confirmed by hiding the AR root and inspecting the remaining background. Bright cards and Evening Room improve contrast; these are still Specs additive-display previews, not a claim of opaque real-world occlusion on physical glasses.
