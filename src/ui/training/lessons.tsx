// Training lessons. Each step explains one idea, points at the part of the
// screen it is about, and (where it makes sense) asks the learner to do it,
// ticking off by itself when the app's state shows it is done.
//
// The lessons use the 220 kV GIS substation sample, so every number the
// learner reads matches the screen. Values are read live from the schedule.

import { useConfig } from "../../backend/config";
import { useStore, fmtDate } from "../store";
import { $, byText, click, row, setValue, wait, type Ctx, type Lesson } from "./engine";

const hpd = (c: Ctx) => c.s.schedule?.calendars?.find((x) => x.id === c.s.schedule?.defaultCalendarId)?.hoursPerDay ?? 8;
const d = (c: Ctx, h: number | null | undefined) => (h == null ? "–" : `${Math.round((h / hpd(c)) * 10) / 10} d`);
const tab = (label: string) => () => byText(".p6-tabs button", label, true);
const tabOn = (label: string) => !!tab(label)()?.classList.contains("active");
const rail = (label: string) => () => byText(".p6-rail button", label, true);
const lowerHead = () => $(".p6-lowerhead")?.textContent ?? "";
const pick = async (code: string) => {
  setValue(".p6-find", code);
  await wait(300);
  click(row(code));
  await wait(200);
};
const findCleared = (c: Ctx) => c.s.ganttFilter.text === "";

export const COURSES = ["Getting started", "Planning skills", "Project controls", "4D and reporting"];

export const LESSONS: Lesson[] = [
  // ==================================================================
  {
    id: "tour",
    course: "Getting started",
    title: "A first look around",
    minutes: 6,
    level: "Beginner",
    summary: "The P6 layout, the data date, the Directory and Command bars, and how to read a Gantt chart.",
    learn: ["Switch layouts", "Find the data date", "Read the activity table and bars", "Collapse WBS bands"],
    needs: { mode: "p6", sample: true },
    steps: [
      {
        title: "Welcome to training mode",
        body: () => (
          <>
            <p>Each lesson is a short, hands-on walk through the real application. The card explains one idea at a time and the highlighted area shows where it lives on screen.</p>
            <p>
              When a step says <b>Your turn</b>, do it yourself. The card ticks it off and moves on as soon as it sees the change. If you get stuck, <b>Show me</b> does it for you.
            </p>
            <p>The example is a 220/33 kV GIS substation in Abu Dhabi: engineering, procurement and construction of a 9-bay GIS hall, two power transformers and a control building.</p>
          </>
        ),
      },
      {
        title: "Three layouts and Reports",
        target: ".mode-switch",
        body: () => (
          <>
            <p>This switch changes the layout, not the data. <b>P6</b> looks like Primavera P6 Professional, <b>Project</b> like Microsoft Project, and <b>4D</b> adds the 3D model and playback. <b>Reports</b> opens the dashboard builder.</p>
            <p>Use the layout your company works in. Everything you learn here applies to all of them; only the words change (P6 says <i>activity</i> and <i>data date</i>, MS Project says <i>task</i> and <i>status date</i>).</p>
          </>
        ),
      },
      {
        title: "The data date",
        target: ".p6-status",
        body: (c) => (
          <>
            <p>
              The status bar shows the <b>data date</b>: <b>{fmtDate(c.s.schedule?.dataDate ?? null)}</b>. It is the line between the past and the future. Everything before it is actual (what happened), everything after it is forecast (what will happen if the plan holds).
            </p>
            <p>Each update period, usually weekly or monthly, you record progress up to a new data date and reschedule. Remaining work can never start before the data date.</p>
          </>
        ),
      },
      {
        title: "The Directory bar (left)",
        target: ".p6-rail-left",
        body: () => (
          <>
            <p>As in P6, the left bar says <i>where to look</i>:</p>
            <ul>
              <li>
                <b>Projects</b>: open a project from the database.
              </li>
              <li>
                <b>WBS</b> and <b>Activities</b>: collapse the schedule to its work breakdown, or show every activity.
              </li>
              <li>
                <b>Assignments</b>, <b>Resources</b> and <b>Activity Usage</b>: who works on what, resource loading, and cost or earned value over time.
              </li>
              <li>
                <b>Reports</b>, <b>Tracking</b> and <b>P6 Import</b>: dashboards and bringing projects in from a P6 server.
              </li>
            </ul>
          </>
        ),
      },
      {
        title: "The Command bar (right)",
        target: ".p6-rail-right",
        body: () => (
          <>
            <p>The right bar says <i>what to do</i>: add and delete activities, <b>Schedule (F9)</b> to recalculate dates, <b>Commit</b> to save to the database, expand or collapse the WBS, zoom the timescale, find, and export to P6 XER.</p>
            <p>Most commands also have a keyboard shortcut. Hover a button to see it.</p>
          </>
        ),
      },
      {
        title: "Reading the activity table",
        target: ".gantt-cols",
        body: () => (
          <>
            <p>These are P6's Classic Schedule Layout columns:</p>
            <ul>
              <li>
                <b>Activity ID</b> and <b>Name</b>: the unique code and description.
              </li>
              <li>
                <b>Original Duration</b>: the planned working days. <b>Remaining Duration</b>: working days still to go.
              </li>
              <li>
                <b>Schedule % Complete</b>: how far through the work is.
              </li>
              <li>
                <b>Start</b> and <b>Finish</b>: actual dates where they exist (marked <b>A</b>), forecast dates otherwise.
              </li>
              <li>
                <b>Total Float</b>: how many days the activity can slip before the project finish moves. Zero or negative means critical.
              </li>
            </ul>
          </>
        ),
      },
      {
        title: "Reading the bars",
        target: ".gantt-body",
        body: () => (
          <>
            <p>
              Each bar runs from start to finish. The <b style={{ color: "#2f6fd0" }}>blue</b> part is actual work up to the data date, <b style={{ color: "#3c9a3c" }}>green</b> is remaining work, and <b style={{ color: "#d03b3b" }}>red</b> is remaining work on the critical path. Diamonds are milestones: zero-duration events such as <i>220 kV energisation</i>.
            </p>
            <p>The dashed vertical line is the data date. Shaded rows are WBS bands that group the activities.</p>
          </>
        ),
      },
      {
        title: "Collapse a WBS band",
        target: ".gantt-row.wbs",
        task: "Click any WBS band (a shaded row) to collapse it.",
        done: (c) => c.s.collapsedWbs.size > 0,
        showMe: () => void click(".gantt-row.wbs"),
        body: () => (
          <>
            <p>The <b>work breakdown structure</b> (WBS) splits the project into deliverables: here General, Engineering, Procurement and Construction, with Construction divided again into civil works, installation and commissioning.</p>
            <p>Collapsing a band rolls it up into one summary bar. Managers read the schedule at this level; site teams read it at activity level.</p>
          </>
        ),
      },
      {
        title: "Expand it again",
        target: () => rail("Expand All")(),
        task: "Click Expand All on the Command bar (or click the band again).",
        done: (c) => c.s.collapsedWbs.size === 0,
        showMe: () => void click(rail("Expand All")),
        body: () => <p>Expand All and Collapse All work on every band at once. Collapsing everything gives the WBS view, a one-page summary of the project.</p>,
      },
      {
        title: "Check yourself",
        body: () => <p>One question before you move on.</p>,
        quiz: {
          q: "An activity's bar is half blue and half red. What does that tell you?",
          options: ["It is complete and was late", "It has started, and its remaining work is on the critical path", "It has not started and has float", "It is a milestone"],
          answer: 1,
          explain: "Blue is actual work done before the data date, so it has started. Red remaining work means any delay to it delays the project finish.",
        },
      },
    ],
  },

  // ==================================================================
  {
    id: "activity",
    course: "Getting started",
    title: "Reading one activity",
    minutes: 6,
    level: "Beginner",
    summary: "Find an activity, select it, and read its details: type, WBS, durations, dates and relationships.",
    learn: ["Find by ID", "Use the detail tabs", "Predecessors and successors", "Relationship types and lag"],
    needs: { mode: "p6", sample: true },
    steps: [
      {
        title: "Find an activity",
        target: ".p6-find",
        task: "Type C-5000 in the find box.",
        done: (c) => c.s.ganttFilter.text.toLowerCase().includes("c-5000"),
        showMe: () => void setValue(".p6-find", "C-5000"),
        body: () => <p>Big schedules run to thousands of activities. The find box filters the table by ID or name as you type. In P6 itself this is Ctrl+F, which works here too.</p>,
      },
      {
        title: "Select it",
        target: row("C-5000"),
        task: "Click the C-5000 row.",
        done: (c) => c.sel()?.code === "C-5000",
        showMe: () => void click(row("C-5000")),
        body: () => <p>Selecting an activity fills the lower pane with its details, just as in P6.</p>,
      },
      {
        title: "General tab",
        target: ".p6-lower",
        enter: () => void click(tab("General")),
        body: (c) => (
          <>
            <p>
              <b>{c.sel()?.code}</b> {c.sel()?.name}. The General tab holds what the activity <i>is</i>:
            </p>
            <ul>
              <li>
                <b>Type</b>: task dependent (uses its own calendar), resource dependent, level of effort (spans other work, such as site supervision), or start/finish milestone.
              </li>
              <li>
                <b>WBS</b>: where it sits in the breakdown.
              </li>
              <li>
                <b>Calendar</b>: working days and hours. This project works a UAE week, Monday to Saturday.
              </li>
            </ul>
          </>
        ),
      },
      {
        title: "Open the Status tab",
        target: tab("Status"),
        task: "Click the Status tab.",
        done: () => tabOn("Status"),
        showMe: () => void click(tab("Status")),
        body: () => <p>The Status tab is where progress is recorded each update.</p>,
      },
      {
        title: "Durations and progress",
        target: ".p6-lowerbody",
        body: (c) => {
          const a = c.sel();
          return (
            <>
              <p>
                For {a?.code}: original duration <b>{d(c, a?.originalDurationHours)}</b>, remaining <b>{d(c, a?.remainingDurationHours)}</b>, <b>{a?.percentComplete}%</b> complete, actual start <b>{fmtDate(a?.actualStart ?? null)}</b>.
              </p>
              <ul>
                <li>
                  <b>Original duration</b> is the plan. It does not change during the job.
                </li>
                <li>
                  <b>Remaining duration</b> is the planner's honest estimate of what is left. It drives the forecast finish.
                </li>
                <li>
                  <b>% complete</b> measures progress; with costs loaded it also drives earned value.
                </li>
              </ul>
              <p>Below that, the dates table shows early, late and baseline dates and the total and free float.</p>
            </>
          );
        },
      },
      {
        title: "Predecessors",
        target: tab("Predecessors"),
        task: "Click the Predecessors tab.",
        done: () => tabOn("Predecessors"),
        showMe: () => void click(tab("Predecessors")),
        body: () => <p>Predecessors are the activities that must happen before this one can start or finish. They are the logic that turns a list of tasks into a schedule.</p>,
      },
      {
        title: "Relationship types",
        target: ".p6-lowerbody",
        body: () => (
          <>
            <ul>
              <li>
                <b>FS, finish to start</b>: B starts after A finishes. By far the most common.
              </li>
              <li>
                <b>SS, start to start</b>: B starts after A starts, e.g. cable pulling can start once trenching has started.
              </li>
              <li>
                <b>FF, finish to finish</b>: B finishes after A finishes, e.g. testing finishes after installation finishes.
              </li>
              <li>
                <b>SF, start to finish</b>: rare; avoid it.
              </li>
            </ul>
            <p>
              <b>Lag</b> adds a wait: FS + 7 days means "7 days after A finishes". Good practice is to keep logic simple, avoid long lags (model the wait as an activity instead) and give every activity at least one predecessor and one successor.
            </p>
          </>
        ),
      },
      {
        title: "Successors",
        target: tab("Successors"),
        task: "Click the Successors tab.",
        done: () => tabOn("Successors"),
        showMe: () => void click(tab("Successors")),
        body: () => <p>Successors are the activities waiting on this one. A delay here flows into each of them, unless they have float to absorb it.</p>,
      },
      {
        title: "Check yourself",
        body: () => <p>A typical site situation:</p>,
        quiz: {
          q: "Formwork can be stripped 7 days after the concrete pour finishes. How do you link Pour → Strip?",
          options: ["SS with 7 days lag", "FS with 7 days lag", "FF with no lag", "No link; add a constraint"],
          answer: 1,
          explain: "Stripping waits for the pour to finish, then 7 days of curing: finish to start with a 7-day lag. Some planners model curing as its own activity instead.",
        },
      },
      {
        title: "Clear the find box",
        target: ".p6-find",
        task: "Clear the find box so all activities show again.",
        done: findCleared,
        showMe: () => void setValue(".p6-find", ""),
        body: () => <p>Filters stay on until you clear them, in every layout.</p>,
      },
    ],
  },

  // ==================================================================
  {
    id: "cpm",
    course: "Planning skills",
    title: "Critical path and float",
    minutes: 8,
    level: "Beginner",
    summary: "How the critical path method works, what total and free float mean, and how to find the critical path.",
    learn: ["Forward and backward pass", "Total float and free float", "Filter the critical path", "Negative float"],
    needs: { mode: "p6", sample: true },
    steps: [
      {
        title: "How CPM calculates dates",
        body: () => (
          <>
            <p>The critical path method (CPM) runs two passes over the logic:</p>
            <ul>
              <li>
                <b>Forward pass</b>: from the data date, each activity starts as early as its predecessors allow. This gives the <b>early start and early finish</b>, and the project finish.
              </li>
              <li>
                <b>Backward pass</b>: from the project finish, each activity finishes as late as its successors allow. This gives the <b>late start and late finish</b>.
              </li>
            </ul>
            <p>
              <code>Total float = late finish − early finish</code>
            </p>
            <p>Activities with zero total float form the <b>critical path</b>: the longest chain through the project. Any delay on it moves the finish date by the same amount.</p>
          </>
        ),
      },
      {
        title: "Show only critical work",
        target: ".p6-layoutbar select",
        task: "Set the Filter to Critical.",
        done: (c) => c.s.ganttFilter.kind === "critical",
        showMe: () => void setValue(".p6-layoutbar select", "critical"),
        body: () => <p>P6 has the same filter under View → Filter By. It is the quickest way to see what drives the finish date.</p>,
      },
      {
        title: "This project's critical path",
        target: ".gantt-body",
        body: (c) => {
          const crit = (c.s.schedule?.activities ?? []).filter((a) => a.critical && a.status !== "complete");
          return (
            <>
              <p>
                {crit.length} open activities are critical. The chain runs through the <b>power transformers</b>: manufacture (P-3030), factory test and delivery (P-3040), crane placing (C-4900), erection and oil filling (C-5030, C-5040), then pre-commissioning, energisation, trial operation and the taking-over certificate.
              </p>
              <p>The GIS equipment itself is not critical; it has float. Long-lead equipment driving the finish is typical for substations, which is why planners track factory dates so closely.</p>
            </>
          );
        },
      },
      {
        title: "Run the schedule",
        target: () => rail("Schedule")(),
        task: "Click Schedule on the Command bar (or press F9).",
        done: (c) => c.act("P-3040")?.lateStart != null,
        showMe: () => void click(rail("Schedule")),
        body: () => <p>Late dates and float come from the backward pass, so they only exist after scheduling. Imported projects carry P6's float; pressing F9 recalculates it here.</p>,
      },
      {
        title: "Read the float of a critical activity",
        task: "Select P-3040 and open its Status tab.",
        target: () => row("P-3040")() ?? $(".gantt-body"),
        done: (c) => c.sel()?.code === "P-3040" && tabOn("Status"),
        showMe: async () => {
          click(row("P-3040"));
          await wait(200);
          click(tab("Status"));
        },
        body: (c) => {
          const a = c.act("P-3040");
          return (
            <p>
              P-3040 <i>{a?.name}</i> shows a total float of <b>{d(c, a?.totalFloatHours)}</b>. In the dates table you can see its early and late dates are the same: there is no room at all.
            </p>
          );
        },
      },
      {
        title: "Total float and free float",
        target: ".p6-lowerbody",
        body: () => (
          <>
            <ul>
              <li>
                <b>Total float</b>: how far an activity can slip before the <i>project finish</i> moves.
              </li>
              <li>
                <b>Free float</b>: how far it can slip before its <i>next activity</i> moves.
              </li>
            </ul>
            <p>Free float is never more than total float. Float belongs to the path, not to one activity: if an early activity uses it, the later ones on the same path lose it.</p>
            <p>
              <b>Negative float</b> means the schedule cannot meet a constraint or deadline; the number is how many days must be recovered.
            </p>
          </>
        ),
      },
      {
        title: "Back to all activities",
        target: ".p6-layoutbar select",
        task: "Set the Filter back to All Activities.",
        done: (c) => c.s.ganttFilter.kind === "all",
        showMe: () => void setValue(".p6-layoutbar select", "all"),
        body: () => <p>Now look for activities with small float, such as C-4090 cable trenches with a few days: these are "near-critical" and can become critical after one bad week.</p>,
      },
      {
        title: "Check yourself",
        body: () => <p>Float in practice:</p>,
        quiz: {
          q: "An activity has 10 days of total float and slips by 4 days. What happens?",
          options: ["The project finish moves 4 days", "Nothing moves; its total float drops to 6 days", "The project finish moves 10 days", "It becomes critical"],
          answer: 1,
          explain: "Float absorbs the slip, so the finish holds. But that float is now used: the path has 6 days left.",
        },
      },
      {
        title: "Check yourself",
        body: () => <p>One more:</p>,
        quiz: {
          q: "What is the critical path?",
          options: ["The activities with the most cost", "The longest chain of logic through the project; zero float", "All activities that have started", "Activities with constraints"],
          answer: 1,
          explain: "The critical path is the longest path through the network. Its length sets the project duration, so its activities have no float.",
        },
      },
    ],
  },

  // ==================================================================
  {
    id: "update",
    course: "Planning skills",
    title: "The weekly progress update",
    minutes: 7,
    level: "Intermediate",
    summary: "Record progress on an activity, reschedule with F9, and see what moved.",
    learn: ["The update cycle", "Enter % complete and remaining", "Schedule (F9)", "Commit to the database"],
    needs: { mode: "p6", sample: true },
    steps: [
      {
        title: "The update cycle",
        body: () => (
          <>
            <p>Every update period the planner:</p>
            <ol>
              <li>collects progress from site: actual starts and finishes, % complete and the remaining time for work in hand;</li>
              <li>enters it against the new data date;</li>
              <li>reschedules (F9) so remaining work is pushed after the data date;</li>
              <li>checks the critical path and float, and compares with the baseline;</li>
              <li>reports: S-curve, look-ahead, milestones, narrative.</li>
            </ol>
            <p>You will now do steps 2 and 3 on one activity.</p>
          </>
        ),
      },
      {
        title: "Where the data date is set",
        target: ".p6-status .dd-edit",
        body: (c) => (
          <p>
            The data date sits in the status bar: <b>{fmtDate(c.s.schedule?.dataDate ?? null)}</b>. Click it to pick a new date. In a real update you move it forward first (for a weekly update, by seven days) and then enter progress up to that date. For this lesson leave it where it is. In the MS Project layout the same box is <i>Project → Status Date</i>.
          </p>
        ),
      },
      {
        title: "Select C-5000",
        target: ".p6-find",
        task: "Find and select C-5000 (220 kV GIS installation – bays 1–5).",
        done: (c) => c.sel()?.code === "C-5000",
        showMe: () => pick("C-5000"),
        enter: (c) => {
          const a = c.act("C-5000");
          c.mem.pct = a?.percentComplete;
          c.mem.finish = a?.finish;
        },
        body: () => <p>GIS installation for bays 1–5 is in progress on site.</p>,
      },
      {
        title: "Open the Status tab",
        target: tab("Status"),
        task: "Click the Status tab.",
        done: () => tabOn("Status"),
        showMe: () => void click(tab("Status")),
        body: (c) => (
          <p>
            It is at <b>{String(c.mem.pct ?? c.act("C-5000")?.percentComplete)}%</b>. The site engineer reports that bays 1–5 are now 45% installed.
          </p>
        ),
      },
      {
        title: "Enter the new % complete",
        target: '.p6-lowerbody input[type="number"][max="100"]',
        task: "Set % complete to 45.",
        done: (c) => c.act("C-5000")?.percentComplete === 45,
        showMe: () => void setValue('.p6-lowerbody input[type="number"][max="100"]', "45"),
        body: () => (
          <>
            <p>
              Base % complete on something you can measure: bays installed, metres of cable pulled, tonnes of steel erected. "Looks about half done" leads to the classic 90%-complete-for-months problem.
            </p>
            <p>
              Then check <b>Remaining duration</b>: does the time left match the work left? If the crew is slower than planned, increase it; the forecast finish moves accordingly.
            </p>
          </>
        ),
      },
      {
        title: "Reschedule",
        target: () => rail("Schedule")(),
        task: "Click Schedule on the Command bar (or press F9).",
        done: (c) => !c.s.scheduleDirty,
        showMe: () => void click(rail("Schedule")),
        body: () => <p>Editing marks the schedule as changed. Scheduling runs CPM again: forward pass, backward pass, float, critical path. Always reschedule before you report.</p>,
      },
      {
        title: "What moved",
        target: ".cl-statusbar",
        body: (c) => {
          const r = c.s.scheduleReport;
          return (
            <>
              <p>The status bar reports the result. {r ? `The project now finishes ${fmtDate(r.projectFinish ?? null)}.` : ""}</p>
              <p>
                C-5000 finishes <b>{fmtDate(c.act("C-5000")?.finish ?? null)}</b>. Its finish depends on the remaining duration, not on the % complete: % complete is a measure of progress, remaining duration is the forecast.
              </p>
            </>
          );
        },
      },
      {
        title: "Saving the update",
        target: () => rail("Commit")(),
        body: () => (
          <p>
            <b>Commit (Ctrl+S)</b> writes the project to the database so the team and the reports see it. You do not need to commit for this lesson. If you would rather not keep the change, reload the sample from the start screen or reopen the last committed version from Projects.
          </p>
        ),
      },
      {
        title: "Check yourself",
        body: () => <p>About the data date:</p>,
        quiz: {
          q: "After you reschedule, can remaining work start before the data date?",
          options: ["Yes, if the logic allows", "No; remaining work is always scheduled on or after the data date", "Only for critical activities", "Only for milestones"],
          answer: 1,
          explain: "Everything before the data date is history. CPM places all remaining work on or after it.",
        },
      },
    ],
  },

  // ==================================================================
  {
    id: "baseline",
    course: "Project controls",
    title: "Baselines and variance",
    minutes: 6,
    level: "Intermediate",
    summary: "Compare the current schedule with the baseline, see slippage and filter late work.",
    learn: ["What a baseline is", "Show baseline bars", "Finish variance", "Filter late activities"],
    needs: { mode: "p6", sample: true },
    steps: [
      {
        title: "What a baseline is",
        body: () => (
          <>
            <p>The <b>baseline</b> is the approved plan, frozen at the start of the project (and re-baselined only with the client's agreement, for example after an approved extension of time).</p>
            <p>
              Every update is measured against it: <code>variance = current finish − baseline finish</code>. Positive means late.
            </p>
          </>
        ),
      },
      {
        title: "Show the baseline bars",
        target: ".p6-layoutbar button.p6-drop",
        task: "Click the Layout button to switch to the layout with baseline bars.",
        done: (c) => c.s.ganttTracking,
        showMe: () => void click(".p6-layoutbar button.p6-drop"),
        body: () => <p>In P6 this is the baseline bar option on the Bars dialog; in MS Project it is the Tracking Gantt.</p>,
      },
      {
        title: "Reading slippage",
        target: ".gantt-body",
        body: (c) => {
          const a = c.act("P-3030");
          return (
            <>
              <p>The thin grey bar under each activity is its baseline. When the current bar ends to the right of it, the activity is late.</p>
              <p>
                Transformer manufacture P-3030 was due <b>{fmtDate(a?.baselineFinish ?? null)}</b> and now finishes <b>{fmtDate(a?.finish ?? null)}</b>. Because it is on the critical path, that slip carries through to the end of the project.
              </p>
            </>
          );
        },
      },
      {
        title: "Late against baseline",
        target: ".p6-layoutbar select",
        task: "Set the Filter to Late against Baseline.",
        done: (c) => c.s.ganttFilter.kind === "late",
        showMe: () => void setValue(".p6-layoutbar select", "late"),
        body: (c) => {
          const g = c.act("G-1900");
          const v = g?.finish != null && g?.baselineFinish != null ? Math.round((g.finish - g.baselineFinish) / 86_400_000) : null;
          return (
            <p>
              These are activities forecast to finish after their baseline. The taking-over certificate G-1900 is forecast <b>{fmtDate(g?.finish ?? null)}</b> against a baseline of <b>{fmtDate(g?.baselineFinish ?? null)}</b>
              {v !== null ? `: ${v} days late` : ""}. That is the number the client will ask about first.
            </p>
          );
        },
      },
      {
        title: "Reset the view",
        target: ".p6-layoutbar",
        task: "Set the Filter back to All Activities and switch the Layout back.",
        done: (c) => c.s.ganttFilter.kind === "all" && !c.s.ganttTracking,
        showMe: async () => {
          setValue(".p6-layoutbar select", "all");
          await wait(100);
          if (useStore.getState().ganttTracking) click(".p6-layoutbar button.p6-drop");
        },
        body: () => <p>A delay is only half the story; the next step is to explain it (cause, responsibility, recovery). The delay analysis practices used for extension of time claims start from exactly this comparison.</p>,
      },
      {
        title: "Check yourself",
        body: () => <p>Variance:</p>,
        quiz: {
          q: "Baseline finish 31-Jul-27, forecast finish 14-Aug-27. What is the finish variance?",
          options: ["−14 days (ahead)", "+14 days (late)", "0 days", "It depends on the float"],
          answer: 1,
          explain: "Forecast minus baseline: 14 days late.",
        },
      },
    ],
  },

  // ==================================================================
  {
    id: "evm",
    course: "Project controls",
    title: "Cost, resources and earned value",
    minutes: 8,
    level: "Intermediate",
    summary: "Planned value, earned value and actual cost; SPI and CPI; resource usage.",
    learn: ["PV, EV and AC", "SPI and CPI", "Read the cost S-curve", "Resource usage profile"],
    needs: { mode: "p6", sample: true },
    steps: [
      {
        title: "Open the Activity Usage Profile",
        target: () => rail("Activity Usage")(),
        task: "Click Activity Usage on the Directory bar.",
        done: () => lowerHead().includes("Activity Usage"),
        showMe: () => void click(rail("Activity Usage")),
        body: () => <p>The lower pane switches to cost over time. The example project is cost-loaded in AED: every activity has resources with rates.</p>,
      },
      {
        title: "Three numbers",
        target: ".p6-lower",
        body: () => (
          <>
            <ul>
              <li>
                <b>Planned value (PV)</b>: the budgeted cost of the work <i>scheduled</i> by the data date, according to the baseline.
              </li>
              <li>
                <b>Earned value (EV)</b>: the budgeted cost of the work <i>actually done</i>: budget × % complete.
              </li>
              <li>
                <b>Actual cost (AC)</b>: what that work really cost.
              </li>
            </ul>
            <p>The S-curve plots all three cumulatively, with the forecast to completion dashed.</p>
          </>
        ),
      },
      {
        title: "SPI and CPI",
        target: ".p6-lower",
        body: () => (
          <>
            <p>
              <code>SPI = EV ÷ PV</code> is the schedule performance index. Below 1.0 means less work has been earned than planned.
            </p>
            <p>
              <code>CPI = EV ÷ AC</code> is the cost performance index. Below 1.0 means the work done cost more than its budget.
            </p>
            <p>This project reports SPI 0.96 and CPI 0.99: slightly behind schedule, close to budget. A common rule of thumb flags anything under 0.95 for a recovery plan.</p>
            <p>
              <code>EAC = BAC ÷ CPI</code> is the simplest estimate at completion: if the cost efficiency so far continues, this is the final cost.
            </p>
          </>
        ),
      },
      {
        title: "Resource usage",
        target: () => rail("Resources")(),
        task: "Click Resources on the Directory bar.",
        done: () => lowerHead().includes("Resource Usage"),
        showMe: () => void click(rail("Resources")),
        body: () => (
          <>
            <p>The Resource Usage Profile stacks weekly hours by resource: design engineers, civil crew, electrical technicians, OEM specialists, testing engineers and plant.</p>
            <p>Peaks show where you need the most people; if a peak is higher than the crew you can mobilise, you need to level (move non-critical work into its float) or add resources.</p>
          </>
        ),
      },
      {
        title: "Back to activity details",
        target: () => rail("Activities")(),
        task: "Click Activities on the Directory bar.",
        done: () => !lowerHead().includes("Usage"),
        showMe: () => void click(rail("Activities")),
        body: () => <p>The Resources detail tab of any activity shows its assignments: budgeted, actual and remaining units and cost.</p>,
      },
      {
        title: "Check yourself",
        body: () => <p>Earned value:</p>,
        quiz: {
          q: "PV = 100, EV = 90, AC = 120. Which is true?",
          options: ["Ahead of schedule and under budget", "Behind schedule (SPI 0.90) and over budget (CPI 0.75)", "On schedule, over budget", "Behind schedule, under budget"],
          answer: 1,
          explain: "SPI = 90 ÷ 100 = 0.90 and CPI = 90 ÷ 120 = 0.75. Less work done than planned, and it cost more than budgeted.",
        },
      },
    ],
  },

  // ==================================================================
  {
    id: "logic",
    course: "Planning skills",
    title: "Adding an activity and its logic",
    minutes: 8,
    level: "Intermediate",
    summary: "Add an activity, name it, give it a duration and predecessors, schedule it, then remove it.",
    learn: ["Add after the selected activity", "Durations", "Add a predecessor with lag", "Schedule and check dates", "Delete safely"],
    needs: { mode: "p6", sample: true },
    steps: [
      {
        title: "Start from C-5000",
        target: ".p6-find",
        task: "Find and select C-5000.",
        done: (c) => c.sel()?.code === "C-5000",
        showMe: () => pick("C-5000"),
        enter: (c) => {
          c.mem.ids = new Set((c.s.schedule?.activities ?? []).map((a) => a.id));
        },
        body: () => <p>You will add a short activity after GIS installation of bays 1–5: a <i>bay 1–5 punch-list walk-down</i>.</p>,
      },
      {
        title: "Add an activity",
        target: () => rail("Add")(),
        task: "Click Add on the Command bar (or press Ins).",
        done: (c) => (c.s.schedule?.activities ?? []).some((a) => !(c.mem.ids as Set<string>)?.has(a.id)),
        showMe: () => void click(rail("Add")),
        enter: (c) => {
          if (!c.mem.ids) c.mem.ids = new Set((c.s.schedule?.activities ?? []).map((a) => a.id));
        },
        body: () => <p>Stratum adds it after the selected activity, in the same WBS, already linked finish-to-start from C-5000, and selects it.</p>,
      },
      {
        title: "Name it",
        target: ".p6-lowerbody label.span2 input",
        task: "On the General tab, change the name to: Bays 1–5 punch-list walk-down",
        enter: () => void click(tab("General")),
        done: (c) => {
          const n = (c.s.schedule?.activities ?? []).find((a) => !(c.mem.ids as Set<string>)?.has(a.id));
          return !!n && n.name !== "New activity" && n.name.trim().length > 3;
        },
        showMe: () => void setValue(".p6-lowerbody label.span2 input", "Bays 1–5 punch-list walk-down"),
        body: () => <p>Write names as verb + object + location, so they read clearly on their own: "Install GIS bays 1–5", not "GIS".</p>,
      },
      {
        title: "Set the duration",
        target: tab("Status"),
        task: "Open the Status tab and set Original duration to 3 days.",
        done: (c) => {
          const n = (c.s.schedule?.activities ?? []).find((a) => !(c.mem.ids as Set<string>)?.has(a.id));
          return !!n && Math.abs((n.originalDurationHours ?? 0) - 3 * hpd(c)) < 0.01;
        },
        showMe: async () => {
          click(tab("Status"));
          await wait(200);
          setValue('.p6-lowerbody input[type="number"]', "3");
        },
        body: () => <p>Durations are in working days on the activity's calendar. Keep construction activities short enough to measure progress, typically no longer than two update periods.</p>,
      },
      {
        title: "Add a second predecessor",
        target: tab("Predecessors"),
        task: "On the Predecessors tab, add C-5060 as an SS predecessor with 5 days lag, then click Add.",
        done: (c) => {
          const n = (c.s.schedule?.activities ?? []).find((a) => !(c.mem.ids as Set<string>)?.has(a.id));
          const p = c.act("C-5060");
          return !!n && !!p && (c.s.schedule?.relationships ?? []).some((r) => r.successorId === n.id && r.predecessorId === p.id);
        },
        showMe: async () => {
          click(tab("Predecessors"));
          await wait(200);
          setValue('.p6-lowerbody input[list="activity-codes"]', "C-5060");
          const sel = $(".p6-lowerbody section .row select");
          if (sel) setValue(() => sel, "SS");
          const lag = $('.p6-lowerbody section .row input[type="number"]');
          if (lag) setValue(() => lag, "5");
          await wait(150);
          click(() => byText(".p6-lowerbody section .row button", "Add", true));
        },
        body: () => (
          <p>
            The walk-down also needs the 33 kV switchgear crew, who start C-5060 first. <b>SS + 5 days</b> means it can start 5 working days after C-5060 starts. The activity now has two predecessors; CPM takes whichever drives the later date.
          </p>
        ),
      },
      {
        title: "Schedule it",
        target: () => rail("Schedule")(),
        task: "Press F9 or click Schedule.",
        done: (c) => !c.s.scheduleDirty,
        showMe: () => void click(rail("Schedule")),
        body: () => <p>Until you schedule, the new activity sits at the data date with no float.</p>,
      },
      {
        title: "Read its dates",
        target: ".p6-lower",
        enter: () => void click(tab("Status")),
        body: (c) => {
          const n = (c.s.schedule?.activities ?? []).find((a) => !(c.mem.ids as Set<string>)?.has(a.id));
          return (
            <p>
              {n?.code} now runs <b>{fmtDate(n?.start ?? null)}</b> to <b>{fmtDate(n?.finish ?? null)}</b> with <b>{d(c, n?.totalFloatHours)}</b> total float. It has no successor, so its float runs to the project finish; in a real schedule you would link it to a successor such as GIS HV testing (C-5020) so it cannot float freely. Open ends like this are one of the first things a schedule review checks.
            </p>
          );
        },
      },
      {
        title: "Remove the practice activity",
        target: () => rail("Delete")(),
        task: "With it selected, click Delete on the Command bar and confirm.",
        done: (c) => !(c.s.schedule?.activities ?? []).some((a) => !(c.mem.ids as Set<string>)?.has(a.id)),
        showMe: (c) => {
          const n = (c.s.schedule?.activities ?? []).find((a) => !(c.mem.ids as Set<string>)?.has(a.id));
          if (n) {
            useStore.getState().deleteActivity(n.id);
            useStore.getState().selectActivity(null);
          }
        },
        body: () => <p>Deleting removes the activity and its relationships. Reschedule afterwards (F9) so the rest of the network is recalculated.</p>,
      },
      {
        title: "Tidy up",
        target: ".p6-find",
        task: "Clear the find box and press F9.",
        done: (c) => findCleared(c) && !c.s.scheduleDirty,
        showMe: async () => {
          setValue(".p6-find", "");
          await wait(100);
          click(rail("Schedule"));
        },
        body: () => <p>That is the full cycle of building logic: add, describe, estimate, link, schedule, check.</p>,
      },
    ],
  },

  // ==================================================================
  {
    id: "msp",
    course: "Getting started",
    title: "The MS Project layout",
    minutes: 5,
    level: "Beginner",
    summary: "The same project laid out like Microsoft Project, and how its terms map to P6.",
    learn: ["Switch to Project", "Ribbon and Timeline", "Tracking Gantt", "P6 ↔ MS Project terms"],
    needs: { sample: true },
    steps: [
      {
        title: "Switch to the Project layout",
        target: ".mode-switch",
        task: "Click Project in the layout switch (or Ctrl+Alt+2).",
        done: (c) => c.cfg.mode === "msp",
        showMe: () => useConfig.getState().update({ mode: "msp" }),
        body: () => <p>Same project, same dates; the screen now looks and reads like Microsoft Project.</p>,
      },
      {
        title: "The ribbon",
        target: ".msp-tabrow",
        body: () => (
          <p>
            The ribbon tabs group commands as in MS Project: <b>Task</b> (progress, add tasks, scroll to task), <b>Resource</b>, <b>Report</b>, <b>Project</b> (information, calculate project) and <b>View</b> (Gantt, Tracking Gantt, Resource Usage, Timeline and Details).
          </p>
        ),
      },
      {
        title: "The Timeline",
        target: ".msp-tl",
        body: () => <p>The Timeline shows the whole project span, the key milestones and the status date: the one-line picture managers like to paste into reports.</p>,
      },
      {
        title: "Tracking Gantt",
        target: () => byText(".msp-tabrow button", "View", true),
        task: "Open the View tab and click Tracking Gantt.",
        done: () => !!byText(".rb-big.active", "Tracking Gantt"),
        showMe: async () => {
          click(() => byText(".msp-tabrow button", "View", true));
          await wait(200);
          click(() => byText(".rb-big", "Tracking Gantt"));
        },
        body: () => <p>Tracking Gantt draws the baseline under each task and colours critical tasks red: the MS Project equivalent of the P6 layout with baseline bars.</p>,
      },
      {
        title: "Same ideas, different words",
        body: () => (
          <table className="tr-table">
            <thead>
              <tr>
                <th>Primavera P6</th>
                <th>MS Project</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Activity</td>
                <td>Task</td>
              </tr>
              <tr>
                <td>WBS band</td>
                <td>Summary task</td>
              </tr>
              <tr>
                <td>Data date</td>
                <td>Status date</td>
              </tr>
              <tr>
                <td>Total float</td>
                <td>Total slack</td>
              </tr>
              <tr>
                <td>Schedule (F9)</td>
                <td>Calculate Project</td>
              </tr>
              <tr>
                <td>Relationship</td>
                <td>Dependency / link</td>
              </tr>
              <tr>
                <td>Original duration</td>
                <td>Duration (baseline duration)</td>
              </tr>
              <tr>
                <td>Activity code</td>
                <td>Custom field / outline code</td>
              </tr>
            </tbody>
          </table>
        ),
      },
      {
        title: "Back to Gantt Chart and P6",
        target: ".mode-switch",
        task: "Click Gantt Chart on the View tab, then P6 in the layout switch.",
        done: (c) => c.cfg.mode === "p6",
        showMe: async () => {
          click(() => byText(".rb-big", "Gantt Chart", true));
          await wait(150);
          useConfig.getState().update({ mode: "p6" });
        },
        body: () => <p>You can switch at any time; the selection and filters carry over.</p>,
      },
    ],
  },

  // ==================================================================
  {
    id: "sim4d",
    course: "4D and reporting",
    title: "4D simulation",
    minutes: 7,
    level: "Intermediate",
    summary: "Play the schedule against the 3D model and read what is being built on any date.",
    learn: ["Switch to 4D", "Navigate the model", "Play and step the timeline", "Linking rules and profiles"],
    needs: { sample: true },
    steps: [
      {
        title: "Switch to 4D",
        target: ".mode-switch",
        task: "Click 4D in the layout switch (or Ctrl+Alt+3).",
        done: (c) => c.cfg.mode === "4d",
        showMe: () => useConfig.getState().update({ mode: "4d" }),
        body: () => <p>The 4D layout adds the 3D model, a timeline and the linking tools. A 4D model is a 3D model in which every element is tied to the activity that builds it, so time becomes the fourth dimension.</p>,
      },
      {
        title: "The model",
        target: ".center .viewport",
        body: () => (
          <>
            <p>
              Drag to orbit, right-drag to pan, scroll to zoom. Colours follow the <b>appearance profile</b> of each activity: elements being installed show green, finished elements their normal colour, and elements whose activity has not started are hidden.
            </p>
            <p>At the data date you can see the GIS hall built, transformer bays waiting for their transformers, and cable trenches in progress.</p>
          </>
        ),
      },
      {
        title: "Play the schedule",
        target: ".timeline-controls",
        task: "Press the play button (or Space).",
        done: (c) => c.s.playing,
        showMe: () => useStore.getState().setPlaying(true),
        body: () => <p>Playback moves the date forward and rebuilds the model day by day.</p>,
      },
      {
        title: "Pause",
        target: ".timeline-controls",
        task: "Press play again to pause.",
        done: (c) => !c.s.playing,
        showMe: () => useStore.getState().setPlaying(false),
        body: () => <p>Use ◀ ▶ to step a day and ◀◀ ▶▶ for a week (Shift + arrow keys do the same). The list under the slider shows which activities are active on that date.</p>,
      },
      {
        title: "Why planners use 4D",
        target: ".center .viewport",
        body: () => (
          <ul>
            <li>Check the sequence is buildable: no roof before columns, no cable pulling before trenches.</li>
            <li>Spot space clashes: a 200 t crane placing transformers while the access road is being built.</li>
            <li>Explain the plan to people who do not read Gantt charts: clients, site crews, authorities.</li>
            <li>Show progress visually in reviews and claims.</li>
          </ul>
        ),
      },
      {
        title: "How elements get linked",
        target: ".right .tabs",
        body: () => (
          <>
            <p>
              The right-hand tabs hold the 4D tools. <b>Rules</b> link model elements to activities automatically, for example "elements whose Activity property equals the activity ID". <b>Profiles</b> decide how each kind of work appears (install, demolish, temporary). <b>Selection</b> shows what is linked to the selected activity; Alt-click an activity to select its elements.
            </p>
            <p>In the sample, 202 elements are linked by one rule.</p>
          </>
        ),
      },
      {
        title: "Back to P6",
        target: ".mode-switch",
        task: "Click P6 in the layout switch.",
        done: (c) => c.cfg.mode === "p6",
        showMe: () => useConfig.getState().update({ mode: "p6" }),
        body: () => <p>The 4D layout keeps its own dark theme; the P6 and MS Project layouts are light, like the applications they copy.</p>,
      },
      {
        title: "Check yourself",
        body: () => <p>4D:</p>,
        quiz: {
          q: "What makes a 3D model a 4D model?",
          options: ["A higher level of detail", "Each element is linked to the activity that builds it, so the model can be shown at any date", "It includes costs", "It is viewed in VR"],
          answer: 1,
          explain: "4D = 3D + time. Cost would make it 5D.",
        },
      },
    ],
  },

  // ==================================================================
  {
    id: "reports",
    course: "4D and reporting",
    title: "Dashboards and reports",
    minutes: 8,
    level: "Beginner",
    summary: "Create a planning dashboard, filter it with slicers, customise widgets and share the result.",
    learn: ["Open Reports", "Start from a template", "Slicers", "Customise, add and style widgets", "PDF, Excel and email"],
    needs: { sample: true },
    steps: [
      {
        title: "Open Reports",
        target: ".mode-switch",
        task: "Click Reports in the layout switch (or Ctrl+Alt+4).",
        done: (c) => c.s.view === "dashboards",
        showMe: () => useStore.getState().setView("dashboards"),
        body: () => <p>Reports is the dashboard builder. It works with whatever project is open, or with any project saved in the database.</p>,
      },
      {
        title: "Start from a template",
        target: () => byText(".dash-new", "Planning dashboard"),
        task: "Click + Planning dashboard under New.",
        done: () => !!$(".widget.kind-gauge"),
        showMe: () => void click(() => byText(".dash-new", "Planning dashboard")),
        body: () => <p>Templates give you a complete dashboard to adapt. This one has the views planners most often share every week.</p>,
      },
      {
        title: "Gauges",
        target: ".widget.kind-gauge",
        body: () => (
          <p>
            The SPI and CPI gauges have red, amber and green bands. Here both sit in amber, between 0.90 and 1.00. The physical progress gauge compares actual % with the baseline plan %. You set the band limits per widget.
          </p>
        ),
      },
      {
        title: "Use a slicer",
        target: ".widget.kind-slicer",
        task: "Click Procurement in the Discipline slicer.",
        done: () => !!$(".slicer button.on"),
        showMe: () => void click(() => byText(".slicer button", "Procurement", true)),
        body: () => <p>Slicers filter every widget on the dashboard at once. The bars, donuts and tables now show procurement only.</p>,
      },
      {
        title: "Clear the filter",
        target: () => byText(".dash-bar button", "Clear filters"),
        task: "Click Clear filters in the bar at the top.",
        done: () => !$(".slicer button.on"),
        showMe: () => void click(() => byText(".dash-bar button", "Clear filters")),
        body: () => <p>Slicer choices are saved with the dashboard, so clear them before you send a report you want to show the whole project.</p>,
      },
      {
        title: "Select a widget",
        target: ".widget.kind-groupbars",
        task: "The dashboard is in Customise mode. Click the 'Plan vs actual by discipline' card.",
        done: () => !!$(".widget.selected"),
        enter: () => {
          if (!$(".inspector")) click(() => byText(".dash-bar button", "Customise"));
        },
        showMe: () => void click(".widget.kind-groupbars"),
        body: () => (
          <p>
            In Customise mode, clicking a card opens its settings on the right: <b>Data</b> (what it shows), <b>Look</b> (how it looks) and <b>Filter</b> (which part of the project). Drag a card by its title to move it; drag its bottom-right corner to resize.
          </p>
        ),
      },
      {
        title: "Change its look",
        target: () => byText(".inspector .tabs button", "Look", true),
        task: "Open the Look tab and choose the Filled title bar.",
        done: () => !!$(".widget.selected.head-filled"),
        showMe: async () => {
          click(() => byText(".inspector .tabs button", "Look", true));
          await wait(150);
          click(() => byText(".inspector .seg button", "Filled", true));
        },
        body: () => <p>Colours, card style, text size and which chart series show are all here. Page-wide settings (theme, logo, header, footer, PDF orientation) are under Add / Page → Page &amp; theme.</p>,
      },
      {
        title: "Add a milestone tracker",
        target: ".inspector",
        task: "Close the widget settings (✕), then click Milestone tracker in the gallery.",
        enter: (c) => {
          c.mem.ms = document.querySelectorAll(".widget.kind-milestones").length;
        },
        done: (c) => document.querySelectorAll(".widget.kind-milestones").length > (c.mem.ms as number),
        showMe: async () => {
          click('.inspector button[title="Close (Esc)"]');
          await wait(150);
          click(() => byText(".gallery-item", "Milestone tracker"));
        },
        body: () => <p>New widgets go to the end of the page and are selected, ready to set up. Milestones are marked on track, at risk (little float left) or late.</p>,
      },
      {
        title: "Finish customising",
        target: () => byText(".dash-bar button", "Done"),
        task: "Click Done.",
        done: () => !$(".inspector"),
        showMe: () => void click(() => byText(".dash-bar button", "Done")),
        body: () => (
          <p>
            Changes save as you go. Ctrl+Z undoes the last change while customising. Under <b>More</b> you can duplicate the dashboard, save it as a template for your team, or export it as a file.
          </p>
        ),
      },
      {
        title: "Share it",
        target: ".dash-bar",
        body: () => (
          <p>
            <b>PDF</b> prints the dashboard with your header and footer, <b>Excel</b> exports the data behind it, and <b>Email</b> sends it on a schedule (for example every Monday 08:00) to the project manager and director. On a Stratum Server, schedules run even when nobody has the app open.
          </p>
        ),
      },
      {
        title: "Back to the schedule",
        target: ".reports-topbar .mode-switch",
        task: "Click P6 in the switch at the top.",
        done: (c) => c.s.view === "workspace",
        showMe: () => {
          useStore.getState().setView("workspace");
          useConfig.getState().update({ mode: "p6" });
        },
        body: () => <p>The practice dashboard stays in your list; delete it from More if you do not need it.</p>,
      },
    ],
  },
];

export interface GlossaryEntry {
  term: string;
  def: string;
  alt?: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  { term: "Activity", alt: "Task (MS Project)", def: "A unit of work with a duration, dates and logic, such as 'Install GIS bays 1–5'." },
  { term: "Actual cost (AC)", def: "What the work done so far has really cost." },
  { term: "Actual start / finish", def: "The dates the work really started or finished. Shown with an A after the date." },
  { term: "Baseline", def: "The approved plan, frozen and used to measure variance. Re-baselining needs the client's agreement." },
  { term: "Budget at completion (BAC)", def: "The total approved budget for the work." },
  { term: "Calendar", def: "Working days, hours and holidays used to turn durations into dates." },
  { term: "Constraint", def: "A date imposed on an activity (start on or after, finish on or before…). Use sparingly; logic should drive dates." },
  { term: "Cost performance index (CPI)", def: "EV ÷ AC. Below 1.0: work is costing more than budgeted." },
  { term: "Critical path", def: "The longest chain of logic through the project. Its activities have zero (or the least) total float; delaying them delays the finish." },
  { term: "CPM", def: "Critical path method: the forward and backward pass that calculates early and late dates and float." },
  { term: "Data date", alt: "Status date (MS Project)", def: "The date progress is recorded up to. Past is actual; future is forecast." },
  { term: "Earned value (EV)", def: "Budgeted cost of the work actually done: budget × % complete." },
  { term: "Estimate at completion (EAC)", def: "The forecast final cost; simplest form BAC ÷ CPI." },
  { term: "Finish variance", def: "Current finish minus baseline finish. Positive: late." },
  { term: "Float (total)", alt: "Total slack (MS Project)", def: "How long an activity can slip before the project finish moves. Late finish − early finish." },
  { term: "Float (free)", alt: "Free slack", def: "How long an activity can slip before its next activity moves." },
  { term: "Forecast", def: "Dates and costs for remaining work, calculated by CPM from the data date." },
  { term: "4D", def: "A 3D model linked to the schedule so it can be shown at any date." },
  { term: "Lag", def: "A wait added to a relationship, e.g. FS + 7 days for curing." },
  { term: "Level of effort (LOE)", def: "An activity that spans other work, such as site supervision or HSE, taking its dates from them." },
  { term: "Look-ahead", def: "A short-term view (2–6 weeks) of the work starting or running, used to plan crews, materials and permits." },
  { term: "Milestone", def: "A zero-duration event: contract award, energisation, taking-over." },
  { term: "Near-critical", def: "Activities with only a few days of float; they become critical after small delays." },
  { term: "Negative float", def: "The schedule cannot meet a constraint or deadline; the number of days to recover." },
  { term: "Open end", def: "An activity with no predecessor or no successor. Schedule quality checks flag them." },
  { term: "Original duration", def: "The planned duration in working days." },
  { term: "Planned value (PV)", def: "Budgeted cost of the work scheduled by the data date on the baseline." },
  { term: "% complete", def: "How far the work is done; base it on measurable quantities." },
  { term: "Relationship (FS, SS, FF, SF)", alt: "Dependency / link", def: "Logic between activities: finish-to-start, start-to-start, finish-to-finish, start-to-finish." },
  { term: "Remaining duration", def: "Working days still needed; drives the forecast finish." },
  { term: "Resource", def: "Labour, plant or material assigned to activities with quantities and rates." },
  { term: "S-curve", def: "Cumulative progress or cost over time; plan, actual and forecast compared." },
  { term: "Schedule performance index (SPI)", def: "EV ÷ PV. Below 1.0: less work done than planned." },
  { term: "Slicer", def: "Dashboard buttons that filter every widget, e.g. by discipline." },
  { term: "Update", def: "The periodic cycle of recording progress, rescheduling and reporting." },
  { term: "WBS", alt: "Summary tasks (MS Project)", def: "Work breakdown structure: the hierarchy of deliverables the activities sit under." },
  { term: "Weightage", def: "Each group's share of overall progress in an EPC progress report, by cost, hours, duration or agreed split." },
  { term: "XER", def: "Primavera P6's exchange file format." },
];
