import { useLocalSearchParams, useRouter } from "expo-router";

import { WorkoutRoutines } from "@/components/workout-routines";

/** Routines under Training (#403); `?new=1` opens the editor straight away. */
export default function RoutinesScreen() {
  const router = useRouter();
  const { new: startNew } = useLocalSearchParams<{ new?: string }>();
  return (
    <WorkoutRoutines startNew={startNew === "1"} onStarted={() => router.navigate("/training")} />
  );
}
