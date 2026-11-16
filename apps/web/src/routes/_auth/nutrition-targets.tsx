import type { NutritionTargetWire } from "@openvalens/api/contracts/nutrition-targets";
import { offlineScope } from "@openvalens/api/presenters/offline";
import {
  DIARY_COPY,
  NUTRIENT_LABELS,
  deviceTimeZone,
  localDateIn,
} from "@openvalens/api/presenters/nutrition-diary";
import {
  TARGET_COPY,
  TARGET_NUTRIENTS,
  formatHelpline,
  formatProteinReference,
  formatTarget,
  parseTargetForm,
  resolveHideNumbers,
} from "@openvalens/api/presenters/nutrition-targets";
import type { NutrientKey } from "@openvalens/api/contracts/nutrition-diary";
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Button, buttonVariants } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useId, useMemo, useState } from "react";
import {
  Beef,
  ChevronRight,
  Droplet,
  Gauge,
  Leaf,
  LifeBuoy,
  type LucideIcon,
  Plus,
  Settings2,
  Target,
  Wheat,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import { EnergyEstimateCard, HOW_WORKED_OUT } from "@/components/energy-estimate-card";
import { nativeSelectClass, textLinkClass } from "@/components/food-classes";
import { LogDialog } from "@/components/log-dialog";
import {
  Details,
  EmptyState,
  ErrorState,
  Page,
  PageHeader,
  Section,
  ToneIcon,
} from "@/components/page";
import { ModuleHiddenNote } from "@/components/module-hidden-note";
import { targetSince } from "@/utils/food-display";

const TARGET_ICONS: Partial<Record<NutrientKey, LucideIcon>> = {
  energyKcal: Zap,
  energyKj: Zap,
  proteinG: Beef,
  carbohydrateG: Wheat,
  fatG: Droplet,
  fiberG: Leaf,
};

type TargetNutrient = (typeof TARGET_NUTRIENTS)[number];

const PAGE_COPY = Object.freeze({
  addTarget: msg`Add target`,
  editTarget: msg`Edit target`,
  estimates: msg`Estimates`,
  estimatesNote: msg`General references worked out from your own records. They are not targets and never change one on their own.`,
  settingsLink: msg`Nutrition settings`,
  noEnergyTarget: msg`No energy target set`,
  noProteinTarget: msg`No protein target set`,
});

/**
 * Nutrition targets (Issue #80, nutrition-targets#0): the member's own
 * targets, then the energy estimate and protein reference beside them.
 * Targets are entered here or accepted from a #76 suggestion, never set by the
 * app; they are shown separately from what was logged, with no verdicts.
 * Display, About you and feature switches are in Settings › Nutrition.
 */
export const Route = createFileRoute("/_auth/nutrition-targets")({
  component: NutritionTargetsPage,
});

function networkFailure(retry: () => void, i18n: I18n) {
  toast.error(i18n._(TARGET_COPY.networkError), {
    action: { label: i18n._(DIARY_COPY.retry), onClick: retry },
  });
}

/** Which target the dialog edits: a new one, or the row that was tapped. */
type Editing = { kind: "new" } | { kind: "edit"; target: NutritionTargetWire } | null;

function NutritionTargetsPage() {
  const localDate = useMemo(() => localDateIn(deviceTimeZone()), []);
  const { data: session } = authClient.useSession();
  const scope = offlineScope(session as Parameters<typeof offlineScope>[0]);
  const queryClient = useQueryClient();
  const { t, i18n } = useLingui();
  const [editing, setEditing] = useState<Editing>(null);
  const overviewOptions = orpc.nutritionTargets.get.queryOptions({ input: { localDate } });
  const overviewKey = [...overviewOptions.queryKey, { offlineScope: scope }];
  const overview = useQuery({
    ...overviewOptions,
    queryKey: overviewKey,
    enabled: Boolean(scope),
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.nutritionTargets.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.nutritionDrinks.key() }),
    ]);

  const data = overview.data;
  // Unknown preferences fail closed: numbers stay hidden until the answer is in.
  const hideNumbers = overview.isSuccess ? resolveHideNumbers(data?.settings.hideNumbers) : true;
  const targetFor = (key: NutrientKey) => data?.targets.find((item) => item.nutrient === key);
  const energyTarget = targetFor("energyKcal");
  const proteinTarget = targetFor("proteinG");
  const energyOff = data?.safety.energyTargets === "off";

  return (
    <Page>
      <ModuleHiddenNote module="food" />
      <PageHeader
        title={i18n._(TARGET_COPY.title)}
        actions={
          <>
            <Link to="/settings/nutrition" className={buttonVariants({ variant: "ghost" })}>
              <Settings2 aria-hidden="true" />
              {i18n._(PAGE_COPY.settingsLink)}
            </Link>
            <Button onClick={() => setEditing({ kind: "new" })} disabled={!data}>
              <Plus aria-hidden="true" />
              {i18n._(PAGE_COPY.addTarget)}
            </Button>
          </>
        }
      />

      {overview.isPending ? (
        <div className="grid gap-8" aria-hidden="true">
          <Skeleton className="h-48 w-full rounded-3xl" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-40 w-full rounded-3xl" />
            <Skeleton className="h-40 w-full rounded-3xl" />
          </div>
        </div>
      ) : overview.isError || !data ? (
        <ErrorState
          title={i18n._(TARGET_COPY.networkError)}
          action={
            <Button variant="outline" onClick={() => void overview.refetch()}>
              {i18n._(DIARY_COPY.retry)}
            </Button>
          }
        />
      ) : (
        <>
          {data.support ? (
            <section
              role="note"
              aria-label={i18n._(TARGET_COPY.helplinesTitle)}
              className="sheet flex min-w-0 items-start gap-4 p-5 text-sm text-ink-2"
            >
              <LifeBuoy className="mt-0.5 size-5 shrink-0 text-ink-3" aria-hidden="true" />
              <div className="grid min-w-0 gap-2">
                <p className="text-ink">{data.support.text}</p>
                <ul className="grid gap-1">
                  {data.support.helplines.map((line) => (
                    <li key={line.name}>
                      {line.phone ? (
                        <a
                          className={textLinkClass}
                          href={`tel:${line.phone.replace(/[^+\d]/g, "")}`}
                        >
                          {formatHelpline(line)}
                        </a>
                      ) : (
                        <a
                          className={textLinkClass}
                          href={line.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {formatHelpline(line)}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          {data.notes.length > 0 ? (
            <ul className="grid gap-1 rounded-2xl bg-paper-2 px-4 py-3 text-sm text-ink-2">
              {data.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}

          {/* 1. Your targets: one row each; a tap opens the same dialog as Add target. */}
          <Section
            icon={Target}
            tone="food"
            title={i18n._(TARGET_COPY.yourTargets)}
            info={i18n._(TARGET_COPY.targetsNote)}
          >
            {data.targets.length === 0 ? (
              <EmptyState
                icon={Target}
                title={i18n._(TARGET_COPY.noTargets)}
                action={
                  <Button variant="outline" onClick={() => setEditing({ kind: "new" })}>
                    <Plus aria-hidden="true" />
                    {i18n._(PAGE_COPY.addTarget)}
                  </Button>
                }
              />
            ) : (
              <ul
                className="sheet grid min-w-0 divide-y divide-rule px-2 py-1"
                aria-label={i18n._(TARGET_COPY.yourTargets)}
              >
                {data.targets.map((target) => {
                  const name = i18n._(NUTRIENT_LABELS[target.nutrient].label);
                  return (
                    <li key={target.id}>
                      <button
                        type="button"
                        className="flex w-full cursor-pointer items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors duration-[var(--dur-short)] hover:bg-paper-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                        aria-label={t`Edit ${name} target`}
                        onClick={() => setEditing({ kind: "edit", target })}
                      >
                        <ToneIcon icon={TARGET_ICONS[target.nutrient] ?? Target} tone="food" />
                        <span className="grid min-w-0 flex-1 gap-0.5">
                          <span className="font-semibold text-ink">{name}</span>
                          <span className="text-sm text-ink-3">{targetSince(target, i18n)}</span>
                        </span>
                        <span className="num shrink-0 rounded-full bg-food-soft px-2.5 py-1 text-sm font-semibold text-ink">
                          {formatTarget(target, hideNumbers, i18n)}
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {/* 2. Estimates: energy and protein side by side, the method behind a disclosure. */}
          <Section
            icon={Gauge}
            tone="food"
            title={i18n._(PAGE_COPY.estimates)}
            info={
              <>
                <p>{i18n._(PAGE_COPY.estimatesNote)}</p>
                <p className="text-ink-3">{data.safety.policyVersion}</p>
              </>
            }
          >
            <div className="grid min-w-0 items-start gap-4 sm:grid-cols-2">
              <EnergyEstimateCard
                key={scope ?? "no-scope"}
                hideNumbers={!overview.isSuccess || hideNumbers}
                scope={scope}
                targetsQueryKey={overviewKey}
                height={{ cm: data.settings.heightCm, revision: data.settings.revision }}
                targetLine={
                  energyTarget
                    ? t`Your target: ${formatTarget(energyTarget, hideNumbers, i18n)}`
                    : i18n._(PAGE_COPY.noEnergyTarget)
                }
              />
              <ProteinCard
                reference={data.proteinReference}
                hideNumbers={hideNumbers}
                targetLine={
                  proteinTarget
                    ? t`Your target: ${formatTarget(proteinTarget, hideNumbers, i18n)}`
                    : i18n._(PAGE_COPY.noProteinTarget)
                }
              />
            </div>
          </Section>
        </>
      )}

      <TargetDialog
        editing={editing}
        onClose={() => setEditing(null)}
        hideNumbers={hideNumbers}
        energyOff={energyOff}
        existing={data?.targets ?? []}
        onChanged={() => void refresh()}
      />
    </Page>
  );
}

/** The protein reference (#76) as a headline, the member's own target, and how it is worked out. */
function ProteinCard({
  reference,
  hideNumbers,
  targetLine,
}: {
  reference: Parameters<typeof formatProteinReference>[0] | null;
  hideNumbers: boolean;
  targetLine: string;
}) {
  const { i18n } = useLingui();
  const id = useId();
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="sheet grid min-w-0 content-start gap-3 p-5 text-sm text-ink-2"
    >
      <div className="flex items-center gap-2.5">
        <ToneIcon icon={Beef} tone="food" size="sm" />
        <h3 id={`${id}-heading`} className="text-lg leading-tight text-ink">
          {i18n._(TARGET_COPY.proteinReferenceTitle)}
        </h3>
      </div>
      {reference ? (
        <div className="grid gap-1.5">
          <p className="num font-display text-2xl leading-tight font-medium text-ink">
            {formatProteinReference(reference, hideNumbers, i18n)}
          </p>
          <p>{targetLine}</p>
          <Details summary={i18n._(HOW_WORKED_OUT)}>
            <p className="text-ink-3">{i18n._(TARGET_COPY.proteinReferenceNote)}</p>
          </Details>
        </div>
      ) : (
        <p>{i18n._(TARGET_COPY.proteinReferenceUnavailable)}</p>
      )}
    </section>
  );
}

/**
 * Add or change one target (nutrition-targets#0): nutrient, minimum, maximum
 * and the day it applies from, with Clear for an existing one. Opened by
 * "Add target" and by a tap on a target's row.
 */
function TargetDialog({
  editing,
  onClose,
  hideNumbers,
  energyOff,
  existing,
  onChanged,
}: {
  editing: Editing;
  onClose: () => void;
  hideNumbers: boolean;
  energyOff: boolean;
  existing: readonly NutritionTargetWire[];
  onChanged: () => void;
}) {
  const { i18n } = useLingui();
  return (
    <LogDialog
      open={editing !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={i18n._(editing?.kind === "edit" ? PAGE_COPY.editTarget : PAGE_COPY.addTarget)}
    >
      {editing ? (
        <TargetForm
          key={editing.kind === "edit" ? editing.target.id : "new"}
          target={editing.kind === "edit" ? editing.target : null}
          hideNumbers={hideNumbers}
          energyOff={energyOff}
          existing={existing}
          onDone={() => {
            onChanged();
            onClose();
          }}
        />
      ) : null}
    </LogDialog>
  );
}

function Field({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-sm font-medium text-ink-3">
        {label}
      </Label>
      {children(id)}
    </div>
  );
}

function TargetForm({
  target,
  hideNumbers,
  energyOff,
  existing,
  onDone,
}: {
  target: NutritionTargetWire | null;
  hideNumbers: boolean;
  energyOff: boolean;
  existing: readonly NutritionTargetWire[];
  onDone: () => void;
}) {
  const { t, i18n } = useLingui();
  const choices = TARGET_NUTRIENTS.filter(
    (key) => !(energyOff && (key === "energyKcal" || key === "energyKj")),
  );
  const firstFree = choices.find((key) => !existing.some((item) => item.nutrient === key));
  const [nutrient, setNutrient] = useState<TargetNutrient>(
    (target?.nutrient as TargetNutrient | undefined) ?? firstFree ?? choices[0]!,
  );
  // Numbers stay out of the fields while they are hidden (#88).
  const start = (value: number | null | undefined) =>
    hideNumbers || value === null || value === undefined ? "" : String(value);
  const [min, setMin] = useState(start(target?.minAmount));
  const [max, setMax] = useState(start(target?.maxAmount));
  const [effectiveFrom, setEffectiveFrom] = useState(() => localDateIn(deviceTimeZone()));
  const [error, setError] = useState<MessageDescriptor | null>(null);
  const setTarget = useMutation(orpc.nutritionTargets.setTarget.mutationOptions());
  const clearTarget = useMutation(orpc.nutritionTargets.clearTarget.mutationOptions());

  const save = () => {
    const parsed = parseTargetForm(nutrient, { min, max, effectiveFrom }, i18n.locale);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    const send = () =>
      setTarget.mutate(parsed.input, {
        onSuccess: () => {
          toast.success(i18n._(TARGET_COPY.saved));
          onDone();
        },
        onError: () => networkFailure(send, i18n),
      });
    send();
  };

  const clear = () => {
    if (!target) return;
    const input = { nutrient: target.nutrient, effectiveTo: localDateIn(deviceTimeZone()) };
    const send = () =>
      clearTarget.mutate(input, {
        onSuccess: () => {
          toast.success(i18n._(TARGET_COPY.cleared));
          onDone();
        },
        onError: () => networkFailure(send, i18n),
      });
    send();
  };

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">{i18n._(TARGET_COPY.setTarget)}</legend>
        <div className="sm:col-span-2">
          <Field label={t`Nutrient`}>
            {(id) => (
              <select
                id={id}
                className={nativeSelectClass}
                value={nutrient}
                disabled={target !== null}
                onChange={(event) => setNutrient(event.target.value as TargetNutrient)}
              >
                {choices.map((key) => (
                  <option key={key} value={key}>
                    {i18n._(NUTRIENT_LABELS[key].label)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <Field label={i18n._(TARGET_COPY.minimum)}>
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              className="num"
              value={min}
              aria-label={
                hideNumbers ? t`Minimum (optional) (hidden)` : i18n._(TARGET_COPY.minimum)
              }
              onChange={(event) => setMin(event.target.value)}
            />
          )}
        </Field>
        <Field label={i18n._(TARGET_COPY.maximum)}>
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              className="num"
              value={max}
              aria-label={
                hideNumbers ? t`Maximum (optional) (hidden)` : i18n._(TARGET_COPY.maximum)
              }
              onChange={(event) => setMax(event.target.value)}
            />
          )}
        </Field>
        <Field label={i18n._(TARGET_COPY.effectiveFrom)}>
          {(id) => (
            <Input
              id={id}
              type="date"
              className="num"
              value={effectiveFrom}
              onChange={(event) => event.target.value && setEffectiveFrom(event.target.value)}
            />
          )}
        </Field>
      </fieldset>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {i18n._(error)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={setTarget.isPending}>
          {i18n._(setTarget.isPending ? TARGET_COPY.saving : TARGET_COPY.setTarget)}
        </Button>
        {target ? (
          <Button
            type="button"
            variant="ghost"
            className="text-ink-3 hover:text-destructive"
            onClick={clear}
            disabled={clearTarget.isPending}
          >
            <X aria-hidden="true" />
            {i18n._(TARGET_COPY.clearTarget)}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
