import type { ActivityLoadResult } from "@openvalens/api/activity-load-contract";
import {
  ACTIVITY_LOAD_COPY,
  activityLoadView,
  type ActivityNumberView,
} from "@openvalens/api/presenters/activity-load";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";

/**
 * Issue #99 — weekly activity: WHO active minutes and session effort points.
 * Pure props → markup from the shared view model
 * (`@openvalens/api/presenters/activity-load`), so web and native show the
 * same numbers, formulas, units, coverage and unavailable states. No colour
 * carries meaning; each number has a screen-reader label.
 */

function NumberBlock({ part }: { part: ActivityNumberView }) {
  const titleId = `${part.key}-title`;
  return (
    <section className="grid gap-2 rounded-lg border border-border p-4" aria-labelledby={titleId}>
      <h3 id={titleId} className="text-sm font-medium">
        {part.title}
      </h3>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-3xl" role="img" aria-label={part.accessibilityLabel}>
          {part.valueText}
        </span>
        {part.available ? (
          <span className="text-sm text-muted-foreground" aria-hidden="true">
            {part.unitText}
          </span>
        ) : null}
      </div>
      <p className="text-sm">{part.statusText}</p>
      {part.breakdown.length > 0 ? (
        <ul className="text-sm text-muted-foreground">
          {part.breakdown.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {part.coverage.map((line) => (
        <p key={line} className="text-sm text-muted-foreground">
          {line}
        </p>
      ))}
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">How this is calculated</summary>
        <p className="mt-2">{part.formula}</p>
        {part.sources.map((line) => (
          <p key={line} className="mt-2 text-muted-foreground">
            {line}
          </p>
        ))}
        {part.key === "active_minutes" ? (
          <p className="mt-2">
            <a
              className="underline"
              href={ACTIVITY_LOAD_COPY.whoUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              WHO 2020 guidelines (opens the paper)
            </a>
          </p>
        ) : null}
      </details>
    </section>
  );
}

export function ActivityLoadCard({ result }: { result: ActivityLoadResult }) {
  const view = activityLoadView(result);
  return (
    <Card role="region" aria-labelledby="activity-load-title">
      <CardHeader>
        <CardTitle id="activity-load-title">{view.title}</CardTitle>
        <CardDescription>{view.intro}</CardDescription>
        {view.windowText ? (
          <p className="text-xs text-muted-foreground">{view.windowText}</p>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-4">
        {view.withheldExplanation ? <p className="text-sm">{view.withheldExplanation}</p> : null}
        {view.activeMinutes && view.effort ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberBlock part={view.activeMinutes} />
            <NumberBlock part={view.effort} />
          </div>
        ) : null}
        {view.effortDays.length > 0 ? (
          <div>
            <h3 className="mb-2 text-sm font-medium">Effort points by day</h3>
            <ul className="divide-y divide-border">
              {view.effortDays.map((day) => (
                <li
                  key={day.date}
                  className="flex justify-between gap-4 py-1.5 text-sm"
                  aria-label={day.accessibilityLabel}
                >
                  <span aria-hidden="true">{day.label}</span>
                  <span className="font-mono" aria-hidden="true">
                    {day.valueText}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {view.comparison ? (
          <section className="grid gap-1 text-sm" aria-labelledby="effort-comparison-title">
            <h3 id="effort-comparison-title" className="font-medium">
              {view.comparison.title}
            </h3>
            <p>{view.comparison.text}</p>
            {view.comparison.detail ? (
              <p className="text-muted-foreground">{view.comparison.detail}</p>
            ) : null}
            <p className="text-muted-foreground">{view.comparison.limits}</p>
          </section>
        ) : null}
        {view.context.length > 0 ? (
          <section className="grid gap-1 text-sm" aria-labelledby="activity-context-title">
            <h3 id="activity-context-title" className="font-medium">
              {ACTIVITY_LOAD_COPY.contextTitle}
            </h3>
            {view.context.map((line) => (
              <p key={line} className="text-muted-foreground">
                {line}
              </p>
            ))}
          </section>
        ) : null}
        {view.notes.map((line) => (
          <p key={line} className="text-xs text-muted-foreground">
            {line}
          </p>
        ))}
        {view.versionText ? (
          <p className="text-xs text-muted-foreground">{view.versionText}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
