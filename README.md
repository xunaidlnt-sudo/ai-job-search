<p align="center"><img src="brand/stratum-logo.png" alt="Stratum 4D" width="420"></p>

# Stratum 4D

Stratum links a Primavera P6 schedule to an IFC building model and plays back the construction sequence over time. It runs in the browser; a desktop build is planned.

Release 0.2 covers phases 1 to 4 of the roadmap:

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

## Running it

Needs Node.js 20 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for the XER parser, linking and simulation engine
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
src/core/      schedule model, XER parser, linking rules, profiles, simulation, project file, demo data
src/viewer/    three.js viewport and IFC loader
src/ui/        React UI: Gantt, timeline, side panel, toolbar
tests/         vitest unit tests
docs/          parity tracker and clean-room policy
```

## Known limits

- The CPM engine follows P6's default options (retained logic, finish float, predecessor-calendar lags). Progress override, resource levelling and multiple float paths are not implemented yet.
- Costs and quantities are spread linearly over each activity's elapsed time, so weekly figures can differ slightly from P6's calendar-weighted spread.
- XER export has been checked by re-importing into Stratum, not yet in a live P6 database: use P6's import preview the first time.
- Very large IFC files (hundreds of MB) still load slowly; GPU instancing and level-of-detail are planned.
- Video export is WebM only (browser MediaRecorder).

## Licence

Proprietary; all rights reserved. Third-party libraries keep their own licences (three.js MIT, web-ifc MPL-2.0, React MIT, zustand MIT).
