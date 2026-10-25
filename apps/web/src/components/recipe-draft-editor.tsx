import {
  parseRecipeDraft,
  RECIPE_IMPORT_COPY,
  type RecipeDraft,
  type RecipeDraftIngredient,
} from "@openvalens/api/presenters/recipe-draft";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Textarea } from "@openvalens/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Carrot,
  ChefHat,
  ClipboardPaste,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { offlineScope } from "@openvalens/api/presenters/offline";
import { controlLinkClass, nativeSelectClass, textLinkClass } from "@/components/food-classes";
import { Details, Page, PageHeader, Section, ToneIcon } from "@/components/page";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

const MAX_INPUT = 1024 * 1024;
const MAX_INGREDIENTS = 200;
/** A paste parse or a URL import (#82): same draft shape, wider status set. */
type DraftResult = { status: string; candidates: RecipeDraft[]; message: string | null };
const EMPTY_RESULT: DraftResult = { status: "empty", candidates: [], message: null };

function safeSourceUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function copyDraft(draft: RecipeDraft): RecipeDraft {
  return {
    ...draft,
    source: { ...draft.source },
    ingredients: draft.ingredients.map((item) => ({ ...item })),
  };
}

type IngredientTextField = "rawText" | "quantityText" | "unitText" | "foodText";
function editIngredientText(
  item: RecipeDraftIngredient,
  key: IngredientTextField,
  value: string,
): RecipeDraftIngredient {
  if (key === "rawText") return { ...item, rawText: value };
  if (key === "quantityText") return { ...item, quantityText: value || null };
  if (key === "unitText") return { ...item, unitText: value || null };
  return { ...item, foodText: value || null };
}

export function RecipeDraftEditor() {
  const { data: session, isPending } = authClient.useSession();
  const scope = offlineScope(session as Parameters<typeof offlineScope>[0]);
  const [activeScope, setActiveScope] = useState(scope);
  const [format, setFormat] = useState<"ingredients" | "json-ld" | "url">("ingredients");
  const [text, setText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [result, setResult] = useState<DraftResult>(EMPTY_RESULT);
  const [draft, setDraft] = useState<RecipeDraft | null>(null);
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [replacePending, setReplacePending] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const importUrl = useMutation(orpc.nutritionRecipeImport.fromUrl.mutationOptions());
  const { t, i18n } = useLingui();

  useEffect(() => {
    if (scope === activeScope) return;
    setActiveScope(scope);
    setText("");
    setSourceUrl("");
    setResult(EMPTY_RESULT);
    setDraft(null);
    setMessage("");
    setDirty(false);
    setReplacePending(false);
    setShowPaste(false);
  }, [scope, activeScope]);

  const show = (parsed: DraftResult) => {
    setResult(parsed);
    if (
      (parsed.status === "ready" || parsed.status === "no_recipe") &&
      parsed.candidates.length === 1
    ) {
      setDraft(copyDraft(parsed.candidates[0]!));
      setDirty(false);
      setMessage(parsed.message ?? "");
      setShowPaste(false);
    } else {
      setDraft(null);
      setDirty(false);
      setMessage(
        parsed.status === "choose_recipe"
          ? t`Choose the recipe you want to review.`
          : (parsed.message ?? t`No draft was created.`),
      );
    }
  };
  const parse = () => {
    if (format === "url") {
      importUrl.mutate(
        { url: sourceUrl.trim() },
        {
          onSuccess: show,
          onError: () => {
            setDraft(null);
            setMessage(t`The import failed. Nothing was saved.`);
          },
        },
      );
      return;
    }
    if (new TextEncoder().encode(text).length > MAX_INPUT) {
      setDraft(null);
      setResult({
        status: "invalid",
        candidates: [],
        message: t`Paste is over the 1 MiB limit. Shorten it and try again.`,
      });
      setMessage(t`The previous review was cleared. Your pasted text is still here.`);
      return;
    }
    const parsed = parseRecipeDraft({
      text,
      format,
      ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
      importedAt: new Date().toISOString(),
    });
    show({ ...parsed, message: parsed.message ? i18n._(parsed.message) : null });
  };
  const choose = (candidate: RecipeDraft) => {
    setDraft(copyDraft(candidate));
    setDirty(false);
    setMessage("");
    setShowPaste(false);
  };
  const changePaste = (next: string) => {
    setText(next);
    if (draft || result.candidates.length) {
      setResult(EMPTY_RESULT);
      setShowPaste(true);
      setMessage(t`Paste changed. Create a replacement draft explicitly.`);
    }
  };
  const clear = () => {
    setText("");
    setSourceUrl("");
    setDraft(null);
    setResult(EMPTY_RESULT);
    setDirty(false);
    setReplacePending(false);
    setShowPaste(false);
    setMessage(t`Draft cleared. Nothing was saved.`);
    textRef.current?.focus();
  };
  const updateDraft = (update: (current: RecipeDraft) => RecipeDraft) => {
    setDraft((current) => (current ? update(current) : current));
    setDirty(true);
  };
  const addIngredient = () =>
    updateDraft((current) =>
      current.ingredients.length >= MAX_INGREDIENTS
        ? current
        : {
            ...current,
            ingredients: [
              ...current.ingredients,
              {
                id: crypto.randomUUID(),
                rawText: "",
                quantityText: null,
                unitText: null,
                foodText: null,
                preparation: "unknown",
              },
            ],
          },
    );
  const updateIngredient = (
    id: string,
    update: (item: RecipeDraftIngredient) => RecipeDraftIngredient,
  ) =>
    updateDraft((current) => ({
      ...current,
      ingredients: current.ingredients.map((item) => (item.id === id ? update(item) : item)),
    }));

  if (isPending || scope !== activeScope)
    return (
      <Page width="narrow">
        <div role="status" className="grid gap-4">
          <span className="sr-only">
            <Trans>Loading your workspace…</Trans>
          </span>
          <Skeleton className="h-12 w-64 rounded-full" />
          <Skeleton className="h-64 w-full rounded-3xl" />
        </div>
      </Page>
    );
  if (!scope)
    return (
      <Page width="narrow">
        <PageHeader
          title={<Trans>Recipe draft</Trans>}
          description={<Trans>Sign in to create a private, session-only draft.</Trans>}
        />
      </Page>
    );

  const notProvided = t`Not provided`;
  const ingredientCount = draft?.ingredients.length ?? 0;
  const site = draft?.source.site || notProvided;
  const author = draft?.source.author || notProvided;
  const importedAt = draft?.source.importedAt ?? "";
  const sourceLink = draft?.source.url || notProvided;

  return (
    <Page width="narrow">
      <PageHeader
        title={<Trans>Recipe draft</Trans>}
        info={
          <Trans>
            Paste ingredients or Recipe JSON-LD, or import one recipe page if you turned that on in
            nutrition settings. Nothing is saved.
          </Trans>
        }
        description={
          <Trans>Not saved. Discard the draft to clear it; reloading may lose it.</Trans>
        }
        actions={
          <Link
            to="/nutrition"
            className={`inline-flex min-h-11 items-center gap-1.5 ${controlLinkClass}`}
          >
            <ArrowLeft className="size-4 text-food" aria-hidden="true" />
            <Trans>Back to meal diary</Trans>
          </Link>
        }
      />
      {!draft || showPaste ? (
        <Section icon={ClipboardPaste} tone="food" sheet title={<Trans>Paste recipe text</Trans>}>
          <div className="grid gap-4">
            <fieldset className="flex flex-wrap gap-2">
              <legend className="mb-2 text-sm font-medium text-ink-3">
                <Trans>Paste format</Trans>
              </legend>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-input bg-card px-3.5 text-sm text-ink-2 transition-colors duration-[var(--dur-short)] hover:bg-muted has-[:checked]:border-transparent has-[:checked]:bg-food-soft has-[:checked]:font-semibold has-[:checked]:text-ink">
                <input
                  type="radio"
                  className="size-4 accent-primary"
                  name="format"
                  checked={format === "ingredients"}
                  onChange={() => setFormat("ingredients")}
                />
                <Trans>Ingredients</Trans>
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-input bg-card px-3.5 text-sm text-ink-2 transition-colors duration-[var(--dur-short)] hover:bg-muted has-[:checked]:border-transparent has-[:checked]:bg-food-soft has-[:checked]:font-semibold has-[:checked]:text-ink">
                <input
                  type="radio"
                  className="size-4 accent-primary"
                  name="format"
                  checked={format === "json-ld"}
                  onChange={() => setFormat("json-ld")}
                />
                <Trans>Recipe JSON-LD</Trans>
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-input bg-card px-3.5 text-sm text-ink-2 transition-colors duration-[var(--dur-short)] hover:bg-muted has-[:checked]:border-transparent has-[:checked]:bg-food-soft has-[:checked]:font-semibold has-[:checked]:text-ink">
                <input
                  type="radio"
                  className="size-4 accent-primary"
                  name="format"
                  checked={format === "url"}
                  onChange={() => setFormat("url")}
                />
                {i18n._(RECIPE_IMPORT_COPY.urlLabel)}
              </label>
            </fieldset>
            {format !== "url" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="recipe-paste" className="text-sm font-medium text-ink-3">
                  <Trans>Paste text (up to 1 MiB)</Trans>
                </Label>
                <Textarea
                  ref={textRef}
                  id="recipe-paste"
                  value={text}
                  onChange={(event) => changePaste(event.target.value)}
                  className="min-h-48"
                />
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="recipe-source" className="text-sm font-medium text-ink-3">
                {format === "url"
                  ? i18n._(RECIPE_IMPORT_COPY.urlLabel)
                  : t`Source URL (optional, provenance only)`}
              </Label>
              <Input
                id="recipe-source"
                type="url"
                autoComplete="off"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
              />
              {format === "url" ? (
                <p className="text-sm text-ink-3">
                  {i18n._(RECIPE_IMPORT_COPY.urlHint)}{" "}
                  <Link to="/nutrition-targets" className={textLinkClass}>
                    <Trans>Nutrition settings</Trans>
                  </Link>
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  if (replacePending) return;
                  if (dirty && draft) {
                    setReplacePending(true);
                    return;
                  }
                  parse();
                }}
                disabled={
                  (format === "url" ? !sourceUrl.trim() || importUrl.isPending : !text.trim()) ||
                  replacePending
                }
              >
                <Sparkles aria-hidden="true" />
                {importUrl.isPending ? i18n._(RECIPE_IMPORT_COPY.importing) : t`Create draft`}
              </Button>
              <Button variant="ghost" onClick={clear}>
                <Trans>Clear</Trans>
              </Button>
            </div>
            {replacePending ? (
              <div role="alert" className="grid gap-2 rounded-2xl bg-warning/10 px-4 py-3">
                <p className="text-sm text-ink">
                  <Trans>Parsing again will replace your edited review. Continue?</Trans>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setDraft(null);
                      parse();
                      setReplacePending(false);
                    }}
                  >
                    <Trans>Replace review</Trans>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setReplacePending(false);
                      setShowPaste(false);
                    }}
                  >
                    <Trans>Keep review</Trans>
                  </Button>
                </div>
              </div>
            ) : null}
            {message ? (
              <p role="status" aria-live="polite" className="text-sm text-ink-2">
                {message}
              </p>
            ) : null}
            {result.status === "choose_recipe" ? (
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium text-ink-3">
                  <Trans>Choose a recipe to review</Trans>
                </legend>
                {result.candidates.map((candidate) => (
                  <Button
                    key={candidate.id}
                    variant="outline"
                    className="h-auto min-h-11 justify-start whitespace-normal py-2 text-left"
                    onClick={() => choose(candidate)}
                  >
                    {candidate.title || t`Untitled recipe`}
                  </Button>
                ))}
              </fieldset>
            ) : null}
          </div>
        </Section>
      ) : null}
      {draft && !showPaste ? (
        <Section icon={ChefHat} tone="food" sheet title={<Trans>Review draft</Trans>}>
          <div className="grid gap-4">
            <p className="flex items-start gap-2 rounded-2xl bg-paper-2 px-4 py-3 text-sm text-ink-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden="true" />
              <Trans comment="safety">
                Ingredients remain unmatched and unverified. No nutrition values are calculated.
                This is not clinical advice.
              </Trans>
            </p>
            <div className="grid gap-1.5">
              <Label htmlFor="draft-title" className="text-sm font-medium text-ink-3">
                <Trans>Title</Trans>
              </Label>
              <Input
                id="draft-title"
                maxLength={300}
                value={draft.title ?? ""}
                onChange={(event) =>
                  updateDraft((current) => ({ ...current, title: event.target.value || null }))
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="draft-servings" className="text-sm font-medium text-ink-3">
                <Trans>Servings (text)</Trans>
              </Label>
              <Input
                id="draft-servings"
                maxLength={200}
                value={draft.servingsText ?? ""}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    servingsText: event.target.value || null,
                  }))
                }
              />
            </div>
            <section className="grid gap-3 pt-2" aria-labelledby="draft-ingredients-title">
              <h3
                id="draft-ingredients-title"
                className="flex items-center gap-2.5 font-display text-lg font-medium text-ink"
              >
                <ToneIcon icon={Carrot} tone="food" size="sm" />
                {t`Ingredients (${ingredientCount}/${MAX_INGREDIENTS})`}
              </h3>
              {draft.ingredients.map((item, index) => (
                <fieldset
                  key={item.id}
                  className="grid min-w-0 gap-3 rounded-2xl bg-paper-2 p-4 sm:grid-cols-2"
                >
                  <legend className="float-left mb-1 font-display text-sm font-medium text-ink sm:col-span-2">
                    {t`Ingredient ${index + 1}: unmatched, unverified`}
                  </legend>
                  {(["rawText", "quantityText", "unitText", "foodText"] as const).map((key) => (
                    <div
                      key={key}
                      className={key === "rawText" ? "grid gap-1.5 sm:col-span-2" : "grid gap-1.5"}
                    >
                      <Label
                        htmlFor={`${item.id}-${key}`}
                        className="text-sm font-medium text-ink-3"
                      >
                        {
                          {
                            rawText: t`Original text`,
                            quantityText: t`Quantity (text)`,
                            unitText: t`Unit (text)`,
                            foodText: t`Food text`,
                          }[key]
                        }
                      </Label>
                      <Input
                        id={`${item.id}-${key}`}
                        maxLength={
                          { rawText: 2000, quantityText: 100, unitText: 100, foodText: 500 }[key]
                        }
                        value={item[key] ?? ""}
                        onChange={(event) =>
                          updateIngredient(item.id, (current) =>
                            editIngredientText(current, key, event.target.value),
                          )
                        }
                      />
                    </div>
                  ))}
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${item.id}-prep`} className="text-sm font-medium text-ink-3">
                      <Trans>Preparation</Trans>
                    </Label>
                    <select
                      id={`${item.id}-prep`}
                      className={`min-h-11 ${nativeSelectClass}`}
                      value={item.preparation}
                      onChange={(event) =>
                        updateIngredient(item.id, (current) => ({
                          ...current,
                          preparation: event.target.value as RecipeDraftIngredient["preparation"],
                        }))
                      }
                    >
                      <option value="unknown">{t`Unknown`}</option>
                      <option value="raw">{t`Raw`}</option>
                      <option value="cooked">{t`Cooked`}</option>
                    </select>
                  </div>
                  <Button
                    variant="ghost"
                    className="min-h-11 w-fit self-end text-ink-3 hover:text-destructive"
                    onClick={() =>
                      updateDraft((current) => ({
                        ...current,
                        ingredients: current.ingredients.filter(
                          (ingredient) => ingredient.id !== item.id,
                        ),
                      }))
                    }
                  >
                    <Trash2 aria-hidden="true" />
                    {t`Remove ingredient ${index + 1}`}
                  </Button>
                </fieldset>
              ))}
            </section>
            <Button
              variant="outline"
              className="min-h-11 w-fit"
              disabled={draft.ingredients.length >= MAX_INGREDIENTS}
              onClick={addIngredient}
            >
              <Plus aria-hidden="true" />
              <Trans>Add ingredient</Trans>
            </Button>
            <Details
              summary={
                <h3 className="text-sm">
                  <Trans>Source details (provenance only)</Trans>
                </h3>
              }
            >
              <section
                className="grid gap-1 rounded-2xl bg-paper-2 px-4 py-3"
                aria-label={t`Source metadata`}
              >
                <p className="text-sm text-ink-2">{t`Site: ${site}`}</p>
                <p className="text-sm text-ink-2">{t`Author: ${author}`}</p>
                <p className="text-sm text-ink-2">{t`Imported: ${importedAt}`}</p>
                <p className="text-sm break-all text-ink-2">{t`Source URL: ${sourceLink}`}</p>
                {safeSourceUrl(draft.source.url) ? (
                  <a
                    className={`min-h-11 w-fit content-center text-sm ${textLinkClass}`}
                    href={safeSourceUrl(draft.source.url)!}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Trans>Open source URL</Trans>
                  </a>
                ) : null}
              </section>
            </Details>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowPaste(true);
                  setMessage(t`Change the paste, then explicitly create a replacement draft.`);
                }}
              >
                <Trans>Change paste</Trans>
              </Button>
              <Button variant="destructive" onClick={clear}>
                <Trans>Discard draft</Trans>
              </Button>
            </div>
          </div>
        </Section>
      ) : null}
    </Page>
  );
}
