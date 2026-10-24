/* Three.js preview of the printed letters.
 * 3D-FIX-02 scene · 03 layout · 04 picking · 05 touch (spin, pinch / ctrl+wheel zoom)
 * 06 PLA material and studio reflections · 07 skeletons and motion · 08 order thumbnails.
 *
 * Loads the Draco GLBs produced by tools/export_glb.py (see models.ts). They are
 * in the STL frame (mm, Z-up, top face on +Z) and ship without normals, so each
 * geometry gets creased normals on load. Studs are not in the mesh: the GLB
 * lists their grid cells and every stud is an instance of one smooth shape.
 * The name group is tipped -90° about X so the letters lie flat, studs up.
 *
 * Each letter is a slot that survives retyping: unchanged letters glide to
 * their new place, new ones fade up, and a glyph that isn't downloaded yet
 * holds its place as a translucent skeleton block.
 *
 * Rendering is on demand: frames run only while something moves (idle sway,
 * tweens, damped spin) and pause off-screen / in a hidden tab.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createPlaMaterial } from './plaMaterial';
import { buildPieceGeometry, createPieceMaterial, placePieces } from './decorativeDots';
import { themeColor, type LetterSize } from './themes';
import { previewChars } from './previewState';
import { manifest as MANIFEST, MODEL_URLS, createDracoLoader } from './models';

export type ViewMode = 'hero' | 'top' | 'side';

export interface BuilderPreviewProps {
  name: string;
  size: LetterSize;
  theme: string;                         // key of THEMES
  oneColour: string;                     // hex, used by the 'one' theme
  letterColours: Record<number, string>; // per-index hex overrides
  dots?: boolean;                        // "Decorative Dots" add-on: show the pack's 10 LEGO pieces
  viewMode: ViewMode;
  /** Tap on the preview: letter index (-1 = missed every letter), canvas-relative CSS px. */
  onLetterClick?: (index: number, x: number, y: number) => void;
}

export interface ManifestLetter { width: number; height: number; depth: number; originX: number; originY: number }
export interface Manifest {
  bodyDepth: number;
  studHeight: number;
  studDiameter: number;
  studPitch: number;
  letters: Record<string, ManifestLetter>;
}

export interface Glyph { body: THREE.BufferGeometry; studs: number[] }

interface Slot {
  char: string;
  group: THREE.Group;                       // userData.letterIndex is the name index
  material: THREE.MeshStandardMaterial | null;
  skeleton: THREE.Mesh | null;
  slide: { from: number; to: number; start: number } | null;
  appear: { start: number } | null;
  tint: { from: THREE.Color; to: THREE.Color; start: number } | null;
  studs: number[] | null;                   // stud cells, once the glyph is loaded
  dots: THREE.Group | null;                 // decorative pieces pressed onto this letter
}

interface CameraTween {
  fromPos: THREE.Vector3; toPos: THREE.Vector3;
  fromLook: THREE.Vector3; toLook: THREE.Vector3;
  start: number;
}

const CREASE_ANGLE = Math.PI / 6; // must match the note in tools/export_glb.py
const STUD_SEGMENTS = 20;     // round enough at any zoom; 120 triangles a stud
const STUD_CHAMFER = 0.2;     // mm, softens the top edge highlight like a printed stud
const ENV_INTENSITY = 0.35;   // studio reflections: tone and soft speculars, not extra light
const SWAY_AMPLITUDE = 0.15;  // radians
const SWAY_SPEED = 0.0003;    // radians per ms
const DRAG_SPEED = 0.008;     // radians per px
const SPIN_DAMPING_MS = 70;   // drag spin eases toward the finger with this time constant
const LETTER_GAP = 10;        // mm between letters, as on a shelf
const CAMERA_TWEEN_MS = 300;
const SLIDE_MS = 300;         // existing letters gliding to a new layout
const APPEAR_MS = 150;        // a letter fading up into place…
const APPEAR_STAGGER_MS = 50; // …each new letter this much after the previous one
const APPEAR_RISE_MM = 6;
const TINT_MS = 200;          // colour changes blend rather than snap
const DOT_POP_MS = 280;       // decorative pieces pop on…
const DOT_STAGGER_MS = 55;    // …one after another
const SKELETON_COLOUR = 0xd0d4e0;
const SKELETON_OPACITY = 0.4;
const TAP_SLOP_PX = 6;        // pointer travel below this is a tap, not a drag
const ZOOM_MIN = 0.05;        // camera distance multipliers (smaller = closer; this far in, layer lines resolve)
const ZOOM_MAX = 1.6;
const FRAME_MARGIN = 1.08;    // name fills ~92% of the tighter screen axis
const SLOW_FRAME_MS = 40;     // a render slower than this (3x running) is a slow device
const SLOW_FRAME_STREAK = 3;
const VERY_SLOW_FRAME_MS = 120; // one frame this slow (no GPU / software WebGL): stop animating at once
const THUMB_DIRECTION = new THREE.Vector3(0, 1, 0.38); // order thumbnail: from above, tilted enough to show the letters' depth
const THUMB_MARGIN = 1.06;
const SHADOW_MIN_HALF = 400;  // mm; shadow frustum grows past this for long names

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const progress = (start: number, ms: number, now: number) => THREE.MathUtils.clamp((now - start) / ms, 0, 1);

export class BuilderPreview {
  protected props: BuilderPreviewProps;
  private canvas: HTMLCanvasElement;
  protected renderer: THREE.WebGLRenderer;
  protected scene = new THREE.Scene();
  protected camera = new THREE.PerspectiveCamera(32, 1, 1, 2000);
  protected nameGroup = new THREE.Group();
  private loader: GLTFLoader;
  private draco: DRACOLoader;
  private onReady?: () => void;
  protected manifest: Promise<Manifest>;
  private geometries = new Map<string, Promise<Glyph>>();
  private loaded = new Map<string, Glyph>(); // same glyphs, for synchronous cache hits
  protected studGeometry: Promise<THREE.BufferGeometry>;
  protected studGeo: THREE.BufferGeometry | null = null;
  private skeletonMaterial = new THREE.MeshBasicMaterial({
    color: SKELETON_COLOUR, transparent: true, opacity: SKELETON_OPACITY, depthWrite: false,
  });
  private slots: Slot[] = [];
  private manifestData: Manifest | null = null;
  private pieceGeos = new Map<string, THREE.BufferGeometry>(); // by footprint, e.g. 2x4
  private dotsKey = '';
  private dotsPop: { start: number } | null = null;
  protected layoutBox = new THREE.Box3();
  protected buildToken = 0;
  protected building: Promise<void> = Promise.resolve();
  protected shown = false; // first real letters drawn
  private keyLight!: THREE.DirectionalLight;
  private lookAt = new THREE.Vector3();
  protected framed = false;
  private tween: CameraTween | null = null;
  protected reduceMotion: boolean;

  private rotation = 0;
  private spinTarget = 0;
  private lastFrame = 0;
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
  private raycaster = new THREE.Raycaster();
  private resizeObs: ResizeObserver;
  private visObs: IntersectionObserver;

  constructor(
    canvas: HTMLCanvasElement,
    props: BuilderPreviewProps,
    opts: { onReady?: () => void } = {},
  ) {
    this.canvas = canvas;
    this.props = props;
    this.onReady = opts.onReady;
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

    this.draco = createDracoLoader();
    this.loader = new GLTFLoader().setDRACOLoader(this.draco);
    this.manifest = Promise.resolve(MANIFEST as Manifest);
    this.studGeometry = this.manifest.then(buildStudGeometry);

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
    // After the constructor returns, so a subclass's fields exist when its rebuild() runs
    this.building = Promise.resolve().then(() => this.rebuild());
  }

  setProps(next: Partial<BuilderPreviewProps>): void {
    const prev = this.props;
    this.props = { ...prev, ...next };
    if (next.dots !== undefined && !!next.dots !== !!prev.dots && Object.keys(next).length === 1) {
      this.refreshDots(true);
    } else if (next.name !== undefined && next.name !== prev.name) {
      this.building = this.rebuild();
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
    this.slots.forEach((s) => this.disposeSlot(s));
    this.skeletonMaterial.dispose();
    this.pieceGeos.forEach((g) => g.dispose());
    this.geometries.forEach((g) => g.then(({ body }) => body.dispose()));
    this.studGeometry.then((g) => g.dispose());
    this.scene.environment?.dispose();
    this.draco.dispose();
    this.renderer.dispose();
  }

  /**
   * Square PNG of the current design for the order record (3D-FIX-08). Framed from above
   * with a slight tilt rather than the spec's hero angle: in a square, the hero view turns
   * a name into a thin strip, and this reads at email and gift-card sizes.
   * Waits for every glyph, snaps running animations to their end, renders once at
   * `size`×`size`, then restores the live view in the same task so nothing flickers.
   */
  async capture(size = 512, background = '#a7b2bf'): Promise<Blob> {
    await this.contentSettled();
    this.finishAnimations();

    const r = this.renderer;
    const saved = {
      ratio: r.getPixelRatio(), size: r.getSize(new THREE.Vector2()), aspect: this.camera.aspect,
      zoom: this.zoom,
      pos: this.camera.position.clone(), look: this.lookAt.clone(),
    };
    r.setPixelRatio(1);
    r.setSize(size, size, false);
    this.camera.aspect = 1;
    this.zoom = 1;
    this.frameCamera(false, THUMB_DIRECTION, THUMB_MARGIN);
    this.nameGroup.rotation.z = 0;
    r.render(this.scene, this.camera);
    const shot = document.createElement('canvas');
    shot.width = shot.height = size;
    const ctx = shot.getContext('2d')!;
    ctx.fillStyle = background; // flatten onto the stage colour: PNG alpha looks odd in some mail clients
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(r.domElement, 0, 0, size, size); // same task as render: drawing buffer still valid

    r.setPixelRatio(saved.ratio);
    r.setSize(saved.size.x, saved.size.y, false);
    this.camera.aspect = saved.aspect;
    this.zoom = saved.zoom;
    this.frameCamera(); // restores this.fit for the live view…
    this.tween = null;
    this.camera.position.copy(saved.pos); // …then the exact camera the user had
    this.lookAt.copy(saved.look);
    this.camera.lookAt(this.lookAt);
    this.nameGroup.rotation.z = this.rotation;
    r.render(this.scene, this.camera);

    return new Promise((resolve, reject) =>
      shot.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
  }

  /** Resolves once the current design is fully loaded (subclasses with other content override). */
  protected async contentSettled(): Promise<void> {
    let token: number;
    do { // the name may change while glyphs load; wait for the latest layout
      token = this.buildToken;
      await this.building;
      await Promise.all(this.slots.map((s) => this.loadGeometry(s.char)));
      await new Promise((r) => setTimeout(r)); // let fillSlot callbacks run
    } while (token !== this.buildToken || this.slots.some((s) => !s.material));
  }

  /** Snap running animations to their end state (before a capture). */
  protected finishAnimations(): void {
    for (const s of this.slots) {
      if (s.slide) { s.group.position.x = s.slide.to; s.slide = null; }
      if (s.appear) { s.appear = null; s.material!.opacity = 1; s.group.position.z = 0; }
      if (s.tint) { s.material!.color.copy(s.tint.to); s.tint = null; }
    }
    if (this.dotsPop) this.stepDots(Infinity); // every dot at full size
  }

  /** True once there is real geometry to show (drives onReady and quality adaptation). */
  protected hasContent(): boolean {
    return this.slots.some((s) => s.material);
  }

  /** Per-frame content animation; returns true while anything is still moving. */
  protected stepContent(now: number): boolean {
    const slotsMoving = this.stepSlots(now);
    return this.stepDots(now) || slotsMoving;
  }

  /** Colour of letter i: per-letter override, else the theme's colour for that position. */
  letterHex(i: number): string {
    const { theme, oneColour, letterColours } = this.props;
    return letterColours[i] ?? themeColor(theme, i, oneColour);
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

  protected loadGeometry(char: string): Promise<Glyph> {
    let p = this.geometries.get(char);
    if (!p) {
      p = this.loader.loadAsync(MODEL_URLS[char]).then((gltf) => {
        let mesh: THREE.Mesh | null = null;
        gltf.scene.traverse((o) => {
          if (!mesh && o instanceof THREE.Mesh) mesh = o;
        });
        if (!mesh) throw new Error(`letter_${char}.glb has no mesh`);
        const m = mesh as THREE.Mesh;
        // Node extras land in userData: stud cells as a flat [i0, j0, i1, j1, ...] list
        const glyph = {
          body: toCreasedNormals(m.geometry, CREASE_ANGLE),
          studs: (m.userData.studs ?? m.parent?.userData.studs ?? []) as number[],
        };
        this.loaded.set(char, glyph);
        return glyph;
      });
      p.catch(() => this.geometries.delete(char)); // allow a retry
      this.geometries.set(char, p);
    }
    return p;
  }

  /** Lay the name out left to right, LETTER_GAP apart, centred on X=0. */
  protected async rebuild(): Promise<void> {
    const token = ++this.buildToken;
    const manifest = await this.manifest;
    this.manifestData = manifest;
    const chars = previewChars(this.props.name).filter((c) => manifest.letters[c]);
    this.studGeo ??= await this.studGeometry;

    if (!this.shown) {
      // First load: the page's HTML skeleton is showing, so wait for every glyph and
      // bring the whole name in together rather than block by block
      await Promise.all(chars.map((c) => this.loadGeometry(c).catch(() => {}))); // a failed glyph falls back to a skeleton
    }
    if (token !== this.buildToken) return; // superseded by newer input

    const now = performance.now();
    const metas = chars.map((c) => manifest.letters[c]);
    const total = metas.reduce((w, m) => w + m.width, 0) + LETTER_GAP * Math.max(0, chars.length - 1);

    // Keep slots whose letter is unchanged at that position; replace the rest
    const old = this.slots;
    this.slots = chars.map((char, i) => (old[i]?.char === char ? old[i] : this.createSlot(char, i)));
    old.forEach((s, i) => { if (this.slots[i] !== s) this.disposeSlot(s); });

    let cursor = -total / 2;
    let stagger = 0;
    this.slots.forEach((slot, i) => {
      const x = cursor - metas[i].originX; // left edge at cursor
      cursor += metas[i].width + LETTER_GAP;
      if (slot.group.parent) {
        slot.slide = this.reduceMotion || slot.group.position.x === x ? null
          : { from: slot.group.position.x, to: x, start: now };
        if (!slot.slide) slot.group.position.x = x;
        return;
      }
      slot.group.position.x = x;
      this.nameGroup.add(slot.group);
      const glyph = this.loaded.get(slot.char);
      const delay = stagger++ * APPEAR_STAGGER_MS;
      if (glyph) {
        this.fillSlot(slot, glyph, manifest, now + delay);
      } else {
        this.addSkeleton(slot, metas[i], manifest);
        this.loadGeometry(slot.char).then((g) => {
          if (this.slots.includes(slot) && !slot.material) {
            this.fillSlot(slot, g, manifest, performance.now());
            this.refreshDots(true);
            this.requestRender();
          }
        }).catch(() => {}); // the skeleton stays if a glyph can't load
      }
    });

    // Layout box in world space: X = width, Y = up (print Z), Z = toward the viewer (print -Y)
    const tallest = Math.max(0, ...metas.map((m) => m.height));
    const depth = Math.max(0, ...metas.map((m) => m.depth));
    this.layoutBox.set(new THREE.Vector3(-total / 2, 0, -tallest / 2), new THREE.Vector3(total / 2, depth, tallest / 2));
    if (!chars.length) this.layoutBox.makeEmpty();

    this.fitShadow(total);
    this.frameCamera(this.framed);
    this.refreshDots(true);

    if (!this.shown && this.slots.some((s) => s.material)) {
      // Compile shaders off the main thread where the browser supports it, before the first frame
      await this.renderer.compileAsync(this.scene, this.camera).catch(() => {});
      if (token !== this.buildToken) return;
      // Start the fade-in cascade now, not before a possibly slow compile
      const t = performance.now();
      this.slots.forEach((s, i) => { if (s.appear) s.appear.start = t + i * APPEAR_STAGGER_MS; });
      this.scheduleEnvironment();
    }
    this.requestRender();
  }

  private createSlot(char: string, index: number): Slot {
    const group = new THREE.Group();
    group.userData = { letterIndex: index, char };
    return { char, group, material: null, skeleton: null, slide: null, appear: null, tint: null, studs: null, dots: null };
  }

  /** Translucent block the size of the glyph, shown until its GLB arrives. */
  private addSkeleton(slot: Slot, meta: ManifestLetter, manifest: Manifest): void {
    const box = new THREE.BoxGeometry(meta.width, meta.height, manifest.bodyDepth);
    box.translate(meta.originX + meta.width / 2, meta.originY + meta.height / 2, manifest.bodyDepth / 2);
    slot.skeleton = new THREE.Mesh(box, this.skeletonMaterial);
    slot.group.add(slot.skeleton);
  }

  private fillSlot(slot: Slot, glyph: Glyph, manifest: Manifest, appearAt: number): void {
    if (slot.skeleton) {
      slot.skeleton.geometry.dispose();
      slot.group.remove(slot.skeleton);
      slot.skeleton = null;
    }
    const material = createPlaMaterial(manifest.bodyDepth + manifest.studHeight);
    material.color.set(this.letterHex(slot.group.userData.letterIndex));
    material.transparent = true; // kept on so the fade never forces a shader recompile
    const body = new THREE.Mesh(glyph.body, material);
    body.castShadow = true;
    body.receiveShadow = true;
    slot.group.add(body, buildStuds(this.studGeo!, material, glyph.studs, manifest.studPitch));
    slot.material = material;
    slot.studs = glyph.studs;
    if (this.reduceMotion) return;
    material.opacity = 0;
    slot.appear = { start: appearAt };
  }

  private disposeSlot(slot: Slot): void {
    slot.material?.dispose();
    slot.dots?.traverse((o) => { if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose(); });
    slot.skeleton?.geometry.dispose();
    slot.group.traverse((o) => { if (o instanceof THREE.InstancedMesh) o.dispose(); });
    slot.group.removeFromParent();
  }

  /**
   * Place (or clear) the decorative pieces. Only rebuilds when the name, its colours, the
   * loaded letters or the add-on change; `pop` animates them in.
   */
  private refreshDots(pop: boolean): void {
    const m = this.manifestData;
    const on = !!this.props.dots && !!m;
    const key = on ? [this.props.name, ...this.slots.map((s, i) => (s.studs ? this.letterHex(i) : '-'))].join('|') : '';
    if (key === this.dotsKey) return;
    this.dotsKey = key;
    for (const slot of this.slots) {
      if (!slot.dots) continue;
      slot.dots.traverse((o) => { if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose(); });
      slot.group.remove(slot.dots);
      slot.dots = null;
    }
    this.dotsPop = null;
    if (!on || !m) return this.requestRender();

    const placed = placePieces(this.props.name, this.slots.map((s, i) => ({ studs: s.studs ?? [], colour: this.letterHex(i) })));
    this.slots.forEach((slot, li) => {
      const mine = placed.filter((d) => d.letter === li);
      if (!mine.length) return;
      const group = new THREE.Group();
      for (const d of mine) {
        const k = `${d.w}x${d.h}`;
        if (!this.pieceGeos.has(k)) this.pieceGeos.set(k, buildPieceGeometry(d.w, d.h, m.studPitch));
        const piece = new THREE.Mesh(this.pieceGeos.get(k)!, createPieceMaterial(d.colour));
        piece.position.set(d.cx * m.studPitch, d.cy * m.studPitch, m.bodyDepth); // on the letter's top face
        piece.castShadow = true;
        piece.receiveShadow = true;
        group.add(piece);
      }
      slot.dots = group;
      slot.group.add(group);
    });
    if (pop && !this.reduceMotion) {
      this.dotsPop = { start: performance.now() };
      this.stepDots(this.dotsPop.start); // start at scale 0, not a flash of full size
    }
    this.requestRender();
  }

  /** Pop-in: each piece grows out of the letter with a small overshoot, one after another. */
  private stepDots(now: number): boolean {
    if (!this.dotsPop) return false;
    let n = 0, done = true;
    for (const slot of this.slots) {
      for (const piece of slot.dots?.children ?? []) {
        const t = progress(this.dotsPop.start + n++ * DOT_STAGGER_MS, DOT_POP_MS, now);
        if (t < 1) done = false;
        piece.scale.setScalar(Math.max(0.001, easeOutBack(t))); // geometry's origin is its base, so it grows from the letter
      }
    }
    if (done) this.dotsPop = null;
    return true;
  }

  /** Build the studio environment once the first frame is up, so it never delays it. */
  protected scheduleEnvironment(): void {
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
  protected fitShadow(nameWidth: number): void {
    const half = Math.max(SHADOW_MIN_HALF, nameWidth / 2 + 60);
    Object.assign(this.keyLight.shadow.camera, { left: -half, right: half, top: half * 0.75, bottom: -half * 0.75, far: half * 3 });
    this.keyLight.shadow.camera.updateProjectionMatrix();
  }

  protected applyColours(only?: Set<number>): void {
    const now = performance.now();
    this.slots.forEach((slot, i) => {
      if (!slot.material || (only && !only.has(i))) return;
      const to = new THREE.Color(this.letterHex(i));
      if (this.reduceMotion || slot.appear) {
        slot.material.color.copy(to);
        slot.tint = null;
      } else if (!slot.material.color.equals(to)) {
        slot.tint = { from: slot.material.color.clone(), to, start: now };
      }
    });
    this.refreshDots(false); // a dot never matches its letter, so colours can shuffle
    this.requestRender();
  }

  /** Point the camera at the name for the current view; eases over 300ms when animate is set. */
  protected frameCamera(animate = false, direction?: THREE.Vector3, margin = FRAME_MARGIN): void {
    const box = this.layoutBox; // target layout, not mid-slide positions
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) * margin;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    // Fit whichever is tighter: the object's height (its depth/thickness, whichever shows) against
    // the vertical FOV, its width against the horizontal one. (Fitting the width vertically too
    // left wide names and the door sign at about half the stage width on 16:9 screens.)
    const tall = Math.max(size.y, size.z) * margin;
    const fitDist = Math.max(tall / (2 * tanHalf), (size.x * margin) / (2 * tanHalf * this.camera.aspect));

    // Spec's view angles; the camera sits fitDist (× the user's pinch zoom) away along each
    const dir = (direction?.clone() ?? {
      hero: new THREE.Vector3(0, 0.55, 1.1),
      top: new THREE.Vector3(0, 1, 0.001),
      side: new THREE.Vector3(1.1, 0.02, 0.01),
    }[this.props.viewMode]).normalize();

    // Refine by projecting the layout's corners: in perspective the near edge of a flat name
    // looks wider than the analytic fit assumes, so the Angle view used to crop at the sides.
    // Each pass rescales the distance so the widest/tallest corner lands at 1/margin of the frame.
    const probe = this.camera.clone();
    probe.updateProjectionMatrix(); // capture() changes aspect without updating the live camera's matrix
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(
      i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
    let dist = fitDist;
    for (let pass = 0; pass < 6; pass++) {
      probe.position.copy(center).addScaledVector(dir, dist);
      probe.lookAt(center);
      probe.updateMatrixWorld();
      const extent = Math.max(...corners.map((c) => {
        const v = c.clone().project(probe);
        return Math.max(Math.abs(v.x), Math.abs(v.y));
      }));
      dist *= extent * margin;
    }
    const fittedDist = dist;
    this.fit = { center, dir, dist: fittedDist };
    const toPos = center.clone().addScaledVector(dir, fittedDist * this.zoom);

    // Long names put the camera well past the spec's 2000mm far plane
    this.camera.far = Math.max(2000, fittedDist * ZOOM_MAX + maxDim * 2);
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

  protected requestRender(): void {
    if (this.frameQueued) return;
    this.frameQueued = true;
    requestAnimationFrame(this.frame);
  }

  private frame = (t: number): void => {
    this.frameQueued = false;
    if (!this.visible || document.hidden) return; // resumed by observers
    const now = performance.now();
    const dt = this.lastFrame ? Math.min(100, now - this.lastFrame) : 16;
    this.lastFrame = now;

    let moving = this.stepSpin(t, now, dt);
    moving = this.stepCamera(now) || moving;
    moving = this.stepContent(now) || moving;

    this.nameGroup.rotation.z = this.rotation;
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    const hasContent = this.hasContent();
    if (hasContent) this.adaptQuality(performance.now() - t0);
    if (hasContent && !this.shown) {
      this.shown = true;
      this.onReady?.();
    }
    if (moving) this.requestRender();
    else this.lastFrame = 0;
  };

  /** Idle sway, tap settle, or damped follow of the drag target. Returns true while moving. */
  private stepSpin(t: number, now: number, dt: number): boolean {
    if (this.swaying) {
      this.rotation = this.spinTarget = Math.sin(t * SWAY_SPEED) * SWAY_AMPLITUDE;
      return true;
    }
    if (this.settle) {
      const k = progress(this.settle.start, CAMERA_TWEEN_MS, now);
      this.rotation = this.spinTarget = this.settle.from * (1 - easeOutCubic(k)); // ease back to square-on
      if (k === 1) this.settle = null;
      return true;
    }
    const gap = this.spinTarget - this.rotation;
    if (Math.abs(gap) < 1e-4) {
      this.rotation = this.spinTarget;
      return false;
    }
    this.rotation += this.reduceMotion ? gap : gap * (1 - Math.exp(-dt / SPIN_DAMPING_MS));
    return true;
  }

  private stepCamera(now: number): boolean {
    const tw = this.tween;
    if (!tw) return false;
    const k = progress(tw.start, CAMERA_TWEEN_MS, now);
    const e = easeOutCubic(k);
    this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
    this.lookAt.lerpVectors(tw.fromLook, tw.toLook, e);
    this.camera.lookAt(this.lookAt);
    if (k === 1) this.tween = null;
    return true;
  }

  private stepSlots(now: number): boolean {
    let moving = false;
    for (const slot of this.slots) {
      if (slot.slide) {
        const k = progress(slot.slide.start, SLIDE_MS, now);
        slot.group.position.x = THREE.MathUtils.lerp(slot.slide.from, slot.slide.to, easeOutCubic(k));
        if (k === 1) slot.slide = null;
        moving = true;
      }
      if (slot.appear && slot.material) {
        const k = progress(slot.appear.start, APPEAR_MS, now);
        slot.material.opacity = k;
        slot.group.position.z = -APPEAR_RISE_MM * (1 - easeOutBack(k)); // rises, overshoots a hair, settles
        if (k === 1) {
          slot.appear = null;
          slot.group.position.z = 0;
        }
        moving = true;
      }
      if (slot.tint && slot.material) {
        const k = progress(slot.tint.start, TINT_MS, now);
        slot.material.color.lerpColors(slot.tint.from, slot.tint.to, k);
        if (k === 1) slot.tint = null;
        moving = true;
      }
    }
    return moving;
  }

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
    if (this.settle) {
      // A touch mid-settle finishes it; cancelling would leave the name stuck at a tilt
      this.rotation = this.spinTarget = 0;
      this.settle = null;
    }
    if (this.pointers.size === 2) {
      // Second finger: switch from spin to pinch, and never treat this gesture as a tap
      this.drag = null;
      this.pinch = { startDist: this.pointerSpread(), startZoom: this.zoom };
      return;
    }
    if (this.pointers.size > 2) return;
    this.drag = {
      id: e.pointerId, startX: e.clientX, startY: e.clientY, startRot: this.spinTarget,
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
    this.spinTarget = this.drag.startRot + dx * DRAG_SPEED;
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

/** One printed stud (with a small top chamfer), standing on the body's top face. */
function buildStudGeometry(m: Manifest): THREE.BufferGeometry {
  const r = m.studDiameter / 2;
  const top = m.bodyDepth + m.studHeight;
  // Profile bottom-up so the lathe's faces point outward; starts just inside the body to avoid a seam
  const profile = [[r, m.bodyDepth - 0.01], [r, top - STUD_CHAMFER], [r - STUD_CHAMFER, top], [0, top]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const lathe = new THREE.LatheGeometry(profile, STUD_SEGMENTS);
  lathe.rotateX(Math.PI / 2); // lathe axis Y -> print Z
  const geo = toCreasedNormals(lathe, CREASE_ANGLE);
  lathe.dispose();
  return geo;
}

export function buildStuds(geo: THREE.BufferGeometry, material: THREE.Material, cells: number[], pitch: number): THREE.InstancedMesh {
  const studs = new THREE.InstancedMesh(geo, material, cells.length / 2);
  const m = new THREE.Matrix4();
  for (let k = 0; k < cells.length; k += 2) {
    studs.setMatrixAt(k / 2, m.makeTranslation(cells[k] * pitch, cells[k + 1] * pitch, 0));
  }
  studs.computeBoundingBox();
  studs.computeBoundingSphere();
  studs.receiveShadow = true; // 1.8mm studs cast no shadow worth a second shadow pass
  return studs;
}
