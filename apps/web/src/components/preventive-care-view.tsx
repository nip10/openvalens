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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";
import { Label } from "@openvalens/ui/components/label";
import { Switch } from "@openvalens/ui/components/switch";
import { useState, type ReactNode } from "react";

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
  const [done, setDone] = useState(item.state.lastDoneOn ?? "");
  const [next, setNext] = useState(item.state.nextOn ?? "");
  const id = item.id.replace(/\W/g, "-");
  return (
    <fieldset className="grid gap-3 border-t pt-3" disabled={pending}>
      <legend className="sr-only">Your record for {item.title}</legend>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor={`${id}-done`}>{PREVENTIVE_COPY.lastDone}</Label>
          <input
            id={`${id}-done`}
            type="date"
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={done}
            onChange={(event) => setDone(event.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onUpdateItem({ itemId: item.id, lastDoneOn: done === "" ? null : done })}
        >
          Save done date
        </Button>
      </div>
      {item.canRemind ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <Label htmlFor={`${id}-next`}>{PREVENTIVE_COPY.nextDate}</Label>
              <input
                id={`${id}-next`}
                type="date"
                className="rounded-md border bg-background px-2 py-1 text-sm"
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
              Save next date
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
                {PREVENTIVE_COPY.useSuggestion(formatGuidanceDate(item.suggestedNextOn))}
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
            <Label htmlFor={`${id}-remind`}>{PREVENTIVE_COPY.remind}</Label>
          </div>
          {item.reminderMode === "expect_invitation" ? (
            <div className="flex items-center gap-2">
              <input
                id={`${id}-invite`}
                type="checkbox"
                checked={item.state.plan === "expect_invitation"}
                onChange={(event) =>
                  onUpdateItem({
                    itemId: item.id,
                    plan: event.target.checked ? "expect_invitation" : "none",
                  })
                }
              />
              <Label htmlFor={`${id}-invite`}>{PREVENTIVE_COPY.plans.expect_invitation}</Label>
            </div>
          ) : null}
        </div>
      ) : null}
      {item.canDecide ? (
        <div
          role="radiogroup"
          aria-label={`Your decision about ${item.title}`}
          className="flex flex-wrap gap-3"
        >
          {(["decided_yes", "decided_no", "decided_later"] as const).map((plan) => (
            <label key={plan} className="flex items-center gap-1 text-sm">
              <input
                type="radio"
                name={`${id}-decision`}
                checked={item.state.plan === plan}
                onChange={() => onUpdateItem({ itemId: item.id, plan })}
              />
              {PREVENTIVE_COPY.plans[plan]}
            </label>
          ))}
          {item.state.plan !== "none" ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onUpdateItem({ itemId: item.id, plan: "none" })}
            >
              Clear decision
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
  const card = preventiveItemCard(item);
  return (
    <Card role="article" aria-labelledby={`pc-${card.key}`}>
      <CardHeader>
        <CardTitle id={`pc-${card.key}`}>{card.title}</CardTitle>
        <CardDescription>
          <span className="font-medium text-foreground">{card.gradeLabel}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {card.beingReviewed ? <p>{PREVENTIVE_COPY.beingReviewed}</p> : null}
        <p className="font-medium">{card.applicabilityText}</p>
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
        {card.dateReachedText ? <p className="font-medium">{card.dateReachedText}</p> : null}
        {card.decisionAidUrl ? (
          <a className="underline" href={card.decisionAidUrl} target="_blank" rel="noreferrer">
            {PREVENTIVE_COPY.decisionAid}
          </a>
        ) : null}
        <p className="text-muted-foreground">{card.framing}</p>
        <p className="text-xs text-muted-foreground">
          {card.citation}{" "}
          <a className="underline" href={card.sourceUrl} target="_blank" rel="noreferrer">
            {PREVENTIVE_COPY.sourceLink}
          </a>
          . {card.nonEndorsement}{" "}
          <a
            className="underline"
            href={PREVENTIVE_COPY.reportProblemUrl(card.key)}
            target="_blank"
            rel="noreferrer"
          >
            {PREVENTIVE_COPY.reportProblem}
          </a>
        </p>
        {canEdit && !card.beingReviewed ? (
          <ItemControls item={item} pending={pending} onUpdateItem={onUpdateItem} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function Criteria({
  result,
  pending,
  onDeclare,
}: {
  result: PreventiveCareResult;
  pending: boolean;
  onDeclare: Handlers["onDeclare"];
}) {
  if (result.criteria.length === 0) return null;
  return (
    <Card role="region" aria-labelledby="pc-criteria">
      <CardHeader>
        <CardTitle id="pc-criteria">{PREVENTIVE_COPY.criteriaTitle}</CardTitle>
        <CardDescription>{PREVENTIVE_COPY.criteriaIntro}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {result.criteria.map((criterion) => (
          <fieldset key={criterion.id} className="grid gap-1" disabled={pending || !result.canEdit}>
            <legend className="text-sm font-medium">{criterion.question}</legend>
            <p className="text-xs text-muted-foreground">{criterion.purpose}</p>
            <div className="flex flex-wrap items-center gap-3">
              {DECLARATION_ANSWERS.map((answer) => (
                <label key={answer} className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    name={`criterion-${criterion.id}`}
                    checked={criterion.answer === answer}
                    onChange={() => onDeclare(criterion.id, answer)}
                  />
                  {DECLARATION_LABELS[answer]}
                </label>
              ))}
              {criterion.answer !== null ? (
                <Button size="sm" variant="ghost" onClick={() => onDeclare(criterion.id, null)}>
                  {PREVENTIVE_COPY.clearAnswer}
                </Button>
              ) : null}
            </div>
          </fieldset>
        ))}
      </CardContent>
    </Card>
  );
}

export function EvidenceLibraryView({ library }: { library: EvidenceLibraryResult }) {
  if (!library.enabled) return <p className="text-sm text-muted-foreground">{LIBRARY_COPY.off}</p>;
  return (
    <section aria-labelledby="pc-library" className="grid gap-3">
      <h2 id="pc-library" className="text-xl font-semibold">
        {LIBRARY_COPY.title}
      </h2>
      <p className="text-sm text-muted-foreground">{LIBRARY_COPY.intro}</p>
      {library.entries.map((entry) => {
        const card = evidenceEntryCard(entry);
        return (
          <Card key={card.key} role="article" aria-labelledby={`ev-${card.key}`}>
            <CardHeader>
              <CardTitle id={`ev-${card.key}`}>{card.title}</CardTitle>
              <CardDescription>
                <span className="font-medium text-foreground">{card.verdictLabel}</span> ·{" "}
                {card.certaintyLabel}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {card.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              <ul className="grid gap-1 text-xs text-muted-foreground">
                {card.sources.map((source) => (
                  <li key={source.url + source.citation}>
                    <a className="underline" href={source.url} target="_blank" rel="noreferrer">
                      {source.citation}
                    </a>
                    {source.note ? ` — ${source.note}` : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
      <p className="text-xs text-muted-foreground">Library {library.version}.</p>
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
  const page = preventivePageNotes(result);
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">{PREVENTIVE_COPY.pageTitle}</h1>
        <p className="text-sm text-muted-foreground">{PREVENTIVE_COPY.pageIntro}</p>
      </div>
      {page.statusText ? (
        <div className="grid gap-2">
          <p>{page.statusText}</p>
          {result.status !== "owner_only" ? profileLink : null}
        </div>
      ) : (
        <>
          {page.notes.map((note) => (
            <p key={note} className="text-sm">
              {note}
            </p>
          ))}
          <Criteria result={result} pending={handlers.pending} onDeclare={handlers.onDeclare} />
          <div className="grid gap-4">
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
          {result.notShown.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                {PREVENTIVE_COPY.notShownTitle} ({result.notShown.length})
              </summary>
              <p className="text-sm text-muted-foreground">{PREVENTIVE_COPY.notShownIntro}</p>
              <ul className="list-disc pl-5 text-sm">
                {result.notShown.map((entry) => (
                  <li key={entry.id}>{entry.title}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <p className="text-xs text-muted-foreground">{PREVENTIVE_COPY.disclaimer}</p>
          {result.canEdit ? (
            <div className="flex items-start gap-2">
              <Switch
                id="pc-library-toggle"
                checked={result.libraryEnabled}
                disabled={handlers.pending}
                onCheckedChange={handlers.onLibrary}
              />
              <div className="grid gap-1">
                <Label htmlFor="pc-library-toggle">{PREVENTIVE_COPY.libraryToggle}</Label>
                <p className="text-xs text-muted-foreground">{PREVENTIVE_COPY.libraryToggleHint}</p>
              </div>
            </div>
          ) : null}
          {library ? <EvidenceLibraryView library={library} /> : null}
        </>
      )}
      <p className="text-xs text-muted-foreground">{page.versionText}</p>
    </div>
  );
}
