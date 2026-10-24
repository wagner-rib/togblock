/* Three.js preview of the printed letters (3D-FIX-02 scene, 3D-FIX-03 layout, 3D-FIX-04 picking,
 * 3D-FIX-05 touch: one-finger horizontal spin, pinch / ctrl+wheel zoom,
 * 3D-FIX-06 PLA material and soft studio reflections).
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
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createPlaMaterial } from './plaMaterial';
import { themeColor, type LetterSize } from './themes';
import { previewChars } from './previewState';

export type ViewMode = 'hero' | 'top' | 'side';

export interface BuilderPreviewProps {
  name: string;
  size: LetterSize;
  theme: string;                         // key of THEMES
  oneColour: string;                     // hex, used by the 'one' theme
  letterColours: Record<number, string>; // per-index hex overrides
  viewMode: ViewMode;
  /** Tap on the preview: letter index (-1 = missed every letter), canvas-relative CSS px. */
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
const ENV_INTENSITY = 0.35;  // studio reflections: tone and soft speculars, not extra light
const SWAY_AMPLITUDE = 0.15; // radians
const SWAY_SPEED = 0.0003;   // radians per ms
const DRAG_SPEED = 0.008;    // radians per px
const LETTER_GAP = 10;       // mm between letters, as on a shelf
const CAMERA_TWEEN_MS = 300;
const TAP_SLOP_PX = 6;       // pointer travel below this is a tap, not a drag
const ZOOM_MIN = 0.05;      // camera distance multipliers (smaller = closer; this far in, layer lines resolve)
const ZOOM_MAX = 1.6;
const FRAME_MARGIN = 1.08;
const SLOW_FRAME_MS = 40;    // a render slower than this (3x running) is a slow device
const SLOW_FRAME_STREAK = 3;
const VERY_SLOW_FRAME_MS = 120; // one frame this slow (no GPU / software WebGL): stop animating at once  // name fills ~92% of the tighter screen axis
const SHADOW_MIN_HALF = 400; // mm; shadow frustum grows past this for long names


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
  private drag: { id: number; startX: number; startY: number; startRot: number; moved: boolean; wasSwaying: boolean } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { startDist: number; startZoom: number } | null = null;
  private zoom = 1;
  private fit: { center: THREE.Vector3; dir: THREE.Vector3; dist: number } | null = null;
  private settle: { from: number; start: number } | null = null;
  private slowStreak = 0;
  private framesDrawn = 0;
  private quality: 'full' | 'reduced' | 'still' = 'full';
  private compiled = false;
  private raycaster = new THREE.Raycaster();
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
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
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
    } else if (next.letterColours && Object.keys(next).length === 1) {
      // Single-letter recolour: only touch letters whose colour actually changed
      const changed = new Set([...Object.keys(prev.letterColours), ...Object.keys(next.letterColours)]
        .map(Number).filter((i) => prev.letterColours[i] !== next.letterColours![i]));
      this.applyColours(changed);
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
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.nameGroup.traverse((o) => {
      if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
    });
    this.geometries.forEach((g) => g.then((geo) => geo.dispose()));
    this.scene.environment?.dispose();
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
      const mesh = new THREE.Mesh(geos[i], createPlaMaterial(manifest.bodyDepth + manifest.studHeight));
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
    if (!this.compiled && chars.length) {
      // Compile shaders off the main thread where the browser supports it, before the first frame
      this.compiled = true;
      await this.renderer.compileAsync(this.scene, this.camera).catch(() => {});
      if (token !== this.buildToken) return;
      this.scheduleEnvironment();
    }
    this.requestRender();
  }

  /** Build the studio environment once the first frame is up, so it never delays it. */
  private scheduleEnvironment(): void {
    const build = () => {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const room = new RoomEnvironment();
      this.scene.environment = pmrem.fromScene(room, 0.04).texture;
      this.scene.environmentIntensity = ENV_INTENSITY;
      room.dispose();
      pmrem.dispose();
      this.requestRender();
    };
    'requestIdleCallback' in window ? requestIdleCallback(build, { timeout: 2000 }) : setTimeout(build, 300);
  }

  /** Keep the whole name inside the key light's shadow frustum. */
  private fitShadow(nameWidth: number): void {
    const half = Math.max(SHADOW_MIN_HALF, nameWidth / 2 + 60);
    Object.assign(this.keyLight.shadow.camera, { left: -half, right: half, top: half * 0.75, bottom: -half * 0.75, far: half * 3 });
    this.keyLight.shadow.camera.updateProjectionMatrix();
  }

  /** Colour of letter i: per-letter override, else the theme's colour for that position. */
  letterHex(i: number): string {
    const { theme, oneColour, letterColours } = this.props;
    return letterColours[i] ?? themeColor(theme, i, oneColour);
  }

  private applyColours(only?: Set<number>): void {
    for (const letter of this.nameGroup.children) {
      const i = letter.userData.letterIndex as number;
      if (only && !only.has(i)) continue;
      const hex = this.letterHex(i);
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

    // Spec's view angles; the camera sits fitDist (× the user's pinch zoom) away along each
    const dir = {
      hero: new THREE.Vector3(0, 0.55, 1.1),
      top: new THREE.Vector3(0, 1, 0.001),
      side: new THREE.Vector3(1.1, 0.02, 0.01),
    }[this.props.viewMode].normalize();
    this.fit = { center, dir, dist: fitDist };
    const offset = dir.clone().multiplyScalar(fitDist * this.zoom);
    const toPos = center.clone().add(offset);

    // Long names put the camera well past the spec's 2000mm far plane
    this.camera.far = Math.max(2000, fitDist * ZOOM_MAX + maxDim * 2);
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

  /** Move the camera along the current view direction for a new zoom, without re-measuring. */
  private setZoom(zoom: number): void {
    this.zoom = THREE.MathUtils.clamp(zoom, ZOOM_MIN, ZOOM_MAX);
    if (!this.fit) return;
    this.tween = null;
    this.lookAt.copy(this.fit.center);
    this.camera.position.copy(this.fit.center).addScaledVector(this.fit.dir, this.fit.dist * this.zoom);
    this.camera.lookAt(this.lookAt);
    this.requestRender();
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
    if (this.settle) {
      const k = Math.min(1, (performance.now() - this.settle.start) / CAMERA_TWEEN_MS);
      this.rotation = this.settle.from * Math.pow(1 - k, 3); // ease back to square-on
      if (k === 1) this.settle = null;
    }
    this.stepTween(performance.now());
    this.nameGroup.rotation.z = this.rotation;
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    if (this.nameGroup.children.length) this.adaptQuality(performance.now() - t0);
    if (this.swaying || this.tween || this.settle) this.requestRender();
  };

  /** Step quality down on devices that can't keep up: first pixel ratio, then the idle sway. */
  private adaptQuality(ms: number): void {
    if (this.quality === 'still' || ++this.framesDrawn <= 2) return; // first frames include shader warm-up
    this.slowStreak = ms > SLOW_FRAME_MS ? this.slowStreak + 1 : 0;
    const crawling = ms > VERY_SLOW_FRAME_MS;
    if (!crawling && this.slowStreak < SLOW_FRAME_STREAK) return;
    this.slowStreak = 0;
    if (this.renderer.getPixelRatio() > 1) {
      this.renderer.setPixelRatio(1);
      this.resize();
    }
    if (this.quality === 'full' && !crawling) {
      this.quality = 'reduced';
      return;
    }
    this.quality = 'still';
    if (this.swaying) {
      this.swaying = false;
      this.settle = { from: this.rotation, start: performance.now() };
    }
  }

  private onVisibility = (): void => this.requestRender();

  // ── Interaction ──────────────────────────────────────────────────

  private onPointerDown = (e: PointerEvent): void => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.canvas.setPointerCapture(e.pointerId);
    this.settle = null;
    if (this.pointers.size === 2) {
      // Second finger: switch from spin to pinch, and never treat this gesture as a tap
      this.drag = null;
      this.pinch = { startDist: this.pointerSpread(), startZoom: this.zoom };
      return;
    }
    if (this.pointers.size > 2) return;
    this.drag = {
      id: e.pointerId, startX: e.clientX, startY: e.clientY, startRot: this.rotation,
      moved: false, wasSwaying: this.swaying,
    };
    this.swaying = false;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch) {
      const spread = this.pointerSpread();
      if (spread > 0) this.setZoom(this.pinch.startZoom * (this.pinch.startDist / spread));
      return;
    }
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const dx = e.clientX - this.drag.startX;
    if (!this.drag.moved && Math.hypot(dx, e.clientY - this.drag.startY) < TAP_SLOP_PX) return;
    this.drag.moved = true;
    this.rotation = this.drag.startRot + dx * DRAG_SPEED;
    this.requestRender();
  };

  /** Fires on pointerup and on pointercancel (the browser took a vertical swipe for page scroll). */
  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.drag?.id !== e.pointerId) return;
    const { moved, wasSwaying } = this.drag;
    this.drag = null;
    if (moved || e.type !== 'pointerup') return;
    if (wasSwaying && this.rotation !== 0) {
      this.settle = { from: this.rotation, start: performance.now() };
      this.requestRender();
    }
    this.pick(e);
  };

  /** Trackpad pinch arrives as ctrl+wheel; a plain wheel is left alone so the page scrolls. */
  private onWheel = (e: WheelEvent): void => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    this.swaying = false;
    this.setZoom(this.zoom * Math.exp(e.deltaY * 0.01));
  };

  private pointerSpread(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  /** Raycast a tap into the name and report which letter (index) was hit. */
  private pick(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const ndc = new THREE.Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
    this.nameGroup.rotation.z = this.rotation;
    this.nameGroup.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.nameGroup.children, true)[0];
    let obj: THREE.Object3D | null = hit?.object ?? null;
    while (obj && obj.userData.letterIndex === undefined) obj = obj.parent;
    this.props.onLetterClick?.(obj ? (obj.userData.letterIndex as number) : -1, x, y);
  }
}
