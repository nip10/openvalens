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
import {
  DIARY_COPY,
  UNIT_LABELS,
  localDateIn,
  newClientMutationId,
} from "@openvalens/api/presenters/nutrition-diary";
import {
  formatNutrientSummaryLine,
  resolveHideNumbers,
} from "@openvalens/api/presenters/nutrition-targets";
import { Trans, useLingui } from "@lingui/react/macro";
import { Badge } from "@openvalens/ui/components/badge";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useId, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

/**
 * "My foods" (Issue #81): create, edit, archive and restore the member's
 * private custom foods. Reached from the meal diary. Online-only on web; a
 * network failure leaves saved foods untouched and offers a retry. Edits
 * never change meals already logged (entries keep their snapshot).
 */
export const Route = createFileRoute("/_auth/foods")({
  component: FoodsPage,
});

const selectClass =
  "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Field({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      {children(id)}
    </div>
  );
}

function FoodsPage() {
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<CustomFood | "new" | null>(null);
  const [message, setMessage] = useState("");
  const queryClient = useQueryClient();
  const { t, i18n } = useLingui();
  const foods = useQuery(
    orpc.nutritionCustomFoods.list.queryOptions({ input: { includeArchived: showArchived } }),
  );
  // Hide-numbers (#88): values stay hidden until this member's preference is known.
  const targets = useQuery(
    orpc.nutritionTargets.get.queryOptions({ input: { localDate: localDateIn(undefined) } }),
  );
  const hideNumbers = resolveHideNumbers(
    targets.isSuccess ? targets.data.settings.hideNumbers : undefined,
  );
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.nutritionCustomFoods.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.nutritionDiary.listFoods.key() }),
    ]);

  const archive = useMutation(orpc.nutritionCustomFoods.archive.mutationOptions());
  const restore = useMutation(orpc.nutritionCustomFoods.restore.mutationOptions());

  const setArchived = (food: CustomFood, archived: boolean) => {
    const mutation = archived ? archive : restore;
    const send = () =>
      mutation.mutate(
        { foodId: food.id },
        {
          onSuccess: () => {
            const name = food.name;
            const done = archived
              ? t`${name}: Food archived. It no longer appears in search or quick logging.`
              : t`${name}: Food restored.`;
            setMessage(done);
            if (archived)
              toast(done, {
                action: { label: i18n._(DIARY_COPY.undo), onClick: () => setArchived(food, false) },
              });
            void refresh();
          },
          onError: () => {
            const error = i18n._(CUSTOM_FOOD_COPY.networkError);
            setMessage(error);
            toast.error(error, {
              action: { label: i18n._(CUSTOM_FOOD_COPY.retry), onClick: send },
            });
          },
        },
      );
    send();
  };

  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <p className="sr-only" role="status" aria-live="polite">
        {message}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold">{i18n._(CUSTOM_FOOD_COPY.title)}</h1>
          <Link to="/nutrition" className="text-sm underline">
            <Trans>Back to meal diary</Trans>
          </Link>
        </div>
        <Button onClick={() => setEditing("new")} disabled={editing === "new"}>
          {i18n._(CUSTOM_FOOD_COPY.create)}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{i18n._(CUSTOM_FOOD_COPY.privacy)}</p>

      {editing ? (
        <FoodForm
          key={editing === "new" ? "new" : `${editing.id}:${editing.revision}`}
          food={editing === "new" ? null : editing}
          onDone={(text) => {
            setEditing(null);
            if (text) setMessage(text);
            void refresh();
          }}
          announce={setMessage}
        />
      ) : null}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
        />
        {i18n._(CUSTOM_FOOD_COPY.showArchived)}
      </label>

      {foods.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : foods.isError ? (
        <p className="text-sm text-muted-foreground" role="alert">
          {i18n._(CUSTOM_FOOD_COPY.networkError)}{" "}
          <button className="underline" onClick={() => void foods.refetch()}>
            {i18n._(CUSTOM_FOOD_COPY.retry)}
          </button>
        </p>
      ) : foods.data.foods.length === 0 ? (
        <p className="text-sm text-muted-foreground">{i18n._(CUSTOM_FOOD_COPY.empty)}</p>
      ) : (
        <Card className="py-0">
          <ul className="divide-y divide-border" aria-label={i18n._(CUSTOM_FOOD_COPY.title)}>
            {foods.data.foods.map((food) => (
              <li key={food.id} className="grid gap-1 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="grid">
                    <span className="font-medium">
                      {food.name}
                      {food.brand ? ` · ${food.brand}` : ""}{" "}
                      {food.archived ? (
                        <Badge variant="outline">{i18n._(CUSTOM_FOOD_COPY.archivedBadge)}</Badge>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {describeBasis(food.basis, i18n)} · {i18n._(describeCoverage(food))} ·{" "}
                      {i18n._(CUSTOM_FOOD_COPY.provenance)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatNutrientSummaryLine(food.nutrientsPerBasis, hideNumbers, i18n)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {food.archived ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setArchived(food, false)}
                        disabled={restore.isPending}
                      >
                        {i18n._(CUSTOM_FOOD_COPY.restore)}{" "}
                        <span className="sr-only">{food.name}</span>
                      </Button>
                    ) : (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(food)}>
                          {i18n._(CUSTOM_FOOD_COPY.edit)}{" "}
                          <span className="sr-only">{food.name}</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setArchived(food, true)}
                          disabled={archive.isPending}
                        >
                          {i18n._(CUSTOM_FOOD_COPY.archive)}{" "}
                          <span className="sr-only">{food.name}</span>
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">{i18n._(CUSTOM_FOOD_COPY.archiveNote)}</p>
    </div>
  );
}

function FoodForm({
  food,
  onDone,
  announce,
}: {
  food: CustomFood | null;
  onDone: (message: string | null) => void;
  announce: (text: string) => void;
}) {
  const [fields, setFields] = useState<CustomFoodFields>(() =>
    food ? fieldsFromCustomFood(food) : EMPTY_CUSTOM_FOOD_FIELDS,
  );
  const [revision, setRevision] = useState(food?.revision ?? 1);
  const [conflict, setConflict] = useState<CustomFood | null>(null);
  // One id per form: a retry after a lost response returns the food already saved.
  const [clientMutationId] = useState(newClientMutationId);
  const create = useMutation(orpc.nutritionCustomFoods.create.mutationOptions());
  const update = useMutation(orpc.nutritionCustomFoods.update.mutationOptions());
  const parsed = parseCustomFood(fields);
  const pending = create.isPending || update.isPending;
  const { t, i18n } = useLingui();

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
  const foodName = food?.name ?? "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{food ? t`Edit ${foodName}` : i18n._(CUSTOM_FOOD_COPY.create)}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {food ? (
          <p className="text-sm text-muted-foreground">{i18n._(CUSTOM_FOOD_COPY.editNote)}</p>
        ) : null}
        {conflict ? (
          <div className="grid gap-2 rounded-md border p-3 text-sm" role="alert">
            <p className="font-medium">
              {i18n._(
                conflict.archived
                  ? CUSTOM_FOOD_COPY.conflictArchived
                  : CUSTOM_FOOD_COPY.conflictTitle,
              )}
            </p>
            {conflict.archived ? null : (
              <p>
                <Trans>Other version:</Trans> {conflict.name} ·{" "}
                {describeBasis(conflict.basis, i18n)} · {i18n._(describeCoverage(conflict))}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {conflict.archived ? null : (
                <Button
                  size="sm"
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
              <Input
                id={id}
                value={fields.brand}
                onChange={(e) => set({ brand: e.target.value })}
              />
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
                className={selectClass}
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
                  className={selectClass}
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
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-medium">
            <Trans>Nutrients</Trans>
          </legend>
          {CUSTOM_FOOD_NUTRIENTS.map((key) => (
            <Field key={key} label={i18n._(nutrientFieldLabel(key))}>
              {(id) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  value={fields.nutrients[key] ?? ""}
                  onChange={(e) =>
                    set({ nutrients: { ...fields.nutrients, [key]: e.target.value } })
                  }
                />
              )}
            </Field>
          ))}
        </fieldset>
        <p className="text-xs text-muted-foreground">{i18n._(CUSTOM_FOOD_COPY.blankNote)}</p>
        {!parsed.ok && fields.name ? (
          <p className="text-sm text-muted-foreground" role="alert">
            {i18n._(parsed.error)}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save()} disabled={!parsed.ok || pending}>
            {i18n._(pending ? CUSTOM_FOOD_COPY.saving : CUSTOM_FOOD_COPY.save)}
          </Button>
          <Button variant="outline" onClick={() => onDone(null)}>
            {i18n._(CUSTOM_FOOD_COPY.cancel)}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
