import type { MessageDescriptor } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  clearsAdultOnlyAnswers,
  draftFromSnapshot,
  isAdultConfirmed,
  isAgeCheckImplied,
  isSectionAnswered,
  isSectionDirty,
  rejectionMessage,
  parseBirthYearInput,
  SECTION_TITLES,
  SETUP_SECTIONS,
  WELLNESS_CHOICE_LABELS,
  type SetupSection,
  type WellnessProfileDraft,
} from "@openvalens/api/presenters/wellness-profile";
import {
  unavailableExplanation,
  WELLNESS_ELIGIBILITY,
  WELLNESS_FIELD_COPY,
  WELLNESS_FOCUS_AREAS,
  WELLNESS_INPUT_METHODS,
  WELLNESS_REGIONS,
  WELLNESS_SEXES,
  type WellnessFocusArea,
  type WellnessProfileField,
  type WellnessProfileSnapshot,
} from "@openvalens/api/wellness-profile-contract";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import {
  Compass,
  Globe,
  ShieldCheck,
  Smartphone,
  Target,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useEffect, useId, useState, type ReactNode } from "react";

import { InfoTip, StatusPill } from "@/components/page";

/**
 * Issue #98 — presentational wellness profile editor (web).
 *
 * Every section is optional and saves on its own, so there is no fixed step
 * count and saving one section never touches another. Native controls
 * (fieldset/legend, radio, checkbox) give keyboard and screen-reader support;
 * each section announces its save state through a live region and errors
 * through `role="alert"`. The platform-neutral rules live in
 * `@openvalens/api/presenters/wellness-profile` and are shared with native.
 */

export type SectionSaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: MessageDescriptor };

export type WellnessProfileEditorProps = {
  snapshot: WellnessProfileSnapshot;
  draft: WellnessProfileDraft;
  onDraftChange: (draft: WellnessProfileDraft) => void;
  birthYearText: string;
  onBirthYearTextChange: (text: string) => void;
  saveState: Partial<Record<SetupSection, SectionSaveState>>;
  onSave: (section: SetupSection) => void;
  onUndo: (section: SetupSection) => void;
  /** Rendered as the optional goal section (uses the existing Goals feature). */
  goalSection?: ReactNode;
  /** A section to open on arrival (the page's `?section=`), even when answered. */
  initialOpen?: SetupSection | null;
  now: Date;
};

const SECTION_ICONS: Record<SetupSection, LucideIcon> = {
  eligibility: ShieldCheck,
  focus: Compass,
  inputMethod: Smartphone,
  goal: Target,
  region: Globe,
  ageAndSex: UserRound,
};

/**
 * The optional goal section is left out of the numbering, as it is of the
 * "N of M sections answered" count, so the two always agree.
 */
const NUMBERED_SECTIONS = SETUP_SECTIONS.filter((section) => section !== "goal");

/**
 * The numbered sections on show: the age check is left out once a saved birth
 * year answers it (#profile-3), and the rest number on from 1.
 */
function shownSections(snapshot: WellnessProfileSnapshot): readonly SetupSection[] {
  return isAgeCheckImplied(snapshot)
    ? NUMBERED_SECTIONS.filter((section) => section !== "eligibility")
    : NUMBERED_SECTIONS;
}

/**
 * #profile-2 — the choice sections save as soon as an answer changes. Age and
 * sex keep their Save button (the birth year is typed), and so does an age
 * check change that would also clear a saved birth year or sex.
 */
const SAVE_ON_CHANGE_SECTIONS: readonly SetupSection[] = [
  "eligibility",
  "focus",
  "inputMethod",
  "region",
];

export function savesOnChange(
  section: SetupSection,
  snapshot: WellnessProfileSnapshot,
  draft: WellnessProfileDraft,
): boolean {
  if (!SAVE_ON_CHANGE_SECTIONS.includes(section)) return false;
  return section !== "eligibility" || !clearsAdultOnlyAnswers(snapshot, draft);
}

/**
 * The head of one profile step: its number in a soft circle (none for the
 * optional goal), its icon and title, an optional ⓘ with the why, and a pill
 * once it has an answer.
 */
export function StepHead({
  section,
  titleId,
  answered = false,
  info,
  number,
}: {
  section: SetupSection;
  titleId: string;
  answered?: boolean;
  info?: ReactNode;
  /** Its place among the sections on show; defaults to its place in the full list. */
  number?: number;
}) {
  const { i18n } = useLingui();
  const Icon = SECTION_ICONS[section];
  return (
    <div className="flex flex-wrap items-center gap-3">
      {section === "goal" ? (
        <span className="size-9 shrink-0" aria-hidden="true" />
      ) : (
        <span
          className="num grid size-9 shrink-0 place-items-center rounded-full bg-sidebar-accent font-display text-base font-medium text-signal"
          aria-hidden="true"
        >
          {number ?? NUMBERED_SECTIONS.indexOf(section) + 1}
        </span>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Icon className="size-[18px] shrink-0 text-ink-3" aria-hidden="true" />
        <h2 id={titleId} className="text-xl leading-tight text-ink">
          {i18n._(SECTION_TITLES[section])}
        </h2>
        {info ? <InfoTip>{info}</InfoTip> : null}
      </div>
      {answered ? (
        <StatusPill tone="good">
          <Trans>Answered</Trans>
        </StatusPill>
      ) : null}
    </div>
  );
}

function setAnswer<F extends WellnessProfileField>(
  draft: WellnessProfileDraft,
  field: F,
  value: WellnessProfileDraft["answers"][F],
): WellnessProfileDraft {
  return { ...draft, answers: { ...draft.answers, [field]: value } };
}

export function WellnessProfileEditor(props: WellnessProfileEditorProps) {
  const { draft, onDraftChange } = props;
  const adult = isAdultConfirmed(draft.answers);
  const { t, i18n } = useLingui();
  const shown = shownSections(props.snapshot);
  const numberOf = (section: SetupSection) => shown.indexOf(section) + 1;

  return (
    <div className="grid gap-4">
      {/* #profile-3 — a saved birth year answers the age check, so it is not asked again. */}
      {shown.includes("eligibility") ? (
        <Section
          {...props}
          section="eligibility"
          field="eligibility"
          number={numberOf("eligibility")}
        >
          <EligibilityChoices {...props} />
        </Section>
      ) : null}

      <Section {...props} section="focus" field="focus" number={numberOf("focus")}>
        <div className="grid gap-2">
          {WELLNESS_FOCUS_AREAS.map((area) => {
            const selected =
              draft.answers.focus.state === "recorded" && draft.answers.focus.value.includes(area);
            return (
              <CheckboxRow
                key={area}
                label={i18n._(WELLNESS_CHOICE_LABELS.focus[area])}
                checked={selected}
                onChange={(checked) => {
                  const current: WellnessFocusArea[] =
                    draft.answers.focus.state === "recorded" ? [...draft.answers.focus.value] : [];
                  const next = checked
                    ? [...current, area]
                    : current.filter((value) => value !== area);
                  onDraftChange(
                    setAnswer(
                      draft,
                      "focus",
                      next.length > 0 ? { state: "recorded", value: next } : { state: "unknown" },
                    ),
                  );
                }}
              />
            );
          })}
          <CheckboxRow
            label={i18n._(WELLNESS_CHOICE_LABELS.justExploring)}
            checked={draft.answers.focus.state === "just_exploring"}
            onChange={(checked) =>
              onDraftChange(
                setAnswer(
                  draft,
                  "focus",
                  checked ? { state: "just_exploring" } : { state: "unknown" },
                ),
              )
            }
          />
        </div>
      </Section>

      <Section
        {...props}
        section="inputMethod"
        field="inputMethod"
        number={numberOf("inputMethod")}
      >
        <RadioGroup
          name="inputMethod"
          value={answerValue(draft.answers.inputMethod)}
          options={[
            ...WELLNESS_INPUT_METHODS.map((value) => ({
              value,
              label: i18n._(WELLNESS_CHOICE_LABELS.inputMethod[value]),
            })),
            { value: "declined", label: t`Not sure yet` },
          ]}
          onChange={(value) =>
            onDraftChange(
              setAnswer(
                draft,
                "inputMethod",
                value === "declined"
                  ? { state: "declined" }
                  : { state: "recorded", value: value as (typeof WELLNESS_INPUT_METHODS)[number] },
              ),
            )
          }
        />
      </Section>

      {props.goalSection}

      <Section {...props} section="region" field="region" number={numberOf("region")}>
        <RadioGroup
          name="region"
          value={answerValue(draft.answers.region)}
          options={[
            ...WELLNESS_REGIONS.map((value) => ({
              value,
              label: i18n._(WELLNESS_CHOICE_LABELS.region[value]),
            })),
            { value: "declined", label: i18n._(WELLNESS_CHOICE_LABELS.decline) },
          ]}
          onChange={(value) =>
            onDraftChange(
              setAnswer(
                draft,
                "region",
                value === "declined"
                  ? { state: "declined" }
                  : { state: "recorded", value: value as (typeof WELLNESS_REGIONS)[number] },
              ),
            )
          }
        />
      </Section>

      {adult ? (
        <AgeAndSexSection {...props} number={numberOf("ageAndSex")} />
      ) : (
        <section className="sheet grid gap-3 p-5 opacity-80 md:p-6">
          <StepHead
            section="ageAndSex"
            titleId="section-ageAndSex-unavailable"
            number={numberOf("ageAndSex")}
          />
          <p className="max-w-[65ch] text-sm text-ink-3">
            {unavailableExplanation("adult_confirmation_required")}{" "}
            <Trans>Age and sex are only used by adult features, so they are not asked here.</Trans>
          </p>
        </section>
      )}
    </div>
  );
}

function EligibilityChoices({ draft, onDraftChange }: WellnessProfileEditorProps) {
  const { i18n } = useLingui();
  return (
    <RadioGroup
      name="eligibility"
      value={answerValue(draft.answers.eligibility)}
      options={[
        ...WELLNESS_ELIGIBILITY.map((value) => ({
          value,
          label: i18n._(WELLNESS_CHOICE_LABELS.eligibility[value]),
        })),
        { value: "declined", label: i18n._(WELLNESS_CHOICE_LABELS.decline) },
      ]}
      onChange={(value) =>
        onDraftChange(
          setAnswer(
            draft,
            "eligibility",
            value === "declined"
              ? { state: "declined" }
              : { state: "recorded", value: value as "adult" | "under_18" },
          ),
        )
      }
    />
  );
}

function AgeAndSexSection(props: WellnessProfileEditorProps & { number: number }) {
  return (
    <Section {...props} section="ageAndSex" field="birthYear" extraField="sex">
      <AgeAndSexFields {...props} />
    </Section>
  );
}

/**
 * The adult-only birth year and sex questions, shared by the profile page and
 * the onboarding flow (same copy, same rules). The account's health-data
 * consent covers them; clearing an answer deletes it.
 */
export function AgeAndSexFields(
  props: Pick<
    WellnessProfileEditorProps,
    "draft" | "onDraftChange" | "birthYearText" | "onBirthYearTextChange" | "now"
  >,
) {
  const { draft, onDraftChange, birthYearText, onBirthYearTextChange, now } = props;
  const birthYearId = useId();
  const parsed = parseBirthYearInput(birthYearText, now);
  const ageDeclined = draft.answers.birthYear.state === "declined";
  const { i18n } = useLingui();

  return (
    <>
      <fieldset className="grid min-w-0 gap-3">
        <legend className="mb-1 flex items-center gap-1.5 font-display font-medium text-ink">
          {WELLNESS_FIELD_COPY.birthYear.question}
          <InfoTip>
            <p>{WELLNESS_FIELD_COPY.birthYear.purpose}</p>
            <p>{WELLNESS_FIELD_COPY.birthYear.limits}</p>
          </InfoTip>
        </legend>
        <div className="grid gap-1">
          <label htmlFor={birthYearId} className="text-sm text-ink-3">
            <Trans>Birth year</Trans>
          </label>
          <Input
            id={birthYearId}
            inputMode="numeric"
            autoComplete="bday-year"
            maxLength={4}
            className="num max-w-32"
            value={birthYearText}
            disabled={ageDeclined}
            aria-invalid={!parsed.ok}
            aria-describedby={!parsed.ok ? `${birthYearId}-error` : undefined}
            onChange={(event) => {
              const text = event.target.value;
              onBirthYearTextChange(text);
              const result = parseBirthYearInput(text, now);
              if (result.ok) {
                onDraftChange(
                  setAnswer(
                    draft,
                    "birthYear",
                    result.year === null
                      ? { state: "unknown" }
                      : { state: "recorded", value: result.year },
                  ),
                );
              }
            }}
          />
          {!parsed.ok ? (
            <p id={`${birthYearId}-error`} role="alert" className="text-sm text-destructive">
              {i18n._(rejectionMessage(parsed.reason))}
            </p>
          ) : null}
        </div>
        <CheckboxRow
          label={i18n._(WELLNESS_CHOICE_LABELS.decline)}
          checked={ageDeclined}
          onChange={(checked) => {
            onBirthYearTextChange("");
            onDraftChange(
              setAnswer(draft, "birthYear", checked ? { state: "declined" } : { state: "unknown" }),
            );
          }}
        />
      </fieldset>

      <hr className="border-rule" />

      <fieldset className="grid min-w-0 gap-3">
        <legend className="mb-1 flex items-center gap-1.5 font-display font-medium text-ink">
          {WELLNESS_FIELD_COPY.sex.question}
          <InfoTip>
            <p>{WELLNESS_FIELD_COPY.sex.purpose}</p>
            <p>{WELLNESS_FIELD_COPY.sex.limits}</p>
          </InfoTip>
        </legend>
        <RadioGroup
          name="sex"
          value={answerValue(draft.answers.sex)}
          options={[
            ...WELLNESS_SEXES.map((value) => ({
              value,
              label: i18n._(WELLNESS_CHOICE_LABELS.sex[value]),
            })),
            { value: "not_applicable", label: i18n._(WELLNESS_CHOICE_LABELS.sexNotApplicable) },
            { value: "declined", label: i18n._(WELLNESS_CHOICE_LABELS.decline) },
          ]}
          onChange={(value) =>
            onDraftChange(
              setAnswer(
                draft,
                "sex",
                value === "declined"
                  ? { state: "declined" }
                  : value === "not_applicable"
                    ? { state: "not_applicable" }
                    : { state: "recorded", value: value as "female" | "male" },
              ),
            )
          }
        />
      </fieldset>
    </>
  );
}

export function answerValue(answer: { state: string; value?: unknown }): string | null {
  if (answer.state === "unknown") return null;
  return answer.state === "recorded" ? String(answer.value) : answer.state;
}

/**
 * #profile-1 — a saved answer in a few words ("United Kingdom", "Born 1990,
 * Female"), for the collapsed section. Unanswered fields are left out.
 */
export function sectionSummary(
  section: SetupSection,
  snapshot: WellnessProfileSnapshot,
  i18n: I18n,
): string {
  const labels = WELLNESS_CHOICE_LABELS;
  const decline = i18n._(labels.decline);
  const answers = draftFromSnapshot(snapshot).answers;
  switch (section) {
    case "eligibility": {
      const answer = answers.eligibility;
      if (answer.state === "recorded") return i18n._(labels.eligibility[answer.value]);
      return answer.state === "declined" ? decline : "";
    }
    case "focus": {
      const answer = answers.focus;
      if (answer.state === "recorded") {
        return answer.value.map((area) => i18n._(labels.focus[area])).join(", ");
      }
      return answer.state === "just_exploring" ? i18n._(labels.justExploring) : "";
    }
    case "inputMethod": {
      const answer = answers.inputMethod;
      if (answer.state === "recorded") return i18n._(labels.inputMethod[answer.value]);
      return answer.state === "declined" ? i18n._(labels.notSureYet) : "";
    }
    case "region": {
      const answer = answers.region;
      if (answer.state === "recorded") return i18n._(labels.region[answer.value]);
      return answer.state === "declined" ? decline : "";
    }
    case "ageAndSex": {
      const parts: string[] = [];
      const year = answers.birthYear;
      if (year.state === "recorded") {
        const born = year.value;
        parts.push(i18n._(msg`Born ${born}`));
      } else if (year.state === "declined") {
        parts.push(i18n._(msg`Birth year: ${decline}`));
      }
      const sex = answers.sex;
      if (sex.state === "recorded") parts.push(i18n._(labels.sex[sex.value]));
      else if (sex.state === "not_applicable") parts.push(i18n._(labels.sexNotApplicable));
      else if (sex.state === "declined") parts.push(i18n._(msg`Sex: ${decline}`));
      return parts.join(", ");
    }
    case "goal":
      return "";
  }
}

function Section(
  props: WellnessProfileEditorProps & {
    section: SetupSection;
    field: WellnessProfileField;
    extraField?: WellnessProfileField;
    /** Its place among the sections on show. */
    number: number;
    children: ReactNode;
  },
) {
  const { section, snapshot, draft, saveState, onUndo, initialOpen } = props;
  const dirty = isSectionDirty(snapshot, draft, section);
  const state = saveState[section] ?? { status: "idle" };
  const answered = isSectionAnswered(section, snapshot);
  const [editing, setEditing] = useState(initialOpen === section);
  const autoSave = savesOnChange(section, snapshot, draft);
  // Several focus areas can be ticked, so that section stays open while the
  // person picks; Done folds it. A single choice folds once it is saved.
  const multiple = section === "focus";
  const { i18n } = useLingui();

  useEffect(() => {
    if (multiple && dirty) setEditing(true);
  }, [multiple, dirty]);

  // A saved edit folds back into its summary.
  useEffect(() => {
    if (state.status === "saved" && !multiple) setEditing(false);
  }, [state.status, multiple]);

  const open =
    !answered || editing || dirty || state.status === "saving" || state.status === "error";
  if (!open) {
    return (
      <SectionSummary
        section={section}
        number={props.number}
        summary={sectionSummary(section, snapshot, i18n)}
        saved={state.status === "saved"}
        onEdit={() => setEditing(true)}
      />
    );
  }
  return (
    <SectionForm
      {...props}
      autoSave={autoSave}
      onDone={answered && autoSave ? () => setEditing(false) : undefined}
      onCancel={
        answered && !autoSave
          ? () => {
              onUndo(section);
              setEditing(false);
            }
          : undefined
      }
    />
  );
}

/** An answered section, folded: its number, title, the answer and Edit. */
function SectionSummary({
  section,
  number,
  summary,
  saved,
  onEdit,
}: {
  section: SetupSection;
  number: number;
  summary: string;
  saved: boolean;
  onEdit: () => void;
}) {
  const titleId = useId();
  const { i18n } = useLingui();
  const Icon = SECTION_ICONS[section];
  return (
    <section
      id={`section-${section}`}
      aria-labelledby={titleId}
      role="region"
      className="sheet flex scroll-mt-10 items-center gap-x-4 gap-y-2 p-4 md:px-6"
    >
      <span
        className="num grid size-9 shrink-0 place-items-center rounded-full bg-sidebar-accent font-display text-base font-medium text-signal"
        aria-hidden="true"
      >
        {number}
      </span>
      <div className="grid min-w-0 flex-1 basis-0 gap-0.5">
        <h2 id={titleId} className="flex items-center gap-2 text-lg leading-tight text-ink">
          <Icon className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
          {i18n._(SECTION_TITLES[section])}
        </h2>
        <p className="text-sm text-ink-2">{summary}</p>
      </div>
      <span role="status" aria-live="polite" className="text-sm text-success">
        {saved ? <Trans>Saved</Trans> : null}
      </span>
      <Button variant="outline" size="sm" onClick={onEdit}>
        <Trans>Edit</Trans>
      </Button>
    </section>
  );
}

function SectionForm({
  section,
  field,
  extraField,
  snapshot,
  draft,
  onDraftChange,
  onBirthYearTextChange,
  saveState,
  onSave,
  onUndo,
  onCancel,
  onDone,
  autoSave,
  number,
  children,
}: WellnessProfileEditorProps & {
  section: SetupSection;
  field: WellnessProfileField;
  extraField?: WellnessProfileField;
  number: number;
  /** #profile-2 — the answer saves as soon as it changes (the page does the saving). */
  autoSave: boolean;
  /** For an answered section being edited: discard the edit and fold it again. */
  onCancel?: () => void;
  /** For an answered section that saves on change: fold it again. */
  onDone?: () => void;
  children: ReactNode;
}) {
  const copy = WELLNESS_FIELD_COPY[field];
  const dirty = isSectionDirty(snapshot, draft, section);
  const state = saveState[section] ?? { status: "idle" };
  const titleId = useId();
  const fields = extraField ? [field, extraField] : [field];
  const hasAnswer = fields.some((f) => draft.answers[f].state !== "unknown");
  const { t, i18n } = useLingui();

  return (
    <section
      id={`section-${section}`}
      aria-labelledby={titleId}
      role="region"
      className="sheet grid scroll-mt-10 gap-5 p-5 md:p-6"
    >
      <StepHead
        section={section}
        titleId={titleId}
        number={number}
        answered={isSectionAnswered(section, snapshot)}
        info={
          section !== "ageAndSex" ? (
            <>
              <p>{copy.purpose}</p>
              <p>{copy.limits}</p>
            </>
          ) : undefined
        }
      />
      {section !== "ageAndSex" ? (
        <fieldset className="grid min-w-0 gap-2">
          <legend className="mb-2 font-display font-medium text-ink">{copy.question}</legend>
          {children}
        </fieldset>
      ) : (
        children
      )}
      {section === "eligibility" && clearsAdultOnlyAnswers(snapshot, draft) ? (
        <p className="max-w-[65ch] text-sm text-ink-2">
          <Trans comment="safety">Saving this also clears your birth year and sex.</Trans>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {!autoSave ? (
          <Button
            variant={dirty ? "default" : "outline"}
            onClick={() => onSave(section)}
            disabled={!dirty || state.status === "saving"}
          >
            {state.status === "saving" ? t`Saving…` : t`Save`}
          </Button>
        ) : state.status === "error" ? (
          // A failed save on change waits for the person: no retry loop.
          <Button variant="outline" onClick={() => onSave(section)}>
            <Trans>Try again</Trans>
          </Button>
        ) : null}
        {onDone && !dirty && state.status !== "saving" ? (
          <Button variant="ghost" onClick={onDone}>
            <Trans>Done</Trans>
          </Button>
        ) : null}
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            <Trans>Cancel</Trans>
          </Button>
        ) : dirty && (!autoSave || state.status === "error") ? (
          <Button variant="ghost" onClick={() => onUndo(section)}>
            <Trans>Undo changes</Trans>
          </Button>
        ) : null}
        {hasAnswer ? (
          // #profile-2 — the destructive choice stays quiet.
          <Button
            variant="link"
            size="sm"
            className="text-ink-3"
            onClick={() => {
              let next = draft;
              for (const f of fields) next = setAnswer(next, f, { state: "unknown" });
              if (fields.includes("birthYear")) onBirthYearTextChange("");
              onDraftChange(next);
            }}
          >
            <Trans>Clear answer</Trans>
          </Button>
        ) : null}
        <span role="status" aria-live="polite" className="text-sm">
          {state.status === "error" ? null : autoSave && (dirty || state.status === "saving") ? (
            <span className="text-ink-3">{t`Saving…`}</span>
          ) : dirty ? (
            <span className="text-ink-3">
              <Trans>Unsaved changes</Trans>
            </span>
          ) : state.status === "saved" ? (
            <span className="text-success">
              <Trans>Saved</Trans>
            </span>
          ) : null}
        </span>
      </div>
      {state.status === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {i18n._(state.message)}
        </p>
      ) : null}
    </section>
  );
}

export function RadioGroup({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string | null;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-2">
      {options.map((option) => {
        const optionId = `${id}-${option.value}`;
        return (
          <div
            key={option.value}
            className="flex min-h-10 items-center gap-3 rounded-xl px-3 transition-colors duration-[var(--dur-short)] hover:bg-paper-2 active:bg-paper-3"
          >
            <input
              type="radio"
              id={optionId}
              name={`${name}-${id}`}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
              className="size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55"
            />
            <label
              htmlFor={optionId}
              className={option.disabled ? "flex-1 py-2 text-ink-3" : "flex-1 py-2 text-ink-2"}
            >
              {option.label}
            </label>
          </div>
        );
      })}
    </div>
  );
}

export function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-h-10 items-start gap-3 rounded-xl px-3 py-2 transition-colors duration-[var(--dur-short)] hover:bg-paper-2 active:bg-paper-3">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      <label htmlFor={id} className="flex-1 text-ink-2">
        {label}
      </label>
    </div>
  );
}
