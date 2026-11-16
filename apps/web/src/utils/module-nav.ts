import type { MessageDescriptor } from "@lingui/core";
import { PERSON_MODULES, type PersonModule } from "@openvalens/api/presenters/modules";

import { NAV_GROUPS, type NavGroup } from "@/components/nav-links";
import { moduleForPath } from "@/utils/modules";

export type ModuleNavEntry = {
  module: PersonModule;
  /** The menu entries (and their sub-screens) hiding this module takes away. */
  hides: MessageDescriptor[];
};

export type ModuleNavGroup = { label: MessageDescriptor; modules: ModuleNavEntry[] };

/**
 * #settings-modules-3 — Settings › Modules under the sidebar's own headings
 * (Overview, Body, Daily, Care), each module where its first menu entry is,
 * with the entries it hides. Read from the sidebar, so the two can't drift.
 */
export function modulesByNavGroup(groups: readonly NavGroup[] = NAV_GROUPS): ModuleNavGroup[] {
  const hides = new Map<PersonModule, MessageDescriptor[]>();
  const home = new Map<PersonModule, number>();
  groups.forEach((group, index) => {
    for (const { children, ...link } of group.links) {
      for (const entry of [link, ...(children ?? [])]) {
        const module = moduleForPath(entry.to);
        if (!module) continue;
        if (!home.has(module)) home.set(module, index);
        const list = hides.get(module) ?? [];
        if (!list.some((label) => label.id === entry.label.id)) list.push(entry.label);
        hides.set(module, list);
      }
    }
  });

  const result: ModuleNavGroup[] = groups.map((group) => ({ label: group.label, modules: [] }));
  // Modules in the order their first entry appears in the menu.
  const ordered = [...home.entries()].sort((a, b) => a[1] - b[1]);
  for (const [module, index] of ordered) {
    result[index]!.modules.push({ module, hides: hides.get(module) ?? [] });
  }
  // A module with no menu entry still gets a switch, at the end.
  const missing = PERSON_MODULES.filter((module) => !home.has(module));
  if (missing.length > 0 && result.length > 0) {
    result[result.length - 1]!.modules.push(...missing.map((module) => ({ module, hides: [] })));
  }
  return result.filter((group) => group.modules.length > 0);
}
