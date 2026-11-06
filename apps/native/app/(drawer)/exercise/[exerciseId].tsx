import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";

import { Container } from "@/components/container";
import { ExerciseDetailView } from "@/components/exercise-detail";

/** Issue #404 — an exercise's own page (from workout thumbnails, routines and the library). */
export default function ExerciseScreen() {
  const router = useRouter();
  const { exerciseId } = useLocalSearchParams<{ exerciseId: string }>();
  const id = Number(exerciseId);
  return (
    <Container>
      <View className="p-4">
        {Number.isSafeInteger(id) && id > 0 ? (
          <ExerciseDetailView
            exerciseId={id}
            onBack={router.canGoBack() ? () => router.back() : undefined}
          />
        ) : null}
      </View>
    </Container>
  );
}
