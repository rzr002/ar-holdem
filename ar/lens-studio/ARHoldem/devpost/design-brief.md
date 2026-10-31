---
status: approved
---

# Design brief: AR Hold'em

## Current implementation note (2026-10-29)

This brief records the approved spatial design and earlier planning decisions. The implemented default is five local Lucas v16 program opponents. Lucas uses poker rules, hand-strength/equity evaluation and strategy logic; it is not an LLM or trained model. Codex CLI and a user-configured OpenAI-compatible API are opt-in modes. Provider behavior and verification status are described in the current [run guide](RUNNING.md); historical design references below to “LLM” describe the original requested Codex-backed version, not a claim about the current default.

## The one spatial moment
The original idea was to visualize the existing command-line Texas Hold'em game in AR, retaining its model-backed opponents. The approved design is a six-max table: one human (`YOU`) and five computer opponents (`ATLAS`, `NOVA`, `ORION`, `LYRA`, `VEGA`) in that fixed seat order.

Approved placement (default dimensions): a virtual table appears in front of the player, stays in the room as they look around, and presents private cards near the player and community cards in the middle. The player pinches a large action button, sees the opponent thinking, then watches its legal move update the table.

## Why it belongs on glasses
- Uses: draws in the world.
- The cards, opponent seats and pot occupy separate places on a table the player can look around. The glasses version preserves a spatial card table instead of requiring the player to read a terminal transcript.
- Whether spatial placement is more comfortable than the laptop version remains unproven until a real-device trial.

## Product or overlay
- Type: product; the virtual poker table is the experience.
- What the real version would sense: standard hand interactions and head pose. No recognition of real playing cards, people or tables is required.
- Stand-in for the preview: a virtual table in Lens Studio's simulated room; preview mouse input drives standard SIK button interactions.
- Opponents: the original design reused the existing Codex-backed LLM adapter. The current default is local Lucas v16; Codex/API modes require explicit selection. A provider failure visibly pauses the turn and offers Retry; it never silently switches strategy or provider.
- Explicit `strategic`/`local` modes are visibly labeled offline test modes. Do not present program strategies as LLM decisions.

## Where things live
- Main gaze: slightly down toward the center of the table (default).
- Table: world anchored at launch, with root position `(0, -50, -110)` cm relative to the initial eye position. The final Inspector dimensions are 82 by 60 cm with uniform scale `0.8`, giving a physical footprint of approximately 66 by 48 cm (adjustable in the Inspector).
- Community cards and pot: center of the table, with up to five readable face-up cards and a nearby pot label (default).
- Human cards: near edge, face up and visible only in the human observation; two authored 7.5 by 9.5 cm cards, approximately 6 by 7.6 cm after the table's scale (default).
- Opponents: five seat panels around the table, with names, virtual chip totals, last move and current-turn highlight (default). Their hole cards remain concealed during the hand. `D`, `SB` and `BB` markers show the engine's actual dealer and blind positions.
- Controls: a compact group of large targets near the human seat; light labels with sufficiently bright surfaces for the additive display (default).
- Status: adjacent to the pot, showing the street, current player, opponent thinking state or a concise error (default).

## Hands and input
- Start / Next Hand: pinch a large button (default).
- Fold, Check / Call, Raise and All-in: standard SIK/UI Kit button interactions, with availability and amounts determined by the original rules engine (default).
- Raise amount: a short set of legal presets or a simple amount control, with the final raise-to amount visible before committing (default).
- Retry: pinch after a Codex/API decision failure; retain the same hand and do not debit chips twice (default).
- Targets are big and highlight when aimed at.
- Voice: none in the first version (default).

## When things show
- Private and community cards: only cards actually dealt to the human or board appear during a live hand.
- Human action controls: active only on the human turn; unavailable actions are disabled or hidden.
- Opponent thinking: shown while an opponent decision is pending, then replaced with the confirmed action.
- Result: appears after settlement with winner and payout; Next Hand becomes available.
- Error and Retry: appear on an external model or connection failure; the hand state remains intact.
- If something needs attention out of view: a brief turn/result sound (default); essential status stays by the table.

## Done criteria
Each one can be checked in Lens Studio's preview.
1. Launching the Lens shows a readable spatial table with six seats. Moving the preview camera confirms the table stays in the room.
2. Start deals two human cards and conceals the opponents' cards; the pot and chip totals match the backend state.
3. A mouse-driven pinch triggers a legal human action once. Controls stop accepting human actions while an opponent is thinking.
4. A hand can progress through betting and board streets to settlement, showing the winner and payout. Chips are conserved and Next Hand starts another hand. Label the selected opponent/provider accurately and distinguish program modes from actual model runs.
5. A disconnected backend or failed external model displays an error and recovery action without advancing the turn, losing the hand or silently changing opponents.

## Out of scope
- Real money, deposits, withdrawals, prizes based on chip balances or paid entry.
- Recognizing physical cards, scanning a real table, multiplayer, accounts or persistent leaderboards.
- A full casino environment, custom two-hand gestures, voice control or realistic human avatars.
- Automatic publication to Snap, public repository upload, YouTube upload or Devpost submission. Prepare reviewable submission materials; publishing requires the learner's instruction.

## Risks and open questions
- The learner approved the design on 2026-10-28 and subsequently chose the six-max layout. Historical native LEAF scenarios passed and the six-seat preview was visually inspected. Dimensions and UI details remain tunable; real-device comfort is unproven.
- Existing poker rules and opponent adapters predate the AR work. The standalone project copies this prior code from the source commit recorded in `ar/SOURCE_PROVENANCE.json`. Disclose the reuse and clearly identify the new AR interface and integration work in submission materials.
- Lens Studio access to the local Python bridge must be verified early. HTTP can require experimental settings; a remotely reachable production service would need HTTPS.
- Codex/API responses can have latency and fail. The human must see thinking/error states; never label deterministic program opponents as LLMs.
- No SPECS device is available: comfort over time, real hand tracking and physical surface alignment are feel unproven.
- The new Lens targets the installed Lens Studio 5.23.2 and the current SPECS base template. No editor upgrade is planned for this prototype.

## Build notes for CLAD
- Build for SPECS so it runs and can be demonstrated in Lens Studio's preview. No SPECS device is available.
- Use Spectacles Interaction Kit (SIK) and UI Kit for all interactions, so they work with the mouse in Interactive Preview and with LEAF.
- Build any stand-in exactly as described above, and keep it obvious in the scene.
- Use real-world scale in centimeters. Keep content inside the user's view during the main task.
- The display is additive: black renders as transparent. Don't rely on black or very dark content to be seen; keep text light and readable from where the user stands.
- Get the basic flow working first, then add detail.
- Write LEAF scenarios for each done criterion, run them in preview, and report which pass. Say which criteria have no test.
- Don't record, identify, or follow people.

## After the build: judge it
This part is for you, after CLAD finishes.

1. **Does it work?** Ask your agent which LEAF tests passed and which done criteria have no test.
2. **Walk around it.** Open the preview in Interactive Preview. Use WASD to move, Q and E to go down and up, and right-drag (or hold Shift) to look around. Clicking acts as a pinch. Stand where a user would and look at the task.
3. **Ask the three questions.**
   - Does it use what I'm looking at?
   - Does it put something in my space, where it belongs?
   - Does it free my hands or let me keep my eyes up?
   - Would it be just as good on a phone? If so, what would make it need the glasses?
4. **Check comfort.**
   - Everything I need is in view while I do the task. Nothing sits at the edges, behind me, or stuck to my face.
   - Every control is within reach of someone standing there.
   - Text reads easily from where I stand. No dark UI disappearing.
   - Things show when needed and get out of the way.
5. **Label what you know.** Write "logic proven" next to anything the tests and preview show working, and "feel unproven" next to anything only real glasses could tell you (comfort over time, real hand tracking, real recognition).
6. **Fix with design notes, not code.** Tell your agent what to change in design terms, for example: "Move the step card 15 cm lower and next to the pan. Make the Next button twice as big. Re-run the tests." If a fix takes under a minute, like nudging a panel, do it yourself in the scene.
7. **Submit.** Record a video under 3 minutes of your Lens in the preview, public on YouTube. Make your repo public with your Lens Studio project and this `devpost/` folder. Details are on the hackathon site: https://learn-specs.devpost.com/resources

## Visual revision, 2026-10-29
The learner asked for recognizable suit graphics and more realistic chips. Cards now have ivory rounded bodies, mirrored indexes and vector suit symbols; opponents retain patterned blue backs. Chip inventories use exact 500/100/25/5/1 denominations with consistent colors, white edge inserts, top values and visibly separate discs. The table gained a padded rail, fine piping and inner felt field. Default preview uses Evening Room for contrast; the pot chip rack sits at local (18, 0.4, 5) cm to clear the human turn label. Physical-device contrast remains unproven.
