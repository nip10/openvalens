import { Trans, useLingui } from "@lingui/react/macro";
import {
  aiAppExpiryLabel,
  aiAppScopeDetail,
  aiAppScopeTitle,
  claudeCodeKeyCommand,
} from "@openvalens/api/presenters/ai-apps";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Check, Copy, KeyRound } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

/** What the create-key form edits. */
export type AiAppKeyDraft = {
  label: string;
  /** Opt-in scopes ticked; the base scope is always added by the server. */
  scopes: string[];
  expiresInDays: 30 | 90 | 365 | null;
  agreed: boolean;
};

export type AiAppKeyFormProps = {
  baseScope: string;
  optInScopes: readonly string[];
  /** Opt-in write scopes (M2), off by default; absent offers no writing. */
  writeScopes?: readonly string[];
  expiryDays: readonly (number | null)[];
  consentVersion: string;
  workspaceName: string;
  draft: AiAppKeyDraft;
  onDraftChange: (draft: AiAppKeyDraft) => void;
  isSubmitting: boolean;
  /** Value-free message from a refused create. */
  error: string | null;
  onSubmit: () => void;
  onCancel: () => void;
};

const CHECKBOX = "mt-1 size-4 shrink-0 accent-primary disabled:opacity-55";

/**
 * Issue #439 — the create-key form. Presentational. The base read scope is
 * always on; nutrition, private body measurements and notes start unticked;
 * so do the write scopes, each for one domain (M2). The key is for the workspace the member is in now
 * (the server never takes a workspace from the form). Nothing is created
 * until the member ticks the `mcp-v1` consent.
 */
export function AiAppKeyForm(props: AiAppKeyFormProps) {
  const { t, i18n } = useLingui();
  const nameId = useId();
  const agreeId = useId();
  const { draft } = props;
  const set = (patch: Partial<AiAppKeyDraft>) => props.onDraftChange({ ...draft, ...patch });
  const canSubmit = draft.label.trim().length > 0 && draft.agreed && !props.isSubmitting;

  return (
    <form
      className="sheet grid gap-6 p-5"
      aria-label={t`Create a personal key`}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) props.onSubmit();
      }}
    >
      <div className="grid gap-2">
        <label htmlFor={nameId} className="font-medium text-ink">
          <Trans>Name</Trans>
        </label>
        <Input
          id={nameId}
          value={draft.label}
          maxLength={80}
          autoComplete="off"
          placeholder={t`For example: Claude Code on my laptop`}
          onChange={(event) => set({ label: event.target.value })}
          className="max-w-sm"
        />
      </div>

      <div className="grid gap-1">
        <span className="font-medium text-ink">
          <Trans>Workspace</Trans>
        </span>
        <span className="text-ink-2">{props.workspaceName}</span>
        <span className="text-sm text-ink-3">
          <Trans>
            The key reads only your own records in the workspace you are in now. Switch workspace
            first to make a key for another one.
          </Trans>
        </span>
      </div>

      <fieldset className="grid gap-1">
        <legend className="mb-1 font-medium text-ink">
          <Trans>What the app may read</Trans>
        </legend>
        {[props.baseScope, ...props.optInScopes].map((scope) => (
          <ScopeCheckbox
            key={scope}
            scope={scope}
            required={scope === props.baseScope}
            checked={scope === props.baseScope || draft.scopes.includes(scope)}
            onChange={(selected) =>
              set({
                scopes: selected
                  ? [...new Set([...draft.scopes, scope])]
                  : draft.scopes.filter((entry) => entry !== scope),
              })
            }
          />
        ))}
        <p className="px-3 text-sm text-ink-3">
          <Trans>Cycle data and progress photos are never shared.</Trans>
        </p>
      </fieldset>

      {props.writeScopes?.length ? (
        <fieldset className="grid gap-1">
          <legend className="mb-1 font-medium text-ink">
            <Trans>What the app may add</Trans>
          </legend>
          {props.writeScopes.map((scope) => (
            <ScopeCheckbox
              key={scope}
              scope={scope}
              required={false}
              checked={draft.scopes.includes(scope)}
              onChange={(selected) =>
                set({
                  scopes: selected
                    ? [...new Set([...draft.scopes, scope])]
                    : draft.scopes.filter((entry) => entry !== scope),
                })
              }
            />
          ))}
          <p className="px-3 text-sm text-ink-3">
            <Trans>
              Entries the app adds are labelled with its name and never change device data. The app
              can delete only what it added; you can delete it all here.
            </Trans>
          </p>
        </fieldset>
      ) : null}

      <fieldset className="grid gap-2">
        <legend className="mb-1 font-medium text-ink">
          <Trans>Expires after</Trans>
        </legend>
        <div className="flex flex-wrap gap-2">
          {props.expiryDays.map((days) => (
            <label
              key={String(days)}
              className="flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-rule-2 px-4 text-sm text-ink has-checked:border-primary has-checked:bg-paper-2 has-focus-visible:outline-2 has-focus-visible:outline-ring"
            >
              <input
                type="radio"
                name="ai-app-key-expiry"
                value={String(days)}
                checked={draft.expiresInDays === days}
                onChange={() => set({ expiresInDays: days as AiAppKeyDraft["expiresInDays"] })}
                className="accent-primary"
                data-expiry={String(days)}
              />
              {i18n._(aiAppExpiryLabel(days))}
            </label>
          ))}
        </div>
      </fieldset>

      <section className="grid gap-2 rounded-xl bg-paper-2 p-4 text-sm text-ink-2">
        <p>
          <Trans comment="safety">
            Whatever this key reads goes to the app you give it to, under that app's own terms and
            privacy policy. OpenValens cannot control what the app does with it.
          </Trans>
        </p>
        <p>
          <Trans comment="safety">
            This is separate from Coach AI consent. You can revoke the key at any time on this page;
            revoking stops it on its next request.
          </Trans>
        </p>
        <label htmlFor={agreeId} className="flex items-start gap-3 pt-1">
          <input
            id={agreeId}
            type="checkbox"
            checked={draft.agreed}
            onChange={(event) => set({ agreed: event.target.checked })}
            className={CHECKBOX}
            data-testid="ai-app-key-consent"
          />
          <span>
            <Trans comment="safety">
              I agree to share the records chosen above with the app I use this key in (consent{" "}
              {props.consentVersion}).
            </Trans>
          </span>
        </label>
      </section>

      {props.error ? (
        <p role="alert" className="text-sm text-destructive">
          {props.error}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={props.onCancel}
          disabled={props.isSubmitting}
        >
          <Trans>Cancel</Trans>
        </Button>
        <Button type="submit" disabled={!canSubmit} aria-busy={props.isSubmitting || undefined}>
          {props.isSubmitting ? t`Creating…` : t`Create key`}
        </Button>
      </div>
    </form>
  );
}

function ScopeCheckbox(props: {
  scope: string;
  required: boolean;
  checked: boolean;
  onChange: (selected: boolean) => void;
}) {
  const { i18n } = useLingui();
  const id = useId();
  const title = aiAppScopeTitle(props.scope);
  const detail = aiAppScopeDetail(props.scope);
  return (
    <div className="flex min-h-10 items-start gap-3 rounded-xl px-3 py-2 hover:bg-paper-2">
      <input
        type="checkbox"
        id={id}
        checked={props.checked}
        disabled={props.required}
        onChange={(event) => props.onChange(event.target.checked)}
        className={CHECKBOX}
        data-scope={props.scope}
      />
      <label htmlFor={id} className="grid flex-1 gap-0.5">
        <span className="font-medium text-ink">{title ? i18n._(title) : props.scope}</span>
        {detail ? <span className="text-sm text-ink-2">{i18n._(detail)}</span> : null}
      </label>
    </div>
  );
}

export type AiAppKeyCreatedProps = {
  /** The full key, shown this once. */
  apiKey: string;
  label: string;
  /** `https://<server>/api/mcp`, or `null` when the server did not report one. */
  mcpUrl: string | null;
  onDone: () => void;
  /** Injected for tests; defaults to the browser clipboard. */
  copy?: (text: string) => Promise<void>;
};

/**
 * The new key, shown once, with copy buttons and a ready-to-paste Claude Code
 * command. Focus moves to its heading so screen readers announce it.
 */
export function AiAppKeyCreated(props: AiAppKeyCreatedProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const command = props.mcpUrl ? claudeCodeKeyCommand(props.mcpUrl, props.apiKey) : null;

  return (
    <section className="sheet grid gap-4 p-5" aria-labelledby="ai-app-key-created">
      <div className="flex items-center gap-3">
        <KeyRound className="size-5 shrink-0 text-signal" aria-hidden="true" />
        <h3
          id="ai-app-key-created"
          ref={headingRef}
          tabIndex={-1}
          className="text-lg text-ink outline-none"
        >
          <Trans>Your new key: {props.label}</Trans>
        </h3>
      </div>
      <p className="text-sm text-ink-2" role="status">
        <Trans>
          Copy it now and keep it somewhere safe. You will not see it again; if you lose it, revoke
          it and make a new one.
        </Trans>
      </p>
      <CopyField value={props.apiKey} kind="key" copy={props.copy} />
      {command ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium text-ink">
            <Trans>Add it to Claude Code</Trans>
          </p>
          <CopyField value={command} kind="command" copy={props.copy} />
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button onClick={props.onDone}>
          <Trans>Done</Trans>
        </Button>
      </div>
    </section>
  );
}

async function browserCopy(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

function CopyField(props: {
  value: string;
  kind: "key" | "command";
  copy?: (text: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const label = props.kind === "key" ? t`Copy key` : t`Copy command`;
  return (
    <div className="grid gap-2">
      <code
        className="num block rounded-xl bg-paper-2 px-3 py-2 text-sm break-all text-ink select-all"
        data-copy={props.kind}
      >
        {props.value}
      </code>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await (props.copy ?? browserCopy)(props.value);
              setState("copied");
            } catch {
              setState("failed");
            }
          }}
        >
          {state === "copied" ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
          {label}
        </Button>
        <span role="status" aria-live="polite" className="text-sm text-ink-3">
          {state === "copied"
            ? t`Copied`
            : state === "failed"
              ? t`Could not copy. Select the text and copy it yourself.`
              : ""}
        </span>
      </div>
    </div>
  );
}
