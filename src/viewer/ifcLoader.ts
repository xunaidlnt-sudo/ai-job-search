// IFC loading with web-ifc (open source, MPL-2.0). Produces one three.js mesh
// group per IFC product plus the element metadata the linking engine needs.

import * as THREE from "three";
import * as WebIFC from "web-ifc";
import type { ModelElement } from "../core/types";

export interface LoadedIfc {
  elements: ModelElement[];
  objects: Map<string, THREE.Object3D>;
}

let api: WebIFC.IfcAPI | null = null;

async function getApi(): Promise<WebIFC.IfcAPI> {
  if (api) return api;
  const a = new WebIFC.IfcAPI();
  a.SetWasmPath(new URL("./", document.baseURI).href, true);
  await a.Init();
  api = a;
  return a;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "value" in (v as Record<string, unknown>)) return String((v as { value: unknown }).value ?? "");
  return String(v);
}

export async function loadIfc(bytes: Uint8Array, onProgress?: (msg: string) => void): Promise<LoadedIfc> {
  const ifc = await getApi();
  onProgress?.("Opening model…");
  const modelID = ifc.OpenModel(bytes, { COORDINATE_TO_ORIGIN: true });
  try {
    const objects = new Map<string, THREE.Object3D>();
    const expressToKey = new Map<number, string>();
    const elements: ModelElement[] = [];
    const materials = new Map<string, THREE.MeshLambertMaterial>();

    onProgress?.("Reading geometry…");
    ifc.StreamAllMeshes(modelID, (mesh) => {
      const group = new THREE.Group();
      const placed = mesh.geometries;
      for (let i = 0; i < placed.size(); i++) {
        const pg = placed.get(i);
        const geom = ifc.GetGeometry(modelID, pg.geometryExpressID);
        const verts = ifc.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
        const index = ifc.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
        const pos = new Float32Array(verts.length / 2);
        const nor = new Float32Array(verts.length / 2);
        for (let v = 0, k = 0; v < verts.length; v += 6, k += 3) {
          pos[k] = verts[v];
          pos[k + 1] = verts[v + 1];
          pos[k + 2] = verts[v + 2];
          nor[k] = verts[v + 3];
          nor[k + 1] = verts[v + 4];
          nor[k + 2] = verts[v + 5];
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
        g.setIndex(new THREE.BufferAttribute(index, 1));
        g.applyMatrix4(new THREE.Matrix4().fromArray(pg.flatTransformation));
        geom.delete();
        const c = pg.color;
        const key = `${c.x.toFixed(3)}|${c.y.toFixed(3)}|${c.z.toFixed(3)}|${c.w.toFixed(3)}`;
        let mat = materials.get(key);
        if (!mat) {
          mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(c.x, c.y, c.z), transparent: c.w < 1, opacity: c.w, side: THREE.DoubleSide });
          materials.set(key, mat);
        }
        group.add(new THREE.Mesh(g, mat));
      }
      const line = ifc.GetLine(modelID, mesh.expressID);
      const key = str(line?.GlobalId) || `express-${mesh.expressID}`;
      group.userData.elementId = key;
      objects.set(key, group);
      expressToKey.set(mesh.expressID, key);
    });

    onProgress?.(`Reading properties for ${objects.size} elements…`);
    const storeyOf = await spatialStoreys(ifc, modelID);
    let n = 0;
    for (const [expressID, key] of expressToKey) {
      const line = ifc.GetLine(modelID, expressID);
      const typeCode = ifc.GetLineType(modelID, expressID);
      const props: Record<string, string> = {};
      const tag = str(line?.Tag);
      if (tag) props.Tag = tag;
      const objType = str(line?.ObjectType);
      if (objType) props.ObjectType = objType;
      const storey = storeyOf.get(expressID);
      if (storey) props.Storey = storey;
      try {
        const psets = await ifc.properties.getPropertySets(modelID, expressID, true);
        for (const ps of psets ?? []) {
          const psName = str(ps?.Name) || "Pset";
          for (const p of ps?.HasProperties ?? []) {
            const pName = str(p?.Name);
            const val = str(p?.NominalValue);
            if (pName && val) props[`${psName}.${pName}`] = val;
          }
          for (const q of ps?.Quantities ?? []) {
            const qName = str(q?.Name);
            const val = str(q?.LengthValue ?? q?.AreaValue ?? q?.VolumeValue ?? q?.CountValue ?? q?.WeightValue);
            if (qName && val) props[`${psName}.${qName}`] = val;
          }
        }
      } catch {
        // Some elements have malformed property links; keep the basics.
      }
      elements.push({
        id: key,
        expressId: expressID,
        ifcType: ifc.GetNameFromTypeCode(typeCode) || String(typeCode),
        name: str(line?.Name) || `#${expressID}`,
        properties: props,
      });
      if (++n % 500 === 0) onProgress?.(`Reading properties… ${n}/${expressToKey.size}`);
    }
    return { elements, objects };
  } finally {
    ifc.CloseModel(modelID);
  }
}

interface SpatialNode {
  expressID: number;
  type: string;
  children: SpatialNode[];
}

async function spatialStoreys(ifc: WebIFC.IfcAPI, modelID: number): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  try {
    const root = (await ifc.properties.getSpatialStructure(modelID)) as unknown as SpatialNode;
    const walk = (node: SpatialNode, storey: string | null) => {
      let current = storey;
      if (String(node.type).toUpperCase() === "IFCBUILDINGSTOREY") current = str(ifc.GetLine(modelID, node.expressID)?.Name) || `Storey #${node.expressID}`;
      else if (current) out.set(node.expressID, current);
      for (const c of node.children ?? []) walk(c, current);
    };
    walk(root, null);
  } catch {
    // Spatial structure is optional.
  }
  return out;
}
