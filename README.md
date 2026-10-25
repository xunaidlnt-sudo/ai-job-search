<p align="center"><img src="brand/stratum-logo.png" alt="Stratum 4D" width="420"></p>

# Stratum 4D

Stratum links a Primavera P6 schedule to an IFC building model and plays back the construction sequence over time. It runs in the browser; a desktop build is planned.

Phase 1 (this release) covers the core 4D workflow:

- **P6 XER import**: projects, WBS, activities, relationships, activity codes, actual dates, baseline (target) dates, % complete, total float and driving path. Multi-project XER files prompt for which project to load.
- **IFC import** (IFC2x3/IFC4 via web-ifc): geometry plus name, type, GlobalId, storey, property sets and quantity sets for every element.
- **Linking**: select elements in 3D (click, Shift/Ctrl-click, or select by any property value) and link them to the activity picked in the Gantt. Or write rules such as *`Pset.ActivityID` equals Activity ID* or *`Storey` equals Activity Code: Zone* and run them across the model.
- **Appearance profiles**: Install, Remove, Temporary, Maintain and Neutral, each with its own before / during / after visibility, colour and transparency. Profiles can be edited, duplicated and added.
- **4D playback**: play/pause, step by day or week, speed control, timeline slider, jump to data date. Space bar toggles playback.
- **Two simulation modes**: current schedule (actuals plus forecast) or baseline dates, coloured by profile or by status against baseline (not started / in progress / complete / late / critical).
- **Gantt**: collapsible WBS with rolled-up dates, baseline bars, progress, critical activities, milestones, data-date and playback lines, filter, zoom.
- **Output**: PNG snapshots and WebM video of the full sequence.
- **Project file**: `.stratum.json` holds the schedule, links, rules and profiles. Re-opening it with the same IFC re-matches links by GlobalId.

Added after reading user reviews of existing 4D tools (see [docs/PARITY.md](docs/PARITY.md#user-feedback)):

- **Weekly schedule updates**: import the new XER over the open project. Links carry across by Activity ID even if P6 internal ids change, and the **Check** tab lists finish slip, status/progress changes, and added or removed activities.
- **Link health check**: activities with nothing linked, elements never shown, elements installed by two activities, and broken links (with one-click clean-up).
- **Auto-detect linking rules**: scans every model property against Activity ID, name, WBS and activity codes, then offers the best matches as one-click rules.
- **Autosave and restore**: work is saved in the browser every few seconds; after a crash or closed tab Stratum offers to restore it.
- **Getting-started guide and shortcuts**: press `?`. Space plays, arrows step a day (Shift for a week), Home/End jump.

A built-in demo (two-storey RC frame with a 13-activity P6 schedule) shows the whole workflow without any files. Click **Load demo**.

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

## Known limits in Phase 1

- Schedule dates come from P6 as exported; Stratum does not reschedule yet (its own CPM engine is Phase 3).
- Large IFC files (hundreds of MB) load slowly because each element is drawn as its own mesh. Instanced/merged rendering is on the Phase 2 list.
- Video export is WebM only (browser MediaRecorder).
- Growth simulation is a progressive fade, not directional build-up.

## Licence

Proprietary; all rights reserved. Third-party libraries keep their own licences (three.js MIT, web-ifc MPL-2.0, React MIT, zustand MIT).
