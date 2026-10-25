#!/usr/bin/env python3
"""
Convert letter_font.py STLs into Draco-compressed GLBs for the 3D builder preview.

    letters/standard/letter_<char>.stl  ->  src/assets/models/letter_<char>.glb
                                            src/assets/models/manifest.json

(Under src/ so Vite content-hashes them; src/builder/models.ts imports them.)

Geometry stays in the STL's own frame: millimetres, Z-up, letter centred on
X/Y, back face at Z=0. The browser tips the group to Y-up itself.

Full studs are split off: the GLB holds the letter body (sliced at BODY_DEPTH
and capped, so it keeps the STL's exact outline and keyhole), and the stud
centres go in the mesh node's extras in millimetres ({"studs": [x0, y0, x1, y1,
...]}). letter_font.py centres stud rows inside each stroke, so rows are not
always on a plain 8mm grid; columns are. The browser draws every full stud from
one smooth instanced shape, so studs stay round at any zoom instead of being
decimated into polygons. Edge-clipped studs (EDGE_CLIP_STUDS: part-discs cut by
the letter outline) aren't round, so they stay in the body mesh as extruded
outlines. Each full stud is checked against STUD_DIAMETER and the column grid.

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

MAX_TRIANGLES = 8000          # letter body, after decimation
MAX_CLIPPED_TRIANGLES = 6000  # edge-clipped studs, kept undecimated on top
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
    """From a cross-section through the middle of the studs: full stud centres in mm (sorted),
    and the outlines of edge-clipped studs (shapely polygons in the letter's X/Y)."""
    pitch, body, radius = params['studPitch'], params['bodyDepth'], params['studDiameter'] / 2
    z = body + params['studHeight'] / 2
    section = src.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    if section is None:
        return [], [], ['no studs found']
    # Explicit transform keeps the 2D coordinates in the letter's own X/Y
    planar, _ = section.to_2D(to_2D=trimesh.transformations.translation_matrix([0, 0, -z]))
    full, clipped, problems = [], [], []
    for p in planar.polygons_closed:
        minx, miny, maxx, maxy = p.bounds
        r_area = float(np.sqrt(p.area / np.pi))
        cx = p.centroid.x
        # letter_font.py puts every column on the 8mm grid, so a disc that's off it was
        # clipped by a hair and belongs with the clipped studs
        round_disc = (abs(r_area - radius) <= MAX_STUD_ERROR_MM
                      and abs((maxx - minx) / 2 - radius) <= MAX_STUD_ERROR_MM
                      and abs((maxy - miny) / 2 - radius) <= MAX_STUD_ERROR_MM
                      and abs(cx - round(cx / pitch) * pitch) <= MAX_STUD_ERROR_MM)
        if round_disc:
            full.append(p.centroid.coords[0])
        else:
            clipped.append(p)
    if not full:
        return [], clipped, ['no full studs found']
    centres = np.array(full)
    off_grid = float(np.abs(centres[:, 0] - np.round(centres[:, 0] / pitch) * pitch).max())
    if off_grid > MAX_STUD_ERROR_MM:
        problems.append(f'stud column {off_grid:.3f}mm off the {pitch}mm grid')
    studs = sorted({(round(float(x), 2), round(float(y), 2)) for x, y in centres})  # sorted -> deterministic
    if len(studs) != len(full):
        problems.append(f'{len(full) - len(studs)} duplicate studs')
    return studs, clipped, problems


def clipped_stud_mesh(polys, params):
    """Edge-clipped studs as one mesh standing on the body's top face (outline simplified to ~0.1mm)."""
    parts = []
    for p in polys:
        p = p.simplify(0.1, preserve_topology=True)
        m = trimesh.creation.extrude_polygon(p, height=params['studHeight'])
        m.apply_translation([0, 0, params['bodyDepth']])
        parts.append(m)
    return trimesh.util.concatenate(parts) if parts else None


def export_letter(char, stl_path, glb_path, params):
    src = trimesh.load(stl_path, force='mesh')
    src_bounds = src.bounds.copy()
    studs, clipped, problems = find_studs(src, params)

    mesh = src.slice_plane([0, 0, params['bodyDepth']], [0, 0, -1], cap=True)
    body_faces = len(mesh.faces)
    if len(mesh.faces) > MAX_TRIANGLES:
        mesh = mesh.simplify_quadric_decimation(face_count=MAX_TRIANGLES)
    clip_mesh = clipped_stud_mesh(clipped, params)
    if clip_mesh is not None:
        mesh = trimesh.util.concatenate([mesh, clip_mesh])

    with tempfile.TemporaryDirectory() as tmp:
        plain = os.path.join(tmp, 'plain.glb')
        extras = os.path.join(tmp, 'extras.json')
        with open(plain, 'wb') as f:
            f.write(trimesh.exchange.gltf.export_glb(
                trimesh.Scene({f'letter_{char}': mesh}), include_normals=False))
        with open(extras, 'w') as f:
            json.dump({'studs': [n for xy in studs for n in xy]}, f, separators=(',', ':'))
        draco('compress', plain, glb_path, extras)

    # Read the compressed file back (decoding Draco) and check it against the STL:
    # body matches on X/Y and stops at BODY_DEPTH (or the stud tops, with clipped studs);
    # full studs on top reach the STL's full depth
    info = json.loads(draco('inspect', glb_path))
    glb_bounds = np.array([info['min'], info['max']])
    expected = src_bounds.copy()
    expected[1, 2] = params['bodyDepth'] + (params['studHeight'] if clipped else 0)
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
        'clippedStuds': len(clipped),
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

    args.out = os.path.abspath(args.out)  # the Draco helper runs from tools/
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
              f"body {r['triangles']} tri (from {src_tri}), {r['studs']}+{r['clippedStuds']} studs, "
              f"{r['fileBytes'] / 1024:.0f} KB, bounds Δ {dev:.3f}mm")
        failures += [f'{char}: {p}' for p in problems]
        if r['fileBytes'] > MAX_FILE_BYTES:
            failures.append(f"{char}: {r['fileBytes']} bytes > {MAX_FILE_BYTES}")
        if r['triangles'] > MAX_TRIANGLES + MAX_CLIPPED_TRIANGLES:
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
