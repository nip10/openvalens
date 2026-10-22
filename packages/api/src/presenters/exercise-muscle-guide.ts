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
