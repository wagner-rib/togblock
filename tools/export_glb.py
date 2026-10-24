#!/usr/bin/env python3
"""
Convert letter_font.py STLs into Draco-compressed GLBs for the 3D builder preview.

    letters/standard/letter_<char>.stl  ->  public/models/letter_<char>.glb
                                            public/models/manifest.json

Geometry stays in the STL's own frame: millimetres, Z-up, letter centred on
X/Y, back face at Z=0, stud tops at Z=BODY_DEPTH+STUD_HEIGHT. The browser tips
the group to Y-up itself.

No normals are stored: the mesh stays welded so Draco's edgebreaker can pack it
(~16 KB vs ~80 KB with split hard-edge normals). The browser rebuilds them with
BufferGeometryUtils.toCreasedNormals(geometry, CREASE_ANGLE) - see below.

Setup (once, from site/tools):
    python3 -m venv .venv && .venv/bin/pip install trimesh numpy fast-simplification fonttools shapely
    npm install

Usage (from site/):
    tools/.venv/bin/python tools/export_glb.py --only A    # checkpoint: one letter
    tools/.venv/bin/python tools/export_glb.py             # all 36

Re-running is idempotent: same STLs in -> byte-identical GLBs and manifest out.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

import numpy as np
import trimesh

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
SITE_DIR = os.path.dirname(TOOLS_DIR)
DEFAULT_SRC = os.path.normpath(os.path.join(SITE_DIR, '..', '..', '3d_letters_final'))
DEFAULT_OUT = os.path.join(SITE_DIR, 'public', 'models')
DRACO_HELPER = os.path.join(TOOLS_DIR, 'draco.mjs')

CHARS = [chr(c) for c in range(ord('A'), ord('Z') + 1)] + [str(d) for d in range(10)]

MAX_TRIANGLES = 8000
MAX_FILE_BYTES = 60 * 1024
MAX_BOUNDS_DEVIATION_MM = 0.5
# For the browser: toCreasedNormals at 30deg keeps letter walls and stud rims
# hard while smoothing curved glyph outlines and stud sides.


def load_design_params(src_dir):
    """Read stud/body constants straight from letter_font.py so the manifest can't drift."""
    sys.path.insert(0, src_dir)
    try:
        import letter_font as lf
    finally:
        sys.path.pop(0)
    return {
        'studDiameter': lf.STUD_DIAMETER,
        'studHeight': lf.STUD_HEIGHT,
        'studPitch': lf.STUD_PITCH,
        'bodyDepth': lf.BODY_DEPTH,
    }


def draco(*args):
    out = subprocess.run(['node', DRACO_HELPER, *args], check=True,
                         capture_output=True, text=True, cwd=TOOLS_DIR)
    return out.stdout


def export_letter(char, stl_path, glb_path):
    src = trimesh.load(stl_path, force='mesh')
    src_bounds = src.bounds.copy()

    mesh = src
    if len(mesh.faces) > MAX_TRIANGLES:
        mesh = mesh.simplify_quadric_decimation(face_count=MAX_TRIANGLES)

    with tempfile.TemporaryDirectory() as tmp:
        plain = os.path.join(tmp, 'plain.glb')
        with open(plain, 'wb') as f:
            f.write(trimesh.exchange.gltf.export_glb(
                trimesh.Scene({f'letter_{char}': mesh}), include_normals=False))
        draco('compress', plain, glb_path)

    # Read the compressed file back (decoding Draco) and check it against the STL
    info = json.loads(draco('inspect', glb_path))
    glb_bounds = np.array([info['min'], info['max']])
    deviation = float(np.abs(glb_bounds - src_bounds).max())

    minx, miny, minz = src_bounds[0]
    width, height, depth = src_bounds[1] - src_bounds[0]
    return {
        'width': round(float(width), 2),
        'height': round(float(height), 2),
        'depth': round(float(depth), 2),
        'originX': round(float(minx), 2),
        'originY': round(float(miny), 2),
        'triangles': int(info['triangles']),
        'fileBytes': os.path.getsize(glb_path),
        '_sourceTriangles': len(src.faces),
        '_deviation': deviation,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--src', default=DEFAULT_SRC,
                    help=f'3d_letters_final directory (default: {DEFAULT_SRC})')
    ap.add_argument('--size', default='standard', help='letters/<size>/ subfolder')
    ap.add_argument('--out', default=DEFAULT_OUT)
    ap.add_argument('--only', default='', help='Characters to process, e.g. "A" or "ABC"')
    args = ap.parse_args()

    stl_dir = os.path.join(args.src, 'letters', args.size)
    chars = [c.upper() for c in args.only] if args.only else CHARS
    os.makedirs(args.out, exist_ok=True)

    manifest_path = os.path.join(args.out, 'manifest.json')
    letters = {}
    if args.only and os.path.exists(manifest_path):
        with open(manifest_path) as f:
            letters = json.load(f).get('letters', {})

    failures = []
    for char in chars:
        stl = os.path.join(stl_dir, f'letter_{char}.stl')
        if not os.path.exists(stl):
            failures.append(f'{char}: missing {stl}')
            continue
        r = export_letter(char, stl, os.path.join(args.out, f'letter_{char}.glb'))
        src_tri, dev = r.pop('_sourceTriangles'), r.pop('_deviation')
        letters[char] = r
        print(f"{char}: {r['width']:.0f}×{r['height']:.0f}×{r['depth']}mm, "
              f"{r['triangles']} tri (from {src_tri}), {r['fileBytes'] / 1024:.0f} KB, "
              f"bounds Δ {dev:.3f}mm")
        if r['fileBytes'] > MAX_FILE_BYTES:
            failures.append(f"{char}: {r['fileBytes']} bytes > {MAX_FILE_BYTES}")
        if r['triangles'] > MAX_TRIANGLES:
            failures.append(f"{char}: {r['triangles']} triangles > {MAX_TRIANGLES}")
        if dev > MAX_BOUNDS_DEVIATION_MM:
            failures.append(f'{char}: bounds deviation {dev:.3f}mm > {MAX_BOUNDS_DEVIATION_MM}')

    # Timestamp = newest source STL, not wall-clock, so re-runs are byte-identical
    stls = [os.path.join(stl_dir, f'letter_{c}.stl') for c in letters]
    newest = max(os.path.getmtime(p) for p in stls if os.path.exists(p))
    manifest = {
        'generated': datetime.fromtimestamp(int(newest), timezone.utc).isoformat(),
        'fontScale': 1.0,
        **load_design_params(args.src),
        'letters': {c: letters[c] for c in CHARS if c in letters},
    }
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')

    if failures:
        print('\nFAILED:\n  ' + '\n  '.join(failures), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
