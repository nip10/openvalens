import { Trans, useLingui } from "@lingui/react/macro";
import { PREVENTIVE_COPY } from "@openvalens/api/presenters/preventive-care";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { ErrorState, Page, PageHeader } from "@/components/page";
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
  const { t, i18n } = useLingui();
  const result = useQuery(orpc.preventiveCare.get.queryOptions({ input: {} }));
  const library = useQuery({
    ...orpc.preventiveCare.library.queryOptions({ input: {} }),
    enabled: result.data?.libraryEnabled === true,
  });
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: orpc.preventiveCare.key() });
  const onError = () => toast.error(t`Could not save. Nothing was changed.`);
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
    <Page>
      {result.isPending ? (
        <>
          <PageHeader title={i18n._(PREVENTIVE_COPY.pageTitle)} />
          <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </>
      ) : result.isError || !result.data ? (
        <>
          <PageHeader title={i18n._(PREVENTIVE_COPY.pageTitle)} />
          <ErrorState
            title={<Trans>Could not load preventive care.</Trans>}
            action={
              <Button variant="outline" onClick={() => void result.refetch()}>
                <Trans>Retry</Trans>
              </Button>
            }
          />
        </>
      ) : (
        <PreventiveCareView
          result={result.data}
          library={result.data.libraryEnabled ? (library.data ?? null) : null}
          pending={declare.isPending || updateItem.isPending || settings.isPending}
          profileLink={
            <Link
              to="/profile"
              className="font-display text-sm font-medium text-ink underline decoration-signal underline-offset-[0.15em] transition-colors duration-[var(--dur-short)] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {i18n._(PREVENTIVE_COPY.profileLink)}
            </Link>
          }
          onDeclare={(criterion, answer) => declare.mutate({ criterion, answer })}
          onUpdateItem={(patch) => updateItem.mutate(patch)}
          onLibrary={(libraryEnabled) => settings.mutate({ libraryEnabled })}
        />
      )}
    </Page>
  );
}
