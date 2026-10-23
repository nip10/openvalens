import {
  ENERGY_ESTIMATE_COPY,
  presentEnergyEstimate,
  presentProposal,
} from "@openvalens/api/presenters/energy-estimate";
import { Trans, useLingui } from "@lingui/react/macro";
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
  const { t, i18n } = useLingui();
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
  const presented =
    allowed && !hideNumbers ? presentEnergyEstimate(estimate.data, false, i18n) : null;
  const pendingPresentation = pending && allowed && presentProposal(pending, hideNumbers, i18n);
  const range = presented?.range ?? "";
  const suggestion = pendingPresentation ? (pendingPresentation.suggestion ?? t`Unavailable`) : "";
  const currentTarget = pendingPresentation
    ? (pendingPresentation.current ?? i18n._(ENERGY_ESTIMATE_COPY.noTarget))
    : "";
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
        ? (result.note ?? t`This suggestion is no longer available.`)
        : success,
    );
    refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{i18n._(ENERGY_ESTIMATE_COPY.title)}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p className="font-medium">{i18n._(ENERGY_ESTIMATE_COPY.subtitle)}</p>
        <p className="text-muted-foreground">{i18n._(ENERGY_ESTIMATE_COPY.provisional)}</p>
        {hideNumbers ? (
          <p>{i18n._(ENERGY_ESTIMATE_COPY.hidden)}</p>
        ) : !authorized ? (
          <p>{i18n._(ENERGY_ESTIMATE_COPY.unavailable)}</p>
        ) : estimate.isError ? (
          <p role="alert">
            {i18n._(ENERGY_ESTIMATE_COPY.error)}{" "}
            <button className="underline" onClick={() => void estimate.refetch()}>
              <Trans>Retry</Trans>
            </button>
          </p>
        ) : estimate.isPending ? (
          <p>
            <Trans>Loading estimate…</Trans>
          </p>
        ) : presented ? (
          <div className="rounded-md border p-3">
            <p className="text-xl font-semibold">{presented.value}</p>
            <p>{t`${range} (arithmetic range, not a confidence interval)`}</p>
            <p className="text-xs text-muted-foreground">{presented.window}</p>
            {presented.notes.map((n, i) => (
              <p className="mt-1 text-xs text-muted-foreground" key={i}>
                {n}
              </p>
            ))}
          </div>
        ) : (
          <p>{i18n._(ENERGY_ESTIMATE_COPY.unavailable)}</p>
        )}
        {authorized && pending ? (
          <div className="grid gap-2 rounded-md border p-3">
            <p className="font-medium">{i18n._(ENERGY_ESTIMATE_COPY.pending)}</p>
            {pendingPresentation && (
              <>
                <p>{t`Suggested: ${suggestion}`}</p>
                <p>{t`Current target: ${currentTarget}`}</p>
              </>
            )}
            {expired && (
              <p>
                <Trans>This suggestion has expired.</Trans>
              </p>
            )}
            {pending.needsConfirmation && (
              <label className="flex gap-2">
                <input
                  id={id}
                  type="checkbox"
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                />
                <Trans comment="safety">I have read this and want to accept the suggestion.</Trans>
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
                        declined(result, t`Suggestion accepted. Your target is updated.`),
                      onError: () => {
                        setMessage(t`Could not confirm the result. Refresh to check its status.`);
                        refresh();
                      },
                    },
                  )
                }
              >
                {i18n._(ENERGY_ESTIMATE_COPY.accept)}
              </Button>
              <Button
                variant="outline"
                disabled={!allowed || dismiss.isPending}
                onClick={() =>
                  dismiss.mutate(
                    { proposalId: pending.id },
                    {
                      onSuccess: (result) =>
                        declined(result, t`Suggestion dismissed. Your target is unchanged.`),
                      onError: () => {
                        setMessage(t`Could not confirm the result. Refresh to check its status.`);
                        refresh();
                      },
                    },
                  )
                }
              >
                {i18n._(ENERGY_ESTIMATE_COPY.dismiss)}
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
                      t`Could not confirm whether a suggestion was created. Refresh to check.`,
                    );
                    refresh();
                  },
                },
              )
            }
          >
            {i18n._(ENERGY_ESTIMATE_COPY.ask)}
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
