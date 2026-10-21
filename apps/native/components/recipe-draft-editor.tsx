import {
  parseRecipeDraft,
  type RecipeDraft,
  type RecipeDraftIngredient,
  type RecipeDraftParseResult,
} from "@openvalens/api/presenters/recipe-draft";
import { offlineScope } from "@openvalens/api/presenters/offline";
import { Button, Card, Spinner } from "heroui-native";
import { Link } from "expo-router";
import * as Crypto from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { Container } from "@/components/container";
import { authClient } from "@/lib/auth-client";

const MAX_INPUT = 1024 * 1024;
const MAX_INGREDIENTS = 200;
const INPUT = "min-h-11 rounded-lg border border-border bg-card px-3 py-2 text-base text-foreground";
const EMPTY_RESULT: RecipeDraftParseResult = { status: "empty", candidates: [], message: null };

function safeSourceUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function copyDraft(draft: RecipeDraft): RecipeDraft {
  return { ...draft, source: { ...draft.source }, ingredients: draft.ingredients.map((item) => ({ ...item })) };
}

export default function RecipeDraftEditor() {
  const { data: session, isPending } = authClient.useSession();
  const scope = offlineScope(session as Parameters<typeof offlineScope>[0]);
  const [activeScope, setActiveScope] = useState(scope);
  const [format, setFormat] = useState<"ingredients" | "json-ld">("ingredients");
  const [text, setText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [result, setResult] = useState<RecipeDraftParseResult>(EMPTY_RESULT);
  const [draft, setDraft] = useState<RecipeDraft | null>(null);
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [replacePending, setReplacePending] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const pasteRef = useRef<TextInput>(null);

  useEffect(() => {
    if (scope === activeScope) return;
    setActiveScope(scope); setText(""); setSourceUrl(""); setResult(EMPTY_RESULT); setDraft(null);
    setMessage(""); setDirty(false); setReplacePending(false); setShowPaste(false);
  }, [scope, activeScope]);

  const parse = () => {
    if (new TextEncoder().encode(text).length > MAX_INPUT) {
      setDraft(null); setResult({ status: "invalid", candidates: [], message: "Paste is over the 1 MiB limit. Shorten it and try again." });
      setMessage("The previous review was cleared. Your pasted text is still here."); return;
    }
    const parsed = parseRecipeDraft({ text, format, ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}), importedAt: new Date().toISOString() });
    setResult(parsed);
    if (parsed.status === "ready" && parsed.candidates.length === 1) { setDraft(copyDraft(parsed.candidates[0]!)); setDirty(false); setMessage(""); setShowPaste(false); }
    else { setDraft(null); setDirty(false); setMessage(parsed.status === "choose_recipe" ? "Choose the recipe you want to review." : parsed.message ?? "No draft was created."); }
  };
  const choose = (candidate: RecipeDraft) => { setDraft(copyDraft(candidate)); setDirty(false); setMessage(""); setShowPaste(false); };
  const changePaste = (next: string) => { setText(next); if (draft || result.candidates.length) { setResult(EMPTY_RESULT); setShowPaste(true); setMessage("Paste changed. Create a replacement draft explicitly."); } };
  const clear = () => { setText(""); setSourceUrl(""); setDraft(null); setResult(EMPTY_RESULT); setDirty(false); setReplacePending(false); setShowPaste(false); setMessage("Draft cleared. Nothing was saved."); pasteRef.current?.focus(); };
  const updateDraft = (update: (current: RecipeDraft) => RecipeDraft) => { setDraft((current) => current ? update(current) : current); setDirty(true); };
  const updateIngredient = (id: string, update: (item: RecipeDraftIngredient) => RecipeDraftIngredient) => updateDraft((current) => ({ ...current, ingredients: current.ingredients.map((item) => item.id === id ? update(item) : item) }));

  if (isPending || scope !== activeScope) return <Container><View className="flex-1 items-center justify-center p-6"><Spinner /></View></Container>;
  if (!scope) return <Container><View className="gap-2 p-4"><Text className="text-2xl font-semibold text-foreground">Recipe draft</Text><Text className="text-sm text-muted-foreground">Sign in to create a private, session-only draft.</Text></View></Container>;

  return <Container><KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 p-4">
    <View className="gap-2"><Text className="text-2xl font-semibold text-foreground" accessibilityRole="header">Recipe draft</Text><Text className="text-sm text-muted-foreground">Paste ingredients or Recipe JSON-LD. Nothing is fetched or saved.</Text><Text className="text-sm text-muted-foreground">This draft stays only in this screen session. Leaving or refreshing loses it.</Text><Link href="/nutrition" asChild><Pressable accessibilityRole="link" className="min-h-11 justify-center"><Text className="text-sm text-foreground underline">Back to meal diary</Text></Pressable></Link></View>
    {!draft || showPaste ? <Card variant="secondary" className="gap-3 p-4"><Text className="text-lg font-medium text-foreground" accessibilityRole="header">Paste recipe text</Text><View className="gap-1"><Text className="text-sm text-foreground">Paste format</Text><View className="flex-row flex-wrap gap-2"><Choice label="Ingredients" selected={format === "ingredients"} onPress={() => setFormat("ingredients")} /><Choice label="Recipe JSON-LD" selected={format === "json-ld"} onPress={() => setFormat("json-ld")} /></View></View>
      <TextInput ref={pasteRef} value={text} onChangeText={changePaste} multiline textAlignVertical="top" maxLength={MAX_INPUT} placeholder="Paste ingredients or JSON-LD" accessibilityLabel="Paste recipe text, up to 1 MiB" className={`${INPUT} min-h-48`} placeholderTextColor="#9ca3af" />
      <TextInput value={sourceUrl} onChangeText={setSourceUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="Source URL (optional, provenance only)" accessibilityLabel="Source URL, optional, provenance only" className={INPUT} placeholderTextColor="#9ca3af" />
      <View className="flex-row flex-wrap gap-2"><Button isDisabled={!text.trim()} onPress={() => { if (dirty && !replacePending) { setReplacePending(true); return; } parse(); setReplacePending(false); }}>Create draft</Button><Button variant="secondary" onPress={clear}>Clear</Button></View>
      {replacePending ? <Card variant="secondary" className="gap-2 p-3"><Text className="text-sm text-foreground">Parsing again will replace your edited review. Continue?</Text><View className="flex-row flex-wrap gap-2"><Button onPress={() => { setDraft(null); parse(); setReplacePending(false); }}>Replace review</Button><Button variant="secondary" onPress={() => setReplacePending(false)}>Keep review</Button></View></Card> : null}
      {message ? <Text className="text-sm text-muted-foreground" accessibilityLiveRegion="polite">{message}</Text> : null}
      {result.status === "choose_recipe" ? <View className="gap-2"><Text className="text-sm font-medium text-foreground">Choose a recipe to review</Text>{result.candidates.map((candidate) => <Button key={candidate.id} variant="secondary" onPress={() => choose(candidate)}>{candidate.title || "Untitled recipe"}</Button>)}</View> : null}
    </Card> : null}
    {draft && !showPaste ? <Card variant="secondary" className="gap-3 p-4"><Text className="text-lg font-medium text-foreground" accessibilityRole="header">Review draft</Text><Text className="rounded-lg border border-border p-3 text-sm text-muted-foreground">Ingredients remain unmatched and unverified. No nutrition values are calculated. This is not clinical advice.</Text>
      <Field label="Title" value={draft.title ?? ""} onChangeText={(value) => updateDraft((current) => ({ ...current, title: value || null }))} />
      <Field label="Servings (text)" value={draft.servingsText ?? ""} onChangeText={(value) => updateDraft((current) => ({ ...current, servingsText: value || null }))} />
      <View className="gap-3"><Text className="text-lg font-medium text-foreground" accessibilityRole="header">Ingredients ({draft.ingredients.length}/{MAX_INGREDIENTS})</Text>{draft.ingredients.map((item, index) => <View key={item.id} className="gap-2 rounded-lg border border-border p-3"><Text className="font-medium text-foreground">Ingredient {index + 1} · unmatched, unverified</Text>
        {(["rawText", "quantityText", "unitText", "foodText"] as const).map((key) => <Field key={key} label={({ rawText: "Original text", quantityText: "Quantity (text)", unitText: "Unit (text)", foodText: "Food text" })[key]} value={item[key] ?? ""} onChangeText={(value) => updateIngredient(item.id, (current) => ({ ...current, [key]: value || null }))} />)}
        <Text className="text-sm text-foreground">Preparation</Text><View className="flex-row flex-wrap gap-2">{(["unknown", "raw", "cooked"] as const).map((value) => <Choice key={value} label={value} selected={item.preparation === value} onPress={() => updateIngredient(item.id, (current) => ({ ...current, preparation: value }))} />)}</View>
        <Button variant="secondary" onPress={() => updateDraft((current) => ({ ...current, ingredients: current.ingredients.filter((ingredient) => ingredient.id !== item.id) }))}>Remove ingredient {index + 1}</Button>
      </View>)}</View>
      <Button variant="secondary" isDisabled={draft.ingredients.length >= MAX_INGREDIENTS} onPress={() => updateDraft((current) => current.ingredients.length >= MAX_INGREDIENTS ? current : { ...current, ingredients: [...current.ingredients, { id: Crypto.randomUUID(), rawText: "", quantityText: null, unitText: null, foodText: null, preparation: "unknown" }] })}>Add ingredient</Button>
      <View className="gap-1 rounded-lg border border-border p-3"><Text className="font-medium text-foreground">Source details (provenance only)</Text><Text className="text-sm text-muted-foreground">Site: {draft.source.site || "Not provided"}</Text><Text className="text-sm text-muted-foreground">Author: {draft.source.author || "Not provided"}</Text><Text className="text-sm text-muted-foreground">Imported: {draft.source.importedAt}</Text><Text className="text-sm text-muted-foreground">Source URL: {draft.source.url || "Not provided"}</Text>{safeSourceUrl(draft.source.url) ? <Link href={safeSourceUrl(draft.source.url)!} asChild><Pressable accessibilityRole="link" className="min-h-11 justify-center"><Text className="text-sm text-foreground underline">Open source URL</Text></Pressable></Link> : null}</View>
      <View className="flex-row flex-wrap gap-2"><Button variant="secondary" onPress={() => { setShowPaste(true); setMessage("Change the paste, then explicitly create a replacement draft."); }}>Change paste</Button><Button onPress={clear}>Discard draft</Button></View>
    </Card> : null}
  </ScrollView></KeyboardAvoidingView></Container>;
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} className={`min-h-11 justify-center rounded-lg border px-3 ${selected ? "bg-accent" : "border-border"}`}><Text className="text-sm text-foreground">{label}</Text></Pressable>;
}
function Field({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) {
  return <View className="gap-1"><Text className="text-sm font-medium text-foreground">{label}</Text><TextInput value={value} onChangeText={onChangeText} accessibilityLabel={label} className={INPUT} placeholderTextColor="#9ca3af" /></View>;
}
