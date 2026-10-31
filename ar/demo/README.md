# AR Hold’em demo

The current video is [`ARHoldem-demo-paced-20261031.mp4`](ARHoldem-demo-paced-20261031.mp4): 58 seconds, silent, 1920×1280, 30 fps. It uses one continuous 50-second gameplay interval from raw time 73.5–123.5 at 1× speed, followed by an 8-second closing card. Only leading and trailing idle time was trimmed.

The native Lens Studio recorder captured the SPECS desktop preview using the LEAF `DefaultLeafInteractor` and native UIKit buttons. This was neither manual mouse control nor physical hand tracking. The recorded hand is YOU `6h Ah`, board `3h 6c Ac 3s 8s`, and ORION `2s 2h`. YOU wins with two pair, aces and sixes, ending at 536 chips from 500 (`NET +36`). The default local Lucas opponent was used; no external LLM or physical headset was used.

The recorded flow shows 2.2-second opponent think intervals, individual action and card reveals, visible chip transfers, showdown, payout and settled balance. The demonstrated hand preserved chips and blocked duplicate input. Bounded media review confirmed a readable settlement and closing card; wall-crop samples showed no integer-pixel motion at half resolution and 2 Hz. This sampling does not rule out subpixel motion or movement between samples.

The public repository is [github.com/rzr002/ar-holdem](https://github.com/rzr002/ar-holdem); anonymous access to the uploaded contents is still being checked. The video has not been uploaded to YouTube. The raw recording and private evidence are under `ar/submission-build/` and are excluded from public submission materials.

The 80-second cut (`ARHoldem-demo-20261031.mp4`) and older 56-second cut (`ARHoldem-demo.mp4`) are superseded. Their timelines and metadata are historical and do not describe the current recording.
