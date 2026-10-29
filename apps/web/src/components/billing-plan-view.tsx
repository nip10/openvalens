import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { CreditCard, Receipt, Sparkles } from "lucide-react";

import { Section, StatusPill, type StatusTone } from "@/components/page";
import { SettingsGroup, SettingsRow } from "@/components/settings-rows";

/**
 * Issue #297 — Settings › Plan & billing (web, OpenValens Cloud only). Shows
 * the owner's plan and trial, offers Stripe Checkout (monthly or annual) and
 * the Stripe Customer Portal. The mobile app has no equivalent screen, price
 * or link (App Store Review Guideline 3.1.3(f)).
 */

export type BillingPlan = "monthly" | "annual";
export type BillingPrice = { amount: number; currency: string } | null;

export type BillingStatus = {
  status: "none" | "trialing" | "active" | "past_due" | "canceled" | "ended";
  plan: BillingPlan | null;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canSubscribe: boolean;
  canManage: boolean;
  prices: { monthly: BillingPrice; annual: BillingPrice };
};

export type BillingPlanViewProps = {
  status: BillingStatus;
  /** `?checkout=` on return from Stripe Checkout. */
  checkout?: "success" | "cancelled" | null;
  busy: "monthly" | "annual" | "portal" | null;
  actionError: string | null;
  onSubscribe: (plan: BillingPlan) => void;
  onManage: () => void;
};

const TONE: Record<BillingStatus["status"], StatusTone> = {
  none: "neutral",
  trialing: "good",
  active: "good",
  past_due: "warn",
  canceled: "neutral",
  ended: "neutral",
};

export function BillingPlanView({
  status,
  checkout,
  busy,
  actionError,
  onSubscribe,
  onManage,
}: BillingPlanViewProps) {
  const { t, i18n } = useLingui();
  const day = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(i18n.locale, { dateStyle: "long" }).format(new Date(iso)) : "";
  const money = (price: BillingPrice) =>
    price
      ? new Intl.NumberFormat(i18n.locale, {
          style: "currency",
          currency: price.currency.toUpperCase(),
        }).format(price.amount / 100)
      : null;

  const label = {
    none: t`No plan`,
    trialing: t`Free trial`,
    active: t`Active`,
    past_due: t`Payment failed`,
    canceled: t`Cancelled`,
    ended: t`Trial ended`,
  }[status.status];

  const planName =
    status.plan === "annual" ? t`Annual plan` : status.plan === "monthly" ? t`Monthly plan` : null;
  const trialEnd = day(status.trialEndsAt);
  const periodEnd = day(status.currentPeriodEnd);
  const days = status.trialDaysLeft ?? 0;

  let description: string;
  switch (status.status) {
    case "trialing":
      description = status.canSubscribe
        ? t`${days} days left. Your free trial ends on ${trialEnd}. No card needed until you choose a plan.`
        : t`You have chosen a plan. Your first payment is on ${trialEnd}, when the free trial ends.`;
      break;
    case "active":
      description = status.cancelAtPeriodEnd
        ? t`Cancelled. Your plan stays active until ${periodEnd}.`
        : periodEnd
          ? t`Renews on ${periodEnd}.`
          : t`Your plan is active.`;
      break;
    case "past_due":
      description = t`We couldn’t take your latest payment. Update your payment method to keep your plan.`;
      break;
    case "canceled":
      description = t`Your subscription has ended. You can subscribe again at any time.`;
      break;
    case "ended":
      description = t`Your free trial has ended. Choose a plan to keep adding and syncing records.`;
      break;
    case "none":
      description = t`Choose a plan to use OpenValens Cloud with your own workspace.`;
      break;
  }

  return (
    <div className="grid gap-10">
      {checkout === "success" ? (
        <p role="status" className="rounded-2xl bg-success/12 px-4 py-3 text-sm text-success">
          <Trans>Thank you. Your plan shows here as soon as Stripe confirms the payment.</Trans>
        </p>
      ) : checkout === "cancelled" ? (
        <p role="status" className="rounded-2xl bg-muted px-4 py-3 text-sm text-ink-2">
          <Trans>Checkout was cancelled. Nothing was charged.</Trans>
        </p>
      ) : null}

      <Section title={<Trans>Your plan</Trans>} icon={Sparkles} tone="signal">
        <SettingsGroup>
          <SettingsRow
            icon={Sparkles}
            label={
              <span className="inline-flex flex-wrap items-center gap-2">
                <StatusPill tone={TONE[status.status]}>{label}</StatusPill>
                {planName ? <span className="text-ink-2">{planName}</span> : null}
              </span>
            }
            description={description}
          />
        </SettingsGroup>
      </Section>

      {status.canSubscribe ? (
        <Section
          title={<Trans>Choose a plan</Trans>}
          icon={CreditCard}
          tone="signal"
          description={
            <Trans>
              Prices include VAT. Payment is handled by Stripe; you can cancel at any time.
            </Trans>
          }
        >
          <SettingsGroup>
            {(["monthly", "annual"] as const).map((plan) => {
              const amount = money(status.prices[plan]);
              return (
                <SettingsRow
                  key={plan}
                  icon={CreditCard}
                  label={plan === "monthly" ? t`Monthly` : t`Annual`}
                  description={
                    amount
                      ? plan === "monthly"
                        ? t`${amount} per month`
                        : t`${amount} per year`
                      : undefined
                  }
                >
                  <Button onClick={() => onSubscribe(plan)} disabled={busy !== null}>
                    {busy === plan ? t`Opening Stripe…` : t`Subscribe`}
                  </Button>
                </SettingsRow>
              );
            })}
          </SettingsGroup>
        </Section>
      ) : null}

      {status.canManage ? (
        <Section title={<Trans>Billing</Trans>} icon={Receipt} tone="signal">
          <SettingsGroup>
            <SettingsRow
              icon={Receipt}
              label={<Trans>Manage billing</Trans>}
              description={<Trans>Change your card, download invoices or cancel.</Trans>}
            >
              <Button variant="outline" onClick={onManage} disabled={busy !== null}>
                {busy === "portal" ? t`Opening Stripe…` : t`Manage`}
              </Button>
            </SettingsRow>
          </SettingsGroup>
        </Section>
      ) : null}

      {actionError ? (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      <p className="max-w-[60ch] text-sm text-ink-3">
        <Trans>
          Only the owner of a workspace pays. People you share your workspace with don’t need a
          plan. Your records stay yours in every state, and you can always export or delete them.
        </Trans>
      </p>
    </div>
  );
}
