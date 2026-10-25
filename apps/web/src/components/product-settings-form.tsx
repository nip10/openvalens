import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId } from "react";

import type { ProductLocale, ProductUnits } from "@openvalens/api/product-settings-contract";
import { formatDistanceMeters } from "@openvalens/api/presenters/activity";
import { formatKg } from "@openvalens/api/presenters/body";
import { formatProductDate } from "@openvalens/api/presenters/product-formatting";
import { Button } from "@openvalens/ui/components/button";
import { Label } from "@openvalens/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openvalens/ui/components/select";
import { Skeleton } from "@openvalens/ui/components/skeleton";

import { ErrorState, Section } from "@/components/page";
import {
  useProductSettingsForm,
  type ProductSettingsSnapshot,
  type ProductSettingsUpdateInput,
} from "@/utils/product-settings-form-state";

export type ProductSettingsReadState =
  | { status: "loading" }
  | { status: "error"; message?: string; onRetry: () => void }
  | { status: "ready"; snapshot: ProductSettingsSnapshot };

export type ProductSettingsFormProps = {
  ownerId: string;
  readState: ProductSettingsReadState;
  onSave: (payload: ProductSettingsUpdateInput) => Promise<ProductSettingsSnapshot>;
  onReloadLatest?: () => Promise<ProductSettingsSnapshot>;
};

const UNIT_OPTIONS: { value: ProductUnits; label: MessageDescriptor; hint: MessageDescriptor }[] = [
  {
    value: "metric",
    label: msg`Metric`,
    hint: msg({ message: "kg, kilometers", comment: "safety" }),
  },
  {
    value: "imperial",
    label: msg`Imperial`,
    hint: msg({ message: "lb, miles", comment: "safety" }),
  },
];

const PREVIEW_WEIGHT_KG = 100;
const PREVIEW_DISTANCE_METERS = 5000;
const PREVIEW_DATE = new Date(Date.UTC(2026, 0, 15, 14, 30));

function localeHint(locale: ProductLocale): string {
  return formatProductDate(
    PREVIEW_DATE,
    locale,
    { year: "numeric", month: "short", day: "numeric" },
    "UTC",
  );
}

const LOCALE_OPTIONS: { value: ProductLocale; label: MessageDescriptor; hint: string }[] = [
  { value: "en-US", label: msg`United States`, hint: localeHint("en-US") },
  { value: "en-GB", label: msg`United Kingdom`, hint: localeHint("en-GB") },
  { value: "en-CA", label: msg`Canada`, hint: localeHint("en-CA") },
  { value: "pt-PT", label: msg`Portugal`, hint: localeHint("pt-PT") },
];

export function ProductSettingsForm({
  ownerId,
  readState,
  onSave,
  onReloadLatest,
}: ProductSettingsFormProps) {
  if (readState.status === "loading") {
    return <LoadingCard />;
  }

  if (readState.status === "error") {
    return <ErrorCard message={readState.message} onRetry={readState.onRetry} />;
  }

  return (
    <ReadyForm
      ownerId={ownerId}
      snapshot={readState.snapshot}
      onSave={onSave}
      onReloadLatest={onReloadLatest}
    />
  );
}

function ReadyForm({
  ownerId,
  snapshot,
  onSave,
  onReloadLatest,
}: {
  ownerId: string;
  snapshot: ProductSettingsSnapshot;
  onSave: (payload: ProductSettingsUpdateInput) => Promise<ProductSettingsSnapshot>;
  onReloadLatest?: () => Promise<ProductSettingsSnapshot>;
}) {
  const form = useProductSettingsForm({
    ownerId,
    snapshot,
    onSave,
    onReloadLatest,
  });

  const unitsId = useId();
  const localeId = useId();
  const unitsHintId = useId();
  const localeHintId = useId();

  const unitOption = UNIT_OPTIONS.find((o) => o.value === form.draft.units);
  const localeOption = LOCALE_OPTIONS.find((o) => o.value === form.draft.locale);

  const isReadOnly = !form.baseline.canEdit;
  const isBusy = form.isBusy;
  const { t, i18n } = useLingui();
  const unitLabel = unitOption ? i18n._(unitOption.label) : undefined;
  const localeLabel = localeOption ? i18n._(localeOption.label) : undefined;

  return (
    <Section
      title={<Trans>Display defaults</Trans>}
      description={
        <Trans>
          Instance-wide defaults affect how weight, distance, dates, and times appear. Stored values
          stay in canonical kilograms and meters; manual entry stays unchanged.
        </Trans>
      }
      sheet
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.save();
        }}
        className="grid gap-6"
        aria-busy={isBusy}
      >
        <div className="grid gap-6 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor={unitsId} className="text-ink-3">
              <Trans>Units</Trans>
            </Label>
            <Select
              value={form.draft.units}
              onValueChange={(value) => form.setUnits(value as ProductUnits)}
              disabled={isReadOnly || isBusy}
            >
              <SelectTrigger id={unitsId} aria-describedby={unitsHintId}>
                <SelectValue aria-label={unitLabel}>{unitLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {UNIT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {i18n._(option.label)}{" "}
                    <span className="text-ink-3">({i18n._(option.hint)})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id={unitsHintId} className="text-sm text-ink-3">
              <Trans>Choose how weight and distance are displayed.</Trans>
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={localeId} className="text-ink-3">
              <Trans>Locale</Trans>
            </Label>
            <Select
              value={form.draft.locale}
              onValueChange={(value) => form.setLocale(value as ProductLocale)}
              disabled={isReadOnly || isBusy}
            >
              <SelectTrigger id={localeId} aria-describedby={localeHintId}>
                <SelectValue aria-label={localeLabel}>{localeLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {LOCALE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {i18n._(option.label)} <span className="text-ink-3">({option.hint})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id={localeHintId} className="text-sm text-ink-3">
              <Trans>Affects number, date, and time formatting. Language stays English.</Trans>
            </p>
          </div>
        </div>

        <div className="grid gap-1.5 border-t border-rule pt-4">
          <p className="text-sm font-medium text-ink-3">
            <Trans>Preview</Trans>
          </p>
          <p className="flex flex-wrap gap-x-6 gap-y-1 text-ink">
            <span className="num">
              {formatKg(PREVIEW_WEIGHT_KG, {
                units: form.draft.units,
                locale: form.draft.locale,
              })}
            </span>
            <span className="num">
              {formatDistanceMeters(PREVIEW_DISTANCE_METERS, {
                units: form.draft.units,
                locale: form.draft.locale,
              })}
            </span>
            <span>
              {formatProductDate(
                PREVIEW_DATE,
                form.draft.locale,
                {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                },
                "UTC",
              )}
            </span>
          </p>
        </div>

        {isReadOnly ? (
          <p className="text-sm text-ink-3">
            <Trans>You can view these settings but cannot edit them.</Trans>
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!form.canSave}>
              {form.status.tag === "saving" ? t`Saving…` : t`Save`}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={form.reset}
              disabled={isBusy || !form.isChanged}
            >
              <Trans>Reset</Trans>
            </Button>
          </div>
        )}

        <FormStatus status={form.status} isBusy={isBusy} onReloadLatest={form.reloadLatest} />
      </form>
    </Section>
  );
}

function FormStatus({
  status,
  isBusy,
  onReloadLatest,
}: {
  status: { tag: string; message?: MessageDescriptor };
  isBusy: boolean;
  onReloadLatest: () => Promise<void>;
}) {
  const { i18n } = useLingui();
  if (status.tag === "idle") return null;
  const message = status.message ? i18n._(status.message) : undefined;

  if (status.tag === "success") {
    return (
      <p role="status" aria-live="polite" className="text-sm text-success">
        {message}
      </p>
    );
  }

  if (status.tag === "error") {
    return (
      <p role="alert" aria-live="polite" className="text-sm text-destructive">
        {message}
      </p>
    );
  }

  if (status.tag === "conflict" || status.tag === "stale") {
    return (
      <div role="alert" aria-live="polite" className="border-t-2 border-destructive pt-3">
        <p className="text-sm text-destructive">{message}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => void onReloadLatest()}
          disabled={isBusy}
        >
          <Trans>Reload latest</Trans>
        </Button>
      </div>
    );
  }

  return null;
}

function LoadingCard() {
  return (
    <Section
      title={<Trans>Display defaults</Trans>}
      description={
        <Trans>Instance-wide defaults affect how weight, distance, dates, and times appear.</Trans>
      }
      sheet
    >
      <div className="grid gap-4">
        <Skeleton className="h-4 w-2/3" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
        <Skeleton className="h-9 w-1/3" />
      </div>
    </Section>
  );
}

function ErrorCard({ message, onRetry }: { message?: string; onRetry: () => void }) {
  const { t } = useLingui();
  return (
    <Section title={<Trans>Display defaults</Trans>}>
      <ErrorState
        title={message ?? t`Could not load display defaults.`}
        action={
          <Button type="button" variant="outline" onClick={onRetry}>
            <Trans>Retry</Trans>
          </Button>
        }
      />
    </Section>
  );
}
