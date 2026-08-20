#!/usr/bin/env python3
"""Generate the app icons.

Previously this was a headless-Chrome screenshot of tools/icon.html, which
silently produced garbage: Chrome clamps to a minimum window size, so at 180 and
192 it laid the page out wider than asked and the screenshot captured a cropped
corner of the artwork. Only the 512 came out right.

Writing the PNGs directly removes the browser, the window-size dependency and
the non-integer scaling in one go. The Sun-Star bitmap and the palette are read
out of src/art.js, so the icon still cannot drift from the game.
"""
import pathlib, re, struct, zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
ART = (ROOT / 'src' / 'art.js').read_text()

SIZES = [180, 192, 512]        # 180 is the one iOS uses for the home screen
SUN_FRACTION = 0.62            # of the icon width, leaving room for iOS's squircle


def palette():
    m = re.search(r"cosmic:\s*\[([^\]]+)\]", ART)
    hexes = re.findall(r"#([0-9a-fA-F]{6})", m.group(1))
    return [tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) for h in hexes]


def sun_face():
    """The 24x24 'S' face, straight out of the game's own sprite table."""
    m = re.search(r"S:\s*\[(.*?)\],\s*\n\s*\};", ART, re.S)
    rows = re.findall(r"'([.#]{24})'", m.group(1))
    if len(rows) != 24:
        raise SystemExit('expected 24 rows for the Sun face, got %d' % len(rows))
    return rows


def write_png(path, size, px):
    raw = b''.join(b'\x00' + bytes(v for x in range(size) for v in px[y][x])
                   for y in range(size))

    def chunk(tag, data):
        body = tag + data
        return (struct.pack('>I', len(data)) + body +
                struct.pack('>I', zlib.crc32(body) & 0xffffffff))

    path.write_bytes(
        b'\x89PNG\r\n\x1a\n' +
        chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) +
        chunk(b'IDAT', zlib.compress(raw, 9)) +
        chunk(b'IEND', b''))


def build(size, pal, face):
    void, deep, mid, light = pal
    px = [[void] * size for _ in range(size)]
    c = (size - 1) / 2

    # Sparse corona, drawn in target space so it is never resampled. The ring
    # test is applied at each CELL's centre rather than per pixel: testing per
    # pixel clips the cells that straddle the boundary into thin slivers, which
    # read as artefacts rather than dots.
    inner, outer = size * 0.345, size * 0.455
    cell = max(1, size // 45)
    for y in range(size):
        for x in range(size):
            gx, gy = x // cell, y // cell
            if (gx * 7 + gy * 5) % 11:
                continue
            mx, my = gx * cell + cell / 2, gy * cell + cell / 2
            d = ((mx - c) ** 2 + (my - c) ** 2) ** 0.5
            if inner < d < outer:
                px[y][x] = deep if d < (inner + outer) / 2 else mid

    # the Sun-Star itself, scaled by a whole number so pixels stay square
    k = max(1, round(size * SUN_FRACTION / 24))
    off = (size - 24 * k) // 2
    for r in range(24):
        for i in range(24):
            if face[r][i] == '.':
                continue
            for dy in range(k):
                for dx in range(k):
                    px[off + r * k + dy][off + i * k + dx] = light
    return px, k


def main():
    pal, face = palette(), sun_face()
    out = ROOT / 'icons'
    out.mkdir(exist_ok=True)
    for size in SIZES:
        px, k = build(size, pal, face)
        p = out / ('icon-%d.png' % size)
        write_png(p, size, px)
        print('  %-22s %dx%d  sun scaled %dx (%d px, %.0f%%)  %d bytes'
              % (p.name, size, size, k, 24 * k, 100 * 24 * k / size,
                 p.stat().st_size))


if __name__ == '__main__':
    main()
