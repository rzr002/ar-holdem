#!/usr/bin/env python3
"""Edit an actual Lens Studio recording; never synthesizes gameplay.

Requires ffmpeg and Pillow. Raw footage stays outside the public source archive.
Usage: python scripts/build_demo_video.py RAW.mp4 OUTPUT.mp4
"""
import argparse
from datetime import date
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont

SEGMENTS = [
    (0, 6, "One player. Five local opponents.",
     "Lucas v16 runs locally. No LLM account or API key is needed."),
    (40, 57, "Deal a six-seat hand",
     "Face-down opponent cards, virtual chips and rotating blinds."),
    (148, 172, "Call 22, then see the flop",
     "A real preview button sends a legal action to the game engine."),
    (203, 236, "From flop to turn to river",
     "The board and available actions update as the hand progresses."),
    (254, 272, "Settle the hand",
     "NOVA wins this hand. Updated chip balances carry forward."),
    (289, 305, "Start the next hand",
     "Dealer and blinds rotate. The six-seat table is ready to play again."),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--font", default=os.environ.get("DEMO_FONT"))
    parser.add_argument("--timeline", type=Path, help="JSON array of [start, end, title, caption] segments")
    parser.add_argument("--recorded-date", default=date.today().isoformat(),
                        help="Date the source recording was captured (default: today, YYYY-MM-DD)")
    parser.add_argument("--closing-seconds", type=float, default=8,
                        help="Duration of the closing card in seconds (default: 8)")
    args = parser.parse_args()
    if args.closing_seconds <= 0:
        parser.error("--closing-seconds must be greater than zero")
    segments = json.loads(args.timeline.read_text()) if args.timeline else SEGMENTS
    if not segments or any(len(s) != 4 or not 0 <= s[0] < s[1] for s in segments):
        parser.error("Timeline requires nonempty [start, end, title, caption] segments with 0 <= start < end")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        parser.error("Install ffmpeg and put it on PATH")
    fonts = [args.font, "/System/Library/Fonts/Supplemental/Arial.ttf",
             "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    font_path = next((p for p in fonts if p and Path(p).is_file()), None)
    if not font_path:
        parser.error("Pass --font with a local TrueType font")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    source = args.source.resolve()

    def font(size):
        return ImageFont.truetype(font_path, size)

    def run(command):
        subprocess.run([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", *command], check=True)

    with tempfile.TemporaryDirectory(prefix="ar-holdem-video-") as tmp:
        tmp = Path(tmp)
        parts = []
        for index, (start, end, title, body) in enumerate(segments):
            overlay = Image.new("RGBA", (1920, 1280), (0, 0, 0, 0))
            draw = ImageDraw.Draw(overlay)
            draw.rectangle((0, 0, 1920, 76), fill="#101c1b")
            draw.text((54, 19), "AR HOLD'EM / 6-MAX", font=font(32), fill="#eae6d7")
            draw.text((1210, 27), "LENS STUDIO / DESKTOP PREVIEW", font=font(23), fill="#90cdb1")
            draw.rectangle((0, 1156, 1920, 1280), fill="#101c1b")
            draw.rectangle((54, 1178, 61, 1249), fill="#90cdb1")
            draw.text((81, 1173), title, font=font(32), fill="#f5f2e8")
            draw.text((81, 1217), body, font=font(25), fill="#c1cac6")
            draw.text((1480, 1253), "Real recording / idle time cut", font=font(19), fill="#91a39a")
            overlay_path = tmp / f"overlay-{index}.png"
            overlay.save(overlay_path)
            part = tmp / f"part-{index}.mp4"
            # Fit the source without stretching or cropping, then letterbox it in
            # the 1920x1080 gameplay area between the fixed 76px/124px text bands.
            run(["-ss", str(start), "-i", str(source), "-loop", "1", "-i", str(overlay_path),
                 "-filter_complex", "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x101c1b,pad=1920:1280:0:76:color=0x101c1b[game];[game][1:v]overlay=0:0[v]",
                 "-map", "[v]", "-an", "-t", str(end - start), "-r", "30",
                 "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", str(part)])
            parts.append(part)
            print(f"Rendered gameplay segment {index + 1}/{len(segments)}", flush=True)

        closing = Image.new("RGB", (1920, 1280), "#101c1b")
        draw = ImageDraw.Draw(closing)
        draw.text((150, 165), "AR HOLD'EM", font=font(88), fill="#f5f2e8")
        draw.rectangle((150, 287, 1770, 293), fill="#90cdb1")
        lines = [
            "Local by default: Lucas v16 poker policy",
            "Optional: configure your own compatible LLM API",
            "Built with Lens Studio + CLAD / MCP",
            "Reused Hold'em engine and third-party licenses disclosed",
        ]
        for index, text in enumerate(lines):
            draw.text((150, 370 + index * 105), text, font=font(40), fill="#d7dfda")
        draw.text((150, 945), "Desktop simulation. Physical glasses have not been tested.", font=font(32), fill="#90cdb1")
        draw.text((150, 1005), "The recorded game uses Lucas; no external LLM API was called.", font=font(30), fill="#aebdb5")
        draw.text((150, 1125), "Virtual chips only.", font=font(30), fill="#aebdb5")
        closing_path = tmp / "closing.png"
        closing.save(closing_path)
        part = tmp / "closing.mp4"
        run(["-loop", "1", "-i", str(closing_path), "-an", "-t", str(args.closing_seconds), "-r", "30",
             "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", str(part)])
        parts.append(part)
        listing = tmp / "concat.txt"
        listing.write_text("".join(f"file '{part}'\n" for part in parts))
        run(["-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", "-movflags", "+faststart", str(args.output)])
    args.output.with_suffix(".edit.json").write_text(json.dumps({
        "source": f"Lens Studio native preview recording, {args.recorded_date}",
        "gameplay_speed": 1, "edits": "idle-time cuts and English captions; no synthetic gameplay",
        "source_segments_seconds": [{"start": s, "end": e, "caption": t, "description": b} for s, e, t, b in segments],
        "closing_seconds": args.closing_seconds, "audio": "silent", "provider": "lucas",
    }, indent=2) + "\n")
    print(args.output)


if __name__ == "__main__":
    main()
