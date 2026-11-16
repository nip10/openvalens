import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Textarea } from "@openvalens/ui/components/textarea";
import { cn } from "@openvalens/ui/lib/utils";
import type { ReactNode } from "react";

import { FormDialog } from "@/components/form-dialog";
import {
  CLINICAL_RECORD_KINDS,
  clinicalPayload,
  emptyClinicalDraft,
  type ClinicalDraft,
  type ClinicalRecordKind,
} from "@/utils/clinical-records";

/**
 * #clinical-3: add or edit one clinical record. A new record starts with the
 * choice of kind; an existing one opens on its kind with every recorded field,
 * so it doubles as the record's full view.
 */
export function ClinicalRecordDialog({
  draft,
  today,
  onDraftChange,
  onClose,
  onSave,
  saving,
  failed,
}: {
  draft: ClinicalDraft | null;
  today: string;
  onDraftChange: (draft: ClinicalDraft) => void;
  onClose: () => void;
  onSave: (draft: ClinicalDraft) => void;
  saving: boolean;
  failed: boolean;
}) {
  const { t } = useLingui();
  if (!draft) return null;
  const editing = draft.id !== null;
  const ready = clinicalPayload(draft) !== null;
  const kindLabel: Record<ClinicalRecordKind, string> = {
    cardiac: t`Cardiac exam`,
    imaging: t`Imaging study`,
    family: t`Family history`,
  };
  const title = editing
    ? draft.kind === "cardiac"
      ? t`Edit cardiac exam`
      : draft.kind === "imaging"
        ? t`Edit imaging study`
        : t`Edit family history`
    : t`Add a record`;
  const set = (patch: Partial<ClinicalDraft>) =>
    onDraftChange({ ...draft, ...patch } as ClinicalDraft);

  return (
    <FormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      size="lg"
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !saving) onSave(draft);
        }}
      >
        {editing ? null : (
          <div
            className="flex flex-wrap gap-2 sm:col-span-2"
            role="group"
            aria-label={t`Kind of record`}
          >
            {CLINICAL_RECORD_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={draft.kind === kind}
                onClick={() => {
                  if (draft.kind !== kind) onDraftChange(emptyClinicalDraft(kind, today));
                }}
                className={cn(
                  "min-h-10 rounded-full border px-4 text-sm",
                  draft.kind === kind
                    ? "border-water bg-water-soft font-semibold text-ink"
                    : "border-border bg-card text-ink-2",
                )}
              >
                {kindLabel[kind]}
              </button>
            ))}
          </div>
        )}

        {draft.kind === "cardiac" ? (
          <>
            <Field id="clinical-date" label={t`Date`}>
              <Input
                id="clinical-date"
                type="date"
                required
                max={today}
                value={draft.date}
                onChange={(event) => set({ date: event.target.value })}
              />
            </Field>
            <Field id="clinical-type" label={t`Exam`}>
              <Input
                id="clinical-type"
                required
                list="clinical-cardiac-types"
                placeholder={t`ECG, echocardiogram…`}
                value={draft.type}
                onChange={(event) => set({ type: event.target.value })}
              />
              <datalist id="clinical-cardiac-types">
                <option value="ECG" />
                <option value={t`Echocardiogram`} />
                <option value={t`Stress test`} />
                <option value={t`Holter`} />
              </datalist>
            </Field>
            <Field id="clinical-facility" label={t`Facility`} optional>
              <Input
                id="clinical-facility"
                value={draft.facility}
                onChange={(event) => set({ facility: event.target.value })}
              />
            </Field>
            <Field id="clinical-physician" label={t`Doctor`} optional>
              <Input
                id="clinical-physician"
                value={draft.physician}
                onChange={(event) => set({ physician: event.target.value })}
              />
            </Field>
            <Field id="clinical-reason" label={t`Reason`} optional wide>
              <Input
                id="clinical-reason"
                value={draft.reason}
                onChange={(event) => set({ reason: event.target.value })}
              />
            </Field>
            <Field id="clinical-conclusion" label={t`Conclusion`} optional wide>
              <Textarea
                id="clinical-conclusion"
                className="min-h-20"
                value={draft.conclusion}
                onChange={(event) => set({ conclusion: event.target.value })}
              />
            </Field>
            <Field id="clinical-report" label={t`Full report`} optional wide>
              <Textarea
                id="clinical-report"
                value={draft.report}
                onChange={(event) => set({ report: event.target.value })}
              />
            </Field>
          </>
        ) : draft.kind === "imaging" ? (
          <>
            <Field id="clinical-date" label={t`Date`}>
              <Input
                id="clinical-date"
                type="date"
                required
                max={today}
                value={draft.date}
                onChange={(event) => set({ date: event.target.value })}
              />
            </Field>
            <Field id="clinical-type" label={t`Study`}>
              <Input
                id="clinical-type"
                required
                list="clinical-imaging-types"
                placeholder={t`MRI, X-ray…`}
                value={draft.type}
                onChange={(event) => set({ type: event.target.value })}
              />
              <datalist id="clinical-imaging-types">
                <option value="MRI" />
                <option value="CT" />
                <option value={t`X-ray`} />
                <option value={t`Ultrasound`} />
              </datalist>
            </Field>
            <Field id="clinical-body-part" label={t`Body part`} wide>
              <Input
                id="clinical-body-part"
                required
                value={draft.bodyPart}
                onChange={(event) => set({ bodyPart: event.target.value })}
              />
            </Field>
            <Field id="clinical-facility" label={t`Facility`} optional>
              <Input
                id="clinical-facility"
                value={draft.facility}
                onChange={(event) => set({ facility: event.target.value })}
              />
            </Field>
            <Field id="clinical-physician" label={t`Doctor`} optional>
              <Input
                id="clinical-physician"
                value={draft.physician}
                onChange={(event) => set({ physician: event.target.value })}
              />
            </Field>
            <Field id="clinical-technique" label={t`Technique`} optional wide>
              <Input
                id="clinical-technique"
                value={draft.technique}
                onChange={(event) => set({ technique: event.target.value })}
              />
            </Field>
            <Field id="clinical-conclusion" label={t`Conclusion`} optional wide>
              <Textarea
                id="clinical-conclusion"
                className="min-h-20"
                value={draft.conclusion}
                onChange={(event) => set({ conclusion: event.target.value })}
              />
            </Field>
            <Field id="clinical-findings" label={t`Findings`} optional wide>
              <Textarea
                id="clinical-findings"
                value={draft.findings}
                onChange={(event) => set({ findings: event.target.value })}
              />
            </Field>
          </>
        ) : (
          <>
            <Field id="clinical-relation" label={t`Relative`}>
              <Input
                id="clinical-relation"
                required
                list="clinical-relations"
                placeholder={t`Mother, father…`}
                value={draft.relation}
                onChange={(event) => set({ relation: event.target.value })}
              />
              <datalist id="clinical-relations">
                <option value={t`Mother`} />
                <option value={t`Father`} />
                <option value={t`Sister`} />
                <option value={t`Brother`} />
                <option value={t`Grandmother`} />
                <option value={t`Grandfather`} />
              </datalist>
            </Field>
            <Field id="clinical-onset" label={t`Age at onset`} optional>
              <Input
                id="clinical-onset"
                type="number"
                inputMode="numeric"
                min="0"
                max="130"
                step="1"
                value={draft.ageOfOnset}
                onChange={(event) => set({ ageOfOnset: event.target.value })}
              />
            </Field>
            <Field id="clinical-condition" label={t`Condition`} wide>
              <Input
                id="clinical-condition"
                required
                value={draft.condition}
                onChange={(event) => set({ condition: event.target.value })}
              />
            </Field>
            <Field id="clinical-notes" label={t`Notes`} optional wide>
              <Textarea
                id="clinical-notes"
                className="min-h-20"
                value={draft.notes}
                onChange={(event) => set({ notes: event.target.value })}
              />
            </Field>
          </>
        )}

        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={!ready || saving}>
            {saving ? (
              <Trans>Saving…</Trans>
            ) : editing ? (
              <Trans>Save changes</Trans>
            ) : (
              <Trans>Save record</Trans>
            )}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          {failed ? (
            <span role="alert" className="text-sm text-destructive">
              <Trans>Could not save. Check your connection and try again.</Trans>
            </span>
          ) : null}
        </div>
      </form>
    </FormDialog>
  );
}

function Field({
  id,
  label,
  optional = false,
  wide = false,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid content-start gap-2", wide && "sm:col-span-2")}>
      <Label htmlFor={id}>
        {label}
        {optional ? (
          <span className="font-normal text-ink-3">
            {" "}
            <Trans>(optional)</Trans>
          </span>
        ) : null}
      </Label>
      {children}
    </div>
  );
}
