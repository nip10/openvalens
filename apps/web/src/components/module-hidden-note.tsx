import { useLingui } from "@lingui/react";
import {
  MODULE_HIDDEN_LINK,
  MODULE_HIDDEN_NOTE,
  type PersonModule,
} from "@openvalens/api/presenters/modules";
import { Link } from "@tanstack/react-router";
import { EyeOff } from "lucide-react";

import { useModuleEnabled } from "@/utils/modules";

/** The note itself, for a module the person switched off. */
export function ModuleHiddenNoteView() {
  const { _ } = useLingui();
  return (
    <p
      role="note"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-paper-2 px-4 py-3 text-sm text-ink-2"
    >
      <EyeOff className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
      <span>{_(MODULE_HIDDEN_NOTE)}</span>
      <Link
        to="/settings/modules"
        className="font-medium text-signal underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {_(MODULE_HIDDEN_LINK)}
      </Link>
    </p>
  );
}

/**
 * A small note at the top of a hidden module's page. The page keeps working:
 * hiding a module only takes it out of the menu, dashboard, insights and
 * reminders. Renders nothing while the module is on (or the profile loads).
 */
export function ModuleHiddenNote({ module }: { module: PersonModule }) {
  return useModuleEnabled(module) ? null : <ModuleHiddenNoteView />;
}
