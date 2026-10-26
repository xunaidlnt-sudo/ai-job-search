<p align="center"><img src="brand/stratum-logo.png" alt="Stratum 4D" width="420"></p>

# Stratum 4D

**Developed by [Junaid Quamar](https://www.linkedin.com/in/junaidquamar/), Senior Planning Engineer.**

Stratum links a Primavera P6 schedule to an IFC building model and plays back the construction sequence over time. It runs in the browser, as a desktop app for Windows, macOS and Linux, or on a team server.

Release 0.3 adds three interface modes, a project database, live Primavera P6 connections, and a dashboard and report builder with scheduled email. Everything from release 0.2 (phases 1 to 4 of the roadmap) is still there:

**4D**
- **Schedules**: Primavera P6 XER (activities, WBS, logic, codes, UDFs, calendars, constraints, actuals, baseline, resources and costs) and Microsoft Project XML.
- **Models**: IFC2x3/IFC4 via web-ifc, with name, type, GlobalId, storey, property sets and quantity sets per element.
- **Linking**: select in 3D and link, or rules such as *`Pset.ActivityID` equals Activity ID*; auto-detect finds the property that already holds activity IDs.
- **Appearance profiles**: Install, Remove, Temporary, Maintain, Neutral, plus your own; directional growth (bottom-up, west→east…) so slabs pour and walls rise.
- **Pours and bays**: split any element into parts along an axis and link each part to its own activity.
- **Equipment paths**: draw a path in 3D and a crane or truck moves along it during its activity.
- **Groups**: save selections as named groups for selection and rules.
- **Playback**: play, step, speed, data date, current vs baseline dates, colour by status (late work in red).

**Planning**
- **CPM scheduler (F9)**: FS/SS/FF/SF with lags on working calendars and holidays, nine constraint types, retained logic from the data date, total and free float, critical path, LOE/WBS summaries, loop detection, open-end warnings.
- **Activity editor**: add or delete activities; edit durations, status and actual dates, logic, constraints, calendars, user fields and resource assignments.
- **Export**: P6 XER that updates the original project (untouched tables pass straight through), or CSV for Excel.

**Cost, resources, quantities**
- **Earned value**: BAC, PV, EV, AC, SPI, CPI, EAC, VAC, TCPI; S-curves for planned, earned, actual and forecast; WBS roll-up; in cost or labour hours.
- **Resource histograms**: weekly usage per resource, actual-then-remaining or baseline.
- **Quantities**: any numeric IFC quantity (e.g. NetVolume) or element count, installed by the playback date, current vs baseline curve, by IFC type or activity.

**Output**: PNG snapshots, WebM video, `.stratum.json` project files, autosave.

Added after reading user reviews of existing 4D tools (see [docs/PARITY.md](docs/PARITY.md#user-feedback)):

- **Weekly schedule updates**: import the new XER over the open project. Links carry across by Activity ID even if P6 internal ids change, and the **Check** tab lists finish slip, status/progress changes, and added or removed activities.
- **Link health check**: activities with nothing linked, elements never shown, elements installed by two activities, and broken links (with one-click clean-up).
- **Auto-detect linking rules**: scans every model property against Activity ID, name, WBS and activity codes, then offers the best matches as one-click rules.
- **Autosave and restore**: work is saved in the browser every few seconds; after a crash or closed tab Stratum offers to restore it.
- **Getting-started guide and shortcuts**: press `?`. Space plays, arrows step a day (Shift for a week), Home/End jump.

A built-in demo (two-storey RC frame, 14-activity resource-loaded P6 schedule, a mobile crane on a path) shows the whole workflow without any files. Click **Load demo**. `samples/` has the demo as an XER and a small MS Project XML.

Planned work and how Stratum compares with SYNCHRO 4D Pro's public feature set are in [docs/PARITY.md](docs/PARITY.md). Development follows [docs/CLEAN_ROOM.md](docs/CLEAN_ROOM.md).

## Interface modes

The first time Stratum starts, a short setup asks which layout you want. The engine, the data and every feature are the same in all three; only the layout, the wording and the default columns change. Switch at any time in **⚙ Settings → Interface**.

| Mode | Layout | Wording |
|---|---|---|
| **P6 style** | Activity table and Gantt across the top, 3D view beside it, activity detail tabs (General, Cost & EVM, Resources, Quantities, 4D tools) underneath | Activity ID, Original Duration, Total Float, Data Date |
| **MS Project style** | Ribbon tabs (File, Task, Resource, Report, Project, View), timeline strip at the top, Gantt with row numbers and a Predecessors column, task form underneath | ID, Task Name, Duration, Total Slack, Status Date, Calculate |
| **4D style** | 3D model in the middle, Gantt on the left, linking tools on the right, timeline along the bottom | Task ID, Focus date, Reschedule |

**Switching and appearance.** The layout switch in the top bar (P6 · Project · 4D) changes mode instantly; `Ctrl+Alt+1/2/3` does the same. Each layout has its own look: P6 a navy title bar with green remaining and blue actual bars, MS Project a green ribbon with large buttons and light-blue task bars, 4D a graphite dark theme with the Stratum orange. The sun/moon button flips light and dark; **Settings → Interface** also has font, text size and density.

Fonts are bundled, so the desktop app looks the same offline. The default, **Stratum Sans**, is [Inter](https://rsms.me/inter/) set with its own stylistic alternates (single-storey a, open digits, tailed l). IBM Plex Sans, Source Sans 3, Nunito Sans and JetBrains Mono are also included, plus the system font. All are under the SIL Open Font License 1.1.

## Project database

Projects are saved to a database instead of loose files (**Save** or `Ctrl+S`, **Projects** to open). Each save gets a version number; if someone else saved the project after you opened it, Stratum refuses to overwrite their work and offers *Save as new*.

- **Desktop app**: a local SQLite file in your user folder.
- **Browser**: the browser's own storage (IndexedDB).
- **Stratum Server**: one PostgreSQL database for the whole team, with sign-in and three roles: admin (users and settings), planner (projects, dashboards, reports) and viewer (read and receive reports).

`.stratum.json` project files still work under **File**.

## Primavera P6 connections

Desktop app and Stratum Server only (the browser cannot reach a P6 server directly). Add connections in **Settings → Primavera P6**, then use **Import from P6**.

- **P6 EPPM** (web services REST API, 20.x and later): sign in with a P6 user or a bearer token. Stratum reads projects, WBS, activities, relationships, calendars, codes, UDFs, resources and assignments. **Update P6** sends progress back: actual start and finish, % complete and remaining duration. Activities added in Stratum are listed rather than pushed; take those over with an XER.
- **P6 Professional database**: SQL Server, Oracle or SQLite. Read-only by design, so use a read-only database login. Deleted rows and baseline copies are skipped. To return dates to P6 Professional, export an XER and import it with *Update Existing Project*.

Passwords are stored encrypted: with the operating-system keychain in the desktop app, and with AES-GCM keyed by `STRATUM_SECRET` on the server. They are never sent back to the browser.

## Dashboards and reports

**Dashboards** opens a Power BI-style builder. Start from a template or a blank page, then add, resize, drag and configure widgets:

- KPI tiles, cost/labour S-curve, resource histogram, activity tables (late, critical, starting soon, look-ahead), portfolio table across all projects, quantity curve, free text;
- **EPC progress report** pieces: a key-figures table, the *Progress {data date}* banner, a weighted progress table (Cum. BL Plan %, Cum. Actual %, Variance wrt BL) with a shaded **TOTAL** row, a progress S-curve with monthly or weekly planned-vs-achieved bars, and slicer buttons by discipline, package or any activity code.

Progress is weighted by budgeted cost, labour hours, duration or equally, and grouped by WBS level 1 or 2, any activity code or any user field. You can type your own weightage per group (e.g. General 3%, Engineering 7%, Procurement 50%, Construction 40%); the TOTAL row then uses those weights.

Every dashboard prints to PDF (A4 landscape) and exports to Excel (summary, progress table, progress S-curve, late and critical, 3-week look-ahead, all activities, S-curve data, weekly resources, portfolio).

**Email reports**: send a dashboard now, or on a daily, weekly or monthly schedule, to any To/Cc list, as PDF, Excel or both. Subjects take `{project}`, `{date}` and `{datadate}`. Mail goes out through your SMTP server (Settings → Email); each run is logged with its result. Schedules run while the desktop app is open, or around the clock on a Stratum Server.

## Stratum Server (team mode)

```bash
cp .env.example .env      # set STRATUM_SECRET and POSTGRES_PASSWORD
docker compose up -d      # PostgreSQL 16 + Stratum Server on port 8080
```

Open `http://<server>:8080`, create the first admin account, then point each user's setup (or Settings → Database) at that address. Without Docker: `npm run build && npm run build:server`, then `DATABASE_URL=postgres://… STRATUM_SECRET=… npm run server`. Leaving out `DATABASE_URL` uses a SQLite file (`STRATUM_DB_FILE`). PDF reports on the server need Chromium; the Docker image includes it.

## Running it

Needs Node.js 20 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine, database, P6 connector, server and report tests
npm run build      # production build in dist/
```

## Desktop app and installers

Stratum also ships as a desktop app (Electron). It runs the same code as the web version, works offline, and registers `.xer` and `.ifc` files so double-clicking one opens it in Stratum.

```bash
npm run desktop      # build and run the desktop app locally
npm run dist:win     # Windows installer  -> release/Stratum-4D-<version>-win-x64.exe
npm run dist:mac     # macOS disk image   -> release/Stratum-4D-<version>-mac-<arch>.dmg
npm run dist:linux   # Linux AppImage + .deb
```

Each installer has to be built on its own OS (or with Wine for Windows). The GitHub Actions workflow in `.github/workflows/desktop.yml` builds all three on native runners on every push, and attaches them to a draft GitHub Release when you push a `v*` tag.

The Windows installer lets the user pick the install folder and adds Start-menu and desktop shortcuts. Installers are **unsigned** for now, so Windows SmartScreen shows "Windows protected your PC" (click *More info → Run anyway*) and macOS needs right-click → *Open* the first time. Code-signing certificates remove both warnings.

Brand files live in `brand/`: the wordmark for light and dark backgrounds, and the app icon as SVG and 1024 px PNG. `build/icon.png` (installer and window icon) and `public/favicon.svg` are copies of the icon.

## Linking tips

- The quickest route is a shared key. If the model has a property holding the P6 Activity ID (for example `Pset_Stratum.ActivityID`, or an ArchiCAD/Revit shared parameter), one *equals* rule links the whole model.
- Zone- or storey-based schedules: give activities a P6 activity code (e.g. `Zone`) and match it to the IFC `Storey` or a zone property.
- One element can link to several activities, for example *install* under one task and *remove* under a later one. During playback, an active task takes precedence, then the most recently finished task, then the next task due to start.

## Layout

```
src/core/      schedule model, XER/MSPDI, CPM, EVM, progress weighting, reporting model, demo data
src/viewer/    three.js viewport and IFC loader
src/ui/        React UI: the three layouts, Gantt, timeline, dialogs, dashboards and widgets
src/backend/   where data lives: browser storage, desktop app, or Stratum Server
src/services/  database repository (SQLite/PostgreSQL), SMTP, Excel, report scheduler, P6 connectors
src/server/    Stratum Server (Fastify): API, sign-in and roles, PDF rendering
electron/      desktop shell and its local services
tests/         vitest tests
docs/          parity tracker and clean-room policy
```

## Known limits

- The CPM engine follows P6's default options (retained logic, finish float, predecessor-calendar lags). Progress override, resource levelling and multiple float paths are not implemented yet.
- Costs and quantities are spread linearly over each activity's elapsed time, so weekly figures can differ slightly from P6's calendar-weighted spread.
- XER export has been checked by re-importing into Stratum, not yet in a live P6 database: use P6's import preview the first time.
- Very large IFC files (hundreds of MB) still load slowly; GPU instancing and level-of-detail are planned.
- Video export is WebM only (browser MediaRecorder).
- The P6 EPPM connector has been tested against a mock of the documented REST API, and the P6 database reader against SQL Server 2022 and SQLite copies of the P6 schema. Try both against a test P6 database before production use.
- Oracle P6 databases use the same queries as SQL Server but have not been run against a live Oracle instance yet.

## Author

Stratum 4D was conceived, specified and directed by **Junaid Quamar**, Senior Planning Engineer (Primavera P6 project controls and cost engineering for HV substation, transmission and rail electrification projects). The feature set, priorities and planning workflows come from Junaid's project-controls practice.

- LinkedIn: https://www.linkedin.com/in/junaidquamar/

## Licence

Proprietary. Copyright © 2026 Junaid Quamar. All rights reserved. Third-party libraries keep their own licences (three.js MIT, web-ifc MPL-2.0, React MIT, zustand MIT).
