export type ExerciseGuideMuscle = {
  name: string;
  role?: string | null;
  location?: string | null;
  externalMuscleId?: string | null;
};
export type GuideRegion =
  | "Shoulders"
  | "Upper arms"
  | "Hamstrings"
  | "Calves"
  | "Glutes"
  | "Lats"
  | "Obliques"
  | "Chest"
  | "Quads"
  | "Abs"
  | "Serratus"
  | "Trapezius";
const aliases: Record<string, { region: GuideRegion; side: "front" | "back" }> = {};
function add(region: GuideRegion, side: "front" | "back", ...names: string[]) {
  for (const name of names) aliases[name] = { region, side };
}
add("Shoulders", "front", "anterior deltoid", "deltoid", "shoulders");
add("Upper arms", "front", "biceps brachii", "biceps", "brachialis");
add("Hamstrings", "back", "biceps femoris", "hamstrings");
add("Calves", "back", "gastrocnemius", "soleus", "calves");
add("Glutes", "back", "gluteus maximus", "glutes");
add("Lats", "back", "latissimus dorsi", "lats");
add("Obliques", "front", "obliquus externus abdominis", "obliques");
add("Chest", "front", "pectoralis major", "chest");
add("Quads", "front", "quadriceps femoris", "quadriceps", "quads");
add("Abs", "front", "rectus abdominis", "abs");
add("Serratus", "front", "serratus anterior", "serratus");
add("Trapezius", "back", "trapezius");
add("Upper arms", "back", "triceps brachii", "triceps");
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
export function resolveExerciseGuideMuscle(muscle: ExerciseGuideMuscle) {
  const mapped = aliases[norm(muscle.name)];
  const role = norm(muscle.role ?? "");
  const location = norm(muscle.location ?? "");
  if (!mapped || (role !== "primary" && role !== "secondary") || location !== mapped.side)
    return null;
  return mapped;
}

/**
 * wger lists a few muscles only by their anatomical name ("Obliquus externus
 * abdominis"). These are the plain names wger itself uses for the rest
 * ("Obliques"), so a list reads the same throughout. Unknown names pass through.
 */
const PLAIN_MUSCLE_NAMES: Record<string, string> = {
  "anterior deltoid": "Shoulders",
  "biceps brachii": "Biceps",
  "biceps femoris": "Hamstrings",
  gastrocnemius: "Calves",
  "gluteus maximus": "Glutes",
  "latissimus dorsi": "Lats",
  "obliquus externus abdominis": "Obliques",
  "pectoralis major": "Chest",
  "quadriceps femoris": "Quads",
  "rectus abdominis": "Abs",
  "serratus anterior": "Serratus",
  "triceps brachii": "Triceps",
};
export function plainMuscleName(name: string): string {
  return PLAIN_MUSCLE_NAMES[norm(name)] ?? name;
}
