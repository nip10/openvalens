import {
  ENERGY_ESTIMATE_COPY,
  presentEnergyEstimate,
  presentProposal,
} from "@openvalens/api/presenters/energy-estimate";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { deviceTimeZone, localDateIn } from "@openvalens/api/presenters/nutrition-diary";
import { orpc } from "@/utils/orpc";

export function EnergyEstimateCard({
  hideNumbers,
  scope,
  targetsQueryKey,
}: {
  hideNumbers: boolean;
  scope: string | null;
  targetsQueryKey: readonly unknown[];
}) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const id = useId();
  const authorized = scope !== null;
  const date = localDateIn(deviceTimeZone());
  const estimateOpts = orpc.nutritionEnergy.estimate.queryOptions({ input: { to: date } });
  const estimateKey = [...estimateOpts.queryKey, { offlineScope: scope }];
  const estimate = useQuery({
    ...estimateOpts,
    queryKey: estimateKey,
    enabled: authorized && !hideNumbers,
    retry: false,
  });
  const listOpts = orpc.nutritionEnergy.listProposals.queryOptions({ input: {} });
  const proposalsKey = [...listOpts.queryKey, { offlineScope: scope }];
  const proposals = useQuery({
    ...listOpts,
    queryKey: proposalsKey,
    enabled: authorized,
    retry: false,
  });
  const ask = useMutation(orpc.nutritionEnergy.propose.mutationOptions());
  const accept = useMutation(orpc.nutritionEnergy.acceptProposal.mutationOptions());
  const dismiss = useMutation(orpc.nutritionEnergy.dismissProposal.mutationOptions());
  const refresh = () => {
    if (!scope) return;
    void qc.invalidateQueries({ queryKey: estimateKey });
    void qc.invalidateQueries({ queryKey: proposalsKey });
    void qc.invalidateQueries({ queryKey: targetsQueryKey });
  };
  const allowed =
    authorized &&
    estimate.isSuccess &&
    !["hidden", "off", "adults_only"].includes(estimate.data.status);
  const pending = authorized
    ? proposals.data?.proposals.find((p) => p.status === "pending")
    : undefined;
  const presented = allowed && !hideNumbers ? presentEnergyEstimate(estimate.data, false) : null;
  const pendingPresentation = pending && allowed && presentProposal(pending, hideNumbers);
  const expired = pending
    ? pending.expired ||
      !Number.isFinite(Date.parse(pending.expiresAt)) ||
      Date.parse(pending.expiresAt) <= Date.now()
    : false;
  useEffect(() => {
    setConfirm(false);
    setMessage("");
  }, [pending?.id, hideNumbers, scope]);
  const declined = (result: { outcome: string; note?: string }, success: string) => {
    setMessage(
      result.outcome === "declined"
        ? (result.note ?? "This suggestion is no longer available.")
        : success,
    );
    refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{ENERGY_ESTIMATE_COPY.title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p className="font-medium">{ENERGY_ESTIMATE_COPY.subtitle}</p>
        <p className="text-muted-foreground">{ENERGY_ESTIMATE_COPY.provisional}</p>
        {hideNumbers ? (
          <p>{ENERGY_ESTIMATE_COPY.hidden}</p>
        ) : !authorized ? (
          <p>{ENERGY_ESTIMATE_COPY.unavailable}</p>
        ) : estimate.isError ? (
          <p role="alert">
            {ENERGY_ESTIMATE_COPY.error}{" "}
            <button className="underline" onClick={() => void estimate.refetch()}>
              Retry
            </button>
          </p>
        ) : estimate.isPending ? (
          <p>Loading estimate…</p>
        ) : presented ? (
          <div className="rounded-md border p-3">
            <p className="text-xl font-semibold">{presented.value}</p>
            <p>{presented.range} (arithmetic range, not a confidence interval)</p>
            <p className="text-xs text-muted-foreground">{presented.window}</p>
            {presented.notes.map((n, i) => (
              <p className="mt-1 text-xs text-muted-foreground" key={i}>
                {n}
              </p>
            ))}
          </div>
        ) : (
          <p>{ENERGY_ESTIMATE_COPY.unavailable}</p>
        )}
        {authorized && pending ? (
          <div className="grid gap-2 rounded-md border p-3">
            <p className="font-medium">{ENERGY_ESTIMATE_COPY.pending}</p>
            {pendingPresentation && (
              <>
                <p>Suggested: {pendingPresentation.suggestion ?? "Unavailable"}</p>
                <p>
                  Current target: {pendingPresentation.current ?? ENERGY_ESTIMATE_COPY.noTarget}
                </p>
              </>
            )}
            {expired && <p>This suggestion has expired.</p>}
            {pending.needsConfirmation && (
              <label className="flex gap-2">
                <input
                  id={id}
                  type="checkbox"
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                />
                I have read this and want to accept the suggestion.
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  !allowed ||
                  !presented ||
                  expired ||
                  accept.isPending ||
                  (pending.needsConfirmation && !confirm)
                }
                onClick={() =>
                  accept.mutate(
                    {
                      proposalId: pending.id,
                      effectiveFrom: localDateIn(deviceTimeZone()),
                      ...(pending.needsConfirmation && confirm ? { confirmed: true } : {}),
                    },
                    {
                      onSuccess: (result) =>
                        declined(result, "Suggestion accepted. Your target is updated."),
                      onError: () => {
                        setMessage("Could not confirm the result. Refresh to check its status.");
                        refresh();
                      },
                    },
                  )
                }
              >
                {ENERGY_ESTIMATE_COPY.accept}
              </Button>
              <Button
                variant="outline"
                disabled={!allowed || dismiss.isPending}
                onClick={() =>
                  dismiss.mutate(
                    { proposalId: pending.id },
                    {
                      onSuccess: (result) =>
                        declined(result, "Suggestion dismissed. Your target is unchanged."),
                      onError: () => {
                        setMessage("Could not confirm the result. Refresh to check its status.");
                        refresh();
                      },
                    },
                  )
                }
              >
                {ENERGY_ESTIMATE_COPY.dismiss}
              </Button>
            </div>
          </div>
        ) : null}
        {authorized && proposals.isSuccess && !pending && !hideNumbers && (
          <Button
            variant="outline"
            disabled={!presented || ask.isPending}
            onClick={() =>
              ask.mutate(
                { to: localDateIn(deviceTimeZone()) },
                {
                  onSuccess: (result) => {
                    if (result.outcome === "declined") setMessage(result.note);
                    refresh();
                  },
                  onError: () => {
                    setMessage(
                      "Could not confirm whether a suggestion was created. Refresh to check.",
                    );
                    refresh();
                  },
                },
              )
            }
          >
            {ENERGY_ESTIMATE_COPY.ask}
          </Button>
        )}
        {message && (
          <p role="status" aria-live="polite">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
