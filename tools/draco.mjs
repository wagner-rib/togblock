// Draco helper for export_glb.py (trimesh can't write KHR_draco_mesh_compression).
//
//   node draco.mjs compress <in.glb> <out.glb>   plain GLB -> Draco GLB
//   node draco.mjs inspect  <file.glb>           decode, print bounds/triangles as JSON
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });

const [cmd, src, dst] = process.argv.slice(2);

if (cmd === 'compress') {
  const doc = await io.read(src);
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
  console.log(JSON.stringify({ min, max, triangles }));
} else {
  console.error('usage: node draco.mjs compress <in> <out> | inspect <file>');
  process.exit(2);
}
