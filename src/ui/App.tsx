import type * as THREE from "three";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { reportRoute, useConfig } from "../backend/config";
import { ConflictError } from "../backend/types";
import { uid, type P6Connection } from "../core/reporting";
import { DashboardsView } from "./Dashboards";
import { ProjectsDialog } from "./ProjectsDialog";
import { ReportView } from "./ReportView";
import { SettingsDialog } from "./SettingsDialog";
import { SetupWizard } from "./SetupWizard";
import { useTerms } from "./terms";
import { useAppearance } from "./appearance";
import { ModeSwitch, ThemeButton } from "./ModeSwitch";
import {
  Box,
  Boxes,
  Calculator,
  ChartLine,
  FileDown,
  FileText,
  Info,
  Link2,
  Ruler,
  Users,
  ChevronDown,
  CircleHelp,
  CloudUpload,
  Database,
  Download,
  FileUp,
  FolderOpen,
  LayoutDashboard,
  Maximize,
  Menu,
  Save,
  Settings,
  Sparkles,
  Square,
  Video,
} from "lucide-react";
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

/** Report pages (#report=…) render alone, for PDF printing; everything else is the workspace. */
export function App() {
  const route = useMemo(() => reportRoute(), []);
  if (route) return <ReportView dashboardId={route.dashboardId} projectId={route.projectId} backend={route.backend} />;
  return <Workspace />;
}

type DetailTab = "activity" | "cost" | "resources" | "quantities" | "tools";

function Workspace() {
  const viewerRef = useRef<Viewer | null>(null);
  const { config, backend } = useConfig();
  const mode = config.mode;
  const t = useTerms();
  const theme = useAppearance();
  const [settingsTab, setSettingsTab] = useState<null | "interface" | "data" | "p6" | "email" | "users">(null);
  const [projectsTab, setProjectsTab] = useState<null | "database" | "p6">(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("activity");
  const [ribbon, setRibbon] = useState<"file" | "task" | "resource" | "report" | "project" | "view">("task");
  const [showTools, setShowTools] = useState(false);
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
  const { schedule, elements, links, profiles, time, sim, selectedElements, status, busy, segments, paths, pathDraft, leftTab, scheduleDirty, currentProjectId, currentVersion } = store;

  // One viewer for the session; layouts put its canvas in different places.
  const hostRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    if (!viewerRef.current) {
      viewerRef.current = new Viewer(el);
      viewerRef.current.setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    } else viewerRef.current.attach(el);
  }, []);
  useEffect(() => () => viewerRef.current?.dispose(), []);
  useEffect(() => viewerRef.current?.setTheme(theme), [theme]);

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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (s.schedule) void saveRef.current(false).catch(() => {});
        return;
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

  const saveRef = useRef<(asNew: boolean) => Promise<void>>(async () => {});

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
      adoptSchedule(s);
    } catch (err) {
      store.setStatus(`Schedule import failed: ${(err as Error).message}`);
    }
  };

  /** Bring an imported schedule in: as an update of the open project when IDs overlap, else as a new project. */
  const adoptSchedule = (s: Schedule) => {
    {
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
        store.setCurrentProject(null, null);
        const src = s.sourceFormat === "mspdi" ? "MS Project" : s.sourceFormat === "p6-eppm" ? "P6 EPPM" : s.sourceFormat === "p6-db" ? "P6 database" : "P6";
        store.setStatus(
          `Imported ${s.projectCode} (${src}): ${s.activities.length} activities, ` +
            `${s.relationships.length} relationships, ${s.resources?.length ?? 0} resources. Data date ${fmtDate(s.dataDate)}.`,
        );
      }
    }
  };

  // ---- database
  const currentPayload = (): StratumProject => {
    const st = useStore.getState();
    return {
      format: "stratum-project",
      version: 2,
      savedAt: new Date().toISOString(),
      modelFileName: st.modelFileName,
      schedule: st.schedule,
      links: st.links,
      rules: st.rules,
      profiles: st.profiles,
      segments: st.segments,
      groups: st.groups,
      paths: st.paths,
    };
  };

  const saveToDb = async (asNew = false) => {
    const st = useStore.getState();
    if (!st.schedule) return;
    const id = asNew || !st.currentProjectId ? uid("prj") : st.currentProjectId;
    try {
      const v = await useConfig.getState().backend.saveProject(id, currentPayload(), asNew || !st.currentProjectId ? undefined : st.currentVersion ?? undefined);
      st.setCurrentProject(id, v);
      st.setStatus(`Saved ${st.schedule.projectCode} to ${useConfig.getState().backend.label} (version ${v}).`);
    } catch (e) {
      if (e instanceof ConflictError) {
        st.setStatus(`Not saved: ${e.message}`);
        throw new Error(`${e.message} Use "Save as new" to keep your version, or reopen the project.`);
      }
      st.setStatus(`Save failed: ${(e as Error).message}`);
      throw e;
    }
  };

  const openFromDb = async (id: string) => {
    const r = await useConfig.getState().backend.getProject(id);
    if (!r) throw new Error("Project not found");
    applyProject(r.project);
    if (r.project.modelFileName === "Demo model") loadDemoModelOnly();
    store.setCurrentProject(id, r.version);
    store.setStatus(
      `Opened ${r.project.schedule?.projectCode ?? "project"} (version ${r.version}).` +
        (r.project.modelFileName && r.project.modelFileName !== "Demo model" ? ` Open ${r.project.modelFileName} with Import IFC to see the 4D links.` : ""),
    );
  };

  const importFromP6 = (s: Schedule, c: P6Connection) => {
    adoptSchedule(s);
    store.setStatus(`${useStore.getState().status} Pulled from ${c.name}.`);
  };

  const pushToP6 = async () => {
    const s = useStore.getState().schedule;
    if (!s?.p6Source) return;
    if (!window.confirm(`Send progress (actual dates, % complete, remaining duration) for ${s.projectCode} back to P6?`)) return;
    try {
      const r = await useConfig.getState().backend.p6Push(s.p6Source.connectionId, s);
      store.setStatus(`Sent progress for ${r.updated} activities to P6.${r.skipped.length ? ` Not sent (new in Stratum, use XER): ${r.skipped.slice(0, 8).join(", ")}${r.skipped.length > 8 ? "…" : ""}.` : ""} Reschedule in P6 (F9).`);
    } catch (e) {
      store.setStatus(`P6 update failed: ${(e as Error).message}`);
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
  saveRef.current = saveToDb;

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
    store.setCurrentProject(null, null);
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

  const viewport = (
    <div className="viewport-wrap">
      <div
        className={`viewport ${pathDraft ? "drawing" : ""}`}
        ref={hostRef}
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
    </div>
  );

  const canPush = !!schedule?.p6Source && schedule.p6Source.kind === "eppm";
  const dbLabel = backend.label;

  // Buttons shared by every layout, so all three modes keep the same features.
  const I = { size: 16, strokeWidth: 1.9, "aria-hidden": true } as const;
  const btn = {
    importSchedule: (
      <button className="tb" onClick={importSchedule} title="Import a Primavera P6 .xer or Microsoft Project .xml">
        <FileUp {...I} />
        <span>Import schedule</span>
      </button>
    ),
    importIfc: (
      <button className="tb" onClick={importIfc} title="Import an IFC building model">
        <Box {...I} />
        <span>Import IFC</span>
      </button>
    ),
    run: (
      <button className={`tb ${scheduleDirty ? "primary" : ""}`} onClick={runSchedule} disabled={!schedule} title={`${t.schedule} using CPM (F9)`}>
        <Calculator {...I} />
        <span>{t.schedule}</span>
        <kbd>F9</kbd>
      </button>
    ),
    exportMenu: (
      <details className="menu">
        <summary className="tb collapse" title="Export">
          <Download {...I} />
          <span>Export</span>
          <ChevronDown size={13} aria-hidden className="chev" />
        </summary>
        <div className="menu-body" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute("open")}>
          <button onClick={() => exportSchedule("xer")} disabled={!schedule}>P6 XER</button>
          <button onClick={() => exportSchedule("csv")} disabled={!schedule}>CSV (Excel)</button>
          <button onClick={snapshot}>Snapshot PNG</button>
        </div>
      </details>
    ),
    projects: (
      <button className="tb" onClick={() => setProjectsTab("database")} title={`Open or save ${t.projects.toLowerCase()} in ${dbLabel}`}>
        <FolderOpen {...I} />
        <span>{t.projects}</span>
      </button>
    ),
    save: (
      <button className="tb" onClick={() => void saveToDb(false).catch((e) => window.alert(e.message))} disabled={!schedule} title="Save to the database (Ctrl+S)">
        <Save {...I} />
        <span>Save</span>
      </button>
    ),
    p6: (
      <button className="tb" onClick={() => setProjectsTab("p6")} title="Import a project from a P6 connection">
        <Database {...I} />
        <span>Import from P6</span>
      </button>
    ),
    push: canPush ? (
      <button className="tb" onClick={pushToP6} title="Send progress back to P6 EPPM">
        <CloudUpload {...I} />
        <span>Update P6</span>
      </button>
    ) : null,
    dashboards: (
      <button className="tb" onClick={() => store.setView("dashboards")} title="Dashboards and reports">
        <LayoutDashboard {...I} />
        <span>Dashboards</span>
      </button>
    ),
    fit: (
      <button className="tb collapse" onClick={() => viewerRef.current?.fit(selectedElements.size ? selectedElements : undefined)} title="Zoom the 3D view to fit">
        <Maximize {...I} />
        <span>Fit view</span>
      </button>
    ),
    record: (
      <button onClick={toggleRecording} disabled={!schedule} className={`tb collapse ${recording ? "danger" : ""}`} title="Record the 4D playback as video">
        {recording ? <Square {...I} /> : <Video {...I} />}
        <span>{recording ? "Stop" : "Record"}</span>
      </button>
    ),
    demo: (
      <button className="tb" onClick={loadDemo} title="Load the demo project">
        <Sparkles {...I} />
        <span>Demo</span>
      </button>
    ),
    settings: (
      <button className="tb icon-only" onClick={() => setSettingsTab("interface")} title="Settings: interface, fonts, database, P6, email">
        <Settings {...I} />
      </button>
    ),
    help: (
      <button className="tb icon-only" title="Getting started and shortcuts (?)" onClick={() => setHelpOpen(true)}>
        <CircleHelp {...I} />
      </button>
    ),
  };

  const fileMenu = (
    <details className="menu">
      <summary className="tb" title="File">
        <Menu {...I} />
        <span>File</span>
        <ChevronDown size={13} aria-hidden className="chev" />
      </summary>
      <div className="menu-body" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute("open")}>
        <button onClick={() => setProjectsTab("database")}>Open from database…</button>
        <button onClick={() => void saveToDb(true).catch((e) => window.alert(e.message))} disabled={!schedule}>Save as new</button>
        <hr />
        <button onClick={importSchedule}>Import schedule (XER / XML)…</button>
        <button onClick={importIfc}>Import IFC model…</button>
        <button onClick={() => setProjectsTab("p6")}>Import from P6…</button>
        {canPush && <button onClick={pushToP6}>Update P6 with progress</button>}
        <hr />
        <button onClick={openProject}>Open project file…</button>
        <button onClick={saveProject} disabled={!schedule}>Save project file</button>
        <button onClick={loadDemo}>Load demo</button>
      </div>
    </details>
  );

  const brand = (
    <div className="brand">
      <img className="logo-light" src="./stratum-logo.png" alt="Stratum 4D" />
      <img className="logo-dark" src="./stratum-logo-dark.png" alt="" aria-hidden />
    </div>
  );

  const toolbarRight = (
    <>
      <span className="spacer" />
      <span className="muted conn" title="Where projects are stored">
        {dbLabel}
        {currentProjectId ? ` · v${currentVersion}` : ""}
      </span>
      {savedAt && <span className="muted autosaved">Autosaved {savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
      <ModeSwitch />
      <ThemeButton />
      {btn.settings}
      {btn.help}
    </>
  );

  const RIBBON: Record<typeof ribbon, { label: string; body: JSX.Element }> = {
    file: {
      label: "File",
      body: (
        <>
          {btn.projects}
          {btn.save}
          <span className="sep" />
          {btn.importSchedule}
          {btn.importIfc}
          {btn.p6}
          {btn.push}
          <span className="sep" />
          {btn.exportMenu}
          <button className="tb" onClick={openProject}><FileText {...I} /><span>Open file</span></button>
          <button className="tb" onClick={saveProject} disabled={!schedule}><FileDown {...I} /><span>Save file</span></button>
          {btn.demo}
        </>
      ),
    },
    task: {
      label: "Task",
      body: (
        <>
          {btn.run}
          <span className="sep" />
          <button onClick={() => setDetailTab("activity")} className={`tb ${detailTab === "activity" ? "active" : ""}`}><Info {...I} /><span>Information</span></button>
          <button className="tb" onClick={() => { setShowTools(true); setDetailTab("tools"); }}><Link2 {...I} /><span>Link to model</span></button>
        </>
      ),
    },
    resource: {
      label: "Resource",
      body: (
        <>
          <button onClick={() => setDetailTab("resources")} className={`tb ${detailTab === "resources" ? "active" : ""}`}><Users {...I} /><span>Resource usage</span></button>
          <button onClick={() => setDetailTab("cost")} className={`tb ${detailTab === "cost" ? "active" : ""}`}><ChartLine {...I} /><span>Cost & EVM</span></button>
          <button onClick={() => setDetailTab("quantities")} className={`tb ${detailTab === "quantities" ? "active" : ""}`}><Ruler {...I} /><span>Quantities</span></button>
        </>
      ),
    },
    report: {
      label: "Report",
      body: (
        <>
          {btn.dashboards}
          {btn.exportMenu}
        </>
      ),
    },
    project: {
      label: "Project",
      body: (
        <>
          {btn.run}
          {btn.p6}
          {btn.push}
        </>
      ),
    },
    view: {
      label: "View",
      body: (
        <>
          {btn.fit}
          {btn.record}
          <button className={`tb ${showTools ? "active" : ""}`} onClick={() => setShowTools(!showTools)}><Boxes {...I} /><span>4D tools pane</span></button>
        </>
      ),
    },
  };

  const DETAIL_TABS: [DetailTab, string][] = [
    ["activity", mode === "msp" ? "Task Form" : t.activity === "Activity" ? "General" : t.activity],
    ["cost", "Cost & EVM"],
    ["resources", t.resources],
    ["quantities", "Quantities"],
    ["tools", "4D tools"],
  ];
  const detailBody = (
    <div className="details-body">
      {detailTab === "activity" && <ActivityEditor />}
      {detailTab === "cost" && <CostPanel />}
      {detailTab === "resources" && <ResourcePanel />}
      {detailTab === "quantities" && <QuantityPanel />}
      {detailTab === "tools" && <SidePanel />}
    </div>
  );
  const detailTabs = (
    <div className="tabs">
      {DETAIL_TABS.map(([id, label]) => (
        <button key={id} className={detailTab === id ? "active" : ""} onClick={() => setDetailTab(id)}>
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className={`app mode-${mode}`}>
      {mode === "msp" ? (
        <header className="ribbon">
          <div className="ribbon-tabs">
            {brand}
            {(Object.keys(RIBBON) as (typeof ribbon)[]).map((k) => (
              <button key={k} className={ribbon === k ? "active" : ""} onClick={() => setRibbon(k)}>
                {RIBBON[k].label}
              </button>
            ))}
            {toolbarRight}
          </div>
          <div className="ribbon-body toolbar">{RIBBON[ribbon].body}</div>
        </header>
      ) : (
        <header className="toolbar">
          {brand}
          {fileMenu}
          {btn.projects}
          {btn.save}
          <span className="sep" />
          {mode === "p6" ? btn.importSchedule : btn.importIfc}
          {btn.push}
          {btn.run}
          {btn.exportMenu}
          <span className="sep" />
          {btn.dashboards}
          {btn.fit}
          {btn.record}
          {toolbarRight}
        </header>
      )}
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
      {mode === "4d" && (
        <main className="workspace">
          <section className="left">
            <div className="tabs left-tabs">
              {LEFT_TABS.map((x) => (
                <button key={x.id} className={leftTab === x.id ? "active" : ""} onClick={() => store.setLeftTab(x.id)}>
                  {x.id === "activity" ? t.activity : x.label}
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
          <section className="center">{viewport}</section>
          <section className="right">
            <SidePanel />
          </section>
        </main>
      )}
      {mode === "p6" && (
        <main className="layout-p6">
          <div className="p6-top">
            <section className="p6-gantt">
              <div className="pane-title">{t.activities}</div>
              <Gantt />
            </section>
            <section className="p6-view">{viewport}</section>
          </div>
          <section className="p6-details">
            {detailTabs}
            {detailBody}
          </section>
        </main>
      )}
      {mode === "msp" && (
        <main className="layout-msp">
          <div className="msp-timeline">
            <Timeline />
          </div>
          <div className="msp-top">
            <section className="msp-gantt">
              <Gantt />
            </section>
            <section className="msp-view">{viewport}</section>
            {showTools && (
              <section className="msp-tools">
                <SidePanel />
              </section>
            )}
          </div>
          <section className="msp-form">
            {detailTabs}
            {detailBody}
          </section>
        </main>
      )}
      <footer>
        {mode !== "msp" && <Timeline />}
        <div className={`status ${busy ? "busy" : ""}`}>
          {status}
          <span className="muted">
            {elements.length ? ` · ${elements.length} elements` : ""}
            {links.length ? ` · ${links.length} links` : ""}
          </span>
        </div>
      </footer>
      {store.view === "dashboards" && (
        <div className="overlay-view">
          <DashboardsView onClose={() => store.setView("workspace")} />
        </div>
      )}
      {projectsTab && (
        <ProjectsDialog
          initialTab={projectsTab}
          onClose={() => setProjectsTab(null)}
          onOpen={async (id) => {
            await openFromDb(id);
            setProjectsTab(null);
          }}
          onSave={saveToDb}
          onImportP6={(sch, c) => {
            importFromP6(sch, c);
            setProjectsTab(null);
          }}
        />
      )}
      {settingsTab && <SettingsDialog initialTab={settingsTab} onClose={() => setSettingsTab(null)} />}
      {!config.configured && (
        <SetupWizard
          onDone={(open) => {
            if (open === "p6") setSettingsTab("p6");
            else if (open === "email") setSettingsTab("email");
          }}
        />
      )}
    </div>
  );
}
