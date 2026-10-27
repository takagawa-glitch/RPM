"""アプリのアイコン（回転モザイクの柄）を作る。標準ライブラリだけで PNG を書き出す。
使い方: py tools/make_icons.py
"""
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"
BG = (0x18, 0x20, 0x2B)
# 5段階の濃さ（回数が増えるほど濃い）と、今日の目印
SHADES = [(0x2A, 0x33, 0x44), (0x4A, 0x5F, 0xA8), (0x5E, 0x7A, 0xE6), (0x7D, 0x98, 0xFF), (0xC7, 0xD2, 0xF8)]
HOT = (0xF2, 0xB5, 0x3E)
# 5x5 の柄（数字は SHADES の番号、9 は今日の目印）
PATTERN = [
    [4, 4, 4, 3, 3],
    [4, 3, 3, 3, 2],
    [3, 3, 2, 2, 1],
    [2, 2, 1, 9, 9],
    [1, 1, 0, 0, 0],
]


def make(size: int) -> bytes:
    pad = size * 0.14
    gap = size * 0.035
    cell = (size - pad * 2 - gap * 4) / 5
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            col = BG
            gx, gy = x - pad, y - pad
            if 0 <= gx < size - pad * 2 and 0 <= gy < size - pad * 2:
                cx, cy = int(gx // (cell + gap)), int(gy // (cell + gap))
                if cx < 5 and cy < 5 and gx - cx * (cell + gap) < cell and gy - cy * (cell + gap) < cell:
                    v = PATTERN[cy][cx]
                    col = HOT if v == 9 else SHADES[v]
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
