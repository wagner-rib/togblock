// Draco helper for export_glb.py (trimesh can't write KHR_draco_mesh_compression).
//
//   node draco.mjs compress <in.glb> <out.glb> [extras.json]   plain GLB -> Draco GLB,
//                                                 extras set on the mesh node
//   node draco.mjs inspect  <file.glb>           decode, print bounds/triangles/studs as JSON
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { readFileSync } from 'node:fs';

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });

const [cmd, src, dst, extrasPath] = process.argv.slice(2);
const meshNode = (doc) => doc.getRoot().listNodes().find((n) => n.getMesh());

if (cmd === 'compress') {
  const doc = await io.read(src);
  if (extrasPath) meshNode(doc).setExtras(JSON.parse(readFileSync(extrasPath, 'utf8')));
  doc
    .createExtension(KHRDracoMeshCompression)
    .setRequired(true)
    .setEncoderOptions({
      method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
      encodeSpeed: 0, // slowest / smallest; output is deterministic
      decodeSpeed: 5,
      // 14-bit positions on a ~200mm letter = ~0.012mm steps, far below print resolution
      quantizationVolume: 'mesh',
      quantizationBits: { POSITION: 14, NORMAL: 10 },
    });
  await io.write(dst, doc);
} else if (cmd === 'inspect') {
  const doc = await io.read(src);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], v[k]);
          max[k] = Math.max(max[k], v[k]);
        }
      }
      const idx = prim.getIndices();
      triangles += (idx ? idx.getCount() : pos.getCount()) / 3;
    }
  }
  const studs = (meshNode(doc)?.getExtras().studs ?? []).length / 2;
  console.log(JSON.stringify({ min, max, triangles, studs }));
} else {
  console.error('usage: node draco.mjs compress <in> <out> | inspect <file>');
  process.exit(2);
}
