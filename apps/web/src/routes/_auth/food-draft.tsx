import type { FoodDraftCandidateWire } from "@openvalens/api/contracts/nutrition-food-drafts";
import {
  FOOD_DRAFT_COPY,
  FOOD_DRAFT_FLAG_LABELS,
  PHOTO_DRAFT_COPY,
} from "@openvalens/api/presenters/food-draft";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Textarea } from "@openvalens/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { client } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/food-draft")({ component: FoodDraftPage });

type Flag = FoodDraftCandidateWire["flags"][number];

/** Re-derives an item's flags after the member edits a field. */
function withFlags(flags: Flag[], cleared: Flag[], added: Flag | null): Flag[] {
  return [...flags.filter((flag) => !cleared.includes(flag)), ...(added ? [added] : [])];
}

/**
 * Describe a meal (#73). The member speaks with their keyboard's dictation or
 * types; this page never records audio. The draft is never saved: each item
 * is matched to a food in the diary and confirmed there.
 *
 * A meal photo (#71) feeds the same review. It is sent to the provider only
 * after a per-photo confirmation, with metadata stripped on the server, and
 * is never stored.
 */
function FoodDraftPage() {
  const [transcript, setTranscript] = useState("");
  const [useAi, setUseAi] = useState(false);
  const [aiAgreed, setAiAgreed] = useState(false);
  const [candidates, setCandidates] = useState<FoodDraftCandidateWire[] | null>(null);
  const [source, setSource] = useState<"text" | "photo">("text");
  const [message, setMessage] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoAgreed, setPhotoAgreed] = useState(false);
  const [photoMessage, setPhotoMessage] = useState("");
  const provider = useQuery({
    queryKey: ["nutritionFoodDrafts", "provider"],
    queryFn: () => client.nutritionFoodDrafts.provider({}),
  });
  const parse = useMutation({
    mutationFn: () =>
      client.nutritionFoodDrafts.parse({
        transcript,
        mode: useAi ? "ai" : "local",
        ...(useAi && provider.data?.provider
          ? { sendToProvider: { provider: provider.data.provider, host: provider.data.host } }
          : {}),
      }),
    onSuccess: (result) => {
      // A confirmation covers one send only.
      setAiAgreed(false);
      setSource("text");
      setCandidates(result.status === "ready" ? result.candidates : null);
      setMessage(FOOD_DRAFT_COPY.status[result.status]);
    },
    onError: () => setMessage("Could not make a draft. Nothing was saved."),
  });
  const parsePhoto = useMutation({
    mutationFn: (file: File) =>
      client.nutritionFoodDrafts.parsePhoto({
        photo: file,
        sendToProvider: {
          provider: provider.data?.provider ?? "",
          host: provider.data?.host ?? null,
        },
      }),
    onSuccess: (result) => {
      // A confirmation covers this one photo only.
      setPhotoAgreed(false);
      setSource("photo");
      setCandidates(result.status === "ready" ? result.candidates : null);
      setPhotoMessage(PHOTO_DRAFT_COPY.status[result.status]);
    },
    onError: () => setPhotoMessage("Could not make a draft. Nothing was saved."),
  });
  const edit = (id: string, patch: Partial<FoodDraftCandidateWire>) =>
    setCandidates((current) =>
      current ? current.map((item) => (item.id === id ? { ...item, ...patch } : item)) : current,
    );

  return (
    <main className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold">Describe a meal</h1>
        <p className="text-sm text-muted-foreground">{FOOD_DRAFT_COPY.intro}</p>
        <Link to="/nutrition" className="w-fit text-sm underline">
          Back to meal diary
        </Link>
      </header>
      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div className="grid gap-1.5">
            <Label htmlFor="food-draft-text">What did you have?</Label>
            <Textarea
              id="food-draft-text"
              maxLength={2000}
              value={transcript}
              placeholder="Two eggs, a slice of toast and a coffee"
              onChange={(event) => setTranscript(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">{FOOD_DRAFT_COPY.dictation}</p>
          </div>
          {provider.data?.available ? (
            <div className="grid gap-2 rounded-md border p-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={useAi}
                  onChange={(event) => {
                    setUseAi(event.target.checked);
                    setAiAgreed(false);
                  }}
                />
                Use the AI provider for this draft
              </label>
              {useAi ? (
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={aiAgreed}
                    onChange={(event) => setAiAgreed(event.target.checked)}
                  />
                  <span>
                    Send this text, and nothing else, to {provider.data.provider}
                    {provider.data.host ? ` (${provider.data.host})` : ""} now.{" "}
                    {FOOD_DRAFT_COPY.aiDisclosure}
                  </span>
                </label>
              ) : null}
            </div>
          ) : null}
          <Button
            className="w-fit"
            disabled={!transcript.trim() || (useAi && !aiAgreed) || parse.isPending}
            onClick={() => parse.mutate()}
          >
            {parse.isPending ? "Working…" : "Make a draft"}
          </Button>
          {message ? (
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {message}{" "}
              {message === FOOD_DRAFT_COPY.status.disabled ? (
                <Link to="/nutrition-targets" className="underline">
                  Nutrition settings
                </Link>
              ) : null}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {provider.data?.available ? (
        <Card>
          <CardHeader>
            <CardTitle>From a photo</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">{PHOTO_DRAFT_COPY.intro}</p>
            <div className="grid gap-1.5">
              <Label htmlFor="food-draft-photo">Meal photo (JPEG or PNG, up to 10 MB)</Label>
              <Input
                id="food-draft-photo"
                type="file"
                accept="image/jpeg,image/png"
                onChange={(event) => {
                  setPhoto(event.target.files?.[0] ?? null);
                  setPhotoAgreed(false);
                }}
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={photoAgreed}
                disabled={!photo}
                onChange={(event) => setPhotoAgreed(event.target.checked)}
              />
              <span>
                Send this photo to {provider.data.provider}
                {provider.data.host ? ` (${provider.data.host})` : ""} now.{" "}
                {PHOTO_DRAFT_COPY.disclosure}
              </span>
            </label>
            <Button
              className="w-fit"
              disabled={!photo || !photoAgreed || parsePhoto.isPending}
              onClick={() => photo && parsePhoto.mutate(photo)}
            >
              {parsePhoto.isPending ? "Working…" : "Make a draft from this photo"}
            </Button>
            {photoMessage ? (
              <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                {photoMessage}{" "}
                {photoMessage === PHOTO_DRAFT_COPY.status.disabled ? (
                  <Link to="/nutrition-targets" className="underline">
                    Nutrition settings
                  </Link>
                ) : null}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {candidates ? (
        <Card>
          <CardHeader>
            <CardTitle>Review the draft</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              {source === "photo" ? PHOTO_DRAFT_COPY.review : FOOD_DRAFT_COPY.review}
            </p>
            {candidates.map((item, index) => (
              <fieldset key={item.id} className="grid gap-3 rounded-lg border p-3">
                <legend className="px-1 text-sm font-medium">
                  Item {index + 1} ·{" "}
                  {source === "photo" ? "from the photo" : `heard “${item.sourceText}”`}
                </legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${item.id}-food`}>Food</Label>
                    <Input
                      id={`${item.id}-food`}
                      maxLength={200}
                      value={item.foodText}
                      onChange={(event) => edit(item.id, { foodText: event.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${item.id}-quantity`}>Quantity</Label>
                    <Input
                      id={`${item.id}-quantity`}
                      inputMode="decimal"
                      value={item.quantity ?? ""}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        const quantity =
                          event.target.value.trim() && Number.isFinite(value) && value > 0
                            ? value
                            : null;
                        edit(item.id, {
                          quantity,
                          flags: withFlags(
                            item.flags,
                            ["no_quantity", "vague_quantity"],
                            quantity === null ? "no_quantity" : null,
                          ),
                        });
                      }}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${item.id}-unit`}>Unit</Label>
                    <Input
                      id={`${item.id}-unit`}
                      maxLength={20}
                      value={item.unitText ?? ""}
                      onChange={(event) => {
                        const unitText = event.target.value.trim() || null;
                        edit(item.id, {
                          unitText,
                          flags: withFlags(
                            item.flags,
                            ["no_unit"],
                            unitText === null ? "no_unit" : null,
                          ),
                        });
                      }}
                    />
                  </div>
                </div>
                {item.flags.length ? (
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    {item.flags.map((flag) => FOOD_DRAFT_FLAG_LABELS[flag]).join(" · ")}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Link
                    to="/nutrition"
                    search={{ food: item.foodText }}
                    className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm"
                  >
                    Find and log this food
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setCandidates((current) =>
                        current ? current.filter((entry) => entry.id !== item.id) : current,
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              </fieldset>
            ))}
            <Button
              variant="destructive"
              className="w-fit"
              onClick={() => {
                setCandidates(null);
                setMessage("Draft discarded. Nothing was saved.");
              }}
            >
              Discard draft
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
