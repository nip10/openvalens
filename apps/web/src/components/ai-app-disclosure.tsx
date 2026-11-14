import { Trans, useLingui } from "@lingui/react/macro";
import { AI_APP_DISCLOSURE, aiAppPlatformDataNotice } from "@openvalens/api/presenters/ai-apps";
import { useId } from "react";

export type AiAppDisclosureProps = {
  /**
   * The app's own name (OAuth) or the key's name, as the member sees it;
   * `null` for a key not named yet.
   */
  appName: string | null;
  /** Every scope the connection would hold, base scope included. */
  scopes: readonly string[];
  /** What the member revokes in: "connection" (OAuth) or "key". */
  kind: "connection" | "key";
  /** The AI-app consent version the member agrees to (e.g. `mcp-v2`). */
  consentVersion: string;
  agreed: boolean;
  onAgreedChange: (agreed: boolean) => void;
  /** Test id for the consent checkbox. */
  checkboxTestId: string;
};

/**
 * Issue #518 — what every AI-app consent shows before the member can approve
 * (Apple Review Guidelines 5.1.2(i), DPLA 3.3.3(H), Google Play User Data
 * policy): the app is a third party that can be an AI service, under its own
 * terms; which Apple Health / Health Connect data the chosen scopes reach; that
 * it is only for the member's own health and fitness, never ads or sale; that
 * disconnecting does not delete what the app already has; and an unticked
 * checkbox naming the app. Presentational.
 */
export function AiAppDisclosure(props: AiAppDisclosureProps) {
  const { i18n } = useLingui();
  const agreeId = useId();
  const platformData = aiAppPlatformDataNotice(props.scopes);
  const consentVersion = props.consentVersion;
  return (
    <section
      className="grid gap-2 rounded-xl bg-paper-2 p-4 text-sm text-ink-2"
      data-testid="ai-app-disclosure"
    >
      <p>
        {props.appName
          ? i18n._({ ...AI_APP_DISCLOSURE.thirdParty, values: { app: props.appName } })
          : i18n._(AI_APP_DISCLOSURE.thirdPartyUnnamed)}
      </p>
      {platformData ? <p data-testid="ai-app-platform-data">{i18n._(platformData)}</p> : null}
      <p>{i18n._(AI_APP_DISCLOSURE.purpose)}</p>
      <p>{i18n._(AI_APP_DISCLOSURE.disconnect)}</p>
      <p>
        {props.kind === "connection" ? (
          <Trans comment="safety">
            This is separate from Coach AI consent. You can disconnect at any time in Settings →
            Connected AI apps, on the web or in the mobile app.
          </Trans>
        ) : (
          <Trans comment="safety">
            This is separate from Coach AI consent. You can revoke the key at any time on this page
            or in the mobile app.
          </Trans>
        )}
      </p>
      <label htmlFor={agreeId} className="flex items-start gap-3 pt-1 font-medium text-ink">
        <input
          id={agreeId}
          type="checkbox"
          checked={props.agreed}
          onChange={(event) => props.onAgreedChange(event.target.checked)}
          className="mt-1 size-4 shrink-0 accent-primary"
          data-testid={props.checkboxTestId}
        />
        <span>
          {props.appName
            ? i18n._({ ...AI_APP_DISCLOSURE.agree, values: { app: props.appName } })
            : i18n._(AI_APP_DISCLOSURE.agreeUnnamed)}
        </span>
      </label>
      <p className="text-xs text-ink-3">
        <Trans comment="safety">Consent {consentVersion}</Trans>
      </p>
    </section>
  );
}
