import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { CalendarClock, Coins, Gauge, Hash, Sparkles, Users, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ErrorState, Section, StatusPill } from "@/components/page";
import type { AdminAiUsageOutput } from "@/utils/admin-settings-keys";

/**
 * Issue #299 — AI usage this month on /admin/settings: totals and the
 * accounts with the highest estimated cost, by opaque id only. Read-only; the
 * cap and prices are server settings (`AI_MONTHLY_COST_LIMIT`, docs/ai-providers.md).
 */
export type AdminAiUsageProps =
  | { status: "loading" }
  | { status: "error"; onRetry?: () => void }
  | { status: "ready"; usage: AdminAiUsageOutput };

export function AdminAiUsage(props: AdminAiUsageProps) {
  return (
    <Section
      icon={Sparkles}
      tone="signal"
      title={<Trans>AI usage</Trans>}
      actions={props.status === "ready" ? <CapWord usage={props.usage} /> : null}
    >
      {props.status === "loading" ? (
        <div className="sheet grid gap-3 p-5">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : props.status === "error" ? (
        <ErrorState
          title={<Trans>Could not load AI usage.</Trans>}
          action={
            props.onRetry ? (
              <Button variant="outline" onClick={props.onRetry}>
                <Trans>Retry</Trans>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <UsageDetails usage={props.usage} />
      )}
    </Section>
  );
}

/** A UTC calendar day (`YYYY-MM-DD`) written out in `locale`. */
function utcDay(day: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(
      new Date(`${day}T00:00:00.000Z`),
    );
  } catch {
    return day;
  }
}

function money(micros: number, currency: string, locale: string): string {
  const value = micros / 1_000_000;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: value > 0 && value < 1 ? 4 : 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function count(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

function UsageDetails({ usage }: { usage: AdminAiUsageOutput }) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale;
  const month = utcDay(usage.month, locale, { year: "numeric", month: "long" });
  const resets = utcDay(usage.resetsOn, locale, { year: "numeric", month: "long", day: "numeric" });
  const totals = usage.totals;
  const cost = (micros: number) =>
    usage.pricesConfigured ? money(micros, usage.currency, locale) : t`not priced`;

  return (
    <>
      <dl className="sheet m-0 grid divide-y divide-rule px-5 text-sm">
        <Item icon={CalendarClock} label={t`Month (UTC)`}>
          <Trans>
            {month}, resets on {resets}
          </Trans>
        </Item>
        <Item icon={Coins} label={t`Estimated cost`}>
          {usage.pricesConfigured ? (
            money(totals.costMicros, usage.currency, locale)
          ) : (
            <Trans>No AI prices configured, so cost is not estimated</Trans>
          )}
        </Item>
        <Item icon={Hash} label={t`Tokens`}>
          <Trans>
            {count(totals.inputTokens, locale)} in ({count(totals.cachedInputTokens, locale)}{" "}
            cached), {count(totals.outputTokens, locale)} out
          </Trans>
        </Item>
        <Item icon={Gauge} label={t`Provider calls`}>
          {count(totals.callCount, locale)}
        </Item>
        <Item icon={Users} label={t`People using AI`}>
          {count(totals.accounts, locale)}
        </Item>
      </dl>

      {usage.top.length > 0 ? (
        <div className="sheet overflow-x-auto p-0">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <caption className="px-5 pt-4 pb-2 text-left font-medium text-ink">
              <Trans>Highest usage this month</Trans>
            </caption>
            <thead className="text-ink-3">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">
                  <Trans>Account</Trans>
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  <Trans>Estimated cost</Trans>
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  <Trans>Tokens in / out</Trans>
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  <Trans>Calls</Trans>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {usage.top.map((account) => (
                <tr key={account.userId}>
                  <td className="px-5 py-2">
                    <code className="font-mono text-xs text-ink-2">{account.userId}</code>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{cost(account.costMicros)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {count(account.inputTokens, locale)} / {count(account.outputTokens, locale)}
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums">
                    {count(account.callCount, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="sheet p-5 text-sm text-ink-2">
          <Trans>No AI calls yet this month.</Trans>
        </p>
      )}

      <p className="max-w-[65ch] text-sm text-ink-3">
        <Trans>
          Accounts are shown by their opaque id only. Usage counts tokens and estimated cost, never
          what anyone wrote. See docs/ai-providers.md, section Monthly usage cap.
        </Trans>
      </p>
    </>
  );
}

function Item({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-x-6 gap-y-0.5 py-3 sm:grid-cols-[13rem_minmax(0,1fr)]">
      <dt className="flex items-center gap-2 text-ink-3">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {label}
      </dt>
      <dd className="m-0 text-ink">{children}</dd>
    </div>
  );
}

/** The cap as a word on a tint; the word carries the meaning. */
function CapWord({ usage }: { usage: AdminAiUsageOutput }) {
  const { i18n } = useLingui();
  if (usage.monthlyLimitMicros === null) {
    return (
      <StatusPill tone="neutral">
        <Trans>No monthly cap</Trans>
      </StatusPill>
    );
  }
  const limit = money(usage.monthlyLimitMicros, usage.currency, i18n.locale);
  return (
    <StatusPill tone="good">
      <Trans>Cap {limit} per person per month</Trans>
    </StatusPill>
  );
}
