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

Two sample projects show the whole workflow without any files:
- **220/33 kV GIS substation, Abu Dhabi** (fictional). It has an EPC schedule of 46 activities on a UAE 6-day calendar with public holidays, costs in AED, procurement of GIS and transformers, and a 202-element model of the GIS hall, transformer bays, control building, trenches and site works.
- **Small RC building.**

Load either from the empty workspace or the File menu. `samples/` has the RC demo as an XER and a small MS Project XML.

**User guide:** [docs/Stratum-4D-User-Guide.pdf](docs/Stratum-4D-User-Guide.pdf) (with screenshots, worked through the GIS substation example; written and credited to Junaid Quamar).

Planned work and how Stratum compares with SYNCHRO 4D Pro's public feature set are in [docs/PARITY.md](docs/PARITY.md). Development follows [docs/CLEAN_ROOM.md](docs/CLEAN_ROOM.md).

## Interface modes

The first time Stratum starts, a short setup asks which layout you want. All three share the same engine and data. The P6 and MS Project layouts are schedule-only and laid out like the originals; the 3D model, linking and playback live in the 4D layout. Switch at any time from the top bar or in **Settings → Interface**.

| Mode | Layout | Wording |
|---|---|---|
| **P6 style** | Laid out like P6 Professional's Activities window, schedule only (no 3D): title bar, menu bar (File, Edit, View, Project, Enterprise, Tools, Admin, Help), toolbar, Directory bar left, Command bar right, Layout and Filter bar, activity table and Gantt with coloured WBS bands, Activity Details tabs (General, Status, Resources, Predecessors, Successors, Codes) or a Resource / Activity Usage Profile below, P6-style status bar | Activity ID, Original/Remaining Duration, Schedule % Complete, Total Float, Data Date; actual dates marked "A"; blue actual, green remaining, red critical bars |
| **MS Project style** | Laid out like Microsoft Project's Gantt Chart view, schedule only (no 3D): green title bar, ribbon (File, Task, Resource, Report, Project, View) with groups, Timeline, Gantt Chart with row numbers, indicators, task mode, predecessors and resource names, optional Task Form, Tracking Gantt and Resource Usage views, status bar with zoom | ID, Task Name, Duration ("15 days"), Start ("Mon 05/10/26"), Status Date, Calculate Project |
| **4D style** | 3D model in the middle, Gantt on the left, linking tools on the right, timeline along the bottom | Task ID, Focus date, Reschedule |

**Switching and appearance.** The layout switch at the top right (P6 · Project · 4D) changes layout instantly; `Ctrl+Alt+1/2/3` does the same. The open project, selection and filters stay as they are. P6 uses light Windows-style chrome with blue actual, green remaining and red critical bars; MS Project a green title bar and ribbon with blue task bars and black summary brackets; 4D a graphite dark theme with the Stratum orange. The sun/moon button flips light and dark; **Settings → Interface** also has font, text size and density.

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

**Before you connect, and when it fails.** Stratum only makes outgoing HTTPS calls to P6, so nothing needs port forwarding on the Stratum side. The machine running Stratum must be able to reach the P6 server, the same way a browser reaches the P6 web client. **Test connection** checks each link in turn and says what to fix if one breaks:
- the address;
- the server name (DNS);
- the port;
- the certificate (expired, wrong name, or issued by a company authority this machine doesn't trust);
- the REST API path;
- sign-in (wrong password, or no API module access);
- project access (OBS).

**Copy report for IT** puts the result on the clipboard.

**Company certificates and proxies.**
- **Desktop app:** P6 calls go through Electron's network stack, so they trust the Windows / macOS certificate store and use the system proxy.
- **Stratum Server:** set `NODE_EXTRA_CA_CERTS` to a PEM file holding the company root certificate, and `HTTPS_PROXY` / `NO_PROXY` if P6 must be reached through a proxy.
- **Either:** paste the root certificate into **Company certificate** on the connection.

Passwords are stored encrypted: with the operating-system keychain in the desktop app, and with AES-GCM keyed by `STRATUM_SECRET` on the server. They are never sent back to the browser.

## Dashboards and reports

**Reports** sits in the top-bar switch next to P6 · Project · 4D (Ctrl+Alt+4) and opens a Power BI-style builder. Start from a template (Planning dashboard, EPC progress report, Project status), a blank page, your own saved templates or an imported dashboard file. Then click **Customise**:

- drag a card's title bar to move it and its corner to resize it (1–12 columns wide, half-row heights); duplicate, remove, undo and redo (Ctrl+Z / Ctrl+Y);
- a side panel with **Data** (measure, grouping, weighting, period, decimals, prefix/suffix, green and red limits), **Look** (accent colour, card background, filled or underlined title bar, card style, text size, alignment, line or shaded area, legend, which series to show) and **Filter** (limit one widget to a discipline or code value, follow or ignore the slicers);
- activity tables with your choice and order of columns, including any activity code, plus a default sort; readers can click headings to sort;
- **Page & theme**: Stratum, EPC report or Executive (dark) theme, main colour, background, card style, spacing, header and subtitle with `{project}` and `{datadate}`, company logo, footer, A4 landscape or portrait for the PDF;
- **More**: duplicate, save as template, export the dashboard as a file to share, delete.

Widgets:

- numbers: KPI tile, gauge (SPI, CPI, % complete against plan), key-figures table, status donut (progress status, float bands, critical share);
- charts: cost/labour S-curve, progress S-curve with period bars, one S-curve per phase (E, P, C…), plan vs actual by discipline, resource histogram, quantity curve;
- tables: activity table, milestone tracker (baseline vs forecast, days late, on track / at risk / late), 1–12 week look-ahead grouped by week, weighted progress table (Cum. BL Plan %, Cum. Actual %, Variance wrt BL) with a shaded **TOTAL** row, portfolio across all projects;
- layout: section banner, text note, image or logo, slicer buttons by discipline, package or any activity code.

Progress is weighted by budgeted cost, labour hours, duration or equally, and grouped by WBS level 1 or 2, any activity code or any user field. You can type your own weightage per group (e.g. General 3%, Engineering 7%, Procurement 50%, Construction 40%); the TOTAL row then uses those weights.

Every dashboard prints to PDF (A4, in the orientation set on the page) and exports to Excel (summary, progress table, progress S-curve, late and critical, 3-week look-ahead, all activities, S-curve data, weekly resources, portfolio).

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
