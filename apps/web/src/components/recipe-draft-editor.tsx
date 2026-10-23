import {
  parseRecipeDraft,
  RECIPE_IMPORT_COPY,
  type RecipeDraft,
  type RecipeDraftIngredient,
} from "@openvalens/api/presenters/recipe-draft";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Textarea } from "@openvalens/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { offlineScope } from "@openvalens/api/presenters/offline";
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
  const { t } = useLingui();

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
    show(parsed);
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
      <main className="mx-auto max-w-3xl px-4 py-6">
        <p role="status">
          <Trans>Loading your workspace…</Trans>
        </p>
      </main>
    );
  if (!scope)
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-2xl font-semibold">
          <Trans>Recipe draft</Trans>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <Trans>Sign in to create a private, session-only draft.</Trans>
        </p>
      </main>
    );

  const notProvided = t`Not provided`;
  const ingredientCount = draft?.ingredients.length ?? 0;
  const site = draft?.source.site || notProvided;
  const author = draft?.source.author || notProvided;
  const importedAt = draft?.source.importedAt ?? "";
  const sourceLink = draft?.source.url || notProvided;

  return (
    <main className="mx-auto grid max-w-3xl gap-5 px-4 py-6">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold">
          <Trans>Recipe draft</Trans>
        </h1>
        <p className="text-sm text-muted-foreground">
          <Trans>
            Paste ingredients or Recipe JSON-LD, or import one recipe page if you turned that on in
            nutrition settings. Nothing is saved.
          </Trans>
        </p>
        <p className="text-sm text-muted-foreground">
          <Trans>Not saved. Discard the draft to clear it; reloading may lose it.</Trans>
        </p>
        <Link to="/nutrition" className="min-h-11 w-fit content-center text-sm underline">
          <Trans>Back to meal diary</Trans>
        </Link>
      </header>
      {!draft || showPaste ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Paste recipe text</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">
                <Trans>Paste format</Trans>
              </legend>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="format"
                  checked={format === "ingredients"}
                  onChange={() => setFormat("ingredients")}
                />
                <Trans>Ingredients</Trans>
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="format"
                  checked={format === "json-ld"}
                  onChange={() => setFormat("json-ld")}
                />
                <Trans>Recipe JSON-LD</Trans>
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="format"
                  checked={format === "url"}
                  onChange={() => setFormat("url")}
                />
                {RECIPE_IMPORT_COPY.urlLabel}
              </label>
            </fieldset>
            {format !== "url" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="recipe-paste">
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
              <Label htmlFor="recipe-source">
                {format === "url"
                  ? RECIPE_IMPORT_COPY.urlLabel
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
                <p className="text-xs text-muted-foreground">
                  {RECIPE_IMPORT_COPY.urlHint}{" "}
                  <Link to="/nutrition-targets" className="underline">
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
                {importUrl.isPending ? RECIPE_IMPORT_COPY.importing : t`Create draft`}
              </Button>
              <Button variant="outline" onClick={clear}>
                <Trans>Clear</Trans>
              </Button>
            </div>
            {replacePending ? (
              <div role="alert" className="grid gap-2 rounded-lg border p-3">
                <p className="text-sm">
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
              <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                {message}
              </p>
            ) : null}
            {result.status === "choose_recipe" ? (
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">
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
          </CardContent>
        </Card>
      ) : null}
      {draft && !showPaste ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Review draft</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="rounded-md border p-3 text-sm">
              <Trans comment="safety">
                Ingredients remain unmatched and unverified. No nutrition values are calculated.
                This is not clinical advice.
              </Trans>
            </p>
            <div className="grid gap-1.5">
              <Label htmlFor="draft-title">
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
              <Label htmlFor="draft-servings">
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
            <section className="grid gap-3" aria-labelledby="draft-ingredients-title">
              <h2 id="draft-ingredients-title" className="text-lg font-medium">
                {t`Ingredients (${ingredientCount}/${MAX_INGREDIENTS})`}
              </h2>
              {draft.ingredients.map((item, index) => (
                <fieldset key={item.id} className="grid gap-3 rounded-lg border p-3">
                  <legend className="px-1 text-sm font-medium">
                    {t`Ingredient ${index + 1} · unmatched, unverified`}
                  </legend>
                  {(["rawText", "quantityText", "unitText", "foodText"] as const).map((key) => (
                    <div key={key} className="grid gap-1.5">
                      <Label htmlFor={`${item.id}-${key}`}>
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
                    <Label htmlFor={`${item.id}-prep`}>
                      <Trans>Preparation</Trans>
                    </Label>
                    <select
                      id={`${item.id}-prep`}
                      className="min-h-11 rounded-md border bg-background px-3"
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
                    variant="outline"
                    className="min-h-11 w-fit"
                    onClick={() =>
                      updateDraft((current) => ({
                        ...current,
                        ingredients: current.ingredients.filter(
                          (ingredient) => ingredient.id !== item.id,
                        ),
                      }))
                    }
                  >
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
              <Trans>Add ingredient</Trans>
            </Button>
            <section className="grid gap-1 rounded-lg border p-3" aria-label={t`Source metadata`}>
              <h2 className="font-medium">
                <Trans>Source details (provenance only)</Trans>
              </h2>
              <p className="text-sm">{t`Site: ${site}`}</p>
              <p className="text-sm">{t`Author: ${author}`}</p>
              <p className="text-sm">{t`Imported: ${importedAt}`}</p>
              <p className="break-all text-sm">{t`Source URL: ${sourceLink}`}</p>
              {safeSourceUrl(draft.source.url) ? (
                <a
                  className="min-h-11 content-center text-sm underline"
                  href={safeSourceUrl(draft.source.url)!}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Trans>Open source URL</Trans>
                </a>
              ) : null}
            </section>
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
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
