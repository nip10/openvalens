import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The micronutrient summary now lives in the Meal diary's "All nutrients"
 * (micronutrients#4). Old links and bookmarks land there, opened.
 */
export const Route = createFileRoute("/_auth/micronutrients")({
  beforeLoad: () => {
    throw redirect({ to: "/nutrition", search: { nutrients: "all" }, replace: true });
  },
});
