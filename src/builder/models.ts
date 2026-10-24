/* Letter models from tools/export_glb.py. Importing them through Vite gives each
 * GLB a content-hashed /_astro/ URL served with a one-year immutable cache, so
 * repeat visits never re-download or re-validate a glyph; the manifest rides
 * along inside the (lazy) preview chunk instead of costing a request. */
import manifest from '../assets/models/manifest.json';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { FileLoader } from 'three';
import dracoWrapper from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url';
import dracoWasm from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url';
import dracoJs from 'three/examples/jsm/libs/draco/gltf/draco_decoder.js?url';

const files = import.meta.glob('../assets/models/letter_*.glb', {
  query: '?url', import: 'default', eager: true,
}) as Record<string, string>;

export const MODEL_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [path.match(/letter_(\w)\.glb$/)![1], url]),
);

export { manifest };

// ── Draco decoder ──
// DRACOLoader fetches its decoder by fixed file name from a directory, which
// would keep it out of the hashed /_astro/ cache. Point each name at the
// Vite-hashed copy straight from the three package instead (no copy in public/).

const DECODER_URLS: Record<string, string> = {
  'draco_wasm_wrapper.js': dracoWrapper,
  'draco_decoder.wasm': dracoWasm,
  'draco_decoder.js': dracoJs, // fallback for browsers without WebAssembly
};

export function createDracoLoader(): DRACOLoader {
  const loader = new DRACOLoader();
  // _loadLibrary(name, responseType) is DRACOLoader's single fetch point (three r170)
  (loader as unknown as { _loadLibrary: (name: string, type: string) => Promise<unknown> })._loadLibrary =
    (name, type) => new FileLoader(loader.manager).setResponseType(type).loadAsync(DECODER_URLS[name]);
  return loader;
}
