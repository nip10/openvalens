import { useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { cn } from "@openvalens/ui/lib/utils";
import { Plus } from "lucide-react";
import {
  createContext,
  type ComponentType,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type LogTarget,
  type LogTargetKind,
  logTargetKey,
  logTargetLabel,
  resolveLogLaunch,
  routeLogTarget,
} from "./log-targets";

/**
 * The log "+" and its page API (DESIGN.md "Forms and logging").
 *
 * - `useLogTarget(target)`: point the "+" at something to log while the
 *   component is mounted, e.g. `{ kind: "food", date }` on the meal diary.
 *   Without one, the screen's default from `ROUTE_LOG_TARGETS` applies.
 * - `useLogDialog(kind, open)`: the page's own dialog for a kind the palette
 *   has no entry for (or a better one). The "+" and the palette's row for the
 *   kind call `open(target)` instead of the palette.
 * - `useOpenLog()`: a function any button can call to open the same thing as
 *   the "+", or a given target (`openLog({ kind: "food", meal: "lunch", date })`).
 */

export type PaletteRenderProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the palette starts; null for the full list. */
  target: LogTarget | null;
  /** Opens the page's own dialog for a kind; false when the page has none. */
  openPageDialog: (kindId: string) => boolean;
};

type DialogOpener = (target: LogTarget) => void;

/** Stable for the provider's life, so pages that register do not rerender. */
type LauncherActions = {
  open: (target?: LogTarget) => void;
  openPalette: (target: LogTarget | null) => void;
  togglePalette: () => void;
  setPageTarget: (id: string, target: LogTarget | null) => void;
  registerDialog: (kind: string, opener: { current: DialogOpener }) => () => void;
};

const noop = () => {};
// Without a provider (signed out, isolated tests) every call does nothing.
const ActionsContext = createContext<LauncherActions>({
  open: noop,
  openPalette: noop,
  togglePalette: noop,
  setPageTarget: noop,
  registerDialog: () => noop,
});
/** What the "+" logs on this screen now: the page's target, else the route's. */
const CurrentContext = createContext<LogTarget | null>(null);

/**
 * Holds the palette's state and what each page registered. The app shell
 * renders it around every screen and passes `pathname` for the route
 * defaults; `Palette` is the palette itself.
 */
export function LogLauncherProvider({
  pathname,
  Palette,
  children,
}: {
  pathname: string;
  Palette: ComponentType<PaletteRenderProps>;
  children: ReactNode;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteTarget, setPaletteTarget] = useState<LogTarget | null>(null);
  const [pageTargets, setPageTargets] = useState<readonly { id: string; target: LogTarget }[]>([]);
  // The newest registration for a kind wins, so a dialog opened on top of a page can take over.
  const dialogs = useRef(new Map<string, { current: DialogOpener }[]>());

  const current = pageTargets.at(-1)?.target ?? routeLogTarget(pathname);
  const currentRef = useRef(current);
  currentRef.current = current;

  const dialogFor = useCallback(
    (kind: string) => dialogs.current.get(kind)?.at(-1)?.current ?? null,
    [],
  );

  const openPalette = useCallback((target: LogTarget | null) => {
    setPaletteTarget(target);
    setPaletteOpen(true);
  }, []);

  const openRef = useRef(paletteOpen);
  openRef.current = paletteOpen;
  const togglePalette = useCallback(() => {
    if (!openRef.current) setPaletteTarget(null);
    setPaletteOpen(!openRef.current);
  }, []);

  const open = useCallback(
    (target?: LogTarget) => {
      const launch = resolveLogLaunch(target ?? currentRef.current, (kind) => !!dialogFor(kind));
      if (launch.type === "dialog") {
        setPaletteOpen(false);
        dialogFor(launch.target.kind)?.(launch.target);
        return;
      }
      openPalette(launch.target);
    },
    [dialogFor, openPalette],
  );

  const openPageDialog = useCallback(
    (kindId: string) => {
      const opener = dialogFor(kindId);
      if (!opener) return false;
      const here = currentRef.current;
      const target = (here?.kind === kindId ? here : { kind: kindId }) as LogTarget;
      setPaletteOpen(false);
      // After the palette has closed, so focus lands in the page's dialog.
      window.setTimeout(() => opener(target), 0);
      return true;
    },
    [dialogFor],
  );

  const setPageTarget = useCallback((id: string, target: LogTarget | null) => {
    setPageTargets((list) => {
      const rest = list.filter((entry) => entry.id !== id);
      return target ? [...rest, { id, target }] : rest;
    });
  }, []);

  const registerDialog = useCallback((kind: string, opener: { current: DialogOpener }) => {
    const map = dialogs.current;
    map.set(kind, [...(map.get(kind) ?? []), opener]);
    return () => {
      const left = (map.get(kind) ?? []).filter((entry) => entry !== opener);
      if (left.length > 0) map.set(kind, left);
      else map.delete(kind);
    };
  }, []);

  const actions = useMemo<LauncherActions>(
    () => ({ open, openPalette, togglePalette, setPageTarget, registerDialog }),
    [open, openPalette, togglePalette, setPageTarget, registerDialog],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <CurrentContext.Provider value={current}>
        {children}
        <Palette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          target={paletteTarget}
          openPageDialog={openPageDialog}
        />
      </CurrentContext.Provider>
    </ActionsContext.Provider>
  );
}

/** The launcher's actions, for the app shell (the sidebar "Log…" and ⌘K open the full list). */
export function useLogLauncher() {
  return useContext(ActionsContext);
}

/** What the "+" opens on this screen now, or null for the full palette. */
export function useCurrentLogTarget() {
  return useContext(CurrentContext);
}

/**
 * Points the "+" at `target` while the component is mounted; `null` leaves
 * the screen's default. The newest mounted target wins.
 */
export function useLogTarget(target: LogTarget | null) {
  const { setPageTarget } = useContext(ActionsContext);
  const id = useId();
  const key = logTargetKey(target);
  const latest = useRef(target);
  latest.current = target;
  useEffect(() => {
    setPageTarget(id, latest.current);
    return () => setPageTarget(id, null);
  }, [id, key, setPageTarget]);
}

/**
 * Registers the page's own dialog for `kind` while mounted. The "+" (when it
 * points at the kind), `useOpenLog()` and the palette's row for the kind call
 * `open(target)` instead of opening the palette. Pass `null` while the page
 * cannot log the kind (still loading, or the feature is off).
 */
export function useLogDialog(kind: LogTargetKind, open: ((target: LogTarget) => void) | null) {
  const { registerDialog } = useContext(ActionsContext);
  const opener = useRef<DialogOpener>(noop);
  opener.current = open ?? noop;
  const enabled = open !== null;
  useEffect(() => {
    if (!enabled) return;
    return registerDialog(kind, opener);
  }, [kind, enabled, registerDialog]);
}

/**
 * Opens what the "+" opens: with no argument the screen's current target, or
 * the given one. Use it for "+ Add" buttons that belong to a part of a page.
 */
export function useOpenLog(): (target?: LogTarget) => void {
  return useContext(ActionsContext).open;
}

/**
 * The round "+" at the bottom right of every signed-in screen, clear of the
 * phone's safe area. It opens the current target (see `useLogTarget`).
 */
export function LogFab({ className }: { className?: string }) {
  const { t, i18n } = useLingui();
  const current = useCurrentLogTarget();
  const { open } = useLogLauncher();
  const subject = logTargetLabel(current);
  const what = subject ? i18n._(subject) : null;
  const label = what ? t`Log: ${what}` : t`Log something`;
  return (
    <Button
      type="button"
      size="icon"
      data-log-fab=""
      aria-haspopup="dialog"
      aria-label={label}
      title={label}
      onClick={() => open()}
      className={cn(
        "fixed right-[max(1.25rem,calc(env(safe-area-inset-right)+1rem))] bottom-[max(1.25rem,calc(env(safe-area-inset-bottom)+1rem))] z-[var(--z-sticky-nav)] size-14 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 [&_svg:not([class*='size-'])]:size-6",
        className,
      )}
    >
      <Plus aria-hidden="true" />
    </Button>
  );
}
