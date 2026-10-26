// Print view used to make PDF reports (#report=<dashboard>&project=<id>).
// The server (headless Chromium) and the desktop app (hidden window) load
// this page, wait for data-report-ready, and print it to A4 landscape.

import { useEffect, useState } from "react";
import type { Backend } from "../backend/types";
import type { Dashboard } from "../core/reporting";
import type { Schedule } from "../core/types";
import { PageHead, pageStyle, WidgetFrame, widgetSchedule, WidgetView, type PortfolioEntry } from "./Widgets";

export function ReportView({ dashboardId, projectId, backend }: { dashboardId: string; projectId: string | null; backend: Backend }) {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [schedules, setSchedules] = useState<Record<string, Schedule | null>>({});
  const [portfolio, setPortfolio] = useState<PortfolioEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const d = await backend.getDashboard(dashboardId);
        if (!d) throw new Error("Dashboard not found");
        const base = projectId ?? d.projectId;
        const ids = new Set<string>([...(base ? [base] : []), ...d.widgets.map((w) => w.projectId).filter((x): x is string => !!x)]);
        const loaded: Record<string, Schedule | null> = {};
        for (const id of ids) loaded[id] = (await backend.getProject(id))?.project.schedule ?? null;
        let pf: PortfolioEntry[] | null = null;
        if (d.widgets.some((w) => w.kind === "portfolio")) {
          pf = [];
          for (const p of await backend.listProjects()) {
            const s = (await backend.getProject(p.id))?.project.schedule;
            if (s) pf.push({ id: p.id, schedule: s });
          }
        }
        setSchedules(loaded);
        setPortfolio(pf);
        setDash({ ...d, projectId: base });
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [dashboardId, projectId, backend]);

  useEffect(() => {
    if (error) {
      document.body.dataset.reportError = error;
      document.body.dataset.reportReady = "error";
    } else if (dash) {
      document.body.dataset.orientation = dash.page?.orientation ?? "landscape";
      // Let React paint the SVG charts first.
      requestAnimationFrame(() => requestAnimationFrame(() => (document.body.dataset.reportReady = "1")));
    }
  }, [dash, error]);

  if (error) return <div className="empty">Report error: {error}</div>;
  if (!dash) return <div className="empty">Preparing report…</div>;
  const main = dash.projectId ? schedules[dash.projectId] : null;

  const ps = pageStyle(dash);
  return (
    <div className={`report-page ${ps.className}`} style={ps.style}>
      {dash.page?.orientation === "portrait" && <style>{"@page { size: A4 portrait; }"}</style>}
      <PageHead dash={dash} schedule={main} print />
      <div className="dash-grid">
        {dash.widgets.map((w) => {
          const raw = (w.projectId ? schedules[w.projectId] : main) ?? null;
          const s = widgetSchedule(raw, w, dash.slices);
          return (
            <WidgetFrame key={w.id} w={w} dash={dash} schedule={s}>
              <WidgetView w={w} schedule={s} portfolio={portfolio} slice={{ slices: dash.slices ?? [], raw }} />
            </WidgetFrame>
          );
        })}
      </div>
      <div className="report-foot">
        {dash.page?.footer ? `${dash.page.footer} · ` : ""}Generated {new Date().toLocaleString()} · Stratum 4D · developed by Junaid Quamar
      </div>
    </div>
  );
}
