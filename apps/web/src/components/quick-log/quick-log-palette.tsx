import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { DueSupplement, RecentLogEntry } from "@openvalens/api/contracts/quick-log";
import type { DiaryEntry, FoodChoice, MealSlot } from "@openvalens/api/contracts/nutrition-diary";
import { candidateFromChoice, defaultFoodPortion } from "@openvalens/api/presenters/food-lookup";
import {
  availableLogKinds,
  findLogKind,
  LOG_KINDS,
  logKindPermissionCheck,
  type LogKind,
} from "@openvalens/api/presenters/log-kinds";
import { parseOneLiner, type OneLinerSupplement } from "@openvalens/api/presenters/one-liner";
import { trackerLogKinds } from "@openvalens/api/presenters/trackers";
import {
  deviceTimeZone,
  localDateIn,
  mealSlotForLocalTime,
  newClientMutationId,
  shiftLocalDate,
} from "@openvalens/api/presenters/nutrition-diary";
import {
  buildQuickLogWrite,
  hasQuickForm,
  quickFormDefaults,
  quickLogWriteValue,
  recentEntryTitle,
  recentEntryValue,
  repeatRecentEntry,
  type QuickLogWrite,
} from "@openvalens/api/presenters/quick-log";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@openvalens/ui/components/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@openvalens/ui/components/dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ToneIcon } from "@/components/page";
import { useEnabledModules } from "@/utils/modules";
import { client, orpc } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";
import { enqueueMetricSample } from "@/utils/sync-engine";

import { buildOneLinerSection, paletteFilter, paletteItemValue } from "./one-liner-section";
import { buildPaletteSections, type PaletteNavGroup } from "./palette-sections";
import { performQuickLogWrite } from "./perform-write";
import { QuickForm, type SupplementOption } from "./quick-form";

/** How long the undo toast stays (#440: about 6 s). */
export const UNDO_TOAST_MS = 6_000;

const COPY = {
  title: msg`Log or go to`,
  description: msg`Log something in a tap, repeat a recent entry or open a screen.`,
  placeholder: msg`Log “500 ml water” or go to a screen…`,
  empty: msg`Nothing matches.`,
  saved: msg`Saved: {what}`,
  savedOffline: msg`Saved on this device: {what}. It syncs when you are back online.`,
  undo: msg`Undo`,
  edit: msg`Open`,
  undone: msg`Removed: {what}`,
  undoFailed: msg`Could not remove it. Open the screen to change it.`,
  failed: msg`Could not save. Try again.`,
  copied: msg({ message: "{count, plural, one {Copied # item} other {Copied # items}}" }),
};

/** ⌘K on a Mac, Ctrl+K elsewhere, toggles the palette. */
export function useQuickLogHotkey(toggle: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle, enabled]);
}

type View = { type: "list" } | { type: "form"; kind: LogKind; preset?: Record<string, string> };

/**
 * The quick log command palette (#440): due supplements with one-tap "Taken",
 * recent entries to repeat, food favourites / recents / copy yesterday, every
 * kind the member can log (a quick form, or the full screen for drafts),
 * custom trackers (#441), and the app's screens. Turned-off features never
 * appear. Typed one-liners (#440d) show a preview of what was understood at
 * the top ("Water · 500 ml · now"); Enter logs it.
 */
export function QuickLogPalette({
  open,
  onOpenChange,
  navGroups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  navGroups: readonly PaletteNavGroup[];
}) {
  const { i18n } = useLingui();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [view, setView] = useState<View>({ type: "list" });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const timeZone = useMemo(() => deviceTimeZone(), []);

  useEffect(() => {
    if (open) return;
    setView({ type: "list" });
    setSearch("");
  }, [open]);

  // What the member can log: modules, preferences and role.
  const { enabled: enabledModules, isEnabled } = useEnabledModules();
  const me = useQuery({ ...orpc.sharing.me.queryOptions({ input: {} }), enabled: open });
  const water = useQuery({
    ...orpc.plainWater.getPreferences.queryOptions({ input: {} }),
    enabled: open && isEnabled("food"),
  });
  const privateBody = useQuery({
    ...orpc.privateBody.preference.queryOptions({ input: {} }),
    enabled: open && isEnabled("body"),
  });
  // Custom trackers (#441) join the same list as `tracker:<id>` kinds.
  const trackers = useQuery({
    ...orpc.trackers.list.queryOptions({ input: { timeZone } }),
    enabled: open,
  });
  const kinds = useMemo(
    () =>
      availableLogKinds(
        {
          enabledModules,
          preferences: {
            plain_water: water.data?.enabled === true,
            private_body: privateBody.data?.enabled === true,
          },
          can: logKindPermissionCheck(me.data?.role),
        },
        [...LOG_KINDS, ...trackerLogKinds(trackers.data ?? [])] as LogKind[],
      ),
    [enabledModules, water.data?.enabled, privateBody.data?.enabled, me.data?.role, trackers.data],
  );
  const has = (id: string) => kinds.some((kind) => kind.id === id);
  const canRecords = kinds.some((kind) => kind.permission.resource === "records");

  const recents = useQuery({
    ...orpc.quickLog.recents.queryOptions({ input: {} }),
    enabled: open && canRecords,
  });
  const due = useQuery({
    ...orpc.quickLog.supplementsDue.queryOptions({ input: { timeZone } }),
    enabled: open && has("supplement_intake"),
  });
  const today = localDateIn(timeZone);
  const foods = useQuery({
    ...orpc.nutritionDiary.listFoods.queryOptions({ input: {} }),
    enabled: open && has("food"),
  });
  const yesterday = useQuery({
    ...orpc.nutritionDiary.getDay.queryOptions({
      input: { localDate: shiftLocalDate(today, -1) },
    }),
    enabled: open && has("food"),
  });
  const supplements = useQuery({
    ...orpc.plans.listSupplements.queryOptions({ input: {} }),
    enabled: open && has("supplement_intake"),
  });
  // Food drafts (#73) take typed food when the member turned them on.
  const nutritionTargets = useQuery({
    ...orpc.nutritionTargets.get.queryOptions({ input: { localDate: today } }),
    enabled: open && has("food"),
  });
  const products = useProductSettings();
  const weightUnit = products.data?.units === "imperial" ? "lb" : "kg";

  const refresh = () => {
    for (const key of [
      orpc.healthRecord.key(),
      orpc.vitals.key(),
      orpc.activity.key(),
      orpc.body.key(),
      orpc.sleep.key(),
      orpc.plainWater.key(),
      orpc.supplementIntake.key(),
      orpc.nutritionDiary.key(),
      orpc.goals.key(),
      orpc.trackers.key(),
      orpc.quickLog.key(),
    ])
      void queryClient.invalidateQueries({ queryKey: key });
  };

  /** Toast after a save; the action undoes it, or opens the screen to change it. */
  const announce = (
    what: string,
    kind: LogKind | undefined,
    result: { undo?: () => Promise<void>; queued?: boolean },
  ) => {
    const message = result.queued
      ? i18n._({ ...COPY.savedOffline, values: { what } })
      : i18n._({ ...COPY.saved, values: { what } });
    const undo = result.undo;
    toast.success(message, {
      duration: UNDO_TOAST_MS,
      action: undo
        ? {
            label: i18n._(COPY.undo),
            onClick: () => {
              undo().then(
                () => {
                  toast(i18n._({ ...COPY.undone, values: { what } }));
                  refresh();
                },
                () => toast.error(i18n._(COPY.undoFailed)),
              );
            },
          }
        : kind
          ? { label: i18n._(COPY.edit), onClick: () => void navigate({ to: kind.paths.web }) }
          : undefined,
    });
  };

  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const save = async (write: QuickLogWrite, what: string, kind: LogKind | undefined) => {
    setSaving(true);
    setFailed(false);
    try {
      const result = await performQuickLogWrite(write, client, enqueueMetricSample);
      refresh();
      onOpenChange(false);
      announce(what, kind, result);
      return true;
    } catch {
      setFailed(true);
      toast.error(i18n._(COPY.failed));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const repeat = (entry: RecentLogEntry) => {
    const write = repeatRecentEntry(entry, { timeZone, newId: newClientMutationId });
    void save(
      write,
      `${recentEntryTitle(entry, i18n)} · ${recentEntryValue(entry, i18n)}`,
      findLogKind(entry.kind),
    );
  };

  const takeSupplement = (item: DueSupplement) => {
    const kind = findLogKind("supplement_intake")!;
    if (!item.dose) {
      setView({ type: "form", kind, preset: { supplement: String(item.supplementId) } });
      return;
    }
    void save(
      {
        type: "supplement",
        input: {
          supplementId: item.supplementId,
          occurredAt: new Date().toISOString(),
          timeZone,
          dose: item.dose,
          clientMutationId: newClientMutationId(),
        },
      },
      `${item.name} · ${item.dose}`,
      kind,
    );
  };

  const runFood = async (what: string, work: () => Promise<DiaryEntry[]>) => {
    setSaving(true);
    try {
      const created = await work();
      refresh();
      onOpenChange(false);
      announce(what, findLogKind("food"), {
        undo:
          created.length === 0
            ? undefined
            : async () => {
                for (const entry of created)
                  await client.nutritionDiary.deleteEntry({
                    clientMutationId: newClientMutationId(),
                    entryId: entry.id,
                    expectedRevision: entry.revision,
                  });
              },
      });
    } catch {
      toast.error(i18n._(COPY.failed));
    } finally {
      setSaving(false);
    }
  };

  const logFood = (food: FoodChoice) => {
    const portion = defaultFoodPortion(candidateFromChoice(food));
    void runFood(food.name, async () => {
      const result = await client.nutritionDiary.logEntry({
        clientMutationId: newClientMutationId(),
        localDate: today,
        timeZone,
        slot: mealSlotForLocalTime(),
        food: food.ref,
        amount: portion.amount,
        unit: portion.unit,
        method: "manual",
      });
      return result.created ? [result.entry] : [];
    });
  };

  const copyMeals = ({
    slot,
    entries,
  }: {
    slot: MealSlot | null;
    entries: readonly DiaryEntry[];
  }) => {
    void runFood(i18n._({ ...COPY.copied, values: { count: entries.length } }), async () => {
      const result = await client.nutritionDiary.copyDay({
        clientMutationId: newClientMutationId(),
        fromDate: shiftLocalDate(today, -1),
        toDate: today,
        timeZone,
        entryIds: entries.map((entry) => entry.id),
        ...(slot ? { targetSlot: slot } : {}),
      });
      return result.entries;
    });
  };

  const openKind = (kind: LogKind) => {
    if (hasQuickForm(kind)) {
      setView({ type: "form", kind });
      return;
    }
    onOpenChange(false);
    void navigate({ to: kind.paths.web });
  };

  const go = (to: string) => {
    onOpenChange(false);
    void navigate({ to });
  };

  const sections = buildPaletteSections(
    {
      kinds,
      recents: recents.data?.entries ?? [],
      due: due.data?.items ?? [],
      foods: foods.data ?? null,
      yesterday: (yesterday.data?.entries ?? []).filter((entry) => !entry.deleted),
      slot: mealSlotForLocalTime(),
      navGroups,
    },
    { repeat, takeSupplement, openKind, logFood, copyMeals, navigate: go },
    i18n,
  );

  const supplementOptions: SupplementOption[] | null = supplements.data
    ? supplements.data.map((item) => ({ id: item.id, name: item.name, dose: item.dose }))
    : null;

  // What the member typed, read as a one-liner (#440d).
  const oneLinerSupplements: OneLinerSupplement[] = supplementOptions ?? [];
  const oneLiner = parseOneLiner(search, {
    kinds,
    trackers: trackers.data ?? [],
    supplements: oneLinerSupplements,
    locale: i18n.locale,
    weightUnit,
    kindCounts: recents.data?.kindCounts,
    foodDrafts: nutritionTargets.data?.settings.voiceDraftsEnabled === true,
  });
  const typed = buildOneLinerSection(
    oneLiner,
    i18n,
    {
      timeZone,
      newId: newClientMutationId,
      locale: i18n.locale,
      weightUnit,
      supplements: oneLinerSupplements,
    },
    {
      logEntry: (entry, preview) => {
        if (preview.write) {
          void save(preview.write, `${preview.title} · ${preview.value}`, entry.kind);
          return;
        }
        setView({ type: "form", kind: entry.kind, preset: entry.values });
      },
      openWorkout: (text) => {
        onOpenChange(false);
        void navigate({ to: "/workouts", search: { log: text } });
      },
      openFood: (text, drafts) => {
        onOpenChange(false);
        void (drafts
          ? navigate({ to: "/food-draft", search: { text } })
          : navigate({ to: "/nutrition", search: { food: text } }));
      },
    },
  );
  const rows = typed ? [typed, ...sections] : sections;
  // Enter takes the preview: keep it selected as the text changes.
  const typedTop = typed?.items[0];
  const typedValue = typedTop && (typedTop.score ?? 0) >= 1 ? paletteItemValue(typedTop) : null;
  useEffect(() => {
    if (typedValue) setSelected(typedValue);
  }, [typedValue]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[10vh] translate-y-0 gap-0 overflow-hidden rounded-3xl border-rule bg-popover p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">{i18n._(COPY.title)}</DialogTitle>
        <DialogDescription className="sr-only">{i18n._(COPY.description)}</DialogDescription>
        {view.type === "form" ? (
          <QuickFormView
            key={view.kind.id}
            kind={view.kind}
            preset={view.preset}
            weightUnit={weightUnit}
            supplements={supplementOptions}
            saving={saving}
            failed={failed}
            timeZone={timeZone}
            onBack={() => {
              setFailed(false);
              setView({ type: "list" });
            }}
            onSave={save}
          />
        ) : (
          <Command
            loop
            label={i18n._(COPY.title)}
            filter={paletteFilter}
            value={selected}
            onValueChange={setSelected}
          >
            <CommandInput
              placeholder={i18n._(COPY.placeholder)}
              aria-label={i18n._(COPY.placeholder)}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>{i18n._(COPY.empty)}</CommandEmpty>
              {rows.map((section) => (
                <CommandGroup key={section.id} heading={section.heading}>
                  {section.items.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={paletteItemValue(item)}
                      keywords={[
                        item.label,
                        ...(item.detail ? [item.detail] : []),
                        ...(item.keywords ?? []),
                      ]}
                      disabled={saving}
                      onSelect={item.onSelect}
                    >
                      {item.tone ? (
                        <ToneIcon icon={item.icon} tone={item.tone} size="sm" />
                      ) : (
                        <item.icon aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {item.label}
                        {item.detail ? (
                          <span className="num text-ink-3"> · {item.detail}</span>
                        ) : null}
                      </span>
                      {item.hint ? (
                        <span className="ml-auto text-xs font-medium text-ink-3">{item.hint}</span>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        )}
      </DialogContent>
    </Dialog>
  );
}

function QuickFormView({
  kind,
  preset,
  weightUnit,
  supplements,
  saving,
  failed,
  timeZone,
  onBack,
  onSave,
}: {
  kind: LogKind;
  preset?: Record<string, string>;
  weightUnit: "kg" | "lb";
  supplements: readonly SupplementOption[] | null;
  saving: boolean;
  failed: boolean;
  timeZone: string;
  onBack: () => void;
  onSave: (write: QuickLogWrite, what: string, kind: LogKind) => Promise<boolean>;
}) {
  const { i18n } = useLingui();
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...quickFormDefaults(kind, new Date(), { weightUnit }),
    ...preset,
  }));
  const [showErrors, setShowErrors] = useState(false);
  const [mutationId] = useState(newClientMutationId);
  const parsed = buildQuickLogWrite(kind, values, {
    timeZone,
    locale: i18n.locale,
    // One id per open form, so a retried save cannot log twice.
    newId: () => mutationId,
    supplementDose: (id) => supplements?.find((item) => item.id === id)?.dose ?? null,
  });

  return (
    <QuickForm
      kind={kind}
      values={values}
      errors={parsed.ok ? [] : parsed.errors}
      showErrors={showErrors}
      supplements={kind.id === "supplement_intake" ? supplements : null}
      pending={saving}
      failed={failed}
      onChange={(id, value) => setValues((current) => ({ ...current, [id]: value }))}
      onBack={onBack}
      onSubmit={() => {
        if (!parsed.ok) {
          setShowErrors(true);
          return;
        }
        void onSave(
          parsed.write,
          `${i18n._(kind.label)} · ${quickLogWriteValue(parsed.write, kind, i18n, { weightUnit })}`,
          kind,
        );
      }}
    />
  );
}
