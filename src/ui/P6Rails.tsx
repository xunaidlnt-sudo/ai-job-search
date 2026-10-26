// P6-style vertical shortcut bars: the directory bar on the left (where to
// look) and the command bar on the right (what to do), each stacked top to
// bottom with an icon over a short label.

import {
  Box,
  Calculator,
  Camera,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleDollarSign,
  DatabaseZap,
  FileChartColumn,
  FileOutput,
  FolderKanban,
  ListTree,
  MoveHorizontal,
  Network,
  Plus,
  Ruler,
  Save,
  Search,
  Trash2,
  Users,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { addActivityAfterSelected, deleteSelectedActivity } from "./ActivityEditor";
import { ganttCommand } from "./Gantt";
import { useStore } from "./store";
import { useTerms } from "./terms";

export type DetailTab = "activity" | "cost" | "resources" | "quantities" | "tools";

interface RailItem {
  id: string;
  label: string;
  title: string;
  Icon: LucideIcon;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}

function Rail({ side, items, label }: { side: "left" | "right"; items: (RailItem | "sep")[]; label: string }) {
  return (
    <nav className={`p6-rail p6-rail-${side}`} aria-label={label}>
      {items.map((it, i) =>
        it === "sep" ? (
          <span key={`sep${i}`} className="rail-sep" />
        ) : (
          <button key={it.id} className={it.active ? "on" : ""} title={it.title} onClick={it.onClick} disabled={it.disabled} aria-pressed={it.active}>
            <it.Icon size={20} strokeWidth={1.7} aria-hidden />
            <span>{it.label}</span>
          </button>
        ),
      )}
    </nav>
  );
}

/** Left: where to look. */
export function DirectoryBar({
  detailTab,
  setDetailTab,
  onProjects,
  onReports,
  onP6,
}: {
  detailTab: DetailTab;
  setDetailTab: (t: DetailTab) => void;
  onProjects: () => void;
  onReports: () => void;
  onP6: () => void;
}) {
  const t = useTerms();
  const schedule = useStore((s) => s.schedule);
  const collapsed = useStore((s) => s.collapsedWbs);
  const setCollapsed = useStore((s) => s.setCollapsedWbs);
  const wbsView = !!schedule && schedule.wbs.length > 0 && collapsed.size >= schedule.wbs.length;
  return (
    <Rail
      side="left"
      label="Directory"
      items={[
        { id: "projects", label: t.projects, title: `Open ${t.projects.toLowerCase()} from the database`, Icon: FolderKanban, onClick: onProjects },
        {
          id: "wbs",
          label: t.wbs,
          title: "WBS view: collapse to WBS summaries",
          Icon: Network,
          active: wbsView,
          disabled: !schedule,
          onClick: () => schedule && setCollapsed(new Set(schedule.wbs.map((w) => w.id))),
        },
        {
          id: "activities",
          label: t.activities,
          title: "Activities view: show every activity",
          Icon: ListTree,
          active: !wbsView && detailTab === "activity",
          disabled: !schedule,
          onClick: () => {
            setCollapsed(new Set());
            setDetailTab("activity");
          },
        },
        { id: "resources", label: t.resources, title: "Resources and assignments", Icon: Users, active: detailTab === "resources", onClick: () => setDetailTab("resources") },
        { id: "cost", label: "Cost", title: "Cost and earned value", Icon: CircleDollarSign, active: detailTab === "cost", onClick: () => setDetailTab("cost") },
        { id: "quantities", label: "Quantities", title: "Model quantities", Icon: Ruler, active: detailTab === "quantities", onClick: () => setDetailTab("quantities") },
        { id: "model", label: "4D", title: "Link the schedule to the 3D model", Icon: Box, active: detailTab === "tools", onClick: () => setDetailTab("tools") },
        "sep",
        { id: "reports", label: "Reports", title: "Dashboards and reports", Icon: FileChartColumn, onClick: onReports },
        { id: "p6", label: "P6 import", title: "Import a project from a P6 connection", Icon: DatabaseZap, onClick: onP6 },
      ]}
    />
  );
}

/** Right: what to do. */
export function CommandBar({
  onSchedule,
  onSave,
  onExportXer,
  onSnapshot,
}: {
  onSchedule: () => void;
  onSave: () => void;
  onExportXer: () => void;
  onSnapshot: () => void;
}) {
  const t = useTerms();
  const schedule = useStore((s) => s.schedule);
  const selected = useStore((s) => s.selectedActivity);
  const setCollapsed = useStore((s) => s.setCollapsedWbs);
  const none = !schedule;
  return (
    <Rail
      side="right"
      label="Commands"
      items={[
        { id: "add", label: "Add", title: `Add ${t.activity.toLowerCase()} after the selected one`, Icon: Plus, onClick: addActivityAfterSelected, disabled: none },
        { id: "del", label: "Delete", title: `Delete the selected ${t.activity.toLowerCase()}`, Icon: Trash2, onClick: deleteSelectedActivity, disabled: !selected },
        "sep",
        { id: "f9", label: t.schedule, title: `${t.schedule} (F9)`, Icon: Calculator, onClick: onSchedule, disabled: none },
        { id: "save", label: "Save", title: "Save to the database (Ctrl+S)", Icon: Save, onClick: onSave, disabled: none },
        "sep",
        { id: "expand", label: "Expand", title: "Expand all WBS", Icon: ChevronsUpDown, onClick: () => setCollapsed(new Set()), disabled: none },
        {
          id: "collapse",
          label: "Collapse",
          title: "Collapse all WBS",
          Icon: ChevronsDownUp,
          onClick: () => schedule && setCollapsed(new Set(schedule.wbs.map((w) => w.id))),
          disabled: none,
        },
        { id: "zin", label: "Zoom in", title: "Zoom the timescale in", Icon: ZoomIn, onClick: () => ganttCommand("zoom-in"), disabled: none },
        { id: "zout", label: "Zoom out", title: "Zoom the timescale out", Icon: ZoomOut, onClick: () => ganttCommand("zoom-out"), disabled: none },
        { id: "fit", label: "Fit", title: "Fit the whole project in the timescale", Icon: MoveHorizontal, onClick: () => ganttCommand("fit"), disabled: none },
        { id: "find", label: "Find", title: `Find ${t.activities.toLowerCase()}`, Icon: Search, onClick: () => ganttCommand("find"), disabled: none },
        "sep",
        { id: "xer", label: "XER", title: "Export to P6 XER", Icon: FileOutput, onClick: onExportXer, disabled: none },
        { id: "png", label: "Snapshot", title: "Save the 3D view as PNG", Icon: Camera, onClick: onSnapshot },
      ]}
    />
  );
}
