/**
 * #clinical-3: the add and edit form for a clinical record, kept pure so the
 * dialog stays thin. One draft per kind, as the strings the inputs hold, and
 * the payload each write procedure takes (or null while it is not ready).
 */

export type ClinicalRecordKind = "cardiac" | "imaging" | "family";

export const CLINICAL_RECORD_KINDS: readonly ClinicalRecordKind[] = [
  "cardiac",
  "imaging",
  "family",
];

export type CardiacDraft = {
  kind: "cardiac";
  id: number | null;
  date: string;
  type: string;
  facility: string;
  physician: string;
  reason: string;
  conclusion: string;
  report: string;
};

export type ImagingDraft = {
  kind: "imaging";
  id: number | null;
  date: string;
  type: string;
  bodyPart: string;
  facility: string;
  physician: string;
  technique: string;
  conclusion: string;
  findings: string;
};

export type FamilyDraft = {
  kind: "family";
  id: number | null;
  relation: string;
  condition: string;
  ageOfOnset: string;
  notes: string;
};

export type ClinicalDraft = CardiacDraft | ImagingDraft | FamilyDraft;

/** A blank form of one kind, dated `today` where the kind has a date. */
export function emptyClinicalDraft<K extends ClinicalRecordKind>(
  kind: K,
  today: string,
): Extract<ClinicalDraft, { kind: K }> {
  return blankDraft(kind, today) as Extract<ClinicalDraft, { kind: K }>;
}

function blankDraft(kind: ClinicalRecordKind, today: string): ClinicalDraft {
  switch (kind) {
    case "cardiac":
      return {
        kind,
        id: null,
        date: today,
        type: "",
        facility: "",
        physician: "",
        reason: "",
        conclusion: "",
        report: "",
      };
    case "imaging":
      return {
        kind,
        id: null,
        date: today,
        type: "",
        bodyPart: "",
        facility: "",
        physician: "",
        technique: "",
        conclusion: "",
        findings: "",
      };
    case "family":
      return { kind, id: null, relation: "", condition: "", ageOfOnset: "", notes: "" };
  }
}

const text = (value: string | null | undefined) => value ?? "";

export function cardiacDraft(row: {
  id: number;
  date: string;
  type: string;
  facility: string | null;
  physician: string | null;
  reason: string | null;
  conclusion: string | null;
  report: string | null;
}): CardiacDraft {
  return {
    kind: "cardiac",
    id: row.id,
    date: row.date.slice(0, 10),
    type: row.type,
    facility: text(row.facility),
    physician: text(row.physician),
    reason: text(row.reason),
    conclusion: text(row.conclusion),
    report: text(row.report),
  };
}

export function imagingDraft(row: {
  id: number;
  date: string;
  type: string;
  bodyPart: string;
  facility: string | null;
  physician: string | null;
  technique: string | null;
  conclusion: string | null;
  findings: string | null;
}): ImagingDraft {
  return {
    kind: "imaging",
    id: row.id,
    date: row.date.slice(0, 10),
    type: row.type,
    bodyPart: row.bodyPart,
    facility: text(row.facility),
    physician: text(row.physician),
    technique: text(row.technique),
    conclusion: text(row.conclusion),
    findings: text(row.findings),
  };
}

export function familyDraft(row: {
  id: number;
  relation: string;
  condition: string;
  ageOfOnset: number | null;
  notes: string | null;
}): FamilyDraft {
  return {
    kind: "family",
    id: row.id,
    relation: row.relation,
    condition: row.condition,
    ageOfOnset: row.ageOfOnset === null ? "" : String(row.ageOfOnset),
    notes: text(row.notes),
  };
}

/** A real calendar day as `YYYY-MM-DD`, as a date input gives it. */
export function isRecordDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Trimmed, or null when left empty (the server stores "not recorded"). */
const optional = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};
const required = (value: string): string | null => optional(value);
const withId = (id: number | null) => (id === null ? {} : { id });

export type CardiacPayload = {
  id?: number;
  date: string;
  type: string;
  facility: string | null;
  physician: string | null;
  reason: string | null;
  conclusion: string | null;
  report: string | null;
};
export type ImagingPayload = {
  id?: number;
  date: string;
  type: string;
  bodyPart: string;
  facility: string | null;
  physician: string | null;
  technique: string | null;
  conclusion: string | null;
  findings: string | null;
};
export type FamilyPayload = {
  id?: number;
  relation: string;
  condition: string;
  ageOfOnset: number | null;
  notes: string | null;
};

export type ClinicalPayload =
  | { kind: "cardiac"; input: CardiacPayload }
  | { kind: "imaging"; input: ImagingPayload }
  | { kind: "family"; input: FamilyPayload };

/** The write input for a draft, or null while a required field is missing or invalid. */
export function clinicalPayload(draft: ClinicalDraft): ClinicalPayload | null {
  switch (draft.kind) {
    case "cardiac": {
      const type = required(draft.type);
      if (!isRecordDay(draft.date) || !type) return null;
      return {
        kind: "cardiac",
        input: {
          ...withId(draft.id),
          date: draft.date,
          type,
          facility: optional(draft.facility),
          physician: optional(draft.physician),
          reason: optional(draft.reason),
          conclusion: optional(draft.conclusion),
          report: optional(draft.report),
        },
      };
    }
    case "imaging": {
      const type = required(draft.type);
      const bodyPart = required(draft.bodyPart);
      if (!isRecordDay(draft.date) || !type || !bodyPart) return null;
      return {
        kind: "imaging",
        input: {
          ...withId(draft.id),
          date: draft.date,
          type,
          bodyPart,
          facility: optional(draft.facility),
          physician: optional(draft.physician),
          technique: optional(draft.technique),
          conclusion: optional(draft.conclusion),
          findings: optional(draft.findings),
        },
      };
    }
    case "family": {
      const relation = required(draft.relation);
      const condition = required(draft.condition);
      if (!relation || !condition) return null;
      const age = draft.ageOfOnset.trim();
      let ageOfOnset: number | null = null;
      if (age.length > 0) {
        if (!/^\d{1,3}$/.test(age)) return null;
        ageOfOnset = Number(age);
        if (ageOfOnset > 130) return null;
      }
      return {
        kind: "family",
        input: {
          ...withId(draft.id),
          relation,
          condition,
          ageOfOnset,
          notes: optional(draft.notes),
        },
      };
    }
  }
}
