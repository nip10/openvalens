import { Trans, useLingui } from "@lingui/react/macro";
import {
  parseRecipeDraft,
  RECIPE_IMPORT_COPY,
  type RecipeDraft,
  type RecipeDraftIngredient,
} from "@openvalens/api/presenters/recipe-draft";
import { offlineScope } from "@openvalens/api/presenters/offline";
import { useMutation } from "@tanstack/react-query";
import { Button, Spinner } from "heroui-native";
import { Link, type Href } from "expo-router";
import * as Crypto from "expo-crypto";
import {
  ArrowLeft,
  Carrot,
  ChefHat,
  ClipboardPaste,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react-native";
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

import { Details, Icon, Page, PageHeader, Section, ToneIcon } from "@/components/bloom";
import { Container } from "@/components/container";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

const MAX_INPUT = 1024 * 1024;
const MAX_INGREDIENTS = 200;
const INPUT =
  "min-h-11 rounded-xl border border-rule bg-sheet px-3 py-2 font-sans text-base text-ink";
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
  const { t, i18n } = useLingui();
  const placeholder = useThemeColor("ink-3");

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
        <Page>
          <PageHeader
            title={<Trans>Recipe draft</Trans>}
            description={<Trans>Sign in to create a private, session-only draft.</Trans>}
          />
        </Page>
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
        <ScrollView keyboardShouldPersistTaps="handled">
          <Page>
            <PageHeader
              title={<Trans>Recipe draft</Trans>}
              info={
                <Trans>
                  Paste ingredients or Recipe JSON-LD, or import one recipe page if you turned that
                  on in nutrition settings. Nothing is saved.
                </Trans>
              }
              description={
                <Trans>Not saved. Discard the draft to clear it; reloading may lose it.</Trans>
              }
              actions={
                <Link href="/nutrition" asChild>
                  <Button variant="outline" size="sm" accessibilityRole="link">
                    <Icon icon={ArrowLeft} size={16} color="food" />
                    <Button.Label>
                      <Trans>Back to meal diary</Trans>
                    </Button.Label>
                  </Button>
                </Link>
              }
            />
            {!draft || showPaste ? (
              <Section
                icon={ClipboardPaste}
                tone="food"
                sheet
                title={<Trans>Paste recipe text</Trans>}
              >
                <View className="gap-2">
                  <Text className="font-sans text-sm font-medium text-ink-3">
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
                      label={i18n._(RECIPE_IMPORT_COPY.urlLabel)}
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
                    placeholderTextColor={placeholder}
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
                      ? i18n._(RECIPE_IMPORT_COPY.urlLabel)
                      : t`Source URL (optional, provenance only)`
                  }
                  accessibilityLabel={
                    format === "url"
                      ? i18n._(RECIPE_IMPORT_COPY.urlLabel)
                      : t`Source URL, optional, provenance only`
                  }
                  className={INPUT}
                  placeholderTextColor={placeholder}
                />
                {format === "url" ? (
                  <Text className="font-sans text-sm text-ink-3">
                    {i18n._(RECIPE_IMPORT_COPY.urlHint)}
                  </Text>
                ) : null}
                <View className="flex-row flex-wrap gap-2">
                  <Button
                    isDisabled={
                      (format === "url"
                        ? !sourceUrl.trim() || importUrl.isPending
                        : !text.trim()) || replacePending
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
                    <Icon icon={Sparkles} size={16} color="accent-foreground" />
                    <Button.Label>
                      {importUrl.isPending ? i18n._(RECIPE_IMPORT_COPY.importing) : t`Create draft`}
                    </Button.Label>
                  </Button>
                  <Button variant="ghost" onPress={clear}>
                    <Button.Label>
                      <Trans>Clear</Trans>
                    </Button.Label>
                  </Button>
                </View>
                {replacePending ? (
                  <View className="gap-2 rounded-2xl bg-warning/10 px-4 py-3">
                    <Text className="font-sans text-sm text-ink-2">
                      <Trans>Parsing again will replace your edited review. Continue?</Trans>
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        onPress={() => {
                          setDraft(null);
                          parse();
                          setReplacePending(false);
                        }}
                      >
                        <Button.Label>
                          <Trans>Replace review</Trans>
                        </Button.Label>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onPress={() => {
                          setReplacePending(false);
                          setShowPaste(false);
                        }}
                      >
                        <Button.Label>
                          <Trans>Keep review</Trans>
                        </Button.Label>
                      </Button>
                    </View>
                  </View>
                ) : null}
                {message ? (
                  <Text className="font-sans text-sm text-ink-2" accessibilityLiveRegion="polite">
                    {message}
                  </Text>
                ) : null}
                {result.status === "choose_recipe" ? (
                  <View className="gap-2">
                    <Text className="font-sans text-sm font-medium text-ink-3">
                      <Trans>Choose a recipe to review</Trans>
                    </Text>
                    {result.candidates.map((candidate) => (
                      <Button
                        key={candidate.id}
                        variant="outline"
                        onPress={() => choose(candidate)}
                      >
                        <Button.Label>{candidate.title || t`Untitled recipe`}</Button.Label>
                      </Button>
                    ))}
                  </View>
                ) : null}
              </Section>
            ) : null}
            {draft && !showPaste ? (
              <Section icon={ChefHat} tone="food" sheet title={<Trans>Review draft</Trans>}>
                <View className="flex-row items-start gap-2 rounded-2xl bg-paper-2 px-4 py-3">
                  <View className="pt-0.5">
                    <Icon icon={ShieldCheck} size={16} />
                  </View>
                  <Text className="flex-1 font-sans text-sm text-ink-2">
                    <Trans comment="safety">
                      Ingredients remain unmatched and unverified. No nutrition values are
                      calculated. This is not clinical advice.
                    </Trans>
                  </Text>
                </View>
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
                <View className="gap-3 pt-2">
                  <View className="flex-row items-center gap-2.5">
                    <ToneIcon icon={Carrot} tone="food" size="sm" />
                    <Text
                      className="font-display text-lg font-medium text-ink"
                      accessibilityRole="header"
                    >
                      {t`Ingredients (${ingredientCount}/${MAX_INGREDIENTS})`}
                    </Text>
                  </View>
                  {draft.ingredients.map((item, index) => (
                    <View key={item.id} className="gap-3 rounded-2xl bg-paper-2 p-4">
                      <Text className="font-display text-sm font-medium text-ink">
                        {t`Ingredient ${index + 1}: unmatched, unverified`}
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
                      <View className="gap-1.5">
                        <Text className="font-sans text-sm font-medium text-ink-3">
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
                      </View>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="self-start"
                        onPress={() =>
                          updateDraft((current) => ({
                            ...current,
                            ingredients: current.ingredients.filter(
                              (ingredient) => ingredient.id !== item.id,
                            ),
                          }))
                        }
                      >
                        <Icon icon={Trash2} size={16} color="ink-3" />
                        <Button.Label>{t`Remove ingredient ${index + 1}`}</Button.Label>
                      </Button>
                    </View>
                  ))}
                </View>
                <Button
                  variant="outline"
                  className="self-start"
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
                  <Icon icon={Plus} size={16} color="ink-2" />
                  <Button.Label>
                    <Trans>Add ingredient</Trans>
                  </Button.Label>
                </Button>
                <Details summary={<Trans>Source details (provenance only)</Trans>}>
                  <View className="gap-1 rounded-2xl bg-paper-2 px-4 py-3">
                    <Text className="font-sans text-sm text-ink-2">{t`Site: ${site}`}</Text>
                    <Text className="font-sans text-sm text-ink-2">{t`Author: ${author}`}</Text>
                    <Text className="font-sans text-sm text-ink-2">{t`Imported: ${importedAt}`}</Text>
                    <Text className="font-sans text-sm text-ink-2">
                      {t`Source URL: ${sourceLink}`}
                    </Text>
                    {safeSourceUrl(draft.source.url) ? (
                      <Link href={safeSourceUrl(draft.source.url)! as Href} asChild>
                        <Pressable accessibilityRole="link" className="min-h-11 justify-center">
                          <Text className="font-sans text-sm text-signal underline">
                            <Trans>Open source URL</Trans>
                          </Text>
                        </Pressable>
                      </Link>
                    ) : null}
                  </View>
                </Details>
                <View className="flex-row flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onPress={() => {
                      setShowPaste(true);
                      setMessage(t`Change the paste, then explicitly create a replacement draft.`);
                    }}
                  >
                    <Button.Label>
                      <Trans>Change paste</Trans>
                    </Button.Label>
                  </Button>
                  <Button variant="danger" onPress={clear}>
                    <Button.Label>
                      <Trans>Discard draft</Trans>
                    </Button.Label>
                  </Button>
                </View>
              </Section>
            ) : null}
          </Page>
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
      className={`min-h-11 justify-center rounded-full border px-4 ${selected ? "border-food bg-food-soft" : "border-rule bg-sheet"}`}
    >
      <Text className={`font-sans text-sm ${selected ? "font-semibold text-ink" : "text-ink-2"}`}>
        {label}
      </Text>
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
  const placeholder = useThemeColor("ink-3");
  return (
    <View className="gap-1.5">
      <Text className="font-sans text-sm font-medium text-ink-3">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        maxLength={maxLength}
        accessibilityLabel={label}
        className={INPUT}
        placeholderTextColor={placeholder}
      />
    </View>
  );
}
