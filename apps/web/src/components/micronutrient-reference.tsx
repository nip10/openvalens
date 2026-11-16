import type { TargetSettingsWire } from "@openvalens/api/contracts/nutrition-targets";
import {
  MICRONUTRIENT_COPY,
  MICRONUTRIENT_POPULATIONS,
} from "@openvalens/api/presenters/micronutrients";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";

import { inlineButtonClass, nativeSelectClass } from "@/components/food-classes";
import type { useNutritionSettings } from "@/utils/nutrition-settings";
import { orpc } from "@/utils/orpc";

type Save = ReturnType<typeof useNutritionSettings>["save"];

/** The choice saves at once, so the shared help's "until you save" does not apply here. */
const SOURCE_HELP = msg`EFSA is the usual choice in the EU, EEA and UK; NASEM in the United States. Pick the group that fits you.`;

/** EFSA or NASEM and the group to compare with, saved as soon as it is chosen (#78). */
export function MicronutrientReference({
  settings,
  save,
  className,
}: {
  settings: Pick<TargetSettingsWire, "micronutrientReferenceSource" | "micronutrientPopulation">;
  save: Save;
  className?: string;
}) {
  const { t, i18n } = useLingui();
  const source = settings.micronutrientReferenceSource;
  const population = settings.micronutrientPopulation;
  // Only for the suggestion; the summary itself is on its own page.
  const proposal = useQuery({
    ...orpc.nutritionMicronutrients.summary.queryOptions({
      input: { localDate: new Date().toISOString().slice(0, 10) },
    }),
    select: (data) => data.proposal,
  });
  const proposalText = (
    from: keyof typeof MICRONUTRIENT_COPY.sources,
    populationId: keyof typeof MICRONUTRIENT_POPULATIONS | null,
  ) => {
    const sourceName = i18n._(MICRONUTRIENT_COPY.sources[from]);
    if (!populationId) return t`Suggested from your profile: ${sourceName}.`;
    const group = MICRONUTRIENT_POPULATIONS[populationId].label;
    return t`Suggested from your profile: ${sourceName}, ${group}.`;
  };
  return (
    <fieldset className={className ?? "mb-4 grid gap-2 rounded-2xl bg-paper-2 p-4 text-sm"}>
      <legend className="float-left mb-1 font-display font-medium text-ink">
        {i18n._(MICRONUTRIENT_COPY.sourceLabel)}
      </legend>
      <p className="text-ink-3">{i18n._(SOURCE_HELP)}</p>
      <div className="flex flex-wrap gap-4">
        <label className="grid gap-1.5 text-ink-3">
          <Trans>Source</Trans>
          <select
            className={nativeSelectClass}
            value={source ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              void save({
                micronutrientReferenceSource: value === "efsa" || value === "nasem" ? value : null,
                micronutrientPopulation: null,
              });
            }}
          >
            <option value="">{t`None`}</option>
            <option value="efsa">{i18n._(MICRONUTRIENT_COPY.sources.efsa)}</option>
            <option value="nasem">{i18n._(MICRONUTRIENT_COPY.sources.nasem)}</option>
          </select>
        </label>
        {source ? (
          <label className="grid gap-1.5 text-ink-3">
            <Trans>Group</Trans>
            <select
              className={nativeSelectClass}
              value={population ?? ""}
              onChange={(event) =>
                void save({
                  micronutrientPopulation: (event.target.value ||
                    null) as TargetSettingsWire["micronutrientPopulation"],
                })
              }
            >
              <option value="">{t`Choose a group`}</option>
              {Object.entries(MICRONUTRIENT_POPULATIONS)
                .filter(([, group]) => group.source === source)
                .map(([id, group]) => (
                  <option key={id} value={id}>
                    {group.label}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
      </div>
      {proposal.data?.source &&
      (proposal.data.source !== source ||
        (proposal.data.population && proposal.data.population !== population)) ? (
        <p className="text-ink-2">
          {proposalText(proposal.data.source, proposal.data.population)}{" "}
          <button
            type="button"
            className={inlineButtonClass}
            onClick={() =>
              void save({
                micronutrientReferenceSource: proposal.data!.source,
                micronutrientPopulation: proposal.data!.population,
              })
            }
          >
            <Trans>Use this</Trans>
          </button>
        </p>
      ) : null}
    </fieldset>
  );
}
