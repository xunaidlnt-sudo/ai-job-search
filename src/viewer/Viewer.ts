// three.js viewport: one Object3D per model element (or segment), 4D states
// applied each frame, picking, selection highlight, equipment motion,
// clipping for growth and segments, path drawing, camera fit, capture.
//
// Speed: elements are only repainted when their state actually changes, so
// playback on a large model touches the few elements whose task is moving,
// not the whole model every frame.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { DemoBox } from "../core/demo";
import { combineClips, type Clip, type Motion } from "../core/motion";
import type { ElementState } from "../core/simulation";
import type { ElementSegment, MotionPath } from "../core/types";

interface Entry {
  object: THREE.Object3D;
  originals: Map<THREE.Mesh, THREE.Material>;
  /** Per-mesh override materials (cloned from the originals on first use). */
  overrides: Map<THREE.Mesh, THREE.MeshLambertMaterial> | null;
  /** World-space box at the modelled position. */
  box: THREE.Box3;
  basePos: THREE.Vector3;
  baseYaw: number;
  segment: Clip | null;
  key: string;
}

const SELECT_COLOR = new THREE.Color("#ff7a00");
const DEFAULT_STATE: ElementState = { visible: true, color: null, transparency: 0 };
const AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private root = new THREE.Group();
  private overlay = new THREE.Group();
  private entries = new Map<string, Entry>();
  private selected = new Set<string>();
  private states = new Map<string, ElementState>();
  private motions = new Map<string, Motion>();
  private raycaster = new THREE.Raycaster();
  private needsRender = true;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  /** Elements repainted by the last frame (for diagnostics/tests). */
  lastRepaintCount = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color("#eef1f5");
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    this.camera.position.set(30, 25, 35);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener("change", () => (this.needsRender = true));

    this.scene.add(new THREE.HemisphereLight("#ffffff", "#8d8778", 1.6));
    const sun = new THREE.DirectionalLight("#ffffff", 1.4);
    sun.position.set(40, 80, 30);
    this.scene.add(sun);
    const grid = new THREE.GridHelper(400, 80, "#c3c9d2", "#d9dee5");
    grid.position.y = -2.5;
    this.scene.add(grid);
    this.scene.add(this.root);
    this.scene.add(this.overlay);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    const loop = () => {
      if (this.disposed) return;
      this.controls.update();
      if (this.needsRender) {
        this.renderer.render(this.scene, this.camera);
        this.needsRender = false;
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  /** Move the canvas into another container (interface layouts place the 3D view differently). */
  attach(container: HTMLElement) {
    if (container === this.container) return;
    this.resizeObserver.disconnect();
    this.container = container;
    container.appendChild(this.renderer.domElement);
    this.resizeObserver.observe(container);
    this.resize();
  }

  dispose() {
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  clear() {
    this.root.clear();
    this.entries.clear();
    this.selected.clear();
    this.states.clear();
    this.motions.clear();
    this.needsRender = true;
  }

  get elementCount() {
    return this.entries.size;
  }

  private register(id: string, object: THREE.Object3D, segment: Clip | null) {
    object.userData.elementId = id;
    const originals = new Map<THREE.Mesh, THREE.Material>();
    object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        originals.set(m, m.material as THREE.Material);
        m.userData.elementId = id;
      }
    });
    this.root.add(object);
    object.updateMatrixWorld(true);
    object.traverse((o) => (o.matrixAutoUpdate = false));
    this.entries.set(id, {
      object,
      originals,
      overrides: null,
      box: new THREE.Box3().setFromObject(object),
      basePos: object.position.clone(),
      baseYaw: object.rotation.y,
      segment,
      key: "",
    });
  }

  /** Load element objects. Split elements are replaced by clipped clones, one per segment. */
  setObjects(objects: Map<string, THREE.Object3D>, segments: ElementSegment[] = [], fit = true) {
    this.clear();
    const byParent = new Map<string, ElementSegment[]>();
    for (const s of segments) (byParent.get(s.parentId) ?? byParent.set(s.parentId, []).get(s.parentId)!).push(s);
    for (const [id, object] of objects) {
      const segs = byParent.get(id);
      if (!segs) {
        this.register(id, object, null);
        continue;
      }
      for (const s of segs) this.register(s.id, object.clone(), { axis: s.axis, lo: s.from, hi: s.to });
    }
    for (const id of this.entries.keys()) this.paint(id, true);
    if (fit) this.fit();
  }

  static demoObjects(boxes: DemoBox[]): Map<string, THREE.Object3D> {
    const objects = new Map<string, THREE.Object3D>();
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const mats = new Map<string, THREE.MeshLambertMaterial>();
    for (const b of boxes) {
      let mat = mats.get(b.color);
      if (!mat) {
        mat = new THREE.MeshLambertMaterial({ color: b.color, side: THREE.DoubleSide });
        mats.set(b.color, mat);
      }
      const mesh = new THREE.Mesh(unit, mat);
      mesh.position.set(...b.center);
      mesh.scale.set(...b.size);
      objects.set(b.element.id, mesh);
    }
    return objects;
  }

  fit(ids?: Iterable<string>) {
    const box = new THREE.Box3();
    if (ids) {
      for (const id of ids) {
        const e = this.entries.get(id);
        if (e) box.union(e.box);
      }
    } else {
      for (const e of this.entries.values()) box.union(e.box);
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const dir = new THREE.Vector3(1, 0.75, 1.15).normalize();
    this.camera.position.copy(center).addScaledVector(dir, size * 1.45);
    this.camera.near = Math.max(0.01, size / 1000);
    this.camera.far = size * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
    this.needsRender = true;
  }

  /** Apply one frame of 4D state and motion. Only changed elements are repainted. */
  applyFrame(states: Map<string, ElementState>, motions: Map<string, Motion> = new Map()) {
    this.states = states;
    this.motions = motions;
    let n = 0;
    for (const id of this.entries.keys()) if (this.paint(id)) n++;
    this.lastRepaintCount = n;
    if (n) this.needsRender = true;
  }

  /** Kept for callers that only have states. */
  applyStates(states: Map<string, ElementState>) {
    this.applyFrame(states, this.motions);
  }

  setSelection(ids: Set<string>) {
    const changed = new Set([...this.selected, ...ids]);
    this.selected = new Set(ids);
    for (const id of changed) this.paint(id);
    this.needsRender = true;
  }

  /** Returns true when the element was repainted. */
  private paint(id: string, force = false): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    const s = this.states.get(id) ?? DEFAULT_STATE;
    const motion = this.motions.get(id);
    const isSel = this.selected.has(id);
    const clip = combineClips(entry.segment, s.clip ?? null);
    const r = (x: number) => Math.round(x * 1000) / 1000;
    const key = [
      s.visible ? 1 : 0,
      s.color ?? "",
      r(s.transparency),
      isSel ? 1 : 0,
      clip ? `${clip.axis}${r(clip.lo)}-${r(clip.hi)}` : "",
      motion ? `${r(motion.offset[0])},${r(motion.offset[1])},${r(motion.offset[2])},${r(motion.yaw)}` : "",
    ].join("|");
    if (!force && key === entry.key) return false;
    entry.key = key;

    // Position (equipment on a path).
    const obj = entry.object;
    const off = motion?.offset ?? [0, 0, 0];
    obj.position.set(entry.basePos.x + off[0], entry.basePos.y + off[1], entry.basePos.z + off[2]);
    obj.rotation.y = entry.baseYaw + (motion?.yaw ?? 0);
    obj.updateMatrix();
    obj.updateMatrixWorld(true);

    const clipEmpty = clip !== null && clip.hi - clip.lo <= 1e-4;
    obj.visible = (s.visible && !clipEmpty) || isSel;

    const needOverride = isSel || s.color !== null || s.transparency > 0 || clip !== null;
    if (!needOverride) {
      for (const [mesh, mat] of entry.originals) mesh.material = mat;
      return true;
    }
    if (!entry.overrides) {
      entry.overrides = new Map();
      for (const [mesh, mat] of entry.originals) {
        const src = mat as THREE.MeshLambertMaterial;
        entry.overrides.set(mesh, new THREE.MeshLambertMaterial({ color: src.color?.clone() ?? new THREE.Color("#cccccc"), side: THREE.DoubleSide }));
      }
    }
    let planes: THREE.Plane[] | null = null;
    if (clip && !isSel) {
      const box = entry.box.clone().translate(new THREE.Vector3(off[0], off[1], off[2]));
      const min = box.min[clip.axis];
      const size = box.max[clip.axis] - min;
      const a = min + clip.lo * size;
      const b = min + clip.hi * size;
      planes = [new THREE.Plane(AXIS[clip.axis].clone(), -a), new THREE.Plane(AXIS[clip.axis].clone().negate(), b)];
    }
    const opacity = isSel ? 1 : 1 - s.transparency;
    for (const [mesh, m] of entry.overrides) {
      const orig = entry.originals.get(mesh) as THREE.MeshLambertMaterial;
      if (isSel) m.color.copy(SELECT_COLOR);
      else if (s.color) m.color.set(s.color);
      else m.color.copy(orig.color ?? new THREE.Color("#cccccc"));
      m.transparent = opacity < 1;
      m.opacity = opacity;
      m.depthWrite = opacity > 0.5;
      m.clippingPlanes = planes;
      m.needsUpdate = true;
      mesh.material = m;
    }
    return true;
  }

  /** Element id under a client-space point, ignoring hidden and ghosted elements. */
  pick(clientX: number, clientY: number): string | null {
    const hit = this.hit(clientX, clientY);
    return hit?.id ?? null;
  }

  /** World point under the cursor: on a visible element, else on the ground plane (y = 0). */
  pickPoint(clientX: number, clientY: number): [number, number, number] | null {
    const hit = this.hit(clientX, clientY);
    if (hit) return [hit.point.x, hit.point.y, hit.point.z];
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? [p.x, p.y, p.z] : null;
  }

  private hit(clientX: number, clientY: number): { id: string; point: THREE.Vector3 } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.root.children, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      let visible = true;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) visible = false;
      if (!visible) continue;
      while (o && !o.userData.elementId) o = o.parent;
      const id = o?.userData.elementId as string | undefined;
      if (!id) continue;
      const st = this.states.get(id);
      if (st && st.transparency > 0.8 && !this.selected.has(id)) continue;
      return { id, point: h.point };
    }
    return null;
  }

  /** Draw motion paths (and an in-progress path being edited). */
  setPathOverlay(paths: MotionPath[], draft: [number, number, number][] = []) {
    this.overlay.clear();
    const draw = (pts: [number, number, number][], color: string) => {
      if (pts.length === 0) return;
      const lifted = pts.map(([x, y, z]) => new THREE.Vector3(x, y + 0.05, z));
      if (pts.length > 1) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(lifted), new THREE.LineBasicMaterial({ color, depthTest: false }));
        line.renderOrder = 10;
        this.overlay.add(line);
      }
      const dot = new THREE.SphereGeometry(0.35, 12, 8);
      const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
      for (const v of lifted) {
        const m = new THREE.Mesh(dot, mat);
        m.position.copy(v);
        m.renderOrder = 11;
        this.overlay.add(m);
      }
    };
    for (const p of paths) draw(p.points, "#7c3aed");
    draw(draft, "#ff7a00");
    this.needsRender = true;
  }

  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  requestRender() {
    this.needsRender = true;
  }
}
