// three.js viewport: holds one Object3D per model element, applies 4D states,
// handles picking, selection highlight, camera fit and canvas capture.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { DemoBox } from "../core/demo";
import type { ElementState } from "../core/simulation";

interface Entry {
  object: THREE.Object3D;
  /** Original material per mesh, so "original colour" states can restore it. */
  originals: Map<THREE.Mesh, THREE.Material>;
  /** Per-element override material, created lazily. */
  override: THREE.MeshLambertMaterial | null;
}

const SELECT_COLOR = new THREE.Color("#ff7a00");

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private root = new THREE.Group();
  private entries = new Map<string, Entry>();
  private selected = new Set<string>();
  private states = new Map<string, ElementState>();
  private raycaster = new THREE.Raycaster();
  private needsRender = true;
  private disposed = false;
  private resizeObserver: ResizeObserver;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
    this.needsRender = true;
  }

  setObjects(objects: Map<string, THREE.Object3D>) {
    this.clear();
    for (const [id, object] of objects) {
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
      this.entries.set(id, { object, originals, override: null });
    }
    this.fit();
  }

  setDemo(boxes: DemoBox[]) {
    const objects = new Map<string, THREE.Object3D>();
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const mats = new Map<string, THREE.MeshLambertMaterial>();
    for (const b of boxes) {
      let mat = mats.get(b.color);
      if (!mat) {
        mat = new THREE.MeshLambertMaterial({ color: b.color });
        mats.set(b.color, mat);
      }
      const mesh = new THREE.Mesh(unit, mat);
      mesh.position.set(...b.center);
      mesh.scale.set(...b.size);
      objects.set(b.element.id, mesh);
    }
    this.setObjects(objects);
  }

  fit(ids?: Iterable<string>) {
    const box = new THREE.Box3();
    if (ids) {
      for (const id of ids) {
        const e = this.entries.get(id);
        if (e) box.expandByObject(e.object);
      }
    } else {
      box.setFromObject(this.root);
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

  applyStates(states: Map<string, ElementState>) {
    this.states = states;
    for (const [id, entry] of this.entries) this.paint(id, entry);
    this.needsRender = true;
  }

  setSelection(ids: Set<string>) {
    const changed = new Set([...this.selected, ...ids]);
    this.selected = new Set(ids);
    for (const id of changed) {
      const e = this.entries.get(id);
      if (e) this.paint(id, e);
    }
    this.needsRender = true;
  }

  private paint(id: string, entry: Entry) {
    const s = this.states.get(id) ?? { visible: true, color: null, transparency: 0 };
    const isSel = this.selected.has(id);
    entry.object.visible = s.visible || isSel;
    const useOriginal = !isSel && s.color === null && s.transparency === 0;
    if (useOriginal) {
      for (const [mesh, mat] of entry.originals) mesh.material = mat;
      return;
    }
    if (!entry.override) entry.override = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    const m = entry.override;
    if (isSel) m.color.copy(SELECT_COLOR);
    else if (s.color) m.color.set(s.color);
    else {
      const first = entry.originals.values().next().value as THREE.MeshLambertMaterial | undefined;
      m.color.copy(first?.color ?? new THREE.Color("#cccccc"));
    }
    const opacity = isSel ? 1 : 1 - s.transparency;
    m.transparent = opacity < 1;
    m.opacity = opacity;
    m.depthWrite = opacity > 0.5;
    m.needsUpdate = true;
    for (const mesh of entry.originals.keys()) mesh.material = m;
  }

  /** Return the element id under a client-space point, ignoring hidden elements. */
  pick(clientX: number, clientY: number): string | null {
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
      if (st && st.transparency > 0.8 && !this.selected.has(id)) continue; // skip ghosts
      return id;
    }
    return null;
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
