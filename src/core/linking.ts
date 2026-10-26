// Linking model elements to schedule activities, by rules or by hand.

import type { Activity, Link, LinkMatch, LinkRule, ModelElement, Schedule } from "./types";

export function activityFieldValue(activity: Activity, field: string, schedule: Schedule): string | null {
  if (field === "code") return activity.code;
  if (field === "name") return activity.name;
  if (field === "wbs") {
    const node = schedule.wbs.find((w) => w.id === activity.wbsId);
    return node ? node.code : null;
  }
  if (field.startsWith("code:")) return activity.codes[field.slice(5)] ?? null;
  if (field.startsWith("user:")) return activity.userFields?.[field.slice(5)] ?? null;
  return null;
}

export function elementPropertyValue(element: ModelElement, key: string): string | null {
  if (key === "Name") return element.name;
  if (key === "IfcType") return element.ifcType;
  if (key === "GlobalId") return element.id;
  return element.properties[key] ?? null;
}

function matches(elementValue: string, activityValue: string, mode: LinkMatch, caseSensitive: boolean): boolean {
  const a = caseSensitive ? elementValue.trim() : elementValue.trim().toLowerCase();
  const b = caseSensitive ? activityValue.trim() : activityValue.trim().toLowerCase();
  if (!a || !b) return false;
  switch (mode) {
    case "equals":
      return a === b;
    case "contains":
      return a.includes(b);
    case "startsWith":
      return a.startsWith(b);
  }
}

/**
 * Apply link rules. Each rule compares one element property against one activity
 * field. "equals" rules use a lookup table, so large models stay fast.
 */
export function applyRules(rules: LinkRule[], elements: ModelElement[], schedule: Schedule): Link[] {
  const out: Link[] = [];
  const linkable = schedule.activities.filter((a) => a.type !== "wbs-summary" && a.type !== "loe");
  for (const rule of rules) {
    if (rule.match === "equals") {
      const index = new Map<string, Activity[]>();
      for (const act of linkable) {
        const v = activityFieldValue(act, rule.activityField, schedule);
        if (!v) continue;
        const key = rule.caseSensitive ? v.trim() : v.trim().toLowerCase();
        const list = index.get(key) ?? [];
        list.push(act);
        index.set(key, list);
      }
      for (const el of elements) {
        const v = elementPropertyValue(el, rule.elementProperty);
        if (!v) continue;
        const key = rule.caseSensitive ? v.trim() : v.trim().toLowerCase();
        for (const act of index.get(key) ?? []) out.push({ elementId: el.id, activityId: act.id, profileId: rule.profileId });
      }
    } else {
      const values = linkable
        .map((act) => [act, activityFieldValue(act, rule.activityField, schedule)] as const)
        .filter((p): p is readonly [Activity, string] => !!p[1]);
      for (const el of elements) {
        const v = elementPropertyValue(el, rule.elementProperty);
        if (!v) continue;
        for (const [act, av] of values) {
          if (matches(v, av, rule.match, rule.caseSensitive)) out.push({ elementId: el.id, activityId: act.id, profileId: rule.profileId });
        }
      }
    }
  }
  return dedupeLinks(out);
}

export function dedupeLinks(links: Link[]): Link[] {
  const seen = new Set<string>();
  const out: Link[] = [];
  for (const l of links) {
    const k = `${l.elementId}|${l.activityId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

/** Merge new links over existing ones. A new link to the same element/activity pair replaces the old profile. */
export function mergeLinks(existing: Link[], added: Link[]): Link[] {
  const map = new Map<string, Link>();
  for (const l of existing) map.set(`${l.elementId}|${l.activityId}`, l);
  for (const l of added) map.set(`${l.elementId}|${l.activityId}`, l);
  return [...map.values()];
}

export function unlink(links: Link[], elementIds: Set<string>, activityId?: string): Link[] {
  return links.filter((l) => !(elementIds.has(l.elementId) && (activityId === undefined || l.activityId === activityId)));
}

export interface RuleSuggestion {
  elementProperty: string;
  activityField: string;
  /** Elements whose property value exactly matches an activity's field (case-insensitive). */
  elementMatches: number;
  /** Distinct activities hit. */
  activityMatches: number;
}

/**
 * Look for a property that already carries schedule keys. For each element
 * property and activity field pair, count exact (case-insensitive) matches and
 * return the best pairs. This turns the usual "which parameter holds the
 * activity ID?" hunt into one click.
 */
export function suggestRules(elements: ModelElement[], schedule: Schedule, limit = 5): RuleSuggestion[] {
  const linkable = schedule.activities.filter((a) => a.type !== "wbs-summary" && a.type !== "loe");
  const fields = activityFields(schedule).map((f) => f.value);
  const fieldIndex = new Map<string, Map<string, Set<string>>>();
  for (const f of fields) {
    const idx = new Map<string, Set<string>>();
    for (const a of linkable) {
      const v = activityFieldValue(a, f, schedule)?.trim().toLowerCase();
      if (!v) continue;
      const set = idx.get(v) ?? new Set<string>();
      set.add(a.id);
      idx.set(v, set);
    }
    if (idx.size) fieldIndex.set(f, idx);
  }
  const out: RuleSuggestion[] = [];
  for (const key of propertyKeys(elements)) {
    if (key === "GlobalId") continue;
    for (const [field, idx] of fieldIndex) {
      let elementMatches = 0;
      const acts = new Set<string>();
      for (const el of elements) {
        const v = elementPropertyValue(el, key)?.trim().toLowerCase();
        if (!v) continue;
        const hit = idx.get(v);
        if (hit) {
          elementMatches++;
          for (const id of hit) acts.add(id);
        }
      }
      if (elementMatches > 0) out.push({ elementProperty: key, activityField: field, elementMatches, activityMatches: acts.size });
    }
  }
  // Prefer pairs that spread across many activities; a single activity matching everything is rarely useful.
  out.sort((a, b) => b.activityMatches - a.activityMatches || b.elementMatches - a.elementMatches);
  return out.slice(0, limit);
}

/** All distinct property keys across elements, for rule-builder dropdowns. */
export function propertyKeys(elements: ModelElement[]): string[] {
  const keys = new Set<string>(["Name", "IfcType", "GlobalId"]);
  for (const el of elements) for (const k of Object.keys(el.properties)) keys.add(k);
  return [...keys].sort((a, b) => a.localeCompare(b));
}

export function activityFields(schedule: Schedule | null): { value: string; label: string }[] {
  const base = [
    { value: "code", label: "Activity ID" },
    { value: "name", label: "Activity Name" },
    { value: "wbs", label: "WBS Code" },
  ];
  if (!schedule) return base;
  const types = new Set<string>();
  const user = new Set<string>();
  for (const a of schedule.activities) {
    for (const t of Object.keys(a.codes)) types.add(t);
    for (const t of Object.keys(a.userFields ?? {})) user.add(t);
  }
  return [
    ...base,
    ...[...types].sort().map((t) => ({ value: `code:${t}`, label: `Activity Code: ${t}` })),
    ...[...user].sort().map((t) => ({ value: `user:${t}`, label: `User Field: ${t}` })),
  ];
}
