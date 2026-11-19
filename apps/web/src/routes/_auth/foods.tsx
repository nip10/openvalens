import type {
  CustomFood,
  CustomFoodListItem,
} from "@openvalens/api/contracts/nutrition-custom-foods";
import type { NutrientKey } from "@openvalens/api/contracts/nutrition-diary";
import {
  CUSTOM_FOOD_COPY,
  describeBasis,
  describeCoverage,
  customFoodEnergyLabel,
  customFoodPortion,
  customFoodPortionLabel,
} from "@openvalens/api/presenters/custom-foods";
import {
  DIARY_COPY,
  NUTRIENT_LABELS,
  formatNutrientValue,
  localDateIn,
} from "@openvalens/api/presenters/nutrition-diary";
import { HIDDEN_VALUE, resolveHideNumbers } from "@openvalens/api/presenters/nutrition-targets";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Button, buttonVariants } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, Bookmark, ChefHat, Pencil, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { CustomFoodForm } from "@/components/custom-food-form";
import { nativeSelectClass } from "@/components/food-classes";
import { FormDialog } from "@/components/form-dialog";
import {
  EmptyState,
  ErrorState,
  Page,
  PageHeader,
  Section,
  StatusPill,
  ToneIcon,
} from "@/components/page";
import { SectionTabs } from "@/components/section-tabs";
import {
  FOOD_SORTS,
  enteredValues,
  foodUsageLine,
  shortBasis,
  sortFoods,
  type FoodSort,
} from "@/utils/food-display";
import { orpc } from "@/utils/orpc";
import { ModuleHiddenNote } from "@/components/module-hidden-note";

/**
 * "My foods" (Issue #81): create, edit, archive and restore the member's
 * private custom foods. Reached from the meal diary. Online-only on web; a
 * network failure leaves saved foods untouched and offers a retry. Edits
 * never change meals already logged (entries keep their snapshot). A food is
 * created and edited in a dialog; "Log" opens it in the diary's Log food.
 */
export const Route = createFileRoute("/_auth/foods")({
  component: FoodsPage,
});

const FOODS_COPY = Object.freeze({
  search: msg`Search my foods`,
  noMatch: msg`No foods match.`,
  log: msg`Log`,
  sort: msg`Sort`,
  newRecipe: msg`New recipe`,
  notLogged: msg`Not logged yet`,
  fewValues: msg({
    message: "{count, plural, one {Only # nutrient} other {Only # nutrients}}",
    comment: "A saved food that has few nutrient values filled in.",
  }),
});

const SORT_LABELS = {
  used: msg`Most used`,
  name: msg`A to Z`,
  added: msg`Recently added`,
} as const satisfies Record<FoodSort, unknown>;

/** Fewer values than this, and the card says how few (foods#2). */
const FEW_VALUES = 5;

const MACROS = [
  ["proteinG", "P", "text-protein"],
  ["carbohydrateG", "C", "text-carbs"],
  ["fatG", "F", "text-fat"],
] as const satisfies readonly (readonly [NutrientKey, string, string])[];

function FoodsPage() {
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<CustomFood | "new" | null>(null);
  const [needle, setNeedle] = useState("");
  // foods#0: the foods people log most come first.
  const [sort, setSort] = useState<FoodSort>("used");
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

  const figure = (food: CustomFoodListItem, key: NutrientKey) =>
    hideNumbers
      ? i18n._(HIDDEN_VALUE)
      : formatNutrientValue(
          key,
          food.nutrientsPerBasis[key] === null
            ? null
            : food.nutrientsPerBasis[key] * customFoodPortion(food).factor,
          i18n,
        );

  const shown = useMemo(() => {
    const all = sortFoods(foods.data?.foods ?? [], sort, i18n.locale);
    const query = needle.trim().toLowerCase();
    if (!query) return all;
    return all.filter((food) => `${food.name} ${food.brand ?? ""}`.toLowerCase().includes(query));
  }, [foods.data, needle, sort, i18n.locale]);

  return (
    <Page>
      <SectionTabs parent="/nutrition" />
      <ModuleHiddenNote module="food" />
      <p className="sr-only" role="status" aria-live="polite">
        {message}
      </p>
      <PageHeader
        title={i18n._(CUSTOM_FOOD_COPY.title)}
        info={
          <>
            <p>{i18n._(CUSTOM_FOOD_COPY.privacy)}</p>
            <p>{i18n._(CUSTOM_FOOD_COPY.provenance)}</p>
            <p>{i18n._(CUSTOM_FOOD_COPY.archiveNote)}</p>
          </>
        }
        actions={
          <>
            {/* recipe-drafts#3: a recipe is pasted, reviewed, then saved here as a food. */}
            <Link to="/recipe-drafts" className={buttonVariants({ variant: "outline" })}>
              <ChefHat aria-hidden="true" />
              {i18n._(FOODS_COPY.newRecipe)}
            </Link>
            <Button onClick={() => setEditing("new")}>
              <Plus aria-hidden="true" />
              {i18n._(CUSTOM_FOOD_COPY.create)}
            </Button>
          </>
        }
      />

      <Section aria-label={i18n._(CUSTOM_FOOD_COPY.title)}>
        {/* foods#0, #6: search and the archive filter share one row. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="relative min-w-0 flex-1 basis-60 sm:max-w-sm">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
              aria-hidden="true"
            />
            <Input
              type="search"
              className="pl-9"
              aria-label={i18n._(FOODS_COPY.search)}
              placeholder={i18n._(FOODS_COPY.search)}
              value={needle}
              onChange={(event) => setNeedle(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            {i18n._(FOODS_COPY.sort)}
            <select
              className={`w-auto ${nativeSelectClass}`}
              value={sort}
              onChange={(event) => setSort(event.target.value as FoodSort)}
            >
              {FOOD_SORTS.map((value) => (
                <option key={value} value={value}>
                  {i18n._(SORT_LABELS[value])}
                </option>
              ))}
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            {i18n._(CUSTOM_FOOD_COPY.showArchived)}
          </label>
        </div>
        {foods.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {["a", "b", "c", "d"].map((key) => (
              <Skeleton key={key} className="h-40 w-full rounded-3xl" />
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
            icon={Bookmark}
            title={i18n._(CUSTOM_FOOD_COPY.empty)}
            action={
              <Button variant="outline" onClick={() => setEditing("new")}>
                {i18n._(CUSTOM_FOOD_COPY.create)}
              </Button>
            }
          />
        ) : shown.length === 0 ? (
          <EmptyState icon={Search} title={i18n._(FOODS_COPY.noMatch)} />
        ) : (
          // foods#7: one size for every card; the footer is pinned to the bottom.
          <ul
            className="grid min-w-0 auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-3"
            aria-label={i18n._(CUSTOM_FOOD_COPY.title)}
          >
            {shown.map((food) => {
              const count = enteredValues(food);
              const basis = describeBasis(food.basis, i18n);
              const usage = foodUsageLine(food.usage, i18n);
              return (
                <li key={food.id} className="sheet flex min-w-0 flex-col gap-3 p-4">
                  <div className="flex items-start gap-3">
                    <ToneIcon icon={food.archived ? Archive : Bookmark} tone="food" />
                    <div className="grid min-w-0 flex-1 gap-0.5">
                      <span
                        className="line-clamp-2 font-semibold break-words text-ink"
                        title={food.name}
                      >
                        {food.name}
                      </span>
                      <span className="truncate text-sm text-ink-3" title={basis}>
                        <span className="sr-only">
                          {hideNumbers ? basis : customFoodPortionLabel(food, i18n)}.{" "}
                        </span>
                        <span aria-hidden="true">
                          {food.brand ? `${food.brand} · ` : ""}
                          {hideNumbers
                            ? shortBasis(food, i18n)
                            : customFoodPortionLabel(food, i18n)}
                        </span>
                      </span>
                    </div>
                  </div>
                  <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-2">
                    {MACROS.map(([key, letter, tone]) => (
                      <span key={key} className="num whitespace-nowrap">
                        <span className={`font-semibold ${tone}`} aria-hidden="true">
                          {letter}
                        </span>
                        <span className="sr-only">{i18n._(NUTRIENT_LABELS[key].label)}</span>{" "}
                        {figure(food, key)}
                      </span>
                    ))}
                  </p>
                  {count < FEW_VALUES ? (
                    <p className="text-sm text-ink-3" title={i18n._(describeCoverage(food))}>
                      {i18n._({ ...FOODS_COPY.fewValues, values: { count } })}
                    </p>
                  ) : null}
                  {/* foods#5: how often it is logged, to spot the staples. */}
                  <p className="text-sm text-ink-3">{usage ?? i18n._(FOODS_COPY.notLogged)}</p>
                  <div className="mt-auto flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="num shrink-0 rounded-full bg-food-soft px-2.5 py-1 text-sm font-semibold text-ink">
                        <span className="sr-only">
                          {i18n._(NUTRIENT_LABELS.energyKcal.label)}:{" "}
                        </span>
                        {customFoodEnergyLabel(food, hideNumbers, i18n)}
                      </span>
                      {food.archived ? (
                        <StatusPill tone="neutral">
                          {i18n._(CUSTOM_FOOD_COPY.archivedBadge)}
                        </StatusPill>
                      ) : null}
                    </span>
                    <span className="-mr-1 flex shrink-0 items-center">
                      {food.archived ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setArchived(food, false)}
                          disabled={restore.isPending}
                        >
                          <ArchiveRestore aria-hidden="true" />
                          {i18n._(CUSTOM_FOOD_COPY.restore)}{" "}
                          <span className="sr-only">{food.name}</span>
                        </Button>
                      ) : (
                        <>
                          {/* foods#5: open Log food on the diary with this food searched. */}
                          <Link
                            to="/nutrition"
                            search={{ food: food.name }}
                            className={buttonVariants({ variant: "ghost", size: "sm" })}
                          >
                            <Plus aria-hidden="true" />
                            {i18n._(FOODS_COPY.log)}
                            <span className="sr-only">{food.name}</span>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-ink-2"
                            onClick={() => setEditing(food)}
                          >
                            <Pencil aria-hidden="true" />
                            {i18n._(CUSTOM_FOOD_COPY.edit)}
                            <span className="sr-only">{food.name}</span>
                          </Button>
                        </>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={
          editing && editing !== "new" ? t`Edit ${editing.name}` : i18n._(CUSTOM_FOOD_COPY.create)
        }
        description={editing && editing !== "new" ? i18n._(CUSTOM_FOOD_COPY.editNote) : undefined}
        className="sm:max-w-2xl"
      >
        {editing ? (
          <CustomFoodForm
            key={editing === "new" ? "new" : `${editing.id}:${editing.revision}`}
            food={editing === "new" ? null : editing}
            onDone={(text) => {
              setEditing(null);
              if (text) setMessage(text);
              void refresh();
            }}
            onArchive={
              editing === "new"
                ? undefined
                : () => {
                    setArchived(editing, true);
                    setEditing(null);
                  }
            }
            announce={setMessage}
          />
        ) : null}
      </FormDialog>
    </Page>
  );
}
