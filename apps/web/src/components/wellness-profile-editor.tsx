import {
  isAdultConfirmed,
  isSectionDirty,
  rejectionMessage,
  parseBirthYearInput,
  SECTION_TITLES,
  type SetupSection,
  type WellnessProfileDraft,
} from "@openvalens/api/presenters/wellness-profile";
import {
  CONSENT_COPY,
  DECLINE_LABEL,
  ELIGIBILITY_LABELS,
  FOCUS_AREA_LABELS,
  INPUT_METHOD_LABELS,
  JUST_EXPLORING_LABEL,
  REGION_LABELS,
  SEX_LABELS,
  SEX_NOT_APPLICABLE_LABEL,
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";
import { Input } from "@openvalens/ui/components/input";
import { useId, type ReactNode } from "react";

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
  | { status: "error"; message: string };

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
  now: Date;
};

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

  return (
    <div className="grid gap-6">
      <Section {...props} section="eligibility" field="eligibility">
        <RadioGroup
          name="eligibility"
          value={answerValue(draft.answers.eligibility)}
          options={[
            ...WELLNESS_ELIGIBILITY.map((value) => ({ value, label: ELIGIBILITY_LABELS[value] })),
            { value: "declined", label: DECLINE_LABEL },
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
      </Section>

      <Section {...props} section="focus" field="focus">
        <div className="grid gap-2">
          {WELLNESS_FOCUS_AREAS.map((area) => {
            const selected =
              draft.answers.focus.state === "recorded" && draft.answers.focus.value.includes(area);
            return (
              <CheckboxRow
                key={area}
                label={FOCUS_AREA_LABELS[area]}
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
            label={JUST_EXPLORING_LABEL}
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

      <Section {...props} section="inputMethod" field="inputMethod">
        <RadioGroup
          name="inputMethod"
          value={answerValue(draft.answers.inputMethod)}
          options={[
            ...WELLNESS_INPUT_METHODS.map((value) => ({
              value,
              label: INPUT_METHOD_LABELS[value],
            })),
            { value: "declined", label: "Not sure yet" },
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

      <Section {...props} section="region" field="region">
        <RadioGroup
          name="region"
          value={answerValue(draft.answers.region)}
          options={[
            ...WELLNESS_REGIONS.map((value) => ({ value, label: REGION_LABELS[value] })),
            { value: "declined", label: DECLINE_LABEL },
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
        <AgeAndSexSection {...props} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{SECTION_TITLES.ageAndSex}</CardTitle>
            <CardDescription>
              {unavailableExplanation("adult_confirmation_required")} Age and sex are only used by
              adult features, so they are not asked here.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}

function AgeAndSexSection(props: WellnessProfileEditorProps) {
  const { draft, onDraftChange, birthYearText, onBirthYearTextChange, now } = props;
  const birthYearId = useId();
  const parsed = parseBirthYearInput(birthYearText, now);
  const ageDeclined = draft.answers.birthYear.state === "declined";

  const setConsent = (purpose: "age_band" | "sex", checked: boolean) => {
    let next: WellnessProfileDraft = {
      ...draft,
      consents: { ...draft.consents, [purpose]: checked },
    };
    // Without consent a recorded value cannot be kept: clear it in the draft so
    // the person sees exactly what saving will do.
    if (!checked && purpose === "age_band" && next.answers.birthYear.state === "recorded") {
      next = setAnswer(next, "birthYear", { state: "unknown" });
      onBirthYearTextChange("");
    }
    if (!checked && purpose === "sex" && next.answers.sex.state === "recorded") {
      next = setAnswer(next, "sex", { state: "unknown" });
    }
    onDraftChange(next);
  };

  return (
    <Section {...props} section="ageAndSex" field="birthYear" extraField="sex">
      <fieldset className="grid gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">
          {WELLNESS_FIELD_COPY.birthYear.question}
        </legend>
        <p className="text-xs text-muted-foreground">{WELLNESS_FIELD_COPY.birthYear.purpose}</p>
        <p className="text-xs text-muted-foreground">{WELLNESS_FIELD_COPY.birthYear.limits}</p>
        <CheckboxRow
          label={CONSENT_COPY.age_band}
          checked={draft.consents.age_band}
          onChange={(checked) => setConsent("age_band", checked)}
        />
        <div className="grid gap-1">
          <label htmlFor={birthYearId} className="text-sm">
            Birth year
          </label>
          <Input
            id={birthYearId}
            inputMode="numeric"
            autoComplete="bday-year"
            maxLength={4}
            className="max-w-32"
            value={birthYearText}
            disabled={!draft.consents.age_band || ageDeclined}
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
            <p id={`${birthYearId}-error`} role="alert" className="text-xs text-destructive">
              {rejectionMessage(parsed.reason)}
            </p>
          ) : null}
        </div>
        <CheckboxRow
          label={DECLINE_LABEL}
          checked={ageDeclined}
          onChange={(checked) => {
            onBirthYearTextChange("");
            onDraftChange(
              setAnswer(draft, "birthYear", checked ? { state: "declined" } : { state: "unknown" }),
            );
          }}
        />
      </fieldset>

      <fieldset className="grid gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{WELLNESS_FIELD_COPY.sex.question}</legend>
        <p className="text-xs text-muted-foreground">{WELLNESS_FIELD_COPY.sex.purpose}</p>
        <p className="text-xs text-muted-foreground">{WELLNESS_FIELD_COPY.sex.limits}</p>
        <CheckboxRow
          label={CONSENT_COPY.sex}
          checked={draft.consents.sex}
          onChange={(checked) => setConsent("sex", checked)}
        />
        <RadioGroup
          name="sex"
          value={answerValue(draft.answers.sex)}
          options={[
            ...WELLNESS_SEXES.map((value) => ({
              value,
              label: SEX_LABELS[value],
              disabled: !draft.consents.sex,
            })),
            { value: "not_applicable", label: SEX_NOT_APPLICABLE_LABEL },
            { value: "declined", label: DECLINE_LABEL },
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
    </Section>
  );
}

function answerValue(answer: { state: string; value?: unknown }): string | null {
  if (answer.state === "unknown") return null;
  return answer.state === "recorded" ? String(answer.value) : answer.state;
}

function Section({
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
  children,
}: WellnessProfileEditorProps & {
  section: SetupSection;
  field: WellnessProfileField;
  extraField?: WellnessProfileField;
  children: ReactNode;
}) {
  const copy = WELLNESS_FIELD_COPY[field];
  const dirty = isSectionDirty(snapshot, draft, section);
  const state = saveState[section] ?? { status: "idle" };
  const titleId = useId();
  const fields = extraField ? [field, extraField] : [field];
  const hasAnswer = fields.some((f) => draft.answers[f].state !== "unknown");

  return (
    <Card id={`section-${section}`} aria-labelledby={titleId} role="region">
      <CardHeader>
        <CardTitle id={titleId} className="text-lg">
          {SECTION_TITLES[section]}
        </CardTitle>
        {section !== "ageAndSex" ? <CardDescription>{copy.purpose}</CardDescription> : null}
      </CardHeader>
      <CardContent className="grid gap-4">
        {section !== "ageAndSex" ? (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{copy.question}</legend>
            {children}
            <p className="text-xs text-muted-foreground">{copy.limits}</p>
          </fieldset>
        ) : (
          children
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => onSave(section)} disabled={!dirty || state.status === "saving"}>
            {state.status === "saving" ? "Saving…" : "Save"}
          </Button>
          {dirty ? (
            <Button variant="ghost" onClick={() => onUndo(section)}>
              Undo changes
            </Button>
          ) : null}
          {hasAnswer ? (
            <Button
              variant="outline"
              onClick={() => {
                let next = draft;
                for (const f of fields) next = setAnswer(next, f, { state: "unknown" });
                if (fields.includes("birthYear")) onBirthYearTextChange("");
                onDraftChange(next);
              }}
            >
              Clear answer
            </Button>
          ) : null}
          <span role="status" aria-live="polite" className="text-sm">
            {state.status === "error" ? null : dirty ? (
              <span className="text-muted-foreground">Unsaved changes</span>
            ) : state.status === "saved" ? (
              <span className="text-success">Saved</span>
            ) : null}
          </span>
        </div>
        {state.status === "error" ? (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RadioGroup({
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
          <div key={option.value} className="flex items-center gap-2">
            <input
              type="radio"
              id={optionId}
              name={`${name}-${id}`}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
              className="h-4 w-4"
            />
            <label htmlFor={optionId} className={option.disabled ? "text-muted-foreground" : ""}>
              {option.label}
            </label>
          </div>
        );
      })}
    </div>
  );
}

function CheckboxRow({
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
    <div className="flex items-start gap-2">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4"
      />
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
    </div>
  );
}
