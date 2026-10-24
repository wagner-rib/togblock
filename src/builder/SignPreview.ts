/* 3D preview of the door sign, built to door_sign.py's rules so it matches the
 * print file: a rounded-rectangle brick baseplate with studs on the border only,
 * and the name raised in smooth Russo One letters (the same glyph bodies as the
 * brick letters, scaled to the sign's letter height). Reuses BuilderPreview's
 * stage, lighting, camera, interaction and capture.
 */
import * as THREE from 'three';
import { BuilderPreview, buildStuds, type BuilderPreviewProps, type Glyph } from './BuilderPreview';
import { createPlaMaterial } from './plaMaterial';
import { layoutSign, studCells, signChars, PLATE_WIDTH, PLATE_THICKNESS, PLATE_CORNER, LETTER_RELIEF } from './signLayout';

export { signChars };

const SIGN_FADE_MS = 200;
const TINT_MS = 200;

export interface SignPreviewProps {
  text: string;                   // A–Z, 0–9 and spaces
  plateColour: string;            // hex
  textColour: string;             // hex
  viewMode: BuilderPreviewProps['viewMode'];
}

function plateGeometry(height: number): THREE.ExtrudeGeometry {
  const w = PLATE_WIDTH / 2, h = height / 2, r = PLATE_CORNER;
  const s = new THREE.Shape();
  s.moveTo(-w + r, -h);
  s.lineTo(w - r, -h);
  s.absarc(w - r, -h + r, r, -Math.PI / 2, 0, false);
  s.lineTo(w, h - r);
  s.absarc(w - r, h - r, r, 0, Math.PI / 2, false);
  s.lineTo(-w + r, h);
  s.absarc(-w + r, h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-w, -h + r);
  s.absarc(-w + r, -h + r, r, Math.PI, Math.PI * 1.5, false);
  return new THREE.ExtrudeGeometry(s, { depth: PLATE_THICKNESS, bevelEnabled: false, curveSegments: 10 });
}

export class SignPreview extends BuilderPreview {
  private sign: SignPreviewProps;
  private signGroup = new THREE.Group();
  private plateMat: THREE.MeshStandardMaterial | null = null;
  private textMat: THREE.MeshStandardMaterial | null = null;
  private fade: { start: number } | null = null;
  private tints: { mat: THREE.MeshStandardMaterial; from: THREE.Color; to: THREE.Color; start: number }[] = [];

  constructor(canvas: HTMLCanvasElement, props: SignPreviewProps, opts: { onReady?: () => void } = {}) {
    super(canvas, {
      name: props.text, size: 'standard', theme: 'one', oneColour: props.textColour,
      letterColours: {}, viewMode: props.viewMode,
    }, opts);
    this.sign = props;
  }

  setSign(next: Partial<SignPreviewProps>): void {
    const prev = this.sign;
    this.sign = { ...prev, ...next };
    if (next.text !== undefined && signChars(next.text) !== signChars(prev.text)) {
      this.building = this.rebuild();
    } else if (next.viewMode && next.viewMode !== prev.viewMode) {
      this.setProps({ viewMode: next.viewMode });
    } else {
      this.applyColours();
    }
  }

  protected async rebuild(): Promise<void> {
    const token = ++this.buildToken;
    const manifest = await this.manifest;
    const text = signChars(this.sign.text);
    const layout = layoutSign(text, manifest);
    const glyphs = new Map<string, Glyph>();
    await Promise.all([...new Set(layout.letters.map((l) => l.char))].map(async (c) => {
      glyphs.set(c, await this.loadGeometry(c));
    }));
    this.studGeo ??= await this.studGeometry;
    if (token !== this.buildToken) return;

    this.disposeSign();
    if (!this.signGroup.parent) this.nameGroup.add(this.signGroup);

    this.plateMat = createPlaMaterial(PLATE_THICKNESS + manifest.studHeight);
    this.textMat = createPlaMaterial(1e6); // letter tops aren't stud tops
    this.plateMat.color.set(this.sign.plateColour);
    this.textMat.color.set(this.sign.textColour);

    const plate = new THREE.Mesh(plateGeometry(layout.plateHeight), this.plateMat);
    plate.castShadow = plate.receiveShadow = true;
    // The shared stud shape stands on the letters' 18mm body; drop it onto the 6mm plate
    const studs = buildStuds(this.studGeo, this.plateMat, studCells(layout, manifest.studPitch, manifest.studDiameter / 2), manifest.studPitch);
    const drop = new THREE.Matrix4().makeTranslation(0, 0, PLATE_THICKNESS - manifest.bodyDepth);
    const m = new THREE.Matrix4();
    for (let i = 0; i < studs.count; i++) {
      studs.getMatrixAt(i, m);
      studs.setMatrixAt(i, m.premultiply(drop));
    }
    studs.computeBoundingBox();
    studs.computeBoundingSphere();
    this.signGroup.add(plate, studs);

    const s = layout.letterHeight / 184;
    for (const l of layout.letters) {
      const letter = new THREE.Mesh(glyphs.get(l.char)!.body, this.textMat);
      letter.scale.set(s, s, LETTER_RELIEF / manifest.bodyDepth); // 18mm body → 6mm relief
      letter.position.set(l.x, 0, PLATE_THICKNESS);
      letter.castShadow = letter.receiveShadow = true;
      this.signGroup.add(letter);
    }

    // World layout box: X = width, Y = up (print Z), Z = toward viewer (print -Y)
    const top = PLATE_THICKNESS + LETTER_RELIEF;
    this.layoutBox.set(
      new THREE.Vector3(-PLATE_WIDTH / 2, 0, -layout.plateHeight / 2),
      new THREE.Vector3(PLATE_WIDTH / 2, top, layout.plateHeight / 2),
    );
    this.fitShadow(PLATE_WIDTH);
    this.frameCamera(this.framed);

    const first = !this.shown;
    if (first) {
      await this.renderer.compileAsync(this.scene, this.camera).catch(() => {});
      if (token !== this.buildToken) return;
      this.scheduleEnvironment();
    }
    if (!this.reduceMotion && first) {
      for (const mat of [this.plateMat, this.textMat]) { mat.transparent = true; mat.opacity = 0; }
      this.fade = { start: performance.now() };
    }
    this.requestRender();
  }

  protected applyColours(): void {
    const now = performance.now();
    for (const [mat, hex] of [[this.plateMat, this.sign.plateColour], [this.textMat, this.sign.textColour]] as const) {
      if (!mat) continue;
      const to = new THREE.Color(hex);
      if (mat.color.equals(to)) continue;
      if (this.reduceMotion || !this.shown) mat.color.copy(to);
      else this.tints.push({ mat, from: mat.color.clone(), to, start: now });
    }
    this.requestRender();
  }

  protected hasContent(): boolean {
    return !!this.plateMat;
  }

  protected stepContent(now: number): boolean {
    let moving = false;
    if (this.fade && this.plateMat && this.textMat) {
      const k = Math.min(1, (now - this.fade.start) / SIGN_FADE_MS);
      this.plateMat.opacity = this.textMat.opacity = k;
      if (k === 1) this.fade = null;
      moving = true;
    }
    this.tints = this.tints.filter((t) => {
      const k = Math.min(1, (now - t.start) / TINT_MS);
      t.mat.color.lerpColors(t.from, t.to, k);
      return k < 1;
    });
    return moving || this.tints.length > 0;
  }

  protected async contentSettled(): Promise<void> {
    let token: number;
    do { token = this.buildToken; await this.building; } while (token !== this.buildToken);
  }

  protected finishAnimations(): void {
    if (this.fade && this.plateMat && this.textMat) { this.plateMat.opacity = this.textMat.opacity = 1; this.fade = null; }
    for (const t of this.tints) t.mat.color.copy(t.to);
    this.tints = [];
  }

  private disposeSign(): void {
    this.signGroup.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
      else if (o instanceof THREE.Mesh && o.geometry instanceof THREE.ExtrudeGeometry) o.geometry.dispose();
    });
    this.plateMat?.dispose();
    this.textMat?.dispose();
    this.signGroup.clear();
  }
}
