# Pre-existing work and third-party disclosure

## Reused foundation and development timeline

- Independent project source: the AR repository is a copy-based split from [`terminal-holdem`](https://github.com/rzr002/terminal-holdem), source commit `c954a16484e88fd21aec420a4e0c768584c96a05` (2026-10-29). See `ar/SOURCE_PROVENANCE.json` for the copied paths and AR-specific additions. The standalone project does not load code from the old checkout at runtime.
- The terminal Hold’em rules engine, hand/state model, betting and settlement logic, terminal interface, and earlier program/Codex opponent adapters existed before the event: source commits `5e6ddec` and `7edcc98` are dated 2026-09-08. They are reused as the game foundation, not claimed as new hackathon work.
- The terminal Lucas adapter was added separately on 2026-10-29 in `c954a16`, during this event’s submission window, and was then reused in this AR repository. Its third-party upstream policy remains pre-existing third-party work. Do not describe this adapter as September code, or the Lucas strategy as authored for this entry.
- The project added an AR-specific local bridge and SPECS Lens experience during this submission period. The bridge maps engine state and legal actions to the Lens and keeps private observations seat-specific. The Lens work includes the spatial table, cards/chips, opponent panels, status, and preview-driven interaction. Confirm the final revision and exact list of additions before submission.
- The repository also contains an optional OpenAI-compatible API adapter added for this work. It is not a bundled API service and requires the entrant to configure a compatible endpoint, model and key. Whether the final Lens run uses it must be stated accurately; no provider, model or API behavior should be claimed without final verification.

## Lucas v16 source and license

- Upstream repository: [lucashsu007-create/fullhouse-hackathon-write-up-repo](https://github.com/lucashsu007-create/fullhouse-hackathon-write-up-repo)
- Pinned upstream commit: [`8b98ee3efce3b224177609352258dc86db901cce`](https://github.com/lucashsu007-create/fullhouse-hackathon-write-up-repo/commit/8b98ee3efce3b224177609352258dc86db901cce)
- Source file: `hero_bots/bot_v16_squeeze_C_metacap/bot.py`
- Vendored source: `holdem/vendor/lucas_v16/bot.py`; SHA-256 `ffa1ac5083482a96b240ce2a3dcff8f329333184f9006231d0c42bbbc877810a`
- License: MIT; upstream copyright `Copyright (c) 2026 lucashsu007-create`, reproduced in `holdem/vendor/lucas_v16/LICENSE`. Keep this notice with the copied code.
- Local adapter: `holdem/lucas.py` maps the engine's public observation, BB/chip units, seats and action history to Lucas and maps decisions back. The bundled policy SHA-256 was checked against the recorded source hash on 2026-10-29. Changes for this integration are outside the vendored strategy file.
- Lucas v16 is a conventional program poker policy using ranges, action-weighted sampling, rules and Monte Carlo hand evaluation. It is **not** an LLM, neural network, or reinforcement-learning model. The upstream file has no model weights.

## SPECS template and other dependencies

- The project starts from Snap's SPECS Base Template. `OFFICIAL-TEMPLATE-LICENSE.md` in the Lens project includes the sample-project MIT grant, Snap Specs Developer Terms, Lens Studio License Agreement, and bundled third-party notices including tween.js / Robert Penner. Preserve this notice and comply with the linked Snap terms.
- The Lens project includes Snap-provided packages such as Spectacles Interaction Kit and Spectacles UI Kit, plus the project’s LEAF test package. Preserve each package's own attribution/license files and follow its applicable terms. Check the exact package versions and notices in the final public tree.
- The entrant should verify that the reused pre-existing project components are theirs or are otherwise licensed for this use. Devpost's rules both require the entrant's original, solely owned work and allow compliant open-source components where the entry builds on them; substantial reuse makes this an entrant-side rights/eligibility review item, not something this disclosure resolves.

## Accurate submission wording

Say “AR/SPECS Lens and integration built during the event on a pre-existing Hold’em engine,” not “built entirely from scratch.” Describe Lucas as a local program opponent, and any API opponent as an optional configured integration. Do not call Lucas an LLM or RL agent. Do not imply physical glasses testing or Snap publication.
