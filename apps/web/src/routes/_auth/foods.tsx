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
  NUTRIENT_LABELS,
  UNIT_LABELS,
  formatNutrientValue,
  localDateIn,
  newClientMutationId,
} from "@openvalens/api/presenters/nutrition-diary";
import { HIDDEN_VALUE, resolveHideNumbers } from "@openvalens/api/presenters/nutrition-targets";
import { Trans, useLingui } from "@lingui/react/macro";
import { Badge } from "@openvalens/ui/components/badge";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useId, useState } from "react";
import { toast } from "sonner";

import { controlLinkClass, nativeSelectClass } from "@/components/food-classes";
import { EmptyState, ErrorState, Page, PageHeader, Section } from "@/components/page";
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

  const figure = (food: CustomFood, key: (typeof FOOD_TABLE_NUTRIENTS)[number]) =>
    hideNumbers
      ? i18n._(HIDDEN_VALUE)
      : formatNutrientValue(key, food.nutrientsPerBasis[key], i18n);

  return (
    <Page>
      <p className="sr-only" role="status" aria-live="polite">
        {message}
      </p>
      <PageHeader
        title={i18n._(CUSTOM_FOOD_COPY.title)}
        description={i18n._(CUSTOM_FOOD_COPY.privacy)}
        actions={
          <>
            <Link to="/nutrition" className={`mr-2 ${controlLinkClass}`}>
              <Trans>Back to meal diary</Trans>
            </Link>
            <Button onClick={() => setEditing("new")} disabled={editing === "new"}>
              {i18n._(CUSTOM_FOOD_COPY.create)}
            </Button>
          </>
        }
      />

      <div
        className={
          editing
            ? "grid items-start gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
            : "grid items-start gap-10"
        }
      >
        <section className="grid min-w-0 gap-4" aria-label={i18n._(CUSTOM_FOOD_COPY.title)}>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            {i18n._(CUSTOM_FOOD_COPY.showArchived)}
          </label>

          {foods.isPending ? (
            <div className="grid gap-2" aria-hidden="true">
              {["a", "b", "c", "d"].map((key) => (
                <Skeleton key={key} className="h-12 w-full" />
              ))}
            </div>
          ) : foods.isError ? (
            <ErrorState
              title={i18n._(CUSTOM_FOOD_COPY.networkError)}
              action={
                <Button variant="outline" onClick={() => void foods.refetch()}>
                  {i18n._(CUSTOM_FOOD_COPY.retry)}
                </Button>
              }
            />
          ) : foods.data.foods.length === 0 ? (
            <EmptyState
              title={i18n._(CUSTOM_FOOD_COPY.empty)}
              action={
                <Button variant="outline" onClick={() => setEditing("new")}>
                  {i18n._(CUSTOM_FOOD_COPY.create)}
                </Button>
              }
            />
          ) : (
            <div className="sheet px-5 pt-3 pb-2">
              <table className="w-full text-left text-sm text-ink-2">
                <thead>
                  <tr className="border-b-2 border-rule-2">
                    <th scope="col" className="pb-2 font-medium text-ink-3">
                      <Trans>Food</Trans>
                    </th>
                    <th
                      scope="col"
                      className="hidden pb-2 pl-3 font-medium text-ink-3 sm:table-cell"
                    >
                      <Trans>Values per</Trans>
                    </th>
                    {FOOD_TABLE_NUTRIENTS.map((key) => (
                      <th
                        key={key}
                        scope="col"
                        className={`pb-2 pl-3 text-right font-medium text-ink-3 ${key === "energyKcal" ? "" : "hidden md:table-cell"}`}
                      >
                        {i18n._(NUTRIENT_LABELS[key].label)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {foods.data.foods.map((food) => (
                    <tr
                      key={food.id}
                      className="border-b border-rule align-top transition-colors duration-[var(--dur-short)] last:border-0 hover:bg-muted/70"
                    >
                      <th scope="row" className="py-2.5 pr-3 font-normal">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-display font-medium break-words text-ink">
                            {food.name}
                          </span>
                          {food.archived ? (
                            <Badge variant="outline">
                              {i18n._(CUSTOM_FOOD_COPY.archivedBadge)}
                            </Badge>
                          ) : null}
                        </span>
                        {food.brand ? <span className="block text-ink-3">{food.brand}</span> : null}
                        <span className="block text-ink-3">{i18n._(describeCoverage(food))}</span>
                        <span className="block text-ink-3 sm:hidden">
                          {describeBasis(food.basis, i18n)}
                        </span>
                        <span className="-ml-2 mt-1 flex flex-wrap gap-x-1">
                          {food.archived ? (
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => setArchived(food, false)}
                              disabled={restore.isPending}
                            >
                              {i18n._(CUSTOM_FOOD_COPY.restore)}{" "}
                              <span className="sr-only">{food.name}</span>
                            </Button>
                          ) : (
                            <>
                              <Button variant="ghost" size="xs" onClick={() => setEditing(food)}>
                                {i18n._(CUSTOM_FOOD_COPY.edit)}{" "}
                                <span className="sr-only">{food.name}</span>
                              </Button>
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => setArchived(food, true)}
                                disabled={archive.isPending}
                              >
                                {i18n._(CUSTOM_FOOD_COPY.archive)}{" "}
                                <span className="sr-only">{food.name}</span>
                              </Button>
                            </>
                          )}
                        </span>
                      </th>
                      <td className="hidden py-2.5 pl-3 text-ink-2 sm:table-cell">
                        {describeBasis(food.basis, i18n)}
                      </td>
                      {FOOD_TABLE_NUTRIENTS.map((key) => (
                        <td
                          key={key}
                          className={`num py-2.5 pl-3 ${key === "energyKcal" ? "font-medium text-ink" : "hidden text-ink-2 md:table-cell"}`}
                        >
                          {figure(food, key)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="grid gap-1 text-sm text-ink-3">
            <p>{i18n._(CUSTOM_FOOD_COPY.provenance)}</p>
            <p className="max-w-[70ch]">{i18n._(CUSTOM_FOOD_COPY.archiveNote)}</p>
          </div>
        </section>

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
      </div>
    </Page>
  );
}

/** Per-basis figures printed in the food table (energy always, macros from `md:`). */
const FOOD_TABLE_NUTRIENTS = ["energyKcal", "proteinG", "carbohydrateG", "fatG"] as const;

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
    <Section
      title={food ? t`Edit ${foodName}` : i18n._(CUSTOM_FOOD_COPY.create)}
      description={food ? i18n._(CUSTOM_FOOD_COPY.editNote) : undefined}
    >
      <div className="sheet grid gap-4 px-5 pt-4 pb-5">
        {conflict ? (
          <div className="grid gap-2 border-l-2 border-warning pl-3 text-sm" role="alert">
            <p className="font-display font-medium text-ink">
              {i18n._(
                conflict.archived
                  ? CUSTOM_FOOD_COPY.conflictArchived
                  : CUSTOM_FOOD_COPY.conflictTitle,
              )}
            </p>
            {conflict.archived ? null : (
              <p className="text-ink-2">
                <Trans>Other version:</Trans> {conflict.name}, {describeBasis(conflict.basis, i18n)}
                , {i18n._(describeCoverage(conflict))}
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
          <legend className="float-left mb-1 font-display text-sm font-medium text-ink sm:col-span-2">
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
        <p className="text-sm text-ink-3">{i18n._(CUSTOM_FOOD_COPY.blankNote)}</p>
        {!parsed.ok && fields.name ? (
          <p className="text-sm text-destructive" role="alert">
            {i18n._(parsed.error)}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => save()} disabled={!parsed.ok || pending}>
            {i18n._(pending ? CUSTOM_FOOD_COPY.saving : CUSTOM_FOOD_COPY.save)}
          </Button>
          <Button variant="ghost" onClick={() => onDone(null)}>
            {i18n._(CUSTOM_FOOD_COPY.cancel)}
          </Button>
        </div>
      </div>
    </Section>
  );
}
