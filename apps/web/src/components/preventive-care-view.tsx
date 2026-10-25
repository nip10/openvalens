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

import { PageHeader } from "./page";

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
    <fieldset className="grid gap-3 border-t border-rule pt-4" disabled={pending}>
      <legend className="sr-only">
        <Trans>Your record for {title}</Trans>
      </legend>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor={`${id}-done`}>{i18n._(PREVENTIVE_COPY.lastDone)}</Label>
          <input
            id={`${id}-done`}
            type="date"
            className="h-8 rounded-sm border border-input bg-card px-2 text-sm text-ink outline-2 -outline-offset-2 outline-transparent focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55"
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
                className="h-8 rounded-sm border border-input bg-card px-2 text-sm text-ink outline-2 -outline-offset-2 outline-transparent focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55"
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
  const { i18n } = useLingui();
  const card = preventiveItemCard(i18n, item);
  return (
    <article role="article" aria-labelledby={`pc-${card.key}`} className="grid gap-3 px-5 py-5">
      <div className="grid gap-1">
        <h3 id={`pc-${card.key}`} className="text-lg leading-tight text-ink">
          {card.title}
        </h3>
        <p className="text-sm font-medium text-ink-2">{card.gradeLabel}</p>
      </div>
      <div className="grid max-w-[65ch] gap-2 text-sm text-ink-2">
        {card.beingReviewed ? <p>{i18n._(PREVENTIVE_COPY.beingReviewed)}</p> : null}
        <p className="font-medium text-ink">{card.applicabilityText}</p>
        {card.facts.length > 0 ? (
          <ul className="list-disc pl-5">
            {card.facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        ) : null}
        {card.stateLines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {card.dateReachedText ? (
          <p className="font-medium text-ink">{card.dateReachedText}</p>
        ) : null}
        {card.decisionAidUrl ? (
          <a className={LINK} href={card.decisionAidUrl} target="_blank" rel="noreferrer">
            {i18n._(PREVENTIVE_COPY.decisionAid)}
          </a>
        ) : null}
        <p className="text-ink-3">{card.framing}</p>
        <p className="text-sm text-ink-3">
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
      </div>
      {canEdit && !card.beingReviewed ? (
        <ItemControls item={item} pending={pending} onUpdateItem={onUpdateItem} />
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
    <section role="region" aria-labelledby="pc-criteria" className="grid content-start gap-4">
      <div className="grid gap-1">
        <h2 id="pc-criteria" className="text-xl leading-tight text-ink">
          {i18n._(PREVENTIVE_COPY.criteriaTitle)}
        </h2>
        <p className="text-sm text-ink-3">{i18n._(PREVENTIVE_COPY.criteriaIntro)}</p>
      </div>
      <div className="sheet divide-y divide-rule">
        {result.criteria.map((criterion) => (
          <fieldset
            key={criterion.id}
            className="grid gap-1 px-5 py-4"
            disabled={pending || !result.canEdit}
          >
            <legend className="mb-1 font-display text-sm font-medium text-ink">
              {criterion.question}
            </legend>
            <p className="text-sm text-ink-3">{criterion.purpose}</p>
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
    <section aria-labelledby="pc-library" className="grid content-start gap-4">
      <div className="grid gap-1">
        <h2 id="pc-library" className="text-xl leading-tight text-ink">
          {i18n._(LIBRARY_COPY.title)}
        </h2>
        <p className="max-w-[65ch] text-sm text-ink-3">{i18n._(LIBRARY_COPY.intro)}</p>
      </div>
      <div className="well divide-y divide-rule">
        {library.entries.map((entry) => {
          const card = evidenceEntryCard(i18n, entry);
          return (
            <article
              key={card.key}
              role="article"
              aria-labelledby={`ev-${card.key}`}
              className="grid gap-2 px-5 py-4"
            >
              <h3 id={`ev-${card.key}`} className="text-base leading-tight text-ink">
                {card.title}
              </h3>
              <p className="flex flex-wrap gap-x-4 text-sm">
                <span className="font-medium text-ink">{card.verdictLabel}</span>
                <span className="text-ink-3">{card.certaintyLabel}</span>
              </p>
              <div className="grid max-w-[65ch] gap-2 text-sm text-ink-2">
                {card.lines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
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
            </article>
          );
        })}
      </div>
      <p className="text-sm text-ink-3">
        <Trans>Library {version}.</Trans>
      </p>
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
  const { i18n } = useLingui();
  const page = preventivePageNotes(i18n, result);
  return (
    <>
      <PageHeader
        title={i18n._(PREVENTIVE_COPY.pageTitle)}
        description={i18n._(PREVENTIVE_COPY.pageIntro)}
      />
      {page.statusText ? (
        <div className="well grid justify-items-start gap-2 px-5 py-4">
          <p className="max-w-[65ch] text-ink-2">{page.statusText}</p>
          {result.status !== "owner_only" ? profileLink : null}
        </div>
      ) : (
        <>
          {page.notes.length > 0 ? (
            <div className="grid max-w-[65ch] gap-2 text-sm text-ink-2">
              {page.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          ) : null}
          <div
            className={
              result.criteria.length > 0
                ? "grid items-start gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
                : "grid"
            }
          >
            <div className="sheet min-w-0 divide-y divide-rule">
              {result.items.map((item) => (
                <PreventiveItemCardView
                  key={item.id}
                  item={item}
                  canEdit={result.canEdit}
                  pending={handlers.pending}
                  onUpdateItem={handlers.onUpdateItem}
                />
              ))}
            </div>
            <Criteria result={result} pending={handlers.pending} onDeclare={handlers.onDeclare} />
          </div>
          {result.notShown.length > 0 ? (
            <details className="grid gap-2 border-t border-rule pt-4">
              <summary className="cursor-pointer font-display text-sm font-medium text-ink">
                {i18n._(PREVENTIVE_COPY.notShownTitle)}{" "}
                <span className="num text-ink-3">({result.notShown.length})</span>
              </summary>
              <p className="mt-2 max-w-[65ch] text-sm text-ink-3">
                {i18n._(PREVENTIVE_COPY.notShownIntro)}
              </p>
              <ul className="mt-2 list-disc pl-5 text-sm text-ink-2">
                {result.notShown.map((entry) => (
                  <li key={entry.id}>{entry.title}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <p className="max-w-[65ch] text-sm text-ink-3">{i18n._(PREVENTIVE_COPY.disclaimer)}</p>
          {result.canEdit ? (
            <div className="flex items-start gap-3 border-t border-rule pt-4">
              <Switch
                id="pc-library-toggle"
                checked={result.libraryEnabled}
                disabled={handlers.pending}
                onCheckedChange={handlers.onLibrary}
              />
              <div className="grid gap-1">
                <Label htmlFor="pc-library-toggle">{i18n._(PREVENTIVE_COPY.libraryToggle)}</Label>
                <p className="max-w-[65ch] text-sm text-ink-3">
                  {i18n._(PREVENTIVE_COPY.libraryToggleHint)}
                </p>
              </div>
            </div>
          ) : null}
          {library ? <EvidenceLibraryView library={library} /> : null}
        </>
      )}
      <p className="text-sm text-ink-3">{page.versionText}</p>
    </>
  );
}
