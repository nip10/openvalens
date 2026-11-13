import type { DrinkSummaryWire } from "@openvalens/api/contracts/nutrition-drinks";
import {
  DRINKS_COPY,
  caffeineReferenceNote,
  describeCaffeineReference,
  describeStandardDrink,
  drinkCoverageText,
  drinkPresetLabel,
  formatAlcoholTotal,
  formatCaffeineTotal,
  formatStandardDrinks,
} from "@openvalens/api/presenters/drinks";
import {
  DIARY_COPY,
  mealSlotForLocalTime,
  newClientMutationId,
} from "@openvalens/api/presenters/nutrition-diary";
import type { MealSlot } from "@openvalens/api/contracts/nutrition-diary";
import { useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CupSoda } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { textLinkClass } from "@/components/food-classes";
import { InfoTip, Section } from "@/components/page";
import { orpc } from "@/utils/orpc";

/**
 * Drinks (#443): presets that save a known catalog food at once in the
 * current meal, and the opt-in caffeine and alcohol day totals. Plain water
 * is not part of this section and is never added to anything here.
 */
export function DrinksSection({
  localDate,
  timeZone,
  hideNumbers,
  onSaved,
  announce,
}: {
  localDate: string;
  timeZone: string;
  hideNumbers: boolean;
  onSaved: (name: string, slot: MealSlot) => void;
  announce: (text: string) => void;
}) {
  const { i18n } = useLingui();
  const presets = useQuery(orpc.nutritionDrinks.presets.queryOptions({ input: {} }));
  const summary = useQuery(orpc.nutritionDrinks.summary.queryOptions({ input: { localDate } }));
  const log = useMutation(orpc.nutritionDiary.logEntry.mutationOptions());
  const [pending, setPending] = useState<string | null>(null);

  const available = presets.data?.presets.filter((entry) => entry.available) ?? [];

  const save = (entry: NonNullable<typeof presets.data>["presets"][number]) => {
    const slot = mealSlotForLocalTime();
    const name = drinkPresetLabel(entry.key, i18n);
    // Reused on retry, so a lost response cannot save the drink twice.
    const input = {
      clientMutationId: newClientMutationId(),
      localDate,
      timeZone,
      slot,
      food: { kind: "catalog" as const, id: entry.catalogId },
      amount: entry.amountG,
      unit: "g" as const,
      method: "preset" as const,
    };
    const send = () => {
      setPending(entry.key);
      log.mutate(input, {
        onSuccess: () => {
          setPending(null);
          onSaved(name, slot);
          void summary.refetch();
        },
        onError: () => {
          setPending(null);
          const message = i18n._(DRINKS_COPY.saveFailed);
          announce(message);
          toast.error(message, { action: { label: i18n._(DIARY_COPY.retry), onClick: send } });
        },
      });
    };
    send();
  };

  return (
    <Section
      icon={CupSoda}
      tone="food"
      sheet
      aria-labelledby="drinks-heading"
      title={<span id="drinks-heading">{i18n._(DRINKS_COPY.title)}</span>}
      info={i18n._(DRINKS_COPY.intro)}
    >
      <div className="grid min-w-0 gap-4">
        {presets.isPending ? (
          <Skeleton className="h-20 w-full rounded-3xl" />
        ) : available.length === 0 ? (
          <p className="text-sm text-ink-3">{i18n._(DRINKS_COPY.unavailable)}</p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label={i18n._(DRINKS_COPY.title)}>
            {available.map((entry) => (
              <li key={entry.key}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending !== null}
                  aria-busy={pending === entry.key}
                  onClick={() => save(entry)}
                >
                  {drinkPresetLabel(entry.key, i18n)}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {summary.data ? <DrinkTotals summary={summary.data} hideNumbers={hideNumbers} /> : null}
      </div>
    </Section>
  );
}

function SourceLink({ url }: { url: string }) {
  const { i18n } = useLingui();
  return (
    <a className={textLinkClass} href={url} rel="noreferrer" target="_blank">
      {i18n._(DRINKS_COPY.source)}
    </a>
  );
}

function DrinkTotals({
  summary,
  hideNumbers,
}: {
  summary: DrinkSummaryWire;
  hideNumbers: boolean;
}) {
  const { i18n } = useLingui();
  const { caffeine, alcohol } = summary;
  if (caffeine.status === "off" && alcohol.status === "off") return null;
  // Unknown or hidden preference fails closed: no amount reaches the page.
  if (hideNumbers || caffeine.status === "hidden" || alcohol.status === "hidden")
    return <p className="text-sm text-ink-3">{i18n._(DRINKS_COPY.hidden)}</p>;

  return (
    <div className="grid gap-3 rounded-2xl bg-paper-2 p-4 text-sm">
      <dl className="grid gap-3">
        {caffeine.status === "ready" ? (
          <div className="grid gap-1">
            <dt className="font-semibold text-ink">{i18n._(DRINKS_COPY.caffeine)}</dt>
            <dd className="flex flex-wrap items-center gap-x-2">
              <span className="num text-base text-ink">
                {formatCaffeineTotal(caffeine.total, i18n, false)}
              </span>
              {caffeine.total.atLeast ? <InfoTip>{i18n._(DRINKS_COPY.incomplete)}</InfoTip> : null}
            </dd>
            <dd className="text-ink-3">{i18n._(drinkCoverageText(caffeine.total))}</dd>
            {caffeine.reference ? (
              <dd className="text-ink-3">
                {describeCaffeineReference(caffeine.reference, i18n)}.{" "}
                <SourceLink url={caffeine.reference.url} />
              </dd>
            ) : caffeineReferenceNote(caffeine.referenceNote) ? (
              <dd className="text-ink-3">
                {i18n._(caffeineReferenceNote(caffeine.referenceNote)!)}
              </dd>
            ) : null}
          </div>
        ) : null}
        {alcohol.status === "ready" ? (
          <div className="grid gap-1">
            <dt className="font-semibold text-ink">{i18n._(DRINKS_COPY.alcohol)}</dt>
            <dd className="flex flex-wrap items-center gap-x-2">
              <span className="num text-base text-ink">
                {formatAlcoholTotal(alcohol.total, i18n, false)}
              </span>
              {formatStandardDrinks(alcohol, i18n, false) ? (
                <span className="num text-ink-2">
                  · {formatStandardDrinks(alcohol, i18n, false)}
                </span>
              ) : null}
              {alcohol.total.atLeast ? <InfoTip>{i18n._(DRINKS_COPY.incomplete)}</InfoTip> : null}
            </dd>
            <dd className="text-ink-3">{i18n._(drinkCoverageText(alcohol.total))}</dd>
            <dd className="text-ink-3">
              {alcohol.definition ? (
                <>
                  {describeStandardDrink(alcohol.definition, i18n)}.{" "}
                  <SourceLink url={alcohol.definition.url} />
                </>
              ) : (
                i18n._(DRINKS_COPY.noDefinition)
              )}
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="text-ink-3">{i18n._(DRINKS_COPY.notAdvice)}</p>
    </div>
  );
}
