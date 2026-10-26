// Print view used to make PDF reports (#report=<dashboard>&project=<id>).
// The server (headless Chromium) and the desktop app (hidden window) load
// this page, wait for data-report-ready, and print it to A4 landscape.

import { useEffect, useState } from "react";
import type { Backend } from "../backend/types";
import { fmtDay } from "../core/dashboardData";
import { applySlices } from "../core/progress";
import type { Dashboard } from "../core/reporting";
import type { Schedule } from "../core/types";
import { WidgetView, type PortfolioEntry } from "./Widgets";

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
      // Let React paint the SVG charts first.
      requestAnimationFrame(() => requestAnimationFrame(() => (document.body.dataset.reportReady = "1")));
    }
  }, [dash, error]);

  if (error) return <div className="empty">Report error: {error}</div>;
  if (!dash) return <div className="empty">Preparing report…</div>;
  const main = dash.projectId ? schedules[dash.projectId] : null;

  return (
    <div className={`report-page ${dash.theme === "report" ? "theme-report" : ""}`}>
      <div className="report-head">
        <img src="./stratum-logo.png" alt="Stratum 4D" />
        <div>
          <b>{main ? `${main.projectCode} – ${main.projectName}` : dash.name}</b>
          <div className="muted">
            {dash.name} · Data date {fmtDay(main?.dataDate ?? null)} · Generated {new Date().toLocaleString()}
          </div>
        </div>
      </div>
      <div className="dash-grid">
        {dash.widgets.map((w) => (
          <section key={w.id} className={`widget w${w.w} h${w.h}`}>
            <header>
              <span className="widget-title">{w.title}</span>
            </header>
            <div className="widget-body">
              <WidgetView
                w={w}
                schedule={(() => {
                  const raw = (w.projectId ? schedules[w.projectId] : main) ?? null;
                  return raw && w.kind !== "slicer" ? applySlices(raw, dash.slices) : raw;
                })()}
                portfolio={portfolio}
                slice={{ slices: dash.slices ?? [], raw: (w.projectId ? schedules[w.projectId] : main) ?? null }}
              />
            </div>
          </section>
        ))}
      </div>
      <div className="report-foot">Stratum 4D · developed by Junaid Quamar</div>
    </div>
  );
}
