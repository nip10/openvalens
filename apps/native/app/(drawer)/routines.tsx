import { useLocalSearchParams, useRouter } from "expo-router";

import { WorkoutRoutines } from "@/components/workout-routines";

/**
 * Routines under Training (#403). `?new=1` opens the editor straight away;
 * `?addId=&addName=` comes from an exercise page's "Add to routine" (#404).
 */
export default function RoutinesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ new?: string; addId?: string; addName?: string }>();
  const addId = Number(params.addId);
  const addExercise =
    Number.isSafeInteger(addId) && addId > 0 && params.addName
      ? { id: addId, name: String(params.addName).slice(0, 200) }
      : null;
  return (
    <WorkoutRoutines
      startNew={params.new === "1"}
      onStarted={() => router.navigate("/training")}
      addExercise={addExercise}
      onAddDone={() => router.setParams({ addId: undefined, addName: undefined })}
    />
  );
}
