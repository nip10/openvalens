import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import z from "zod";

import MagicLinkForm from "@/components/magic-link-form";
import { admissionStatusQueryOptions } from "@/utils/admission";
import { validateReturnUrl } from "@/utils/return-url";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({
    error: z.string().optional(),
    returnUrl: z.string().optional(),
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { error, returnUrl } = Route.useSearch();
  const status = useQuery(admissionStatusQueryOptions());
  const safeReturnUrl = validateReturnUrl(returnUrl) ?? null;

  return (
    <MagicLinkForm
      linkError={error !== undefined}
      setupAvailable={status.data?.setupAvailable}
      returnUrl={safeReturnUrl}
    />
  );
}
