import { expect, test } from "bun:test";
import { resolveExerciseGuideMuscle } from "./exercise-muscle-guide";

const taxonomy = [
  ["Biceps", "Upper arms", "front"],
  ["Biceps femoris", "Hamstrings", "back"],
  ["Brachialis", "Upper arms", "front"],
  ["Deltoid", "Shoulders", "front"],
  ["Gastrocnemius", "Calves", "back"],
  ["Gluteus maximus", "Glutes", "back"],
  ["Latissimus dorsi", "Lats", "back"],
  ["Obliquus externus abdominis", "Obliques", "front"],
  ["Pectoralis major", "Chest", "front"],
  ["Quadriceps femoris", "Quads", "front"],
  ["Rectus abdominis", "Abs", "front"],
  ["Serratus anterior", "Serratus", "front"],
  ["Soleus", "Calves", "back"],
  ["Trapezius", "Trapezius", "back"],
  ["Triceps brachii", "Upper arms", "back"],
] as const;

test("resolves explicit English taxonomy names and aliases using validated role and side", () => {
  for (const [name, region, side] of taxonomy) {
    expect(resolveExerciseGuideMuscle({ name, role: "primary", location: side })).toEqual({
      region,
      side,
    });
  }
  for (const [name, region, side] of [
    ["biceps brachii", "Upper arms", "front"],
    ["anterior deltoid", "Shoulders", "front"],
    ["shoulders", "Shoulders", "front"],
    ["hamstrings", "Hamstrings", "back"],
    ["calves", "Calves", "back"],
    ["glutes", "Glutes", "back"],
    ["lats", "Lats", "back"],
    ["obliques", "Obliques", "front"],
    ["chest", "Chest", "front"],
    ["quadriceps", "Quads", "front"],
    ["quads", "Quads", "front"],
    ["abs", "Abs", "front"],
    ["serratus", "Serratus", "front"],
    ["triceps", "Upper arms", "back"],
  ] as const) {
    expect(resolveExerciseGuideMuscle({ name, role: "secondary", location: side })).toEqual({
      region,
      side,
    });
  }
});

test("rejects unresolved, incomplete, conflicting, and guessed mappings regardless of external ID", () => {
  for (const muscle of [
    { name: "", role: "primary", location: "front" },
    { name: "Mystery muscle", role: "primary", location: "front" },
    { name: "Biceps", role: "primary", location: null },
    { name: "Biceps", role: "primary", location: "back" },
    { name: "Biceps", role: "unknown", location: "front" },
    { name: "Biceps", role: null, location: "front" },
  ])
    expect(resolveExerciseGuideMuscle(muscle)).toBeNull();
  expect(
    resolveExerciseGuideMuscle({
      name: "Biceps",
      role: "primary",
      location: "front",
      externalMuscleId: "11",
    }),
  ).toEqual({ region: "Upper arms", side: "front" });
});
