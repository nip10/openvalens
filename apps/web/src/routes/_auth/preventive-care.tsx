import { PREVENTIVE_COPY } from "@openvalens/api/presenters/preventive-care";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { PreventiveCareView } from "@/components/preventive-care-view";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/preventive-care")({
  component: PreventiveCarePage,
});

/**
 * Issue #97 — preventive care by region. Computed on the server from the
 * versioned guideline pack, the #98 profile and the person's own answers on
 * every request; reminders are opt-in per item and go out only through the
 * #92 notification channels.
 */
function PreventiveCarePage() {
  const queryClient = useQueryClient();
  const result = useQuery(orpc.preventiveCare.get.queryOptions({ input: {} }));
  const library = useQuery({
    ...orpc.preventiveCare.library.queryOptions({ input: {} }),
    enabled: result.data?.libraryEnabled === true,
  });
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: orpc.preventiveCare.key() });
  const onError = () => toast.error("Could not save. Nothing was changed.");
  const declare = useMutation(
    orpc.preventiveCare.declare.mutationOptions({ onSuccess: invalidate, onError }),
  );
  const updateItem = useMutation(
    orpc.preventiveCare.updateItem.mutationOptions({ onSuccess: invalidate, onError }),
  );
  const settings = useMutation(
    orpc.preventiveCare.settings.update.mutationOptions({ onSuccess: invalidate, onError }),
  );

  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      {result.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : result.isError || !result.data ? (
        <p className="text-sm text-muted-foreground">
          Could not load preventive care.{" "}
          <button className="underline" onClick={() => void result.refetch()}>
            Retry
          </button>
        </p>
      ) : (
        <PreventiveCareView
          result={result.data}
          library={result.data.libraryEnabled ? (library.data ?? null) : null}
          pending={declare.isPending || updateItem.isPending || settings.isPending}
          profileLink={
            <Link to="/profile" className="underline">
              {PREVENTIVE_COPY.profileLink}
            </Link>
          }
          onDeclare={(criterion, answer) => declare.mutate({ criterion, answer })}
          onUpdateItem={(patch) => updateItem.mutate(patch)}
          onLibrary={(libraryEnabled) => settings.mutate({ libraryEnabled })}
        />
      )}
    </div>
  );
}
