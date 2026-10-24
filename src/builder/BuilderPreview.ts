/* Three.js preview of the printed letters (3D-FIX-02 scaffold).
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

interface Manifest {
  bodyDepth: number;
  studHeight: number;
  letters: Record<string, { width: number; height: number; depth: number; originX: number; originY: number }>;
}

const CREASE_ANGLE = Math.PI / 6; // must match the note in tools/export_glb.py
const ROUGHNESS = 0.72;
const SWAY_AMPLITUDE = 0.15; // radians
const SWAY_SPEED = 0.0003;   // radians per ms
const DRAG_SPEED = 0.008;    // radians per px

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
    this.swaying = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
      this.frameCamera();
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

    const key = new THREE.DirectionalLight(0xfff4e2, 1.3);
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
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800), new THREE.ShadowMaterial({ opacity: 0.22 }));
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

  /** FIX-02 scope: shows the first supported character. FIX-03 lays out the full name. */
  private async rebuild(): Promise<void> {
    const token = ++this.buildToken;
    const manifest = await this.manifest;
    const char = [...this.props.name.toUpperCase()].find((c) => manifest.letters[c]);

    const geo = char ? await this.loadGeometry(char) : null;
    if (token !== this.buildToken) return; // superseded by newer input

    this.nameGroup.traverse((o) => {
      if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
    });
    this.nameGroup.clear();

    if (geo && char) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ roughness: ROUGHNESS, metalness: 0 }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const letter = new THREE.Group();
      letter.userData.letterIndex = 0;
      letter.add(mesh);
      this.nameGroup.add(letter);
    }
    this.applyColours();
    this.frameCamera();
    this.requestRender();
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

  private frameCamera(): void {
    // Frame the unrotated layout so the drag/sway doesn't make the camera breathe
    const spin = this.nameGroup.rotation.z;
    this.nameGroup.rotation.z = 0;
    const box = new THREE.Box3().setFromObject(this.nameGroup);
    this.nameGroup.rotation.z = spin;
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) * 1.1;
    let fitDist = maxDim / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    if (this.camera.aspect < 1) fitDist /= this.camera.aspect; // keep wide names in frame on portrait screens

    const offset = {
      hero: new THREE.Vector3(0, fitDist * 0.55, fitDist * 1.1),
      top: new THREE.Vector3(0, fitDist * 1.4, 0.001),
      side: new THREE.Vector3(fitDist * 1.1, 20, 10),
    }[this.props.viewMode];
    this.camera.position.copy(center).add(offset);
    this.camera.lookAt(center);
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
    this.nameGroup.rotation.z = this.rotation;
    this.renderer.render(this.scene, this.camera);
    if (this.swaying) this.requestRender();
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
