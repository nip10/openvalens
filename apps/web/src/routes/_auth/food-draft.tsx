import type { FoodDraftCandidateWire } from "@openvalens/api/contracts/nutrition-food-drafts";
import {
  FOOD_DRAFT_COPY,
  FOOD_DRAFT_FLAG_LABELS,
  PHOTO_DRAFT_COPY,
} from "@openvalens/api/presenters/food-draft";
import { isPayloadTooLarge, photoUploadProblem } from "@openvalens/api/photo-upload";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, buttonVariants } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Textarea } from "@openvalens/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  Camera,
  ListChecks,
  MessageSquareText,
  Mic,
  Search,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

import { controlLinkClass, textLinkClass } from "@/components/food-classes";
import { Page, PageHeader, Section, StatusPill, ToneIcon } from "@/components/page";
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
const DRAFT_FAILED = msg`Could not make a draft. Nothing was saved.`;
const DRAFT_DISCARDED = msg`Draft discarded. Nothing was saved.`;
const PHOTO_TOO_LARGE = msg`This photo is larger than 10 MB. Choose a smaller JPEG or PNG.`;
const PHOTO_WRONG_TYPE = msg`Use a JPEG or PNG photo up to 10 MB.`;

function FoodDraftPage() {
  const [transcript, setTranscript] = useState("");
  const [useAi, setUseAi] = useState(false);
  const [aiAgreed, setAiAgreed] = useState(false);
  const [candidates, setCandidates] = useState<FoodDraftCandidateWire[] | null>(null);
  const [source, setSource] = useState<"text" | "photo">("text");
  const [message, setMessage] = useState<MessageDescriptor | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoAgreed, setPhotoAgreed] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<MessageDescriptor | null>(null);
  const { t, i18n } = useLingui();
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
      setCandidates(result.status === "ready" ? result.candidates : null);
      setPhotoMessage(PHOTO_DRAFT_COPY.status[result.status]);
    },
    onError: (error) => setPhotoMessage(isPayloadTooLarge(error) ? PHOTO_TOO_LARGE : DRAFT_FAILED),
  });
  const providerName = provider.data?.host
    ? `${provider.data.provider} (${provider.data.host})`
    : (provider.data?.provider ?? "");
  const itemLegend = (number: number, heard: string | null) =>
    heard === null ? t`Item ${number}, from the photo` : t`Item ${number}, heard “${heard}”`;
  const edit = (id: string, patch: Partial<FoodDraftCandidateWire>) =>
    setCandidates((current) =>
      current ? current.map((item) => (item.id === id ? { ...item, ...patch } : item)) : current,
    );

  return (
    <Page width="narrow">
      <PageHeader
        title={<Trans>Describe a meal</Trans>}
        info={i18n._(FOOD_DRAFT_COPY.intro)}
        actions={
          <Link to="/nutrition" className={`inline-flex items-center gap-1.5 ${controlLinkClass}`}>
            <ArrowLeft className="size-4 text-food" aria-hidden="true" />
            <Trans>Back to meal diary</Trans>
          </Link>
        }
      />
      <Section sheet>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label
              htmlFor="food-draft-text"
              className="flex items-center gap-2.5 font-display text-lg font-medium text-ink"
            >
              <ToneIcon icon={MessageSquareText} tone="food" size="sm" />
              <Trans>What did you have?</Trans>
            </Label>
            <Textarea
              id="food-draft-text"
              maxLength={2000}
              value={transcript}
              placeholder={t`Two eggs, a slice of toast and a coffee`}
              onChange={(event) => setTranscript(event.target.value)}
            />
            <p className="flex items-start gap-1.5 text-sm text-ink-3">
              <Mic className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {i18n._(FOOD_DRAFT_COPY.dictation)}
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
          <Button
            className="w-fit"
            disabled={!transcript.trim() || (useAi && !aiAgreed) || parse.isPending}
            onClick={() => parse.mutate()}
          >
            <Sparkles aria-hidden="true" />
            {parse.isPending ? t`Working…` : t`Make a draft`}
          </Button>
          {message ? (
            <p role="status" aria-live="polite" className="text-sm text-ink-2">
              {i18n._(message)}{" "}
              {message === FOOD_DRAFT_COPY.status.disabled ? (
                <Link to="/nutrition-targets" className={textLinkClass}>
                  <Trans>Nutrition settings</Trans>
                </Link>
              ) : null}
            </p>
          ) : null}
        </div>
      </Section>

      {provider.data?.available ? (
        <Section
          icon={Camera}
          tone="food"
          sheet
          title={<Trans>From a photo</Trans>}
          info={i18n._(PHOTO_DRAFT_COPY.intro)}
        >
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="food-draft-photo" className="text-sm font-medium text-ink-3">
                <Trans>Meal photo (JPEG or PNG, up to 10 MB)</Trans>
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
                {photoMessage === PHOTO_DRAFT_COPY.status.disabled ? (
                  <Link to="/nutrition-targets" className={textLinkClass}>
                    <Trans>Nutrition settings</Trans>
                  </Link>
                ) : null}
              </p>
            ) : null}
          </div>
        </Section>
      ) : null}

      {candidates ? (
        <Section
          icon={ListChecks}
          tone="food"
          title={<Trans>Review the draft</Trans>}
          info={i18n._(source === "photo" ? PHOTO_DRAFT_COPY.review : FOOD_DRAFT_COPY.review)}
        >
          <div className="grid gap-3">
            {candidates.map((item, index) => (
              <fieldset key={item.id} className="sheet grid min-w-0 gap-3 p-5">
                <legend className="float-left mb-1 font-display font-medium text-ink">
                  {itemLegend(index + 1, source === "photo" ? null : item.sourceText)}
                </legend>
                <div className="grid gap-3 sm:grid-cols-3">
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
                    <Label
                      htmlFor={`${item.id}-quantity`}
                      className="text-sm font-medium text-ink-3"
                    >
                      <Trans>Quantity</Trans>
                    </Label>
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
                  <Link
                    to="/nutrition"
                    search={{ food: item.foodText }}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    <Search aria-hidden="true" />
                    <Trans>Find and log this food</Trans>
                  </Link>
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
            <Button
              variant="destructive"
              className="mt-1 w-fit"
              onClick={() => {
                setCandidates(null);
                setMessage(DRAFT_DISCARDED);
              }}
            >
              <Trans>Discard draft</Trans>
            </Button>
          </div>
        </Section>
      ) : null}
    </Page>
  );
}
