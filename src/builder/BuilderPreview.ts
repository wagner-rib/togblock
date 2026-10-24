/* Three.js preview of the printed letters (3D-FIX-02 scene, 3D-FIX-03 layout).
 *
 * Loads the Draco GLBs produced by tools/export_glb.py from /models/. They are
 * in the STL frame (mm, Z-up, studs on +Z) and ship without normals, so each
 * geometry gets creased normals on load. The name group is tipped -90° about X
 * so the letters lie flat, studs up, like the visual-target prototype.
 *
 * Rendering is on demand: nothing runs per frame except the idle sine sway,
 * which stops for good on the first drag, and pauses off-screen / hidden tab.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { themeColor, type LetterSize } from './themes';

export type ViewMode = 'hero' | 'top' | 'side';

export interface BuilderPreviewProps {
  name: string;
  size: LetterSize;
  theme: string;                         // key of THEMES
  oneColour: string;                     // hex, used by the 'one' theme
  letterColours: Record<number, string>; // per-index hex overrides
  viewMode: ViewMode;
  onLetterClick?: (index: number, x: number, y: number) => void;
}

interface ManifestLetter { width: number; height: number; depth: number; originX: number; originY: number }
interface Manifest {
  bodyDepth: number;
  studHeight: number;
  letters: Record<string, ManifestLetter>;
}

interface CameraTween {
  fromPos: THREE.Vector3; toPos: THREE.Vector3;
  fromLook: THREE.Vector3; toLook: THREE.Vector3;
  start: number;
}

const CREASE_ANGLE = Math.PI / 6; // must match the note in tools/export_glb.py
const ROUGHNESS = 0.72;
const SWAY_AMPLITUDE = 0.15; // radians
const SWAY_SPEED = 0.0003;   // radians per ms
const DRAG_SPEED = 0.008;    // radians per px
const LETTER_GAP = 10;       // mm between letters, as on a shelf
const MAX_LETTERS = 12;      // same limit and charset as NameBuilder
const CAMERA_TWEEN_MS = 300;
const FRAME_MARGIN = 1.08;  // name fills ~92% of the tighter screen axis
const SHADOW_MIN_HALF = 400; // mm; shadow frustum grows past this for long names

/** Same sanitising as NameBuilder.setText, so letter indexes (and colours) line up. */
export function previewChars(name: string): string[] {
  return [...name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MAX_LETTERS)];
}

export class BuilderPreview {
  private props: BuilderPreviewProps;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 1, 2000);
  private nameGroup = new THREE.Group();
  private loader: GLTFLoader;
  private draco: DRACOLoader;
  private modelsBase: string;
  private manifest: Promise<Manifest>;
  private geometries = new Map<string, Promise<THREE.BufferGeometry>>();
  private buildToken = 0;
  private keyLight!: THREE.DirectionalLight;
  private lookAt = new THREE.Vector3();
  private framed = false;
  private tween: CameraTween | null = null;
  private reduceMotion: boolean;

  private rotation = 0;
  private swaying: boolean;
  private visible = true;
  private frameQueued = false;
  private drag: { id: number; startX: number; startRot: number } | null = null;
  private resizeObs: ResizeObserver;
  private visObs: IntersectionObserver;

  constructor(
    canvas: HTMLCanvasElement,
    props: BuilderPreviewProps,
    opts: { modelsBase?: string; dracoPath?: string } = {},
  ) {
    this.canvas = canvas;
    this.props = props;
    this.modelsBase = opts.modelsBase ?? '/models/';
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.swaying = !this.reduceMotion;

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;

    this.buildLights();
    this.scene.add(this.nameGroup);
    this.nameGroup.rotation.x = -Math.PI / 2;

    this.draco = new DRACOLoader().setDecoderPath(opts.dracoPath ?? '/draco/');
    this.loader = new GLTFLoader().setDRACOLoader(this.draco);
    this.manifest = fetch(this.modelsBase + 'manifest.json').then((res) => {
      if (!res.ok) throw new Error(`manifest.json: HTTP ${res.status}`);
      return res.json();
    });

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas);
    this.visObs = new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting;
      this.requestRender();
    });
    this.visObs.observe(canvas);

    this.resize();
    void this.rebuild();
  }

  setProps(next: Partial<BuilderPreviewProps>): void {
    const prev = this.props;
    this.props = { ...prev, ...next };
    if (next.name !== undefined && next.name !== prev.name) {
      void this.rebuild();
    } else if (next.viewMode && next.viewMode !== prev.viewMode) {
      this.frameCamera(true);
      this.requestRender();
    } else {
      this.applyColours();
    }
  }

  dispose(): void {
    this.resizeObs.disconnect();
    this.visObs.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.nameGroup.traverse((o) => {
      if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
    });
    this.geometries.forEach((g) => g.then((geo) => geo.dispose()));
    this.draco.dispose();
    this.renderer.dispose();
  }

  // ── Scene ────────────────────────────────────────────────────────

  private buildLights(): void {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    const key = (this.keyLight = new THREE.DirectionalLight(0xfff4e2, 1.3));
    key.position.set(180, 260, 200);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004;
    key.shadow.radius = 6;
    Object.assign(key.shadow.camera, { left: -400, right: 400, top: 300, bottom: -300, near: 50, far: 1000 });
    key.shadow.camera.updateProjectionMatrix();
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xcfe3ff, 0.45);
    fill.position.set(-200, 160, 100);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffe8c0, 0.3);
    rim.position.set(0, 80, -200);
    this.scene.add(rim);

    // Letters lie on y=0 (back face down); ground sits just under them
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.ShadowMaterial({ opacity: 0.22 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private loadGeometry(char: string): Promise<THREE.BufferGeometry> {
    let p = this.geometries.get(char);
    if (!p) {
      p = this.loader.loadAsync(`${this.modelsBase}letter_${char}.glb`).then((gltf) => {
        let geo: THREE.BufferGeometry | null = null;
        gltf.scene.traverse((o) => {
          if (!geo && o instanceof THREE.Mesh) geo = o.geometry;
        });
        if (!geo) throw new Error(`letter_${char}.glb has no mesh`);
        return toCreasedNormals(geo, CREASE_ANGLE);
      });
      p.catch(() => this.geometries.delete(char)); // allow a retry
      this.geometries.set(char, p);
    }
    return p;
  }

  /** Lay the name out left to right, LETTER_GAP apart, centred on X=0. */
  private async rebuild(): Promise<void> {
    const token = ++this.buildToken;
    const manifest = await this.manifest;
    const chars = previewChars(this.props.name).filter((c) => manifest.letters[c]);
    const geos = await Promise.all(chars.map((c) => this.loadGeometry(c)));
    if (token !== this.buildToken) return; // superseded by newer input

    this.nameGroup.traverse((o) => {
      if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
    });
    this.nameGroup.clear();

    const metas = chars.map((c) => manifest.letters[c]);
    const total = metas.reduce((w, m) => w + m.width, 0) + LETTER_GAP * Math.max(0, chars.length - 1);
    let cursor = -total / 2;
    chars.forEach((char, i) => {
      const mesh = new THREE.Mesh(geos[i], new THREE.MeshStandardMaterial({ roughness: ROUGHNESS, metalness: 0 }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const letter = new THREE.Group();
      letter.userData = { letterIndex: i, char };
      letter.position.x = cursor - metas[i].originX; // left edge at cursor
      letter.add(mesh);
      this.nameGroup.add(letter);
      cursor += metas[i].width + LETTER_GAP;
    });

    this.fitShadow(total);
    this.applyColours();
    this.frameCamera(this.framed);
    this.requestRender();
  }

  /** Keep the whole name inside the key light's shadow frustum. */
  private fitShadow(nameWidth: number): void {
    const half = Math.max(SHADOW_MIN_HALF, nameWidth / 2 + 60);
    Object.assign(this.keyLight.shadow.camera, { left: -half, right: half, top: half * 0.75, bottom: -half * 0.75, far: half * 3 });
    this.keyLight.shadow.camera.updateProjectionMatrix();
  }

  private applyColours(): void {
    const { theme, oneColour, letterColours } = this.props;
    for (const letter of this.nameGroup.children) {
      const i = letter.userData.letterIndex as number;
      const hex = letterColours[i] ?? themeColor(theme, i, oneColour);
      letter.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.MeshStandardMaterial).color.set(hex);
      });
    }
    this.requestRender();
  }

  /** Point the camera at the name for the current view; eases over 300ms when animate is set. */
  private frameCamera(animate = false): void {
    // Measure the unrotated layout so the drag/sway doesn't make the camera breathe
    const spin = this.nameGroup.rotation.z;
    this.nameGroup.rotation.z = 0;
    const box = new THREE.Box3().setFromObject(this.nameGroup);
    this.nameGroup.rotation.z = spin;
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) * FRAME_MARGIN;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    // Fit whichever is tighter: height against the vertical FOV, width against the horizontal one
    const fitDist = Math.max(maxDim / (2 * tanHalf), (size.x * FRAME_MARGIN) / (2 * tanHalf * this.camera.aspect));

    // Spec's view angles; the camera sits exactly fitDist away along each
    const offset = {
      hero: new THREE.Vector3(0, 0.55, 1.1),
      top: new THREE.Vector3(0, 1, 0.001),
      side: new THREE.Vector3(1.1, 0.02, 0.01),
    }[this.props.viewMode].normalize().multiplyScalar(fitDist);
    const toPos = center.clone().add(offset);

    // Long names put the camera well past the spec's 2000mm far plane
    this.camera.far = Math.max(2000, offset.length() + maxDim * 2);
    this.camera.updateProjectionMatrix();

    if (animate && !this.reduceMotion) {
      this.tween = {
        fromPos: this.camera.position.clone(), toPos,
        fromLook: this.lookAt.clone(), toLook: center,
        start: performance.now(),
      };
    } else {
      this.tween = null;
      this.camera.position.copy(toPos);
      this.lookAt.copy(center);
      this.camera.lookAt(center);
    }
    this.framed = true;
  }

  private stepTween(now: number): void {
    const tw = this.tween;
    if (!tw) return;
    const t = Math.min(1, (now - tw.start) / CAMERA_TWEEN_MS);
    const k = 1 - Math.pow(1 - t, 3); // easeOutCubic
    this.camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
    this.lookAt.lerpVectors(tw.fromLook, tw.toLook, k);
    this.camera.lookAt(this.lookAt);
    if (t === 1) this.tween = null;
  }

  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.frameCamera();
    this.requestRender();
  }

  // ── Render loop (on demand) ──────────────────────────────────────

  private requestRender(): void {
    if (this.frameQueued) return;
    this.frameQueued = true;
    requestAnimationFrame(this.frame);
  }

  private frame = (t: number): void => {
    this.frameQueued = false;
    if (!this.visible || document.hidden) return; // resumed by observers
    if (this.swaying) this.rotation = Math.sin(t * SWAY_SPEED) * SWAY_AMPLITUDE;
    this.stepTween(performance.now());
    this.nameGroup.rotation.z = this.rotation;
    this.renderer.render(this.scene, this.camera);
    if (this.swaying || this.tween) this.requestRender();
  };

  private onVisibility = (): void => this.requestRender();

  // ── Interaction ──────────────────────────────────────────────────

  private onPointerDown = (e: PointerEvent): void => {
    this.swaying = false;
    this.drag = { id: e.pointerId, startX: e.clientX, startRot: this.rotation };
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    this.rotation = this.drag.startRot + (e.clientX - this.drag.startX) * DRAG_SPEED;
    this.requestRender();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.drag?.id === e.pointerId) this.drag = null;
  };
}
