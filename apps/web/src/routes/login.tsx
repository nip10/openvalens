import { createFileRoute } from "@tanstack/react-router";
import z from "zod";

import MagicLinkForm from "@/components/magic-link-form";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({ error: z.string().optional() }),
  component: RouteComponent,
});

function RouteComponent() {
  const { error } = Route.useSearch();
  return <MagicLinkForm linkError={error !== undefined} />;
}
