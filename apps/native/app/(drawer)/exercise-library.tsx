import { View } from "react-native";

import ExerciseLibrary from "@/components/exercise-library";
import { ModuleHiddenNote } from "@/components/module-hidden-note";
import { useModuleEnabled } from "@/lib/modules/use-modules";

/** The exercise library, with the hidden-module note above it (onboarding stage 1). */
export default function ExerciseLibraryScreen() {
  const enabled = useModuleEnabled("activity");
  if (enabled) return <ExerciseLibrary />;
  return (
    <View className="flex-1">
      <View className="px-4 pt-4">
        <ModuleHiddenNote module="activity" />
      </View>
      <ExerciseLibrary />
    </View>
  );
}
