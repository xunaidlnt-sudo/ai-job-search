import type * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";
import { scheduleCpm, ScheduleLoopError } from "../core/cpm";
import { demoModel, demoPaths, demoProfileFor, demoXer, DEMO_LINK_RULE } from "../core/demo";
import { applyRules } from "../core/linking";
import { motionAt } from "../core/motion";
import { parseMspdi } from "../core/mspdi";
import { DEFAULT_PROFILES } from "../core/profiles";
import { parseProject, serializeProject, type StratumProject } from "../core/project";
import { computeStates, scheduleRange } from "../core/simulation";
import type { AppearanceProfile, LinkRule, Schedule } from "../core/types";
import { diffSchedules, remapLinks } from "../core/update";
import { decodeXer, listXerProjects, parseXerTables, xerToSchedule } from "../core/xer";
import { exportCsv, exportXer } from "../core/xerExport";
import { Viewer } from "../viewer/Viewer";
import { ActivityEditor } from "./ActivityEditor";
import { clearAutosave, loadAutosave, startAutosave } from "./autosave";
import { CostPanel, QuantityPanel, ResourcePanel } from "./Analysis";
import { download, downloadDataUrl, pickFile } from "./files";
import { Gantt } from "./Gantt";
import { Help } from "./Help";
import { SidePanel } from "./SidePanel";
import { fmtDate, useStore, type LeftTab } from "./store";
import { Timeline } from "./Timeline";

const LEFT_TABS: { id: LeftTab; label: string }[] = [
  { id: "gantt", label: "Gantt" },
  { id: "activity", label: "Activity" },
  { id: "cost", label: "Cost & EVM" },
  { id: "resources", label: "Resources" },
  { id: "quantities", label: "Quantities" },
];

/** Demo profiles: slabs pour west to east, walls build bottom-up. */
function demoProfiles(): AppearanceProfile[] {
  const base = structuredClone(DEFAULT_PROFILES);
  const install = base.find((p) => p.id === "install")!;
  return [
    ...base,
    { ...structuredClone(install), id: "install-pour", name: "Install – pour west→east", growth: "west-east", progressiveFade: false },
    { ...structuredClone(install), id: "install-rise", name: "Install – build up", growth: "bottom-up", progressiveFade: false },
  ];
}

export function App() {
  const viewerHost = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  /** Model objects as loaded (before splitting into segments). */
  const objectsRef = useRef<Map<string, THREE.Object3D>>(new Map());
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
  const { schedule, elements, links, profiles, time, sim, selectedElements, status, busy, segments, paths, pathDraft, leftTab, scheduleDirty } = store;

  useEffect(() => {
    if (!viewerHost.current) return;
    const v = new Viewer(viewerHost.current);
    viewerRef.current = v;
    return () => v.dispose();
  }, []);

  // Rebuild viewer objects when elements are split or unsplit.
  const segKey = useMemo(() => segments.map((s) => s.id).join(","), [segments]);
  const firstLoad = useRef(true);
  useEffect(() => {
    if (!objectsRef.current.size) return;
    viewerRef.current?.setObjects(objectsRef.current, segments, firstLoad.current);
    firstLoad.current = false;
    viewerRef.current?.setSelection(useStore.getState().selectedElements);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segKey]);

  const elementIds = useMemo(() => elements.map((e) => e.id), [elements]);

  // One 4D frame: states for every element plus equipment motion.
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (!schedule) return v.applyFrame(new Map(), new Map());
    v.applyFrame(computeStates(schedule, links, profiles, elementIds, time, sim), motionAt(schedule, paths, time, sim.dateSource));
  }, [schedule, links, profiles, elementIds, time, sim, paths, segKey]);

  useEffect(() => {
    viewerRef.current?.setSelection(selectedElements);
  }, [selectedElements]);

  useEffect(() => {
    viewerRef.current?.setPathOverlay(sim.showPaths === false && !pathDraft ? [] : paths, pathDraft ?? []);
  }, [paths, pathDraft, sim.showPaths]);

  const runSchedule = () => {
    const s = useStore.getState();
    if (!s.schedule) return;
    try {
      const prevFinish = scheduleRange(s.schedule)?.finish ?? null;
      const r = scheduleCpm(s.schedule);
      s.setSchedule(r.schedule, { keepTime: true });
      s.setScheduleReport({
        at: Date.now(),
        projectFinish: r.projectFinish,
        previousFinish: prevFinish,
        criticalCount: r.criticalPath.length,
        warnings: r.warnings,
      });
      const shift = prevFinish !== null ? Math.round((r.projectFinish - prevFinish) / 86_400_000) : 0;
      s.setStatus(
        `Scheduled: finish ${fmtDate(r.projectFinish)}${shift ? ` (${shift > 0 ? "+" : ""}${shift}d)` : ""}, ` +
          `${r.criticalPath.length} critical activities, ${r.warnings.length} warning(s). See the Check tab.`,
      );
    } catch (err) {
      const msg = err instanceof ScheduleLoopError ? err.message : `Scheduling failed: ${(err as Error).message}`;
      s.setScheduleReport({ at: Date.now(), projectFinish: 0, previousFinish: null, criticalCount: 0, warnings: [], error: msg });
      s.setStatus(msg);
      s.setSideTab("check");
    }
  };

  // Keyboard: Space play/pause, arrows step, Home/End, F9 schedule, ? help, Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (e.key === "F9") {
        e.preventDefault();
        return runSchedule();
      }
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "?") return setHelpOpen((h) => !h);
      if (e.key === "Escape") {
        setHelpOpen(false);
        if (s.pathDraft) s.setPathDraft(null);
        return;
      }
      if (!s.schedule) return;
      const r = scheduleRange(s.schedule, s.sim.dateSource);
      if (!r) return;
      const clamp = (t: number) => Math.min(r.finish, Math.max(r.start, t));
      if (e.code === "Space") {
        e.preventDefault();
        s.setPlaying(!s.playing);
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const dir = e.key === "ArrowRight" ? 1 : -1;
        s.setTime(clamp(s.time + dir * (e.shiftKey ? 7 : 1) * 86_400_000));
      } else if (e.key === "Home") s.setTime(r.start);
      else if (e.key === "End") s.setTime(r.finish);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Desktop app: files double-clicked in Explorer/Finder arrive here.
  const openers = useRef({ importScheduleBytes: async (_n: string, _b: Uint8Array) => {}, importIfcBytes: async (_n: string, _b: Uint8Array) => {} });
  useEffect(() => {
    const bridge = window.stratumDesktop;
    if (!bridge) return;
    return bridge.onOpenFile(({ name, bytes }) => {
      if (/\.(xer|xml)$/i.test(name)) openers.current.importScheduleBytes(name, bytes);
      else if (/\.ifc$/i.test(name)) openers.current.importIfcBytes(name, bytes);
    });
  }, []);

  const onViewportClick = (e: React.MouseEvent) => {
    const v = viewerRef.current;
    if (!v) return;
    const s = useStore.getState();
    if (s.pathDraft) {
      const p = v.pickPoint(e.clientX, e.clientY);
      if (p) s.setPathDraft([...s.pathDraft, [Math.round(p[0] * 100) / 100, 0, Math.round(p[2] * 100) / 100]]);
      return;
    }
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

  const importSchedule = async () => {
    const f = await pickFile(".xer,.xml");
    if (!f) return;
    await importScheduleBytes(f.name, new Uint8Array(await f.arrayBuffer()));
  };

  const importScheduleBytes = async (name: string, bytes: Uint8Array) => {
    try {
      store.setStatus(`Reading ${name}…`, true);
      let s: Schedule;
      const head = new TextDecoder().decode(bytes.subarray(0, 400)).trimStart();
      if (/\.xml$/i.test(name) || head.startsWith("<")) {
        s = parseMspdi(new TextDecoder().decode(bytes));
      } else {
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
        s = xerToSchedule(tables, { projectId });
      }
      const prev = useStore.getState().schedule;
      const prevLinks = useStore.getState().links;
      // Treat it as an update of the open project when Activity IDs overlap.
      const overlap = prev ? s.activities.filter((a) => prev.activities.some((p) => p.code === a.code)).length : 0;
      const isUpdate =
        !!prev &&
        overlap > 0 &&
        window.confirm(
          `Update the open schedule (${prev.projectCode}) with this file?\n\n${overlap} Activity IDs match. Links will be kept by Activity ID.\n\nCancel to load it as a new project instead.`,
        );
      if (isUpdate && prev) {
        const diff = diffSchedules(prev, s);
        const { links: kept, dropped } = remapLinks(prev, s, prevLinks);
        const idMap = new Map(prev.activities.map((a) => [a.id, s.activities.find((b) => b.code === a.code)?.id]));
        store.setPaths(useStore.getState().paths.flatMap((p) => (idMap.get(p.activityId) ? [{ ...p, activityId: idMap.get(p.activityId)! }] : [])));
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
        store.setPaths([]);
        store.setLastUpdate(null);
        store.setScheduleReport(null);
        store.setStatus(
          `Imported ${s.projectCode} (${s.sourceFormat === "mspdi" ? "MS Project" : "P6"}): ${s.activities.length} activities, ` +
            `${s.relationships.length} relationships, ${s.resources?.length ?? 0} resources. Data date ${fmtDate(s.dataDate)}.`,
        );
      }
    } catch (err) {
      store.setStatus(`Schedule import failed: ${(err as Error).message}`);
    }
  };

  const importIfc = async () => {
    const f = await pickFile(".ifc");
    if (!f) return;
    await importIfcBytes(f.name, new Uint8Array(await f.arrayBuffer()));
  };

  const loadObjects = (objects: Map<string, THREE.Object3D>) => {
    objectsRef.current = objects;
    viewerRef.current?.setObjects(objects, useStore.getState().segments, true);
  };

  const importIfcBytes = async (name: string, bytes: Uint8Array) => {
    try {
      store.setStatus(`Loading ${name}…`, true);
      const { loadIfc } = await import("../viewer/ifcLoader");
      const t0 = performance.now();
      const loaded = await loadIfc(bytes, (m) => store.setStatus(m, true));
      store.setModel(loaded.elements, name);
      loadObjects(loaded.objects);
      // Keep links whose element still exists (same GlobalId).
      const ids = new Set(useStore.getState().elements.map((e) => e.id));
      const kept = useStore.getState().links.filter((l) => ids.has(l.elementId));
      store.setLinks(kept);
      store.setStatus(`Loaded ${name}: ${loaded.elements.length} elements in ${((performance.now() - t0) / 1000).toFixed(1)} s. ${kept.length} existing link(s) kept.`);
    } catch (err) {
      console.error(err);
      store.setStatus(`IFC load failed: ${(err as Error).message}`);
    }
  };

  openers.current = { importScheduleBytes, importIfcBytes };

  const loadDemoModelOnly = () => {
    const boxes = demoModel();
    store.setModel(
      boxes.map((b) => b.element),
      "Demo model",
    );
    loadObjects(Viewer.demoObjects(boxes));
  };

  const loadDemo = () => {
    const boxes = demoModel();
    const els = boxes.map((b) => b.element);
    store.setSegments([]);
    store.setGroups([]);
    store.setModel(els, "Demo model");
    loadObjects(Viewer.demoObjects(boxes));
    const s = xerToSchedule(parseXerTables(demoXer()));
    store.setSchedule(s);
    store.setProfiles(demoProfiles());
    const rule: LinkRule = { ...DEMO_LINK_RULE, profileId: "install" };
    const typeOf = new Map(els.map((e) => [e.id, e.ifcType]));
    const found = applyRules([rule], els, s).map((l) => {
      const code = s.activities.find((a) => a.id === l.activityId)!.code;
      let profileId = demoProfileFor(code);
      if (profileId === "install" && typeOf.get(l.elementId) === "IfcSlab") profileId = "install-pour";
      if (profileId === "install" && typeOf.get(l.elementId) === "IfcWall") profileId = "install-rise";
      return { ...l, profileId };
    });
    store.setRules([rule]);
    store.setLinks(found);
    store.setPaths(demoPaths(boxes));
    store.setLastUpdate(null);
    store.setScheduleReport(null);
    store.setStatus(
      `Demo loaded: ${els.length} elements linked to ${new Set(found.map((l) => l.activityId)).size} activities, with costs, resources and a crane path. Press Play, or F9 to reschedule.`,
    );
  };

  const applyProject = (p: StratumProject) => {
    store.setSchedule(p.schedule);
    store.setProfiles(p.profiles);
    store.setRules(p.rules);
    store.setLinks(p.links);
    store.setSegments(p.segments ?? []);
    store.setGroups(p.groups ?? []);
    store.setPaths(p.paths ?? []);
    store.setLastUpdate(null);
    store.setScheduleReport(null);
  };

  const saveProject = () => {
    const s = useStore.getState();
    const text = serializeProject({
      modelFileName: s.modelFileName,
      schedule: s.schedule,
      links: s.links,
      rules: s.rules,
      profiles: s.profiles,
      segments: s.segments,
      groups: s.groups,
      paths: s.paths,
    });
    download(`${s.schedule?.projectCode ?? "project"}.stratum.json`, text, "application/json");
    store.setStatus("Project saved.");
  };

  const openProject = async () => {
    const f = await pickFile(".json");
    if (!f) return;
    try {
      const p = parseProject(await f.text());
      applyProject(p);
      if (p.modelFileName === "Demo model") loadDemoModelOnly();
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

  const exportSchedule = (kind: "xer" | "csv") => {
    const s = useStore.getState().schedule;
    if (!s) return;
    if (kind === "xer") {
      download(`${s.projectCode}-stratum.xer`, exportXer(s), "application/octet-stream");
      store.setStatus(
        s.sourceXer
          ? "XER exported. In P6 use File > Import > XER and choose 'Update Existing Project' to bring the dates back."
          : "XER exported as a new P6 project.",
      );
    } else {
      download(`${s.projectCode}.csv`, exportCsv(s), "text/csv");
      store.setStatus("CSV exported.");
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
          <img src="./stratum-logo.png" alt="Stratum 4D" />
        </div>
        <button onClick={importSchedule} title="Primavera P6 .xer or Microsoft Project .xml">
          Import schedule
        </button>
        <button onClick={importIfc}>Import IFC</button>
        <span className="sep" />
        <button className={scheduleDirty ? "primary" : ""} onClick={runSchedule} disabled={!schedule} title="Run the CPM scheduler (F9)">
          Schedule (F9)
        </button>
        <details className="menu">
          <summary>Export</summary>
          <div className="menu-body">
            <button onClick={() => exportSchedule("xer")} disabled={!schedule}>P6 XER</button>
            <button onClick={() => exportSchedule("csv")} disabled={!schedule}>CSV (Excel)</button>
            <button onClick={snapshot}>Snapshot PNG</button>
          </div>
        </details>
        <span className="sep" />
        <button onClick={openProject}>Open project</button>
        <button onClick={saveProject} disabled={!schedule}>Save project</button>
        <span className="sep" />
        <button onClick={() => viewerRef.current?.fit(selectedElements.size ? selectedElements : undefined)}>Zoom to fit</button>
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
          <button
            onClick={() => {
              clearAutosave();
              setRestore(null);
            }}
          >
            Discard
          </button>
        </div>
      )}
      {scheduleDirty && (
        <div className="banner info">
          The schedule has been edited. Press <b>Schedule (F9)</b> to recalculate dates and float.
        </div>
      )}
      {pathDraft && (
        <div className="banner info">
          Drawing a path: click points in the 3D view ({pathDraft.length} so far). Finish or cancel in the <b>Tools</b> tab, or press Esc.
        </div>
      )}
      {helpOpen && (
        <Help
          onClose={() => setHelpOpen(false)}
          onDemo={() => {
            setHelpOpen(false);
            loadDemo();
          }}
        />
      )}
      <main className="workspace">
        <section className="left">
          <div className="tabs left-tabs">
            {LEFT_TABS.map((t) => (
              <button key={t.id} className={leftTab === t.id ? "active" : ""} onClick={() => store.setLeftTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="left-body">
            {leftTab === "gantt" && <Gantt />}
            {leftTab === "activity" && <ActivityEditor />}
            {leftTab === "cost" && <CostPanel />}
            {leftTab === "resources" && <ResourcePanel />}
            {leftTab === "quantities" && <QuantityPanel />}
          </div>
        </section>
        <section className="center">
          <div
            className={`viewport ${pathDraft ? "drawing" : ""}`}
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
              <button className="primary" onClick={loadDemo}>
                Load demo project
              </button>
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
