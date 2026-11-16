import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Textarea } from "@openvalens/ui/components/textarea";
import { cn } from "@openvalens/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Footprints,
  HeartPulse,
  type LucideIcon,
  Moon,
  Scale,
  Send,
  Target,
  UtensilsCrossed,
} from "lucide-react";
import { type Ref, useState } from "react";

import { ToneIcon, type Tone } from "@/components/page";
import {
  COACH_IDEA_SUBJECT_LABELS,
  type CoachIdeaGroup,
  type CoachIdeaSubject,
  coachIdeas,
} from "@/utils/coach-ideas";
import { useEnabledModules } from "@/utils/modules";
import { orpc } from "@/utils/orpc";
import { useProductSettings } from "@/utils/product-settings";

/** The sidebar's module icons, one per group of ideas. */
const SUBJECT_ICONS: Record<CoachIdeaSubject, { icon: LucideIcon; tone: Tone }> = {
  sleep: { icon: Moon, tone: "sleep" },
  heart: { icon: HeartPulse, tone: "heart" },
  body: { icon: Scale, tone: "weight" },
  training: { icon: Footprints, tone: "steps" },
  food: { icon: UtensilsCrossed, tone: "food" },
  goals: { icon: Target, tone: "weight" },
};

/** Ideas from the person's insights, goals and readiness; general ones while those load. */
export function useCoachIdeas(): CoachIdeaGroup[] {
  const { i18n } = useLingui();
  const { isEnabled } = useEnabledModules();
  const settings = useProductSettings().data;
  const insights = useQuery({
    ...orpc.insights.list.queryOptions({ input: {} }),
    retry: false,
    staleTime: 60_000,
  });
  const goals = useQuery({ ...orpc.goals.list.queryOptions({ input: {} }), retry: false });
  const readiness = useQuery({
    ...orpc.score.readiness.queryOptions({ input: {} }),
    retry: false,
    staleTime: 60_000,
  });
  const score =
    readiness.data?.status === "available" && readiness.data.score !== null
      ? readiness.data.score
      : null;
  return coachIdeas(i18n, {
    insights: insights.data?.insights ?? [],
    goals: goals.data ?? [],
    readinessScore: score,
    isEnabled,
    settings,
  });
}

/** The message box for a new conversation. Enter sends; Shift+Enter adds a line. */
export function CoachComposer({
  ref,
  value,
  onChange,
  onSubmit,
  pending,
}: {
  ref?: Ref<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  const { t } = useLingui();
  return (
    <form
      className="sheet grid gap-2 p-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Textarea
        ref={ref}
        rows={2}
        className="min-h-16 resize-none border-transparent bg-transparent text-base shadow-none hover:bg-transparent"
        aria-label={t`Ask the coach anything…`}
        placeholder={t`Ask the coach anything…`}
        value={value}
        disabled={pending}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || value.trim().length === 0}>
          <Send aria-hidden="true" />
          {pending ? t`Starting…` : t`Send`}
        </Button>
      </div>
    </form>
  );
}

/** #coach-3: what the coach reads, in one line, with the details a tap away. */
export function CoachScopeLine() {
  return (
    <p className="text-sm text-ink-3">
      <Trans>Uses your sleep, activity, food and goals. Not medical advice.</Trans>{" "}
      <Link
        to="/settings"
        hash="ai"
        className="font-medium text-ink-2 underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Trans>Privacy details</Trans>
      </Link>
    </p>
  );
}

/** How many ideas a phone shows before "More ideas". */
const PHONE_IDEAS = 4;

/**
 * #coach-4: questions from the person's own records, grouped by subject with
 * the module icons. A tap puts the question in the message box to edit;
 * nothing is sent.
 */
export function CoachIdeas({
  groups,
  onPick,
}: {
  groups: readonly CoachIdeaGroup[];
  onPick: (text: string) => void;
}) {
  const { i18n } = useLingui();
  const [more, setMore] = useState(false);
  const total = groups.reduce((sum, group) => sum + group.ideas.length, 0);
  if (total === 0) return null;
  let shown = 0;
  return (
    <section aria-labelledby="coach-ideas-title" className="grid gap-3">
      <h2 id="coach-ideas-title" className="text-base leading-tight font-semibold text-ink-2">
        <Trans>Ideas to ask</Trans>
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {groups.map((group) => {
          const subject = SUBJECT_ICONS[group.subject];
          const firstIndex = shown;
          shown += group.ideas.length;
          // On a phone, only the first few until "More ideas".
          const hiddenOnPhone = !more && firstIndex >= PHONE_IDEAS;
          return (
            <div
              key={group.subject}
              className={cn("grid content-start gap-2", hiddenOnPhone && "max-sm:hidden")}
            >
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-2">
                <ToneIcon icon={subject.icon} tone={subject.tone} size="sm" />
                {i18n._(COACH_IDEA_SUBJECT_LABELS[group.subject])}
              </h3>
              <ul className="grid gap-1.5">
                {group.ideas.map((idea, index) => (
                  <li
                    key={idea.key}
                    className={cn(!more && firstIndex + index >= PHONE_IDEAS && "max-sm:hidden")}
                  >
                    <button
                      type="button"
                      onClick={() => onPick(idea.text)}
                      className="w-full rounded-2xl border border-rule bg-card px-3.5 py-2.5 text-left text-sm text-ink-2 transition-colors duration-[var(--dur-short)] hover:border-rule-2 hover:bg-paper-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {idea.text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {total > PHONE_IDEAS && !more ? (
        <Button variant="ghost" size="sm" className="w-fit sm:hidden" onClick={() => setMore(true)}>
          <Trans>More ideas</Trans>
        </Button>
      ) : null}
    </section>
  );
}
