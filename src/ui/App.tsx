import { useEffect, useMemo, useRef, useState } from "react";
import { demoModel, demoProfileFor, demoXer, DEMO_LINK_RULE } from "../core/demo";
import { applyRules } from "../core/linking";
import { DEFAULT_PROFILES } from "../core/profiles";
import { parseProject, serializeProject } from "../core/project";
import { computeStates, scheduleRange } from "../core/simulation";
import type { LinkRule } from "../core/types";
import type { StratumProject } from "../core/project";
import { diffSchedules, remapLinks } from "../core/update";
import { decodeXer, listXerProjects, parseXerTables, xerToSchedule } from "../core/xer";
import { clearAutosave, loadAutosave, startAutosave } from "./autosave";
import { Help } from "./Help";
import { Viewer } from "../viewer/Viewer";
import { download, downloadDataUrl, pickFile } from "./files";
import { Gantt } from "./Gantt";
import { SidePanel } from "./SidePanel";
import { useStore, fmtDate } from "./store";
import { Timeline } from "./Timeline";

export function App() {
  const viewerHost = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [restore, setRestore] = useState<StratumProject | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  // Offer to restore the last autosaved session, then keep autosaving.
  useEffect(() => {
    let stop: (() => void) | undefined;
    loadAutosave().then((p) => {
      if (p?.schedule) setRestore(p);
      stop = startAutosave(setSavedAt);
    });
    return () => stop?.();
  }, []);
  const store = useStore();
  const { schedule, elements, links, profiles, time, sim, selectedElements, status, busy } = store;

  useEffect(() => {
    if (!viewerHost.current) return;
    const v = new Viewer(viewerHost.current);
    viewerRef.current = v;
    return () => v.dispose();
  }, []);

  const elementIds = useMemo(() => elements.map((e) => e.id), [elements]);

  // Recompute 4D states whenever time, links or display options change.
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (!schedule) {
      v.applyStates(new Map());
      return;
    }
    v.applyStates(computeStates(schedule, links, profiles, elementIds, time, sim));
  }, [schedule, links, profiles, elementIds, time, sim]);

  useEffect(() => {
    viewerRef.current?.setSelection(selectedElements);
  }, [selectedElements]);

  // Keyboard: Space play/pause, arrows step a day (Shift = a week), Home/End jump, ? help.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const s = useStore.getState();
      if (e.key === "?") return setHelpOpen((h) => !h);
      if (e.key === "Escape") return setHelpOpen(false);
      if (!s.schedule) return;
      const r = scheduleRange(s.schedule, s.sim.dateSource);
      if (!r) return;
      const clamp = (t: number) => Math.min(r.finish, Math.max(r.start, t));
      const DAYMS = 86_400_000;
      if (e.code === "Space") {
        e.preventDefault();
        s.setPlaying(!s.playing);
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const dir = e.key === "ArrowRight" ? 1 : -1;
        s.setTime(clamp(s.time + dir * (e.shiftKey ? 7 : 1) * DAYMS));
      } else if (e.key === "Home") s.setTime(r.start);
      else if (e.key === "End") s.setTime(r.finish);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Desktop app: files double-clicked in Explorer/Finder arrive here.
  const openers = useRef({ importXerBytes: async (_n: string, _b: Uint8Array) => {}, importIfcBytes: async (_n: string, _b: Uint8Array) => {} });
  useEffect(() => {
    const bridge = window.stratumDesktop;
    if (!bridge) return;
    return bridge.onOpenFile(({ name, bytes }) => {
      if (/\.xer$/i.test(name)) openers.current.importXerBytes(name, bytes);
      else if (/\.ifc$/i.test(name)) openers.current.importIfcBytes(name, bytes);
    });
  }, []);

  const onViewportClick = (e: React.MouseEvent) => {
    const v = viewerRef.current;
    if (!v) return;
    const id = v.pick(e.clientX, e.clientY);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const next = new Set(additive ? selectedElements : []);
    if (id) {
      if (additive && next.has(id)) next.delete(id);
      else next.add(id);
    }
    store.selectElements(next);
  };

  // Distinguish a click from an orbit drag.
  const down = useRef<{ x: number; y: number } | null>(null);

  const importXer = async () => {
    const f = await pickFile(".xer");
    if (!f) return;
    await importXerBytes(f.name, new Uint8Array(await f.arrayBuffer()));
  };

  const importXerBytes = async (name: string, bytes: Uint8Array) => {
    const f = { name };
    try {
      store.setStatus(`Reading ${f.name}…`, true);
      const tables = parseXerTables(decodeXer(bytes));
      const projects = listXerProjects(tables);
      let projectId = projects[0]?.id;
      if (projects.length > 1) {
        const pick = window.prompt(
          `This XER has ${projects.length} projects. Enter the number to import:\n` + projects.map((p, i) => `${i + 1}. ${p.code} – ${p.name}`).join("\n"),
          "1",
        );
        const idx = Number(pick) - 1;
        if (!projects[idx]) return store.setStatus("Import cancelled.");
        projectId = projects[idx].id;
      }
      const s = xerToSchedule(tables, { projectId });
      const prev = useStore.getState().schedule;
      const prevLinks = useStore.getState().links;
      // Treat it as an update of the open project when Activity IDs overlap.
      const overlap = prev ? s.activities.filter((a) => prev.activities.some((p) => p.code === a.code)).length : 0;
      const isUpdate = !!prev && overlap > 0 && window.confirm(
        `Update the open schedule (${prev.projectCode}) with this file?\n\n${overlap} Activity IDs match. Links will be kept by Activity ID.\n\nCancel to load it as a new project instead.`,
      );
      if (isUpdate && prev) {
        const diff = diffSchedules(prev, s);
        const { links: kept, dropped } = remapLinks(prev, s, prevLinks);
        store.setSchedule(s);
        store.setLinks(kept);
        store.setLastUpdate({ ...diff, keptLinks: kept.length, droppedLinks: dropped.length, at: Date.now() });
        store.setSideTab("check");
        const fin = diff.finishShiftDays;
        store.setStatus(
          `Updated ${s.projectCode}: ${diff.changed.length} changed, ${diff.added.length} added, ${diff.removed.length} removed. ` +
            `Finish ${fin ? `${fin > 0 ? "+" : ""}${fin}d` : "unchanged"}. ${kept.length} links kept${dropped.length ? `, ${dropped.length} dropped` : ""}.`,
        );
      } else {
        store.setSchedule(s);
        store.setLinks([]);
        store.setLastUpdate(null);
        store.setStatus(`Imported ${s.projectCode}: ${s.activities.length} activities, ${s.relationships.length} relationships. Data date ${fmtDate(s.dataDate)}.`);
      }
    } catch (err) {
      store.setStatus(`XER import failed: ${(err as Error).message}`);
    }
  };

  const importIfc = async () => {
    const f = await pickFile(".ifc");
    if (!f) return;
    await importIfcBytes(f.name, new Uint8Array(await f.arrayBuffer()));
  };

  const importIfcBytes = async (name: string, bytes: Uint8Array) => {
    const f = { name };
    try {
      store.setStatus(`Loading ${f.name}…`, true);
      const { loadIfc } = await import("../viewer/ifcLoader");
      const loaded = await loadIfc(bytes, (m) => store.setStatus(m, true));
      viewerRef.current?.setObjects(loaded.objects);
      store.setModel(loaded.elements, f.name);
      // Keep links whose element still exists (same GlobalId).
      const ids = new Set(loaded.elements.map((e) => e.id));
      const kept = useStore.getState().links.filter((l) => ids.has(l.elementId));
      store.setLinks(kept);
      store.setStatus(`Loaded ${f.name}: ${loaded.elements.length} elements. ${kept.length} existing link(s) kept.`);
    } catch (err) {
      console.error(err);
      store.setStatus(`IFC load failed: ${(err as Error).message}`);
    }
  };

  openers.current = { importXerBytes, importIfcBytes };

  const loadDemoModelOnly = () => {
    const boxes = demoModel();
    viewerRef.current?.setDemo(boxes);
    store.setModel(boxes.map((b) => b.element), "Demo model");
  };

  const loadDemo = () => {
    const boxes = demoModel();
    viewerRef.current?.setDemo(boxes);
    const els = boxes.map((b) => b.element);
    store.setModel(els, "Demo model");
    const s = xerToSchedule(parseXerTables(demoXer()));
    store.setSchedule(s);
    store.setProfiles(structuredClone(DEFAULT_PROFILES));
    const rule: LinkRule = { ...DEMO_LINK_RULE, profileId: "install" };
    const found = applyRules([rule], els, s).map((l) => {
      const code = s.activities.find((a) => a.id === l.activityId)!.code;
      return { ...l, profileId: demoProfileFor(code) };
    });
    store.setRules([rule]);
    store.setLinks(found);
    store.setLastUpdate(null);
    store.setStatus(`Demo loaded: ${els.length} elements linked to ${new Set(found.map((l) => l.activityId)).size} activities. Press Play.`);
  };

  const applyProject = (p: StratumProject) => {
    store.setSchedule(p.schedule);
    store.setProfiles(p.profiles);
    store.setRules(p.rules);
    store.setLinks(p.links);
    store.setLastUpdate(null);
  };

  const saveProject = () => {
    const s = useStore.getState();
    const text = serializeProject({ modelFileName: s.modelFileName, schedule: s.schedule, links: s.links, rules: s.rules, profiles: s.profiles });
    download(`${s.schedule?.projectCode ?? "project"}.stratum.json`, text, "application/json");
    store.setStatus("Project saved.");
  };

  const openProject = async () => {
    const f = await pickFile(".json");
    if (!f) return;
    try {
      const p = parseProject(await f.text());
      applyProject(p);
      const loadedIds = new Set(useStore.getState().elements.map((e) => e.id));
      const matched = p.links.filter((l) => loadedIds.has(l.elementId)).length;
      store.setStatus(
        `Opened project (${p.links.length} links). ${p.modelFileName ? `Model: ${p.modelFileName}. ` : ""}` +
          (loadedIds.size ? `${matched} links match the loaded model.` : "Load the IFC model to see links."),
      );
    } catch (err) {
      store.setStatus(`Could not open project: ${(err as Error).message}`);
    }
  };

  const snapshot = () => {
    const v = viewerRef.current;
    if (!v) return;
    downloadDataUrl(`stratum-${new Date(time).toISOString().slice(0, 10)}.png`, v.snapshot());
  };

  const toggleRecording = () => {
    const v = viewerRef.current;
    if (!v || !schedule) return;
    if (recording) {
      recording.stop();
      return;
    }
    const range = scheduleRange(schedule, sim.dateSource);
    if (!range) return;
    const stream = v.canvas.captureStream(30);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      download(`${schedule.projectCode}-4d.webm`, new Blob(chunks, { type: "video/webm" }), "video/webm");
      setRecording(null);
      useStore.getState().setPlaying(false);
      store.setStatus("Video saved.");
    };
    // Stop automatically when playback reaches the end.
    const unsub = useStore.subscribe((s, prev) => {
      if (prev.playing && !s.playing) {
        unsub();
        if (rec.state === "recording") rec.stop();
      }
    });
    rec.start(250);
    setRecording(rec);
    store.setTime(range.start);
    store.setPlaying(true);
    store.setStatus("Recording 4D video… press Stop to finish early.");
  };

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="logo">▤</span> Stratum <small>4D</small>
        </div>
        <button onClick={importXer}>Import P6 XER</button>
        <button onClick={importIfc}>Import IFC</button>
        <span className="sep" />
        <button onClick={openProject}>Open project</button>
        <button onClick={saveProject} disabled={!schedule}>Save project</button>
        <span className="sep" />
        <button onClick={() => viewerRef.current?.fit(selectedElements.size ? selectedElements : undefined)}>Zoom to fit</button>
        <button onClick={snapshot}>Snapshot</button>
        <button onClick={toggleRecording} disabled={!schedule} className={recording ? "danger" : ""}>
          {recording ? "■ Stop recording" : "● Record video"}
        </button>
        <span className="spacer" />
        {savedAt && <span className="muted autosaved">Autosaved {savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
        <button onClick={loadDemo}>Load demo</button>
        <button title="Getting started and shortcuts (?)" onClick={() => setHelpOpen(true)}>?</button>
      </header>
      {restore && (
        <div className="banner">
          Restore your last session? <b>{restore.schedule?.projectCode}</b>, {restore.links.length} links
          {restore.savedAt ? `, saved ${new Date(restore.savedAt).toLocaleString()}` : ""}.
          {restore.modelFileName && restore.modelFileName !== "Demo model" ? ` Re-open ${restore.modelFileName} afterwards to see the links.` : ""}
          <button
            className="primary"
            onClick={() => {
              applyProject(restore);
              if (restore.modelFileName === "Demo model") loadDemoModelOnly();
              store.setStatus("Previous session restored.");
              setRestore(null);
            }}
          >
            Restore
          </button>
          <button onClick={() => { clearAutosave(); setRestore(null); }}>Discard</button>
        </div>
      )}
      {helpOpen && <Help onClose={() => setHelpOpen(false)} onDemo={() => { setHelpOpen(false); loadDemo(); }} />}
      <main className="workspace">
        <section className="left">
          <Gantt />
        </section>
        <section className="center">
          <div
            className="viewport"
            ref={viewerHost}
            onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
            onPointerUp={(e) => {
              const d = down.current;
              if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) onViewportClick(e);
              down.current = null;
            }}
          />
          {elements.length === 0 && (
            <div className="viewport-hint">
              <p>No model loaded.</p>
              <button className="primary" onClick={loadDemo}>Load demo project</button>
            </div>
          )}
        </section>
        <section className="right">
          <SidePanel />
        </section>
      </main>
      <footer>
        <Timeline />
        <div className={`status ${busy ? "busy" : ""}`}>
          {status}
          <span className="muted">
            {elements.length ? ` · ${elements.length} elements` : ""}
            {links.length ? ` · ${links.length} links` : ""}
          </span>
        </div>
      </footer>
    </div>
  );
}
