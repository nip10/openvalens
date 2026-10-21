import {
  parseRecipeDraft,
  type RecipeDraft,
  type RecipeDraftIngredient,
  type RecipeDraftParseResult,
} from "@openvalens/api/presenters/recipe-draft";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Textarea } from "@openvalens/ui/components/textarea";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { offlineScope } from "@openvalens/api/presenters/offline";
import { authClient } from "@/lib/auth-client";

const MAX_INPUT = 1024 * 1024;
const MAX_INGREDIENTS = 200;
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

export function RecipeDraftEditor() {
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
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scope === activeScope) return;
    setActiveScope(scope);
    setText(""); setSourceUrl(""); setResult(EMPTY_RESULT); setDraft(null);
    setMessage(""); setDirty(false); setReplacePending(false); setShowPaste(false);
  }, [scope, activeScope]);

  const parse = () => {
    if (new TextEncoder().encode(text).length > MAX_INPUT) {
      setDraft(null); setResult({ status: "invalid", candidates: [], message: "Paste is over the 1 MiB limit. Shorten it and try again." });
      setMessage("The previous review was cleared. Your pasted text is still here.");
      return;
    }
    const parsed = parseRecipeDraft({ text, format, ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}), importedAt: new Date().toISOString() });
    setResult(parsed);
    if (parsed.status === "ready" && parsed.candidates.length === 1) {
      setDraft(copyDraft(parsed.candidates[0]!)); setDirty(false); setMessage(""); setShowPaste(false);
    } else {
      setDraft(null); setDirty(false);
      setMessage(parsed.status === "choose_recipe" ? "Choose the recipe you want to review." : parsed.message ?? "No draft was created.");
    }
  };
  const choose = (candidate: RecipeDraft) => { setDraft(copyDraft(candidate)); setDirty(false); setMessage(""); setShowPaste(false); };
  const changePaste = (next: string) => {
    setText(next);
    if (draft || result.candidates.length) { setResult(EMPTY_RESULT); setShowPaste(true); setMessage("Paste changed. Create a replacement draft explicitly."); }
  };
  const clear = () => {
    setText(""); setSourceUrl(""); setDraft(null); setResult(EMPTY_RESULT); setDirty(false); setReplacePending(false); setShowPaste(false); setMessage("Draft cleared. Nothing was saved.");
    textRef.current?.focus();
  };
  const updateDraft = (update: (current: RecipeDraft) => RecipeDraft) => {
    setDraft((current) => current ? update(current) : current); setDirty(true);
  };
  const addIngredient = () => updateDraft((current) => current.ingredients.length >= MAX_INGREDIENTS ? current : { ...current, ingredients: [...current.ingredients, { id: crypto.randomUUID(), rawText: "", quantityText: null, unitText: null, foodText: null, preparation: "unknown" }] });
  const updateIngredient = (id: string, update: (item: RecipeDraftIngredient) => RecipeDraftIngredient) => updateDraft((current) => ({ ...current, ingredients: current.ingredients.map((item) => item.id === id ? update(item) : item) }));

  if (isPending || scope !== activeScope) return <main className="mx-auto max-w-3xl px-4 py-6"><p role="status">Loading your workspace…</p></main>;
  if (!scope) return <main className="mx-auto max-w-3xl px-4 py-6"><h1 className="text-2xl font-semibold">Recipe draft</h1><p className="mt-2 text-sm text-muted-foreground">Sign in to create a private, session-only draft.</p></main>;

  return <main className="mx-auto grid max-w-3xl gap-5 px-4 py-6">
    <header className="grid gap-2"><h1 className="text-2xl font-semibold">Recipe draft</h1><p className="text-sm text-muted-foreground">Paste ingredients or Recipe JSON-LD. Nothing is fetched or saved.</p><p className="text-sm text-muted-foreground">This draft stays only in this screen session. Leaving or refreshing loses it.</p><Link to="/nutrition" className="min-h-11 w-fit content-center text-sm underline">Back to meal diary</Link></header>
    {!draft || showPaste ? <Card><CardHeader><CardTitle>Paste recipe text</CardTitle></CardHeader><CardContent className="grid gap-4">
      <fieldset className="grid gap-2"><legend className="text-sm font-medium">Paste format</legend><label className="flex min-h-11 items-center gap-2"><input type="radio" name="format" checked={format === "ingredients"} onChange={() => setFormat("ingredients")} />Ingredients</label><label className="flex min-h-11 items-center gap-2"><input type="radio" name="format" checked={format === "json-ld"} onChange={() => setFormat("json-ld")} />Recipe JSON-LD</label></fieldset>
      <div className="grid gap-1.5"><Label htmlFor="recipe-paste">Paste text (up to 1 MiB)</Label><Textarea ref={textRef} id="recipe-paste" value={text} maxLength={MAX_INPUT} onChange={(event) => changePaste(event.target.value)} className="min-h-48" /></div>
      <div className="grid gap-1.5"><Label htmlFor="recipe-source">Source URL (optional, provenance only)</Label><Input id="recipe-source" type="url" autoComplete="off" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /></div>
      <div className="flex flex-wrap gap-2"><Button onClick={() => { if (dirty && draft && !replacePending) { setReplacePending(true); return; } parse(); setReplacePending(false); }} disabled={!text.trim()}>Create draft</Button><Button variant="outline" onClick={clear}>Clear</Button></div>
      {replacePending ? <div role="alert" className="grid gap-2 rounded-lg border p-3"><p className="text-sm">Parsing again will replace your edited review. Continue?</p><div className="flex flex-wrap gap-2"><Button variant="destructive" onClick={() => { setDraft(null); parse(); setReplacePending(false); }}>Replace review</Button><Button variant="outline" onClick={() => setReplacePending(false)}>Keep review</Button></div></div> : null}
      {message ? <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
      {result.status === "choose_recipe" ? <fieldset className="grid gap-2"><legend className="text-sm font-medium">Choose a recipe to review</legend>{result.candidates.map((candidate) => <Button key={candidate.id} variant="outline" className="h-auto min-h-11 justify-start whitespace-normal py-2 text-left" onClick={() => choose(candidate)}>{candidate.title || "Untitled recipe"}</Button>)}</fieldset> : null}
    </CardContent></Card> : null}
    {draft && !showPaste ? <Card><CardHeader><CardTitle>Review draft</CardTitle></CardHeader><CardContent className="grid gap-4">
      <p className="rounded-md border p-3 text-sm">Ingredients remain unmatched and unverified. No nutrition values are calculated. This is not clinical advice.</p>
      <div className="grid gap-1.5"><Label htmlFor="draft-title">Title</Label><Input id="draft-title" value={draft.title ?? ""} onChange={(event) => updateDraft((current) => ({ ...current, title: event.target.value || null }))} /></div>
      <div className="grid gap-1.5"><Label htmlFor="draft-servings">Servings (text)</Label><Input id="draft-servings" value={draft.servingsText ?? ""} onChange={(event) => updateDraft((current) => ({ ...current, servingsText: event.target.value || null }))} /></div>
      <section className="grid gap-3" aria-labelledby="draft-ingredients-title"><h2 id="draft-ingredients-title" className="text-lg font-medium">Ingredients ({draft.ingredients.length}/{MAX_INGREDIENTS})</h2>{draft.ingredients.map((item, index) => <fieldset key={item.id} className="grid gap-3 rounded-lg border p-3"><legend className="px-1 text-sm font-medium">Ingredient {index + 1} · unmatched, unverified</legend>
        {(["rawText", "quantityText", "unitText", "foodText"] as const).map((key) => <div key={key} className="grid gap-1.5"><Label htmlFor={`${item.id}-${key}`}>{({ rawText: "Original text", quantityText: "Quantity (text)", unitText: "Unit (text)", foodText: "Food text" })[key]}</Label><Input id={`${item.id}-${key}`} value={item[key] ?? ""} onChange={(event) => updateIngredient(item.id, (current) => ({ ...current, [key]: event.target.value || null }))} /></div>)}
        <div className="grid gap-1.5"><Label htmlFor={`${item.id}-prep`}>Preparation</Label><select id={`${item.id}-prep`} className="min-h-11 rounded-md border bg-background px-3" value={item.preparation} onChange={(event) => updateIngredient(item.id, (current) => ({ ...current, preparation: event.target.value as RecipeDraftIngredient["preparation"] }))}><option value="unknown">Unknown</option><option value="raw">Raw</option><option value="cooked">Cooked</option></select></div>
        <Button variant="outline" className="min-h-11 w-fit" onClick={() => updateDraft((current) => ({ ...current, ingredients: current.ingredients.filter((ingredient) => ingredient.id !== item.id) }))}>Remove ingredient {index + 1}</Button>
      </fieldset>)}</section>
      <Button variant="outline" className="min-h-11 w-fit" disabled={draft.ingredients.length >= MAX_INGREDIENTS} onClick={addIngredient}>Add ingredient</Button>
      <section className="grid gap-1 rounded-lg border p-3" aria-label="Source metadata"><h2 className="font-medium">Source details (provenance only)</h2><p className="text-sm">Site: {draft.source.site || "Not provided"}</p><p className="text-sm">Author: {draft.source.author || "Not provided"}</p><p className="text-sm">Imported: {draft.source.importedAt}</p><p className="break-all text-sm">Source URL: {draft.source.url || "Not provided"}</p>{safeSourceUrl(draft.source.url) ? <a className="min-h-11 content-center text-sm underline" href={safeSourceUrl(draft.source.url)!} target="_blank" rel="noreferrer">Open source URL</a> : null}</section>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { setShowPaste(true); setMessage("Change the paste, then explicitly create a replacement draft."); }}>Change paste</Button><Button variant="destructive" onClick={clear}>Discard draft</Button></div>
    </CardContent></Card> : null}
  </main>;
}
