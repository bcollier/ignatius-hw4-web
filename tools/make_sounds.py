"""Generate the player's sounds: a singing-bowl bell and 30 seconds of quiet.

Synthesized here rather than downloaded, so there is no licensing question.
Needs ffmpeg to encode MP3. Run: python3 tools/make_sounds.py
"""

import math
import struct
import subprocess
import tempfile
import wave
from pathlib import Path

RATE = 22050
OUT = Path(__file__).parent.parent / "sounds"


def bell(seconds=7.0, base=196.0):
    # A struck bowl: a few inharmonic partials, each decaying at its own rate.
    partials = [(1.0, 1.0, 0.55), (2.71, 0.45, 0.9), (5.12, 0.22, 1.6), (8.4, 0.08, 2.4)]
    samples = []
    for n in range(int(seconds * RATE)):
        t = n / RATE
        attack = min(1.0, t / 0.01)
        value = sum(a * math.exp(-d * t) * math.sin(2 * math.pi * base * f * t + 0.7 * math.sin(2 * math.pi * 0.8 * t))
                    for f, a, d in partials)
        samples.append(0.35 * attack * value)
    return samples


def quiet(seconds=30.0):
    return [0.0] * int(seconds * RATE)


def write_mp3(name, samples):
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        with wave.open(tmp.name, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in samples))
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp.name, "-codec:a", "libmp3lame", "-b:a", "64k", str(OUT / name)], check=True)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    write_mp3("bell.mp3", bell())
    write_mp3("quiet30.mp3", quiet())
    print(sorted(p.name for p in OUT.iterdir()))
