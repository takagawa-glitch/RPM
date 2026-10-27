"""アプリのアイコン（モザイクのタイルで R の字）を作る。標準ライブラリだけで PNG を書き出す。
使い方: py tools/make_icons.py
"""
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"
BG = (0x14, 0x1C, 0x3A)      # 深い紺
FAINT = (0x22, 0x2D, 0x55)   # Rの外側のタイル（モザイクの雰囲気を残す）
# Rのタイルは、回数が増えるほど濃くなるアプリの色を、上から下へ明るい→濃いで並べる
SHADES = [(0xE4, 0xEA, 0xFF), (0xC9, 0xD5, 0xFF), (0xA6, 0xB9, 0xFF), (0x7F, 0x9B, 0xFF), (0x5C, 0x7D, 0xF7), (0x3F, 0x63, 0xEA), (0x2F, 0x55, 0xE0)]
HOT = (0xF5, 0xA4, 0x45)     # 今日の目印（Rの足の先）
# 7x7 の柄。1 = Rのタイル、9 = 今日の目印、0 = 外側
PATTERN = [
    "0111100",
    "0100010",
    "0100010",
    "0111100",
    "0101000",
    "0100100",
    "0100090",
]
N = 7


def make(size: int) -> bytes:
    pad = size * 0.12
    gap = size * 0.022
    cell = (size - pad * 2 - gap * (N - 1)) / N
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            col = BG
            gx, gy = x - pad, y - pad
            if 0 <= gx < size - pad * 2 and 0 <= gy < size - pad * 2:
                cx, cy = int(gx // (cell + gap)), int(gy // (cell + gap))
                if cx < N and cy < N and gx - cx * (cell + gap) < cell and gy - cy * (cell + gap) < cell:
                    v = PATTERN[cy][cx]
                    col = HOT if v == "9" else SHADES[cy] if v == "1" else FAINT
            row += bytes(col)
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", raw) + chunk(b"IEND", b""))


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for s in (180, 192, 512):
        (OUT / f"icon-{s}.png").write_bytes(make(s))
        print(f"icons/icon-{s}.png")
