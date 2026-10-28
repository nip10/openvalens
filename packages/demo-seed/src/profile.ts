import { PERSON_MODULES } from "@openvalens/api/wellness-profile-contract";

import type { DemoApi, DemoActor } from "./api";

/**
 * Finishes setup the way the welcome flow does, so the demo person lands on
 * the dashboard (not `/welcome`) with every module switched on.
 */
export async function completeSetup(
  api: DemoApi,
  actor: DemoActor,
  answers: { sex: "female" | "male"; birthYear: number },
): Promise<void> {
  const profile = await api.call<{ revision: number }>("profile/get", {}, actor);
  await api.call(
    "profile/update",
    {
      expectedRevision: profile.revision,
      setupStatus: "completed",
      eligibility: { state: "recorded", value: "adult" },
      focus: { state: "recorded", value: ["sleep_recovery", "activity_fitness", "nutrition"] },
      inputMethod: { state: "recorded", value: "both" },
      region: { state: "recorded", value: "uk" },
      consents: { age_band: "grant", sex: "grant" },
      birthYear: { state: "recorded", value: answers.birthYear },
      sex: { state: "recorded", value: answers.sex },
      enabledModules: [...PERSON_MODULES],
    },
    actor,
  );
}
