#!/usr/bin/env python3
"""
Convert letter_font.py STLs into Draco-compressed GLBs for the 3D builder preview.

    letters/standard/letter_<char>.stl  ->  src/assets/models/letter_<char>.glb
                                            src/assets/models/manifest.json

(Under src/ so Vite content-hashes them; src/builder/models.ts imports them.)

Geometry stays in the STL's own frame: millimetres, Z-up, letter centred on
X/Y, back face at Z=0. The browser tips the group to Y-up itself.

Studs are split off: the GLB holds only the letter body (sliced at
BODY_DEPTH and capped, so it keeps the STL's exact outline and keyhole), and
the stud centres go in the mesh node's extras as STUD_PITCH grid steps
({"studs": [i0, j0, i1, j1, ...]}, centre = (i, j) * pitch). The browser draws
every stud from one smooth instanced shape, so studs stay round at any zoom
instead of being decimated into polygons. Each centre is checked against the
grid and each stud against STUD_DIAMETER before export.

No normals are stored: the mesh stays welded so Draco's edgebreaker can pack it
(~16 KB vs ~80 KB with split hard-edge normals). The browser rebuilds them with
BufferGeometryUtils.toCreasedNormals(geometry, CREASE_ANGLE) - see below.

Setup (once, from site/tools):
    python3 -m venv .venv && .venv/bin/pip install trimesh numpy fast-simplification fonttools shapely \
        scipy mapbox-earcut networkx rtree
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
DEFAULT_OUT = os.path.join(SITE_DIR, 'src', 'assets', 'models')
DRACO_HELPER = os.path.join(TOOLS_DIR, 'draco.mjs')

CHARS = [chr(c) for c in range(ord('A'), ord('Z') + 1)] + [str(d) for d in range(10)]

MAX_TRIANGLES = 8000
MAX_FILE_BYTES = 60 * 1024
MAX_BOUNDS_DEVIATION_MM = 0.5
MAX_STUD_ERROR_MM = 0.05   # off-grid distance / radius mismatch allowed for a detected stud
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


def find_studs(src, params):
    """Stud centres as (i, j) grid steps, from a cross-section through the middle of the studs."""
    pitch, body, radius = params['studPitch'], params['bodyDepth'], params['studDiameter'] / 2
    section = src.section(plane_origin=[0, 0, body + params['studHeight'] / 2], plane_normal=[0, 0, 1])
    if section is None:
        return [], ['no studs found']
    planar, to_3d = section.to_2D()
    polys = planar.polygons_closed
    centres = trimesh.transform_points(
        np.array([[*p.centroid.coords[0], 0.0] for p in polys]), to_3d)[:, :2]
    grid = np.round(centres / pitch)
    problems = []
    off_grid = float(np.abs(centres - grid * pitch).max())
    if off_grid > MAX_STUD_ERROR_MM:
        problems.append(f'stud {off_grid:.3f}mm off the {pitch}mm grid')
    radii = np.sqrt(np.array([p.area for p in polys]) / np.pi)
    if np.abs(radii - radius).max() > MAX_STUD_ERROR_MM:
        problems.append(f'stud radius {radii.min():.3f}-{radii.max():.3f}mm, expected {radius}')
    steps = sorted({(int(i), int(j)) for i, j in grid})  # sorted -> deterministic output
    if len(steps) != len(polys):
        problems.append(f'{len(polys) - len(steps)} duplicate stud cells')
    return steps, problems


def export_letter(char, stl_path, glb_path, params):
    src = trimesh.load(stl_path, force='mesh')
    src_bounds = src.bounds.copy()
    studs, problems = find_studs(src, params)

    mesh = src.slice_plane([0, 0, params['bodyDepth']], [0, 0, -1], cap=True)
    body_faces = len(mesh.faces)
    if len(mesh.faces) > MAX_TRIANGLES:
        mesh = mesh.simplify_quadric_decimation(face_count=MAX_TRIANGLES)

    with tempfile.TemporaryDirectory() as tmp:
        plain = os.path.join(tmp, 'plain.glb')
        extras = os.path.join(tmp, 'extras.json')
        with open(plain, 'wb') as f:
            f.write(trimesh.exchange.gltf.export_glb(
                trimesh.Scene({f'letter_{char}': mesh}), include_normals=False))
        with open(extras, 'w') as f:
            json.dump({'studs': [n for step in studs for n in step]}, f, separators=(',', ':'))
        draco('compress', plain, glb_path, extras)

    # Read the compressed file back (decoding Draco) and check it against the STL:
    # body matches on X/Y and stops at BODY_DEPTH; studs on top reach the STL's full depth
    info = json.loads(draco('inspect', glb_path))
    glb_bounds = np.array([info['min'], info['max']])
    expected = src_bounds.copy()
    expected[1, 2] = params['bodyDepth']
    deviation = max(float(np.abs(glb_bounds - expected).max()),
                    abs(params['bodyDepth'] + params['studHeight'] - src_bounds[1, 2]))
    if info['studs'] != len(studs):
        problems.append(f"GLB holds {info['studs']} studs, expected {len(studs)}")

    minx, miny, minz = src_bounds[0]
    width, height, depth = src_bounds[1] - src_bounds[0]
    return {
        'width': round(float(width), 2),
        'height': round(float(height), 2),
        'depth': round(float(depth), 2),
        'originX': round(float(minx), 2),
        'originY': round(float(miny), 2),
        'triangles': int(info['triangles']),
        'studs': len(studs),
        'fileBytes': os.path.getsize(glb_path),
        '_sourceTriangles': body_faces,
        '_deviation': deviation,
        '_problems': problems,
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

    params = load_design_params(args.src)
    failures = []
    for char in chars:
        stl = os.path.join(stl_dir, f'letter_{char}.stl')
        if not os.path.exists(stl):
            failures.append(f'{char}: missing {stl}')
            continue
        r = export_letter(char, stl, os.path.join(args.out, f'letter_{char}.glb'), params)
        src_tri, dev, problems = r.pop('_sourceTriangles'), r.pop('_deviation'), r.pop('_problems')
        letters[char] = r
        print(f"{char}: {r['width']:.0f}×{r['height']:.0f}×{r['depth']}mm, "
              f"body {r['triangles']} tri (from {src_tri}), {r['studs']} studs, "
              f"{r['fileBytes'] / 1024:.0f} KB, bounds Δ {dev:.3f}mm")
        failures += [f'{char}: {p}' for p in problems]
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
        **params,
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
