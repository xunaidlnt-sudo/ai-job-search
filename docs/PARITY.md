# Feature parity tracker

Stratum aims to match the functional scope of SYNCHRO 4D Pro. This file tracks where each feature stands.

Ground rules (see also [CLEAN_ROOM.md](CLEAN_ROOM.md)):

- The inventory below comes from public material only: Bentley's product pages, published course outlines and tutorial titles, and press coverage. Nothing comes from decompiling, disassembling or inspecting SYNCHRO binaries or file formats.
- Stratum's code, UI, icons, names and file format are its own.
- The list is not complete. Bentley does not publish a full feature matrix per edition, so some features are missing here and some entries are thin. Add to it from official documentation as it becomes available, with the source.

Status: **Done** (in Stratum now), **Partial** (some of it works), **Planned** (with target phase).

## 4D modelling and simulation

| Feature (public description) | Source | Stratum | Notes |
|---|---|---|---|
| Link 3D model elements to schedule tasks | [1] | **Done** | Manual linking from a 3D selection, plus rule-based auto-linking |
| Play the 4D sequence; scrub by date | [2] | **Done** | Play/pause, step day/week, speed 1–60 days/s, slider |
| Appearance profiles: Install, Remove, Temporary, Maintain, Neutral | [3] | **Done** | Before/during/after: visibility, colour, transparency. Editable, duplicable |
| Custom appearance profiles and colour legend | [3] | **Done** | Profiles tab; legend in Display tab |
| Growth simulation (element appears progressively during the task) | [3] | **Partial** | Progressive fade by task %. Directional growth (bottom-up, along an axis) planned for Phase 2 |
| Export 4D sequence as video | [2] | **Done** | WebM from the viewport. MP4 and camera paths in Phase 2 |
| Snapshots / images | [2] | **Done** | PNG export |
| Define work areas / zones | [1] | **Partial** | Zones can drive linking via activity codes and IFC properties. Drawn 3D work-area volumes: Phase 2 |
| Break design models into constructible components | [1] | **Planned (Phase 3)** | Split slabs/walls into pours and bays |
| 3D paths for moving resources (cranes, equipment) over time | [4] | **Planned (Phase 2)** | Keyframed paths along a task's duration |
| Resource groups | [5] | **Planned (Phase 2)** | |
| User fields on tasks/resources | [5] | **Planned (Phase 2)** | |
| Baseline vs current comparison | [6] | **Done** | Simulate either date set. Status colouring flags late work against baseline |

## Scheduling

| Feature | Source | Stratum | Notes |
|---|---|---|---|
| Import Primavera P6 schedules | [1] | **Done** | XER: projects, WBS, activities, relationships, activity codes, actuals, baseline (target) dates, float, driving path |
| Import Microsoft Project / Asta | [1] | **Planned (Phase 2)** | MSPDI XML first |
| Gantt chart with WBS | [1] | **Done** | Collapsible WBS, baseline bars, progress, critical, data date, zoom |
| Model-based scheduling (create and edit tasks in the tool) | [1] | **Planned (Phase 3)** | Needs Stratum's own CPM engine |
| CPM scheduling engine (logic, calendars, constraints, float) | [1] | **Planned (Phase 3)** | Built from first principles; P6 dates used until then |
| Export schedule back to P6 | — | **Planned (Phase 3)** | XER/XML write-back of updated progress |

## Resources, cost and progress

| Feature | Source | Stratum | Notes |
|---|---|---|---|
| Resource-loaded schedules (labour, material, equipment) | [6] | **Planned (Phase 4)** | Import P6 TASKRSRC first |
| Track resource status and actual resource usage | [2] | **Planned (Phase 4)** | |
| Assign resource costs; track actual cost | [2] | **Planned (Phase 4)** | |
| Earned value graph; cost roll-up by WBS | [2] | **Planned (Phase 4)** | PV/EV/AC, SPI/CPI, S-curves |
| Quantity tracking plots | [6] | **Planned (Phase 4)** | Quantities from IFC quantity sets (already read on import) |
| Earned value KPIs and reports from field data | [7] | **Planned (Phase 5)** | |

## Collaboration and field

| Feature | Source | Stratum | Notes |
|---|---|---|---|
| Cloud collaboration and review | [8] | **Planned (Phase 5)** | Shared projects and review links |
| Field progress capture | [7] | **Planned (Phase 5)** | Mobile web view to record progress against tasks |

## Platform

| Item | Stratum |
|---|---|
| Web app | **Done** |
| Desktop app (Windows/macOS/Linux) | **Done**: Electron app; Windows NSIS installer, macOS DMG, Linux AppImage/deb; opens .xer/.ifc from Explorer/Finder. Unsigned until certificates are bought |
| Project file | **Done**: `.stratum.json` (schedule, links, rules, profiles). Links re-match the model by IFC GlobalId |
| IFC model import | **Done**: IFC2x3 / IFC4 via web-ifc; properties, quantities and storeys are read for linking |

## User feedback

Public reviews of SYNCHRO and write-ups on 4D practice point to recurring pain points. These shaped features beyond straight parity:

| Feedback (paraphrased) | Source | Stratum response |
|---|---|---|
| Importing, syncing and updating data is difficult | [9], [10] | **Done**: XER re-import as an update; links kept by Activity ID; change report in the Check tab |
| Links break when the project changes; manual linking is error-prone | [11] | **Done**: link health check; IFC re-import keeps links by GlobalId |
| Linking is heavy manual work | [11] | **Done**: auto-detect rules from model properties |
| Steep learning curve; features hard to find from menus | [9], [10] | **Done**: getting-started guide, keyboard shortcuts. More in-context help planned |
| Crashes and startup failures | [12] | **Done**: autosave and restore. Running in the browser avoids installs and antivirus conflicts |
| Struggles with large models | [10] | **Planned (Phase 2)**: instanced/merged rendering, level-of-detail |
| Expensive for small firms | [9] | Pricing decision, outside the code |

Reviews are a mix of verified, trial and incentivised users; treat them as signals, not measurements.

## Sources

1. Bentley, SYNCHRO 4D product page: https://www.bentley.com/software/synchro/
2. SYNCHRO Pro at-a-glance sheet (via search summary): resource tracking, 4D playback and video export, cost tracking, earned value graph, WBS cost roll-up
3. Course and tutorial material on appearance profiles, e.g. LinkedIn Learning "Creating custom appearance profiles": https://www.linkedin.com/learning/synchro-4d-visual-scheduling/creating-custom-appearance-profiles ; Ingeoexpert course outline: https://ingeoexpert.com/en/courses-online/4d-planning-and-simulation-with-synchro-4d-pro/
4. LinkedIn Learning "Resource simulations using 3D paths": https://www.linkedin.com/learning/synchro-4d-visual-scheduling/resource-simulations-using-3d-paths
5. Course outlines listing resource groups and user fields (Udemy / Ingeoexpert, links above and https://www.udemy.com/course/synchro-4d-pro-planning-and-4d-simulation-english/)
6. User review summaries on Capterra: https://www.capterra.mx/software/35289/synchro
7. Bentley, SYNCHRO Perform (field progress, earned value KPIs), linked from the SYNCHRO product page
8. Bentley Communities wiki, "Features – SYNCHRO 4D Pro": https://communities.bentley.com/products/construction/w/construction__wiki/52264/features---synchro-4d-pro
9. Capterra reviews: https://www.capterra.com/p/35289/Synchro/reviews/ and Software Advice: https://www.softwareadvice.com/product/6302-Synchro/
10. G2 reviews: https://www.g2.com/products/synchro-construction/reviews
11. Elecosoft, "The future of model-based planning": https://eleco.com/news/future-model-based-planning/
12. Bentley knowledge base articles on crashes and performance, e.g. https://bentleysystems.service-now.com/community?id=kb_article&sysparm_article=KB0017792
