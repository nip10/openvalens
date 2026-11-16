import type { FoodDraftCandidateWire } from "@openvalens/api/contracts/nutrition-food-drafts";
import { aiAppDraftIdentity, aiAppName } from "@openvalens/api/presenters/ai-apps";
import {
  FOOD_DRAFT_COPY,
  FOOD_DRAFT_FLAG_LABELS,
  PHOTO_DRAFT_COPY,
} from "@openvalens/api/presenters/food-draft";
import { isPayloadTooLarge, photoUploadProblem } from "@openvalens/api/photo-upload";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Textarea } from "@openvalens/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Camera, Mic, Search, Sparkles } from "lucide-react";
import { useState } from "react";

import { DecimalHint } from "@/components/decimal-hint";
import {
  AiAppFoodDrafts,
  useAiAppDraftActions,
  ViaApp,
  type AiAppFoodDraft,
} from "@/components/ai-app-drafts";
import { textLinkClass } from "@/components/food-classes";
import { InfoTip, StatusPill } from "@/components/page";
import { useNutritionSettings } from "@/utils/nutrition-settings";
import { client } from "@/utils/orpc";
import { parseDecimal } from "@openvalens/i18n/numbers";

/**
 * Describe a meal (#73) and a meal photo (#71), as the Describe and Photo
 * tabs of Log food (food-draft#0). The member speaks with their keyboard's
 * dictation or types; nothing records audio. A draft is never saved: each
 * item opens the Search tab to find the food, and it is logged to the meal
 * and day the sheet was opened for.
 *
 * A photo is sent to the provider only after a per-photo confirmation, with
 * metadata stripped on the server, and is never stored. A meal draft a
 * connected AI app made (#439, M2c) is listed at the top of Describe and
 * opens in the same review; it is stored until marked done or discarded.
 */
const DRAFT_FAILED = msg`Could not make a draft. Nothing was saved.`;
const DRAFT_DISCARDED = msg`Draft discarded. Nothing was saved.`;
const AI_DRAFT_DONE = msg`Draft done. The foods you logged are in your meal diary.`;
const PHOTO_TOO_LARGE = msg`This photo is larger than 10 MB. Choose a smaller JPEG or PNG.`;
const PHOTO_WRONG_TYPE = msg`Use a JPEG or PNG photo up to 10 MB.`;

export const DRAFT_PANEL_COPY = Object.freeze({
  dictation: msg`Tip: use your keyboard's mic to dictate. Audio is never recorded.`,
  needsText: msg`Describe at least one food.`,
  localOnly: msg`Drafts are made on this server from your words. Photo and AI drafts are off.`,
  settingsLink: msg`Nutrition settings`,
  turnOn: msg`Turn on food drafts`,
  offNote: msg`Describe a meal in your own words and get a list of foods to check. Nothing is logged until you confirm each one.`,
});

type Flag = FoodDraftCandidateWire["flags"][number];
export type DraftItem = FoodDraftCandidateWire;

/** Re-derives an item's flags after the member edits a field. */
function withFlags(flags: Flag[], cleared: Flag[], added: Flag | null): Flag[] {
  return [...flags.filter((flag) => !cleared.includes(flag)), ...(added ? [added] : [])];
}

export function FoodDraftPanel({
  view,
  initialText,
  loggedIds,
  onFind,
  onAiDraft,
}: {
  /** Which input shows: the text box or the photo picker. The review below is shared. */
  view: "describe" | "photo";
  initialText?: string;
  /** Items already logged from this draft; they leave the list. */
  loggedIds: ReadonlySet<string>;
  /** Find and log one item: the sheet switches to Search with its words. */
  onFind: (item: DraftItem) => void;
  /** A connected AI app's draft opened for review (its meal, when it has one). */
  onAiDraft?: (draft: AiAppFoodDraft) => void;
}) {
  const [transcript, setTranscript] = useState(initialText ?? "");
  const [triedEmpty, setTriedEmpty] = useState(false);
  const [useAi, setUseAi] = useState(false);
  const [aiAgreed, setAiAgreed] = useState(false);
  const [candidates, setCandidates] = useState<DraftItem[] | null>(null);
  // What the member typed in each quantity, so "8," stays while they type (#455).
  const [quantityText, setQuantityText] = useState<Record<string, string>>({});
  const [source, setSource] = useState<"text" | "photo" | "ai">("text");
  const [aiDraft, setAiDraft] = useState<AiAppFoodDraft | null>(null);
  const aiActions = useAiAppDraftActions("food");
  const [message, setMessage] = useState<MessageDescriptor | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoAgreed, setPhotoAgreed] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<MessageDescriptor | null>(null);
  const { t, i18n } = useLingui();
  const provider = useQuery({
    queryKey: ["nutritionFoodDrafts", "provider"],
    queryFn: () => client.nutritionFoodDrafts.provider({}),
  });
  const nutritionSettings = useNutritionSettings();
  // food-draft#2: while drafts are off, say what they do and turn them on here.
  const draftsOff = nutritionSettings.settings?.voiceDraftsEnabled === false;
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
      setAiDraft(null);
      setCandidates(result.status === "ready" ? result.candidates : null);
      setQuantityText({});
      setMessage(FOOD_DRAFT_COPY.status[result.status]);
    },
    onError: () => setMessage(DRAFT_FAILED),
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
      setAiDraft(null);
      setCandidates(result.status === "ready" ? result.candidates : null);
      setQuantityText({});
      setPhotoMessage(PHOTO_DRAFT_COPY.status[result.status]);
    },
    onError: (error) => setPhotoMessage(isPayloadTooLarge(error) ? PHOTO_TOO_LARGE : DRAFT_FAILED),
  });
  const providerName = provider.data?.host
    ? `${provider.data.provider} (${provider.data.host})`
    : (provider.data?.provider ?? "");
  const itemLegend = (number: number, heard: string | null) => {
    if (aiDraft && heard !== null) {
      const app = aiAppName(aiAppDraftIdentity(aiDraft), i18n);
      return t`Item ${number}, from ${app}: “${heard}”`;
    }
    return heard === null ? t`Item ${number}, from the photo` : t`Item ${number}, heard “${heard}”`;
  };
  const closeAiDraft = (done: MessageDescriptor) => {
    setCandidates(null);
    setAiDraft(null);
    setMessage(done);
  };
  const edit = (id: string, patch: Partial<DraftItem>) =>
    setCandidates((current) =>
      current ? current.map((item) => (item.id === id ? { ...item, ...patch } : item)) : current,
    );
  const shown = candidates?.filter((item) => !loggedIds.has(item.id)) ?? null;
  const settingsLink = (
    <Link to="/settings/nutrition" hash="features" className={textLinkClass}>
      {i18n._(DRAFT_PANEL_COPY.settingsLink)}
    </Link>
  );

  return (
    <div className="grid min-w-0 gap-4">
      {view === "describe" ? (
        <>
          <AiAppFoodDrafts
            reviewingId={aiDraft?.id ?? null}
            actions={aiActions}
            onReview={(draft) => {
              setAiDraft(draft);
              setSource("ai");
              setCandidates(draft.payload.items);
              setQuantityText({});
              setMessage(null);
              onAiDraft?.(draft);
            }}
          />
          {draftsOff ? (
            <div className="grid justify-items-start gap-3 rounded-2xl bg-paper-2 p-4 text-sm text-ink-2">
              <p>{i18n._(DRAFT_PANEL_COPY.offNote)}</p>
              <Button
                variant="outline"
                disabled={nutritionSettings.saving}
                onClick={() => {
                  setMessage(null);
                  void nutritionSettings.save({ voiceDraftsEnabled: true });
                }}
              >
                {i18n._(DRAFT_PANEL_COPY.turnOn)}
              </Button>
            </div>
          ) : null}
          <div className="grid gap-2">
            <Label
              htmlFor="food-draft-text"
              className="flex items-center gap-1 text-sm font-medium text-ink-3"
            >
              <Trans>What did you have?</Trans>
              <InfoTip>{i18n._(FOOD_DRAFT_COPY.intro)}</InfoTip>
            </Label>
            <Textarea
              id="food-draft-text"
              maxLength={2000}
              value={transcript}
              placeholder={t`Two eggs, a slice of toast and a coffee`}
              aria-describedby="food-draft-hint"
              onChange={(event) => {
                setTranscript(event.target.value);
                setTriedEmpty(false);
              }}
            />
            <p id="food-draft-hint" className="flex items-start gap-1.5 text-sm text-ink-3">
              <Mic className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {i18n._(DRAFT_PANEL_COPY.dictation)}
            </p>
          </div>
          {provider.data?.available ? (
            <div className="grid gap-2 rounded-2xl bg-paper-2 p-4 text-sm text-ink-2">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={useAi}
                  onChange={(event) => {
                    setUseAi(event.target.checked);
                    setAiAgreed(false);
                  }}
                />
                <Trans>Use the AI provider for this draft</Trans>
              </label>
              {useAi ? (
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                    checked={aiAgreed}
                    onChange={(event) => setAiAgreed(event.target.checked)}
                  />
                  <span>
                    <Trans comment="safety">
                      Send this text, and nothing else, to {providerName} now.
                    </Trans>{" "}
                    {i18n._(FOOD_DRAFT_COPY.aiDisclosure)}
                  </span>
                </label>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-2">
            <Button
              variant="outline"
              className="w-fit"
              disabled={(useAi && !aiAgreed) || parse.isPending}
              onClick={() => {
                // Full colour while empty: a press says what is missing (food-draft#3).
                if (!transcript.trim()) {
                  setTriedEmpty(true);
                  return;
                }
                parse.mutate();
              }}
            >
              <Sparkles aria-hidden="true" />
              {parse.isPending ? t`Working…` : t`Make a draft`}
            </Button>
            {triedEmpty ? (
              <p role="alert" className="text-sm text-ink-2">
                {i18n._(DRAFT_PANEL_COPY.needsText)}
              </p>
            ) : null}
            {provider.isSuccess && !provider.data.available && !draftsOff ? (
              <p className="text-sm text-ink-3">
                {i18n._(DRAFT_PANEL_COPY.localOnly)} {settingsLink}
              </p>
            ) : null}
            {message ? (
              <p role="status" aria-live="polite" className="text-sm text-ink-2">
                {i18n._(message)}{" "}
                {message === FOOD_DRAFT_COPY.status.disabled ? settingsLink : null}
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label
              htmlFor="food-draft-photo"
              className="flex items-center gap-1 text-sm font-medium text-ink-3"
            >
              <Trans>Meal photo (JPEG or PNG, up to 10 MB)</Trans>
              <InfoTip>{i18n._(PHOTO_DRAFT_COPY.intro)}</InfoTip>
            </Label>
            <Input
              id="food-draft-photo"
              type="file"
              accept="image/jpeg,image/png"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                // Checked before sending so a large phone photo gets a clear
                // message instead of a failed upload; the server enforces
                // the same limits.
                const problem = file ? photoUploadProblem(file) : null;
                setPhoto(problem ? null : file);
                setPhotoAgreed(false);
                setPhotoMessage(
                  problem === "too_large" ? PHOTO_TOO_LARGE : problem ? PHOTO_WRONG_TYPE : null,
                );
              }}
            />
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-primary disabled:cursor-not-allowed"
              checked={photoAgreed}
              disabled={!photo}
              onChange={(event) => setPhotoAgreed(event.target.checked)}
            />
            <span>
              <Trans comment="safety">Send this photo to {providerName} now.</Trans>{" "}
              {i18n._(PHOTO_DRAFT_COPY.disclosure)}
            </span>
          </label>
          <Button
            className="w-fit"
            variant="outline"
            disabled={!photo || !photoAgreed || parsePhoto.isPending}
            onClick={() => photo && parsePhoto.mutate(photo)}
          >
            <Camera aria-hidden="true" />
            {parsePhoto.isPending ? t`Working…` : t`Make a draft from this photo`}
          </Button>
          {photoMessage ? (
            <p role="status" aria-live="polite" className="text-sm text-ink-2">
              {i18n._(photoMessage)}{" "}
              {photoMessage === PHOTO_DRAFT_COPY.status.disabled ? settingsLink : null}
            </p>
          ) : null}
        </div>
      )}

      {shown && (view === "photo") === (source === "photo") ? (
        <section className="grid gap-3 border-t border-rule pt-4" aria-labelledby="draft-review">
          <h3
            id="draft-review"
            className="flex items-center gap-1 font-display text-lg font-medium text-ink"
          >
            <Trans>Review the draft</Trans>
            <InfoTip>
              {i18n._(source === "photo" ? PHOTO_DRAFT_COPY.review : FOOD_DRAFT_COPY.review)}
            </InfoTip>
          </h3>
          {aiDraft ? (
            <p className="text-sm text-ink-2">
              <ViaApp app={aiAppDraftIdentity(aiDraft)} />{" "}
              <Trans>Log each food, then mark the draft done. It stays here until you do.</Trans>
            </p>
          ) : null}
          {shown.length === 0 ? (
            <p className="text-sm text-ink-3" role="status">
              <Trans>Every item is logged.</Trans>
            </p>
          ) : null}
          {shown.map((item, index) => (
            <fieldset key={item.id} className="grid min-w-0 gap-3 rounded-2xl bg-paper-2 p-4">
              <legend className="float-left mb-1 text-sm font-semibold text-ink">
                {itemLegend(index + 1, source === "photo" ? null : item.sourceText)}
              </legend>
              <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={`${item.id}-food`} className="text-sm font-medium text-ink-3">
                    <Trans>Food</Trans>
                  </Label>
                  <Input
                    id={`${item.id}-food`}
                    maxLength={200}
                    value={item.foodText}
                    onChange={(event) => edit(item.id, { foodText: event.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${item.id}-quantity`} className="text-sm font-medium text-ink-3">
                    <Trans>Quantity</Trans>
                  </Label>
                  <Input
                    id={`${item.id}-quantity`}
                    inputMode="decimal"
                    value={quantityText[item.id] ?? item.quantity ?? ""}
                    onChange={(event) => {
                      const text = event.target.value;
                      setQuantityText((current) => ({ ...current, [item.id]: text }));
                      const value = parseDecimal(text, i18n.locale);
                      const quantity = value !== null && value > 0 ? value : null;
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
                  <DecimalHint value={quantityText[item.id]} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${item.id}-unit`} className="text-sm font-medium text-ink-3">
                    <Trans>Unit</Trans>
                  </Label>
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
                <p className="flex flex-wrap gap-1.5">
                  {item.flags.map((flag) => (
                    <StatusPill key={flag} tone="warn">
                      {i18n._(FOOD_DRAFT_FLAG_LABELS[flag])}
                    </StatusPill>
                  ))}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => onFind(item)}>
                  <Search aria-hidden="true" />
                  <Trans>Find and log this food</Trans>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setCandidates((current) =>
                      current ? current.filter((entry) => entry.id !== item.id) : current,
                    )
                  }
                >
                  <Trans>Remove</Trans>
                </Button>
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            {aiDraft ? (
              <Button
                variant="outline"
                disabled={aiActions.confirm.isPending}
                onClick={() =>
                  aiActions.confirm.mutate(
                    { draftId: aiDraft.id },
                    { onSuccess: () => closeAiDraft(AI_DRAFT_DONE) },
                  )
                }
              >
                <Trans>Mark draft done</Trans>
              </Button>
            ) : null}
            <Button
              variant="ghost"
              className="w-fit"
              disabled={aiActions.discard.isPending}
              onClick={() => {
                if (aiDraft)
                  aiActions.discard.mutate(
                    { draftId: aiDraft.id },
                    { onSuccess: () => closeAiDraft(DRAFT_DISCARDED) },
                  );
                else {
                  setCandidates(null);
                  setMessage(DRAFT_DISCARDED);
                }
              }}
            >
              <Trans>Discard draft</Trans>
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
