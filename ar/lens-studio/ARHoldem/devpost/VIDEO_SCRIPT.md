# Demo video — 2026-10-31 recording

**Current file:** [`ar/demo/ARHoldem-demo-paced-20261031.mp4`](../../../demo/ARHoldem-demo-paced-20261031.mp4). The silent edit is 58 seconds: 50 seconds of continuous gameplay from the raw recording at 1× speed, followed by an 8-second closing card. Only leading and trailing idle time was trimmed.

The footage was captured with Lens Studio's native recorder in the SPECS desktop preview. The human action input uses LEAF `DefaultLeafInteractor` and native UIKit buttons. It is not manual mouse input or physical hand tracking. The default local Lucas opponent was used; the recording contains no external LLM/API call and no physical-glasses use.

## Hand and timeline

| Output time | Footage |
|---|---|
| 0:00–0:14 | Six-seat table and deal; YOU holds `6h Ah`. |
| 0:14–0:39 | Betting and board runout: `3h 6c Ac 3s 8s`; native controls advance the hand. |
| 0:39–0:51 | Showdown reveal: ORION holds `2s 2h`; YOU wins with two pair, aces and sixes. |
| 0:51–0:58 | Payout and closing card; YOU finishes at 536 chips from 500 (`NET +36`). |

The full output is 1920×1280 at 30 fps. The raw gameplay interval is 73.5–123.5 seconds. Opponent thinking is visible at about 2.2 seconds, action and chip transfers are shown in sequence, and the settled NET/BAL display remains visible before the closing card. Bounded visual checks confirmed readable settlement and closing text and no integer-pixel wall-crop motion in the sampled frames; these checks do not rule out subpixel movement or movement between samples. See [`ar/demo/README.md`](../../../demo/README.md) for metadata and evidence details.

## Publication status

The local file has not been uploaded to YouTube. The public repository is [github.com/rzr002/ar-holdem](https://github.com/rzr002/ar-holdem); anonymous access to its latest contents is still being checked. No Devpost submission has been made. The 80-second and 56-second edits are superseded by this recording.
