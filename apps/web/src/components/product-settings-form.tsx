import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId } from "react";

import type { ProductLocale, ProductUnits } from "@openvalens/api/product-settings-contract";
import { formatDistanceMeters } from "@openvalens/api/presenters/activity";
import { formatKg } from "@openvalens/api/presenters/body";
import { formatProductDate } from "@openvalens/api/presenters/product-formatting";
import { Button } from "@openvalens/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";
import { Label } from "@openvalens/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openvalens/ui/components/select";
import { Skeleton } from "@openvalens/ui/components/skeleton";

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
    <Card className="mx-auto w-full max-w-3xl">
      <CardHeader>
        <CardTitle>
          <Trans>Display defaults</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Instance-wide defaults affect how weight, distance, dates, and times appear. Stored
            values stay in canonical kilograms and meters; manual entry stays unchanged.
          </Trans>
        </CardDescription>
      </CardHeader>

      <CardContent>
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
              <Label htmlFor={unitsId}>
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
                      <span className="text-muted-foreground">({i18n._(option.hint)})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p id={unitsHintId} className="text-xs text-muted-foreground">
                <Trans>Choose how weight and distance are displayed.</Trans>
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor={localeId}>
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
                      {i18n._(option.label)}{" "}
                      <span className="text-muted-foreground">({option.hint})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p id={localeHintId} className="text-xs text-muted-foreground">
                <Trans>Affects number, date, and time formatting. Language stays English.</Trans>
              </p>
            </div>
          </div>

          <div className="rounded-lg border p-4">
            <p className="text-sm font-medium">
              <Trans>Preview</Trans>
            </p>
            <p className="text-sm text-muted-foreground">
              {formatKg(PREVIEW_WEIGHT_KG, {
                units: form.draft.units,
                locale: form.draft.locale,
              })}
              {" · "}
              {formatDistanceMeters(PREVIEW_DISTANCE_METERS, {
                units: form.draft.units,
                locale: form.draft.locale,
              })}
              {" · "}
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
            </p>
          </div>

          {isReadOnly ? (
            <p className="text-sm text-muted-foreground">
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
      </CardContent>
    </Card>
  );
}

function FormStatus({
  status,
  isBusy,
  onReloadLatest,
}: {
  status: { tag: string; message?: string };
  isBusy: boolean;
  onReloadLatest: () => Promise<void>;
}) {
  if (status.tag === "idle") return null;

  if (status.tag === "success") {
    return (
      <p role="status" aria-live="polite" className="text-sm text-success">
        {status.message}
      </p>
    );
  }

  if (status.tag === "error") {
    return (
      <p role="alert" aria-live="polite" className="text-sm text-destructive">
        {status.message}
      </p>
    );
  }

  if (status.tag === "conflict" || status.tag === "stale") {
    return (
      <div role="alert" aria-live="polite" className="rounded-lg border border-destructive/50 p-3">
        <p className="text-sm text-destructive">{status.message}</p>
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
    <Card className="mx-auto w-full max-w-3xl">
      <CardHeader>
        <CardTitle>
          <Trans>Display defaults</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Instance-wide defaults affect how weight, distance, dates, and times appear.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-1/3" />
      </CardContent>
    </Card>
  );
}

function ErrorCard({ message, onRetry }: { message?: string; onRetry: () => void }) {
  const { t } = useLingui();
  return (
    <Card className="mx-auto w-full max-w-3xl">
      <CardHeader>
        <CardTitle>
          <Trans>Display defaults</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {message ?? t`Could not load display defaults.`}{" "}
          <button type="button" className="underline" onClick={onRetry}>
            <Trans>Retry</Trans>
          </button>
        </p>
      </CardContent>
    </Card>
  );
}
