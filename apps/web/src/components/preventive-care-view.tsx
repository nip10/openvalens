import { Trans, useLingui } from "@lingui/react/macro";
import type {
  DeclarationAnswer,
  EvidenceLibraryResult,
  PreventiveCareResult,
  PreventiveCriterion,
  PreventiveItemUpdate,
  PreventiveItemView,
} from "@openvalens/api/preventive-care-contract";
import { DECLARATION_ANSWERS } from "@openvalens/api/preventive-care-contract";
import {
  DECLARATION_LABELS,
  evidenceEntryCard,
  formatGuidanceDate,
  LIBRARY_COPY,
  PREVENTIVE_COPY,
  preventiveItemCard,
  preventivePageNotes,
} from "@openvalens/api/presenters/preventive-care";
import { Button } from "@openvalens/ui/components/button";
import { Label } from "@openvalens/ui/components/label";
import { Switch } from "@openvalens/ui/components/switch";
import { useState, type ReactNode } from "react";

import { BookOpen, CalendarClock, MessageCircleQuestion, ShieldCheck } from "lucide-react";

import { friendlyDate } from "@/utils/friendly";

import { Details, InfoTip, PageHeader, StatTile, StatusPill, ToneIcon } from "./page";

/**
 * Issue #97 — preventive care (web). Same view models and copy as native
 * (`@openvalens/api/presenters/preventive-care`). Grades, applicability and
 * states are always text, never colour alone; every control has a label and
 * works with the keyboard. Nothing is pre-selected.
 */

type Handlers = {
  pending: boolean;
  onDeclare: (criterion: PreventiveCriterion, answer: DeclarationAnswer | null) => void;
  onUpdateItem: (patch: PreventiveItemUpdate) => void;
  onLibrary: (enabled: boolean) => void;
};

function ItemControls({
  item,
  pending,
  onUpdateItem,
}: {
  item: PreventiveItemView;
  pending: boolean;
  onUpdateItem: Handlers["onUpdateItem"];
}) {
  const { t, i18n } = useLingui();
  const title = item.title;
  const [done, setDone] = useState(item.state.lastDoneOn ?? "");
  const [next, setNext] = useState(item.state.nextOn ?? "");
  const id = item.id.replace(/\W/g, "-");
  return (
    <fieldset className="grid gap-3" disabled={pending}>
      <legend className="sr-only">
        <Trans>Your record for {title}</Trans>
      </legend>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor={`${id}-done`}>{i18n._(PREVENTIVE_COPY.lastDone)}</Label>
          <input
            id={`${id}-done`}
            type="date"
            className="h-9 rounded-xl border border-input bg-card px-3 text-sm text-ink outline-2 -outline-offset-2 outline-transparent focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55"
            value={done}
            onChange={(event) => setDone(event.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onUpdateItem({ itemId: item.id, lastDoneOn: done === "" ? null : done })}
        >
          <Trans>Save done date</Trans>
        </Button>
      </div>
      {item.canRemind ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <Label htmlFor={`${id}-next`}>{i18n._(PREVENTIVE_COPY.nextDate)}</Label>
              <input
                id={`${id}-next`}
                type="date"
                className="h-9 rounded-xl border border-input bg-card px-3 text-sm text-ink outline-2 -outline-offset-2 outline-transparent focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55"
                value={next}
                onChange={(event) => setNext(event.target.value)}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onUpdateItem({
                  itemId: item.id,
                  nextOn: next === "" ? null : next,
                  ...(next === "" ? { remind: false } : {}),
                })
              }
            >
              <Trans>Save next date</Trans>
            </Button>
            {item.suggestedNextOn && item.suggestedNextOn !== item.state.nextOn ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setNext(item.suggestedNextOn!);
                  onUpdateItem({ itemId: item.id, nextOn: item.suggestedNextOn });
                }}
              >
                {i18n._(PREVENTIVE_COPY.useSuggestion(formatGuidanceDate(item.suggestedNextOn)))}
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id={`${id}-remind`}
              checked={item.state.remind}
              disabled={item.state.nextOn === null}
              onCheckedChange={(checked) => onUpdateItem({ itemId: item.id, remind: checked })}
            />
            <Label htmlFor={`${id}-remind`}>{i18n._(PREVENTIVE_COPY.remind)}</Label>
          </div>
          {item.reminderMode === "expect_invitation" ? (
            <div className="flex items-center gap-2">
              <input
                id={`${id}-invite`}
                className="size-4 accent-signal disabled:cursor-not-allowed disabled:opacity-55"
                type="checkbox"
                checked={item.state.plan === "expect_invitation"}
                onChange={(event) =>
                  onUpdateItem({
                    itemId: item.id,
                    plan: event.target.checked ? "expect_invitation" : "none",
                  })
                }
              />
              <Label htmlFor={`${id}-invite`}>
                {i18n._(PREVENTIVE_COPY.plans.expect_invitation)}
              </Label>
            </div>
          ) : null}
        </div>
      ) : null}
      {item.canDecide ? (
        <div
          role="radiogroup"
          aria-label={t`Your decision about ${title}`}
          className="flex flex-wrap gap-3"
        >
          {(["decided_yes", "decided_no", "decided_later"] as const).map((plan) => (
            <label key={plan} className="flex items-center gap-1.5 text-sm text-ink-2">
              <input
                className="size-4 accent-signal disabled:cursor-not-allowed disabled:opacity-55"
                type="radio"
                name={`${id}-decision`}
                checked={item.state.plan === plan}
                onChange={() => onUpdateItem({ itemId: item.id, plan })}
              />
              {i18n._(PREVENTIVE_COPY.plans[plan])}
            </label>
          ))}
          {item.state.plan !== "none" ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onUpdateItem({ itemId: item.id, plan: "none" })}
            >
              <Trans>Clear decision</Trans>
            </Button>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}

export function PreventiveItemCardView({
  item,
  canEdit,
  pending,
  onUpdateItem,
}: {
  item: PreventiveItemView;
  canEdit: boolean;
  pending: boolean;
  onUpdateItem: Handlers["onUpdateItem"];
}) {
  const { t, i18n } = useLingui();
  const card = preventiveItemCard(i18n, item);
  const lastDone = item.state.lastDoneOn;
  const nextOn = item.state.nextOn;
  const nextDay = nextOn ? friendlyDate(i18n, nextOn) : "";
  const doneDay = lastDone ? friendlyDate(i18n, lastDone) : "";
  const status = card.dateReachedText
    ? { tone: "warn" as const, label: card.dateReachedText }
    : nextOn
      ? { tone: "neutral" as const, label: t`Next: ${nextDay}` }
      : lastDone
        ? { tone: "good" as const, label: t`Done: ${doneDay}` }
        : null;
  return (
    <article
      role="article"
      aria-labelledby={`pc-${card.key}`}
      className="sheet grid min-w-0 content-start gap-3 p-5"
    >
      <div className="flex items-start gap-3">
        <ToneIcon icon={ShieldCheck} tone="water" />
        <div className="grid min-w-0 flex-1 gap-1.5">
          <div className="flex items-start gap-1">
            <h3 id={`pc-${card.key}`} className="text-lg leading-tight text-ink">
              {card.title}
            </h3>
            <InfoTip align="end">
              {card.facts.length > 0 ? (
                <ul className="list-disc pl-5">
                  {card.facts.map((fact) => (
                    <li key={fact}>{fact}</li>
                  ))}
                </ul>
              ) : null}
              <p className="text-ink-3">{card.framing}</p>
              <p className="text-ink-3">
                {card.citation}{" "}
                <a className={LINK} href={card.sourceUrl} target="_blank" rel="noreferrer">
                  {i18n._(PREVENTIVE_COPY.sourceLink)}
                </a>
                . {card.nonEndorsement}{" "}
                <a
                  className={LINK}
                  href={PREVENTIVE_COPY.reportProblemUrl(card.key)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {i18n._(PREVENTIVE_COPY.reportProblem)}
                </a>
              </p>
            </InfoTip>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-water-soft px-2.5 py-0.5 text-sm font-semibold text-ink">
              {card.gradeLabel}
            </span>
            {status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
          </div>
        </div>
      </div>
      <div className="grid gap-1.5 text-sm text-ink-2">
        {card.beingReviewed ? <p>{i18n._(PREVENTIVE_COPY.beingReviewed)}</p> : null}
        <p className="text-ink-3">{card.applicabilityText}</p>
        {card.stateLines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {card.decisionAidUrl ? (
          <a className={LINK} href={card.decisionAidUrl} target="_blank" rel="noreferrer">
            {i18n._(PREVENTIVE_COPY.decisionAid)}
          </a>
        ) : null}
      </div>
      {canEdit && !card.beingReviewed ? (
        <Details summary={<Trans>Update your record</Trans>}>
          <ItemControls item={item} pending={pending} onUpdateItem={onUpdateItem} />
        </Details>
      ) : null}
    </article>
  );
}

const LINK =
  "text-ink underline decoration-signal underline-offset-[0.15em] transition-colors duration-[var(--dur-short)] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function Criteria({
  result,
  pending,
  onDeclare,
}: {
  result: PreventiveCareResult;
  pending: boolean;
  onDeclare: Handlers["onDeclare"];
}) {
  const { i18n } = useLingui();
  if (result.criteria.length === 0) return null;
  return (
    <section role="region" aria-labelledby="pc-criteria" className="grid content-start gap-3">
      <div className="flex items-center gap-2">
        <ToneIcon icon={MessageCircleQuestion} tone="water" size="sm" />
        <h2 id="pc-criteria" className="text-xl leading-tight text-ink">
          {i18n._(PREVENTIVE_COPY.criteriaTitle)}
        </h2>
        <InfoTip>
          <p>{i18n._(PREVENTIVE_COPY.criteriaIntro)}</p>
        </InfoTip>
      </div>
      <div className="sheet divide-y divide-rule">
        {result.criteria.map((criterion) => (
          <fieldset
            key={criterion.id}
            className="grid gap-1 px-5 py-4"
            disabled={pending || !result.canEdit}
          >
            <legend className="mb-1 flex items-center gap-1 font-semibold text-ink">
              {criterion.question}
              <InfoTip align="end">
                <p>{criterion.purpose}</p>
              </InfoTip>
            </legend>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
              {DECLARATION_ANSWERS.map((answer) => (
                <label key={answer} className="flex items-center gap-1.5 text-sm text-ink-2">
                  <input
                    className="size-4 accent-signal disabled:cursor-not-allowed disabled:opacity-55"
                    type="radio"
                    name={`criterion-${criterion.id}`}
                    checked={criterion.answer === answer}
                    onChange={() => onDeclare(criterion.id, answer)}
                  />
                  {i18n._(DECLARATION_LABELS[answer])}
                </label>
              ))}
              {criterion.answer !== null ? (
                <Button size="sm" variant="ghost" onClick={() => onDeclare(criterion.id, null)}>
                  {i18n._(PREVENTIVE_COPY.clearAnswer)}
                </Button>
              ) : null}
            </div>
          </fieldset>
        ))}
      </div>
    </section>
  );
}

export function EvidenceLibraryView({ library }: { library: EvidenceLibraryResult }) {
  const { i18n } = useLingui();
  const version = library.version;
  if (!library.enabled) return <p className="text-sm text-ink-3">{i18n._(LIBRARY_COPY.off)}</p>;
  return (
    <section aria-labelledby="pc-library" className="grid content-start gap-3">
      <div className="flex items-center gap-2">
        <ToneIcon icon={BookOpen} tone="water" size="sm" />
        <h2 id="pc-library" className="text-xl leading-tight text-ink">
          {i18n._(LIBRARY_COPY.title)}
        </h2>
        <InfoTip>
          <p>{i18n._(LIBRARY_COPY.intro)}</p>
          <p className="text-ink-3">
            <Trans>Library {version}.</Trans>
          </p>
        </InfoTip>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {library.entries.map((entry) => {
          const card = evidenceEntryCard(i18n, entry);
          return (
            <article
              key={card.key}
              role="article"
              aria-labelledby={`ev-${card.key}`}
              className="sheet grid min-w-0 content-start gap-2.5 p-5"
            >
              <h3 id={`ev-${card.key}`} className="text-base leading-tight text-ink">
                {card.title}
              </h3>
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <StatusPill tone="neutral">{card.verdictLabel}</StatusPill>
                <span className="text-ink-3">{card.certaintyLabel}</span>
              </p>
              <div className="grid gap-2 text-sm text-ink-2">
                {card.lines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
              <Details summary={<Trans>Sources</Trans>} className="text-sm">
                <ul className="grid gap-1 text-sm text-ink-3">
                  {card.sources.map((source) => (
                    <li key={source.url + source.citation}>
                      <a className={LINK} href={source.url} target="_blank" rel="noreferrer">
                        {source.citation}
                      </a>
                      {source.note ? <span className="block">{source.note}</span> : null}
                    </li>
                  ))}
                </ul>
              </Details>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function PreventiveCareView({
  result,
  library,
  profileLink,
  ...handlers
}: {
  result: PreventiveCareResult;
  library: EvidenceLibraryResult | null;
  /** Link to the profile screen (router-specific, so passed in). */
  profileLink?: ReactNode;
} & Handlers) {
  const { t, i18n } = useLingui();
  const page = preventivePageNotes(i18n, result);
  const dueCount = result.items.filter((item) => item.dateReached).length;
  return (
    <>
      <PageHeader
        title={i18n._(PREVENTIVE_COPY.pageTitle)}
        description={
          <span className="text-sm">
            {t({
              message: "General public-health information, not personal medical advice.",
              comment: "safety",
            })}
          </span>
        }
        info={
          <>
            <p>{i18n._(PREVENTIVE_COPY.pageIntro)}</p>
            {page.statusText ? null : <p>{i18n._(PREVENTIVE_COPY.disclaimer)}</p>}
            <p className="text-ink-3">{page.versionText}</p>
          </>
        }
      />
      {page.statusText ? (
        <div className="sheet grid justify-items-start gap-3 p-5">
          <ToneIcon icon={ShieldCheck} tone="water" />
          <p className="max-w-[65ch] text-ink-2">{page.statusText}</p>
          {result.status !== "owner_only" ? profileLink : null}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatTile
              icon={ShieldCheck}
              tone="water"
              label={<Trans>For you</Trans>}
              value={result.items.length}
              note={
                page.notes.length > 0 ? (
                  <InfoTip>
                    {page.notes.map((note) => (
                      <p key={note}>{note}</p>
                    ))}
                  </InfoTip>
                ) : null
              }
            />
            <StatTile
              icon={CalendarClock}
              tone="water"
              label={<Trans>Date reached</Trans>}
              value={dueCount}
              status={
                dueCount > 0
                  ? { tone: "warn", label: <Trans>Worth a look</Trans> }
                  : { tone: "good", label: <Trans>All clear</Trans> }
              }
            />
          </div>
          <ul className="grid items-start gap-4 md:grid-cols-2">
            {result.items.map((item) => (
              <li key={item.id} className="grid min-w-0">
                <PreventiveItemCardView
                  item={item}
                  canEdit={result.canEdit}
                  pending={handlers.pending}
                  onUpdateItem={handlers.onUpdateItem}
                />
              </li>
            ))}
          </ul>
          <Criteria result={result} pending={handlers.pending} onDeclare={handlers.onDeclare} />
          {result.notShown.length > 0 ? (
            <Details
              summary={
                <>
                  {i18n._(PREVENTIVE_COPY.notShownTitle)}{" "}
                  <span className="num text-ink-3">({result.notShown.length})</span>
                </>
              }
            >
              <p className="max-w-[65ch] text-sm text-ink-3">
                {i18n._(PREVENTIVE_COPY.notShownIntro)}
              </p>
              <ul className="mt-2 list-disc pl-5 text-sm text-ink-2">
                {result.notShown.map((entry) => (
                  <li key={entry.id}>{entry.title}</li>
                ))}
              </ul>
            </Details>
          ) : null}
          {result.canEdit ? (
            <div className="sheet flex items-start gap-3 p-5">
              <Switch
                id="pc-library-toggle"
                checked={result.libraryEnabled}
                disabled={handlers.pending}
                onCheckedChange={handlers.onLibrary}
              />
              <div className="flex items-center gap-1">
                <Label htmlFor="pc-library-toggle">{i18n._(PREVENTIVE_COPY.libraryToggle)}</Label>
                <InfoTip>
                  <p>{i18n._(PREVENTIVE_COPY.libraryToggleHint)}</p>
                </InfoTip>
              </div>
            </div>
          ) : null}
          {library ? <EvidenceLibraryView library={library} /> : null}
        </>
      )}
    </>
  );
}
