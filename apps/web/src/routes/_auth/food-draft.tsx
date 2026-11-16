import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Describe a meal (#73) is the Describe tab of Log food on the meal diary
 * now (food-draft#0). This address stays for old links and bookmarks: it
 * opens the diary with the sheet on Describe, keeping any words it carried.
 */
export const Route = createFileRoute("/_auth/food-draft")({
  validateSearch: (search: Record<string, unknown>): { text?: string } =>
    typeof search.text === "string" && search.text.trim()
      ? { text: search.text.trim().slice(0, 2_000) }
      : {},
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/nutrition",
      search: search.text ? { describe: search.text } : { log: "describe" },
      replace: true,
    });
  },
});
