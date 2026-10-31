# AR Hold’em

AR Hold’em brings a six-seat Texas Hold’em table into a spatial SPECS Lens Studio experience. One person plays from the near seat while five computer opponents take their turns. Cards, the pot, chip stacks, dealer and blind markers, current action, and hand status sit around a virtual table. Large Lens controls let the player deal, fold, check or call, raise, and go all-in.

Opponent cards stay private during betting. At showdown, the remaining participants reveal their cards with English hand categories, and the result explains the winning ranks or kickers. Winner labels follow actual main-pot and side-pot awards, including split pots. Uncontested hands reveal no opponent cards. Payouts show each player's net and balance change; the table ends if the human runs out of chips.

The Lens connects to a local Python bridge that uses the Hold’em rules engine to validate actions, manage betting rounds, settle pots, and give each opponent only its private cards and public table information. The default opponent is local Lucas v16, a rule-based program using hand-strength/equity evaluation and strategy logic. It is not an LLM or trained model. Optional Codex CLI and OpenAI-compatible API modes require separate configuration; they were not used in the demo recording. All chips are virtual.

### Demonstration

The current 58-second silent video was recorded in Lens Studio's SPECS desktop preview with the native LEAF `DefaultLeafInteractor` and UIKit buttons. It shows one complete hand at 1× gameplay speed; only leading and trailing idle time was trimmed. YOU holds `6h Ah`; the board is `3h 6c Ac 3s 8s`, and ORION holds `2s 2h`. YOU wins with two pair, aces and sixes, and finishes with 536 chips (`NET +36`). This demonstrates the desktop simulation, not physical SPECS hardware or physical hand tracking. Watch the [public YouTube demo](https://youtu.be/cYsJk9cjR1o). See [`VIDEO_SCRIPT.md`](VIDEO_SCRIPT.md) for the recording timeline and [`ar/demo/README.md`](../../../demo/README.md) for media details.

### Build and play

Install Python 3.11 or 3.13, install the Lucas build prerequisites and pinned runtime dependencies, run `./ar/run.sh`, then open `SpecsBaseTemplate.esproj` in Lens Studio and start the SPECS Interactive Preview. The preview and bridge run on the same computer. See [`RUNNING.md`](RUNNING.md) for a fresh-checkout walkthrough and optional provider setup.

### Reuse and attribution

The rules engine and earlier terminal poker components predate this event and were copied into this independent repository from the source commit documented in `ar/SOURCE_PROVENANCE.json`. Lucas v16 is third-party MIT-licensed code, with its copyright notice preserved and adaptations documented. The Lens starts from Snap's SPECS Base Template and includes its required notices. The AR-specific contribution includes the spatial Lens, interaction and rendering, bridge, and API integration. See `REUSE_DISCLOSURE.md` for sources and license details.
