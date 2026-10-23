import { Trans, useLingui } from "@lingui/react/macro";
import {
  parseRecipeDraft,
  RECIPE_IMPORT_COPY,
  type RecipeDraft,
  type RecipeDraftIngredient,
} from "@openvalens/api/presenters/recipe-draft";
import { offlineScope } from "@openvalens/api/presenters/offline";
import { useMutation } from "@tanstack/react-query";
import { Button, Card, Spinner } from "heroui-native";
import { Link } from "expo-router";
import * as Crypto from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { Container } from "@/components/container";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

const MAX_INPUT = 1024 * 1024;
const MAX_INGREDIENTS = 200;
const INPUT =
  "min-h-11 rounded-lg border border-border bg-card px-3 py-2 text-base text-foreground";
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

export default function RecipeDraftEditor() {
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
  const pasteRef = useRef<TextInput>(null);
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
    pasteRef.current?.focus();
  };
  const updateDraft = (update: (current: RecipeDraft) => RecipeDraft) => {
    setDraft((current) => (current ? update(current) : current));
    setDirty(true);
  };
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
      <Container>
        <View className="flex-1 items-center justify-center p-6">
          <Spinner />
        </View>
      </Container>
    );
  if (!scope)
    return (
      <Container>
        <View className="gap-2 p-4">
          <Text className="text-2xl font-semibold text-foreground">
            <Trans>Recipe draft</Trans>
          </Text>
          <Text className="text-sm text-muted-foreground">
            <Trans>Sign in to create a private, session-only draft.</Trans>
          </Text>
        </View>
      </Container>
    );

  const notProvided = t`Not provided`;
  const ingredientCount = draft?.ingredients.length ?? 0;
  const site = draft?.source.site || notProvided;
  const author = draft?.source.author || notProvided;
  const importedAt = draft?.source.importedAt ?? "";
  const sourceLink = draft?.source.url || notProvided;

  return (
    <Container>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 p-4">
          <View className="gap-2">
            <Text className="text-2xl font-semibold text-foreground" accessibilityRole="header">
              <Trans>Recipe draft</Trans>
            </Text>
            <Text className="text-sm text-muted-foreground">
              <Trans>
                Paste ingredients or Recipe JSON-LD, or import one recipe page if you turned that on
                in nutrition settings. Nothing is saved.
              </Trans>
            </Text>
            <Text className="text-sm text-muted-foreground">
              <Trans>Not saved. Discard the draft to clear it; reloading may lose it.</Trans>
            </Text>
            <Link href="/nutrition" asChild>
              <Pressable accessibilityRole="link" className="min-h-11 justify-center">
                <Text className="text-sm text-foreground underline">
                  <Trans>Back to meal diary</Trans>
                </Text>
              </Pressable>
            </Link>
          </View>
          {!draft || showPaste ? (
            <Card variant="secondary" className="gap-3 p-4">
              <Text className="text-lg font-medium text-foreground" accessibilityRole="header">
                <Trans>Paste recipe text</Trans>
              </Text>
              <View className="gap-1">
                <Text className="text-sm text-foreground">
                  <Trans>Paste format</Trans>
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  <Choice
                    label={t`Ingredients`}
                    selected={format === "ingredients"}
                    onPress={() => setFormat("ingredients")}
                  />
                  <Choice
                    label={t`Recipe JSON-LD`}
                    selected={format === "json-ld"}
                    onPress={() => setFormat("json-ld")}
                  />
                  <Choice
                    label={RECIPE_IMPORT_COPY.urlLabel}
                    selected={format === "url"}
                    onPress={() => setFormat("url")}
                  />
                </View>
              </View>
              {format !== "url" ? (
                <TextInput
                  ref={pasteRef}
                  value={text}
                  onChangeText={changePaste}
                  multiline
                  textAlignVertical="top"
                  placeholder={t`Paste ingredients or JSON-LD`}
                  accessibilityLabel={t`Paste recipe text, up to 1 MiB`}
                  className={`${INPUT} min-h-48`}
                  placeholderTextColor="#9ca3af"
                />
              ) : null}
              <TextInput
                value={sourceUrl}
                onChangeText={setSourceUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder={
                  format === "url"
                    ? RECIPE_IMPORT_COPY.urlLabel
                    : t`Source URL (optional, provenance only)`
                }
                accessibilityLabel={
                  format === "url"
                    ? RECIPE_IMPORT_COPY.urlLabel
                    : t`Source URL, optional, provenance only`
                }
                className={INPUT}
                placeholderTextColor="#9ca3af"
              />
              {format === "url" ? (
                <Text className="text-xs text-muted-foreground">{RECIPE_IMPORT_COPY.urlHint}</Text>
              ) : null}
              <View className="flex-row flex-wrap gap-2">
                <Button
                  isDisabled={
                    (format === "url" ? !sourceUrl.trim() || importUrl.isPending : !text.trim()) ||
                    replacePending
                  }
                  onPress={() => {
                    if (replacePending) return;
                    if (dirty && draft) {
                      setReplacePending(true);
                      return;
                    }
                    parse();
                  }}
                >
                  {importUrl.isPending ? RECIPE_IMPORT_COPY.importing : t`Create draft`}
                </Button>
                <Button variant="secondary" onPress={clear}>
                  <Trans>Clear</Trans>
                </Button>
              </View>
              {replacePending ? (
                <Card variant="secondary" className="gap-2 p-3">
                  <Text className="text-sm text-foreground">
                    <Trans>Parsing again will replace your edited review. Continue?</Trans>
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      onPress={() => {
                        setDraft(null);
                        parse();
                        setReplacePending(false);
                      }}
                    >
                      <Trans>Replace review</Trans>
                    </Button>
                    <Button
                      variant="secondary"
                      onPress={() => {
                        setReplacePending(false);
                        setShowPaste(false);
                      }}
                    >
                      <Trans>Keep review</Trans>
                    </Button>
                  </View>
                </Card>
              ) : null}
              {message ? (
                <Text className="text-sm text-muted-foreground" accessibilityLiveRegion="polite">
                  {message}
                </Text>
              ) : null}
              {result.status === "choose_recipe" ? (
                <View className="gap-2">
                  <Text className="text-sm font-medium text-foreground">
                    <Trans>Choose a recipe to review</Trans>
                  </Text>
                  {result.candidates.map((candidate) => (
                    <Button
                      key={candidate.id}
                      variant="secondary"
                      onPress={() => choose(candidate)}
                    >
                      {candidate.title || t`Untitled recipe`}
                    </Button>
                  ))}
                </View>
              ) : null}
            </Card>
          ) : null}
          {draft && !showPaste ? (
            <Card variant="secondary" className="gap-3 p-4">
              <Text className="text-lg font-medium text-foreground" accessibilityRole="header">
                <Trans>Review draft</Trans>
              </Text>
              <Text className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
                <Trans comment="safety">
                  Ingredients remain unmatched and unverified. No nutrition values are calculated.
                  This is not clinical advice.
                </Trans>
              </Text>
              <Field
                label={t`Title`}
                maxLength={300}
                value={draft.title ?? ""}
                onChangeText={(value) =>
                  updateDraft((current) => ({ ...current, title: value || null }))
                }
              />
              <Field
                label={t`Servings (text)`}
                maxLength={200}
                value={draft.servingsText ?? ""}
                onChangeText={(value) =>
                  updateDraft((current) => ({ ...current, servingsText: value || null }))
                }
              />
              <View className="gap-3">
                <Text className="text-lg font-medium text-foreground" accessibilityRole="header">
                  {t`Ingredients (${ingredientCount}/${MAX_INGREDIENTS})`}
                </Text>
                {draft.ingredients.map((item, index) => (
                  <View key={item.id} className="gap-2 rounded-lg border border-border p-3">
                    <Text className="font-medium text-foreground">
                      {t`Ingredient ${index + 1} · unmatched, unverified`}
                    </Text>
                    {(["rawText", "quantityText", "unitText", "foodText"] as const).map((key) => (
                      <Field
                        key={key}
                        label={
                          {
                            rawText: t`Original text`,
                            quantityText: t`Quantity (text)`,
                            unitText: t`Unit (text)`,
                            foodText: t`Food text`,
                          }[key]
                        }
                        maxLength={
                          { rawText: 2000, quantityText: 100, unitText: 100, foodText: 500 }[key]
                        }
                        value={item[key] ?? ""}
                        onChangeText={(value) =>
                          updateIngredient(item.id, (current) =>
                            editIngredientText(current, key, value),
                          )
                        }
                      />
                    ))}
                    <Text className="text-sm text-foreground">
                      <Trans>Preparation</Trans>
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      {(["unknown", "raw", "cooked"] as const).map((value) => (
                        <Choice
                          key={value}
                          label={{ unknown: t`Unknown`, raw: t`Raw`, cooked: t`Cooked` }[value]}
                          selected={item.preparation === value}
                          onPress={() =>
                            updateIngredient(item.id, (current) => ({
                              ...current,
                              preparation: value,
                            }))
                          }
                        />
                      ))}
                    </View>
                    <Button
                      variant="secondary"
                      onPress={() =>
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
                  </View>
                ))}
              </View>
              <Button
                variant="secondary"
                isDisabled={draft.ingredients.length >= MAX_INGREDIENTS}
                onPress={() =>
                  updateDraft((current) =>
                    current.ingredients.length >= MAX_INGREDIENTS
                      ? current
                      : {
                          ...current,
                          ingredients: [
                            ...current.ingredients,
                            {
                              id: Crypto.randomUUID(),
                              rawText: "",
                              quantityText: null,
                              unitText: null,
                              foodText: null,
                              preparation: "unknown",
                            },
                          ],
                        },
                  )
                }
              >
                <Trans>Add ingredient</Trans>
              </Button>
              <View className="gap-1 rounded-lg border border-border p-3">
                <Text className="font-medium text-foreground">
                  <Trans>Source details (provenance only)</Trans>
                </Text>
                <Text className="text-sm text-muted-foreground">{t`Site: ${site}`}</Text>
                <Text className="text-sm text-muted-foreground">{t`Author: ${author}`}</Text>
                <Text className="text-sm text-muted-foreground">{t`Imported: ${importedAt}`}</Text>
                <Text className="text-sm text-muted-foreground">{t`Source URL: ${sourceLink}`}</Text>
                {safeSourceUrl(draft.source.url) ? (
                  <Link href={safeSourceUrl(draft.source.url)!} asChild>
                    <Pressable accessibilityRole="link" className="min-h-11 justify-center">
                      <Text className="text-sm text-foreground underline">
                        <Trans>Open source URL</Trans>
                      </Text>
                    </Pressable>
                  </Link>
                ) : null}
              </View>
              <View className="flex-row flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onPress={() => {
                    setShowPaste(true);
                    setMessage(t`Change the paste, then explicitly create a replacement draft.`);
                  }}
                >
                  <Trans>Change paste</Trans>
                </Button>
                <Button onPress={clear}>
                  <Trans>Discard draft</Trans>
                </Button>
              </View>
            </Card>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Container>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`min-h-11 justify-center rounded-lg border px-3 ${selected ? "bg-accent" : "border-border"}`}
    >
      <Text className="text-sm text-foreground">{label}</Text>
    </Pressable>
  );
}
function Field({
  label,
  value,
  onChangeText,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  maxLength?: number;
}) {
  return (
    <View className="gap-1">
      <Text className="text-sm font-medium text-foreground">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        maxLength={maxLength}
        accessibilityLabel={label}
        className={INPUT}
        placeholderTextColor="#9ca3af"
      />
    </View>
  );
}
