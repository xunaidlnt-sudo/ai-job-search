// Link health: find the gaps that make a 4D model misleading. These are
// activities with nothing to show, elements that never appear in the sequence,
// and links pointing at things that no longer exist.

import type { Activity, Link, ModelElement, Schedule } from "./types";

export interface LinkHealth {
  /** Work activities (not milestones, summaries or LOE) with no linked elements. */
  unlinkedActivities: Activity[];
  unlinkedElements: ModelElement[];
  /** Links whose activity is missing from the schedule. */
  orphanActivityLinks: Link[];
  /** Links whose element is missing from the loaded model. */
  orphanElementLinks: Link[];
  /** Elements linked to more than one activity using the same profile, which is often a double-count. */
  duplicateInstalls: { element: ModelElement; activities: Activity[] }[];
  coverage: { activities: number; elements: number };
}

const WORK_TYPES = new Set<Activity["type"]>(["task", "resource-dependent"]);

export function linkHealth(schedule: Schedule, elements: ModelElement[], links: Link[]): LinkHealth {
  const actById = new Map(schedule.activities.map((a) => [a.id, a]));
  const elById = new Map(elements.map((e) => [e.id, e]));
  const linkedActs = new Set<string>();
  const linkedEls = new Set<string>();
  const orphanActivityLinks: Link[] = [];
  const orphanElementLinks: Link[] = [];
  const installs = new Map<string, Set<string>>();

  for (const l of links) {
    const hasAct = actById.has(l.activityId);
    const hasEl = elById.has(l.elementId);
    if (!hasAct) orphanActivityLinks.push(l);
    if (!hasEl && elements.length > 0) orphanElementLinks.push(l);
    if (hasAct && hasEl) {
      linkedActs.add(l.activityId);
      linkedEls.add(l.elementId);
      if (l.profileId === "install") {
        const set = installs.get(l.elementId) ?? new Set<string>();
        set.add(l.activityId);
        installs.set(l.elementId, set);
      }
    }
  }

  const work = schedule.activities.filter((a) => WORK_TYPES.has(a.type));
  const unlinkedActivities = work.filter((a) => !linkedActs.has(a.id));
  const unlinkedElements = elements.filter((e) => !linkedEls.has(e.id));
  const duplicateInstalls = [...installs]
    .filter(([, acts]) => acts.size > 1)
    .map(([elId, acts]) => ({ element: elById.get(elId)!, activities: [...acts].map((id) => actById.get(id)!) }));

  return {
    unlinkedActivities,
    unlinkedElements,
    orphanActivityLinks,
    orphanElementLinks,
    duplicateInstalls,
    coverage: {
      activities: work.length ? (work.length - unlinkedActivities.length) / work.length : 1,
      elements: elements.length ? (elements.length - unlinkedElements.length) / elements.length : 1,
    },
  };
}
