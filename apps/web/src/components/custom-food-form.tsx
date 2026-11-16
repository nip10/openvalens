import type { CustomFood } from "@openvalens/api/contracts/nutrition-custom-foods";
import { AMOUNT_UNITS, type AmountUnit } from "@openvalens/api/contracts/nutrition-diary";
import {
  CUSTOM_FOOD_COPY,
  CUSTOM_FOOD_NUTRIENTS,
  EMPTY_CUSTOM_FOOD_FIELDS,
  describeBasis,
  describeCoverage,
  fieldsFromCustomFood,
  nutrientFieldLabel,
  parseCustomFood,
  type CustomFoodFields,
} from "@openvalens/api/presenters/custom-foods";
import { UNIT_LABELS, newClientMutationId } from "@openvalens/api/presenters/nutrition-diary";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Archive, Check } from "lucide-react";
import { toast } from "sonner";

import { nativeSelectClass } from "@/components/food-classes";
import { orpc } from "@/utils/orpc";

/**
 * The create/edit form for one of the member's custom foods (Issue #81), used
 * in a dialog by My foods and by New recipe's "Save as a food"
 * (recipe-drafts#3). A retried create returns the food already saved; a stale
 * edit shows the other version and lets the member choose.
 */

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

export function CustomFoodForm({
  food,
  initial,
  onDone,
  onArchive,
  announce,
}: {
  food: CustomFood | null;
  /** Starting values for a new food, e.g. a recipe's name (recipe-drafts#3). */
  initial?: Partial<CustomFoodFields>;
  onDone: (message: string | null) => void;
  /** Archive this food (foods#4: the action lives here, not on the card). */
  onArchive?: () => void;
  announce: (text: string) => void;
}) {
  const [fields, setFields] = useState<CustomFoodFields>(() =>
    food ? fieldsFromCustomFood(food) : { ...EMPTY_CUSTOM_FOOD_FIELDS, ...initial },
  );
  const [revision, setRevision] = useState(food?.revision ?? 1);
  const [conflict, setConflict] = useState<CustomFood | null>(null);
  // One id per form: a retry after a lost response returns the food already saved.
  const [clientMutationId] = useState(newClientMutationId);
  const create = useMutation(orpc.nutritionCustomFoods.create.mutationOptions());
  const update = useMutation(orpc.nutritionCustomFoods.update.mutationOptions());
  const { t, i18n } = useLingui();
  const parsed = parseCustomFood(fields, i18n.locale);
  const pending = create.isPending || update.isPending;

  const failed = (retry: () => void) => {
    const error = i18n._(CUSTOM_FOOD_COPY.networkError);
    announce(error);
    toast.error(error, {
      action: { label: i18n._(CUSTOM_FOOD_COPY.retry), onClick: retry },
    });
  };
  const savedText = (name: string) => t`${name}: Food saved.`;

  const save = (expectedRevision = revision) => {
    if (!parsed.ok) return;
    if (!food) {
      const input = { clientMutationId, food: parsed.food };
      const send = () =>
        create.mutate(input, {
          onSuccess: (result) => onDone(savedText(result.food.name)),
          onError: () => failed(send),
        });
      return send();
    }
    const input = { foodId: food.id, expectedRevision, food: parsed.food };
    const send = () =>
      update.mutate(input, {
        onSuccess: (result) => {
          if (result.outcome === "conflict") {
            setConflict(result.server);
            announce(i18n._(CUSTOM_FOOD_COPY.conflictTitle));
            return;
          }
          onDone(
            result.outcome === "unchanged"
              ? i18n._(CUSTOM_FOOD_COPY.unchanged)
              : savedText(result.food.name),
          );
        },
        onError: () => failed(send),
      });
    send();
  };

  const set = (patch: Partial<CustomFoodFields>) => setFields({ ...fields, ...patch });

  return (
    <div className="grid min-w-0 gap-4">
      {conflict ? (
        <div className="grid gap-2 rounded-2xl bg-warning/10 px-4 py-3 text-sm" role="alert">
          <p className="font-display font-medium text-ink">
            {i18n._(
              conflict.archived
                ? CUSTOM_FOOD_COPY.conflictArchived
                : CUSTOM_FOOD_COPY.conflictTitle,
            )}
          </p>
          {conflict.archived ? null : (
            <p className="text-ink-2">
              <Trans>Other version:</Trans> {conflict.name}, {describeBasis(conflict.basis, i18n)},{" "}
              {i18n._(describeCoverage(conflict))}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {conflict.archived ? null : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setRevision(conflict.revision);
                  setConflict(null);
                  save(conflict.revision);
                }}
              >
                {i18n._(CUSTOM_FOOD_COPY.keepMine)}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => onDone(null)}>
              {i18n._(CUSTOM_FOOD_COPY.keepServer)}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t`Food name`}>
          {(id) => (
            <Input id={id} value={fields.name} onChange={(e) => set({ name: e.target.value })} />
          )}
        </Field>
        <Field label={t`Brand (optional)`}>
          {(id) => (
            <Input id={id} value={fields.brand} onChange={(e) => set({ brand: e.target.value })} />
          )}
        </Field>
        <Field label={t`Values per`}>
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              value={fields.basisAmount}
              onChange={(e) => set({ basisAmount: e.target.value })}
            />
          )}
        </Field>
        <Field label={t`Per unit`}>
          {(id) => (
            <select
              id={id}
              className={nativeSelectClass}
              value={fields.basisUnit}
              onChange={(e) => set({ basisUnit: e.target.value as AmountUnit })}
            >
              {AMOUNT_UNITS.map((option) => (
                <option key={option} value={option}>
                  {i18n._(UNIT_LABELS[option])}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t`Serving name (optional, e.g. 1 slice)`}>
          {(id) => (
            <Input
              id={id}
              value={fields.servingLabel}
              onChange={(e) => set({ servingLabel: e.target.value })}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t`Serving size (optional)`}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                value={fields.servingSizeAmount}
                onChange={(e) => set({ servingSizeAmount: e.target.value })}
              />
            )}
          </Field>
          <Field label={t`Serving unit`}>
            {(id) => (
              <select
                id={id}
                className={nativeSelectClass}
                value={fields.servingSizeUnit}
                onChange={(e) => set({ servingSizeUnit: e.target.value as "g" | "ml" })}
              >
                <option value="g">g</option>
                <option value="ml">ml</option>
              </select>
            )}
          </Field>
        </div>
        <Field label={t`Barcode (optional)`}>
          {(id) => (
            <Input
              id={id}
              inputMode="numeric"
              autoComplete="off"
              value={fields.barcode}
              onChange={(e) => set({ barcode: e.target.value })}
            />
          )}
        </Field>
      </div>
      <fieldset className="grid gap-3 border-t border-rule pt-4 sm:grid-cols-2">
        <legend className="float-left mb-1 font-display font-medium text-ink sm:col-span-2">
          <Trans>Nutrients</Trans>
        </legend>
        {CUSTOM_FOOD_NUTRIENTS.map((key) => (
          <Field key={key} label={i18n._(nutrientFieldLabel(key))}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                value={fields.nutrients[key] ?? ""}
                onChange={(e) => set({ nutrients: { ...fields.nutrients, [key]: e.target.value } })}
              />
            )}
          </Field>
        ))}
      </fieldset>
      <p className="text-sm text-ink-3">{i18n._(CUSTOM_FOOD_COPY.blankNote)}</p>
      {!parsed.ok && fields.name ? (
        <p className="text-sm text-destructive" role="alert">
          {i18n._(parsed.error)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => save()} disabled={!parsed.ok || pending}>
          <Check aria-hidden="true" />
          {i18n._(pending ? CUSTOM_FOOD_COPY.saving : CUSTOM_FOOD_COPY.save)}
        </Button>
        <Button variant="ghost" onClick={() => onDone(null)}>
          {i18n._(CUSTOM_FOOD_COPY.cancel)}
        </Button>
        {onArchive ? (
          <Button variant="ghost" className="ml-auto text-ink-3" onClick={onArchive}>
            <Archive aria-hidden="true" />
            {i18n._(CUSTOM_FOOD_COPY.archive)}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
