/* Matte PLA material for the letter preview (3D-FIX-06).
 *
 * MeshStandardMaterial plus three shader tweaks, all computed from the mesh's
 * own (STL-frame, mm) coordinates because the GLBs carry no UVs:
 *  - layer lines: 0.2mm-pitch ridges along print Z on the side walls only
 *    (letters print flat, studs up), faded out below ~2px per line so
 *    they never shimmer at normal viewing distance
 *  - micro-roughness: ±12% value noise at ~5mm, so highlights aren't uniform
 *  - stud tops: roughness 0.65, a touch glossier than the walls, as printed
 */
import * as THREE from 'three';

export const PLA_ROUGHNESS = 0.72;
const LAYER_PITCH_MM = 0.2;
const LAYER_DEPTH_MM = 0.05;
const NOISE_TILE_MM = 5;
const STUD_TOP_ROUGHNESS = 0.65;

const VERTEX_DECL = /* glsl */ `
varying vec3 vPlaPos;
varying vec3 vPlaNormal;
varying vec3 vPlaLayerAxis;
`;

const VERTEX_BODY = /* glsl */ `
#include <begin_vertex>
vPlaPos = position;
#ifdef USE_INSTANCING
vPlaPos = (instanceMatrix * vec4(position, 1.0)).xyz; // studs: print-frame position, so layer lines line up
#endif
vPlaNormal = normal;
vPlaLayerAxis = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
`;

const FRAGMENT_DECL = /* glsl */ `
uniform float uLayerPitch;
uniform float uLayerDepth;
uniform float uNoiseTile;
uniform float uStudTopZ;
uniform float uStudRoughness;
varying vec3 vPlaPos;
varying vec3 vPlaNormal;
varying vec3 vPlaLayerAxis;

float plaHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float plaNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(plaHash(i), plaHash(i + vec3(1, 0, 0)), f.x),
                 mix(plaHash(i + vec3(0, 1, 0)), plaHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(plaHash(i + vec3(0, 0, 1)), plaHash(i + vec3(1, 0, 1)), f.x),
                 mix(plaHash(i + vec3(0, 1, 1)), plaHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

const ROUGHNESS_BODY = /* glsl */ `
#include <roughnessmap_fragment>
float plaGrain = plaNoise(vPlaPos / uNoiseTile);
roughnessFactor *= mix(0.88, 1.12, plaGrain);
if (normalize(vPlaNormal).z > 0.9 && vPlaPos.z > uStudTopZ - 0.3) {
  roughnessFactor = uStudRoughness * mix(0.94, 1.06, plaGrain);
}
`;

const NORMAL_BODY = /* glsl */ `
#include <normal_fragment_maps>
{
  // Sine ridges along print Z; slope of h = (depth/2)·sin(2πz/pitch)
  float wall = 1.0 - abs(normalize(vPlaNormal).z);
  float pxPerLine = uLayerPitch / max(fwidth(vPlaPos.z), 1e-5);
  float fade = wall * smoothstep(1.5, 3.0, pxPerLine);
  if (fade > 0.0) {
    float k = 6.2831853 / uLayerPitch;
    float slope = 0.5 * uLayerDepth * k * cos(vPlaPos.z * k);
    normal = normalize(normal - vPlaLayerAxis * slope * fade);
  }
}
`;

/** One material per letter (colours differ); they all share a single compiled program. */
export function createPlaMaterial(studTopZ: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: PLA_ROUGHNESS, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uLayerPitch: { value: LAYER_PITCH_MM },
      uLayerDepth: { value: LAYER_DEPTH_MM },
      uNoiseTile: { value: NOISE_TILE_MM },
      uStudTopZ: { value: studTopZ },
      uStudRoughness: { value: STUD_TOP_ROUGHNESS },
    });
    shader.vertexShader = VERTEX_DECL + shader.vertexShader.replace('#include <begin_vertex>', VERTEX_BODY);
    shader.fragmentShader = FRAGMENT_DECL + shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', ROUGHNESS_BODY)
      .replace('#include <normal_fragment_maps>', NORMAL_BODY);
  };
  mat.customProgramCacheKey = () => 'togblocks-pla-v1';
  return mat;
}
