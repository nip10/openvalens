import { createFileRoute } from "@tanstack/react-router";

import { ExerciseLibraryPage } from "@/components/exercise-library";

export const Route = createFileRoute("/_auth/exercise-library")({ component: ExerciseLibraryPage });
