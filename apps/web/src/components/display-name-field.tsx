import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { cleanDisplayName, DISPLAY_NAME_MAX, displayNameOf } from "@/utils/display-name";
import { orpc } from "@/utils/orpc";

/**
 * The name the app calls you by (the avatar, greetings, Sharing). Optional:
 * without one the app shows the email. Shown as a line with Edit; editing
 * opens a small input with Save and Cancel.
 */
export function DisplayNameFieldView({
  name,
  email,
  saving,
  onSave,
  showCurrent = true,
}: {
  name: string | null | undefined;
  email: string | null | undefined;
  saving: boolean;
  onSave: (name: string) => Promise<boolean>;
  /** Say the current name; off where a heading already shows it. */
  showCurrent?: boolean;
}) {
  const current = displayNameOf(name, email);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(current ?? "");
  const inputId = useId();
  const { t } = useLingui();
  const cleaned = cleanDisplayName(text);

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {current && !showCurrent ? null : (
          <span className={current ? "text-ink-2" : "text-ink-3"}>
            {current ? (
              <Trans>Name: {current}</Trans>
            ) : (
              <Trans>No name yet. The app shows your email.</Trans>
            )}
          </span>
        )}
        <Button
          variant="link"
          size="sm"
          className="h-auto px-0"
          onClick={() => {
            setText(current ?? "");
            setEditing(true);
          }}
        >
          {current ? <Trans>Edit name</Trans> : <Trans>Add your name</Trans>}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="grid gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!cleaned || cleaned === current) return;
        if (await onSave(cleaned)) setEditing(false);
      }}
    >
      <label htmlFor={inputId} className="text-sm text-ink-3">
        <Trans>What should we call you?</Trans>
      </label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={inputId}
          value={text}
          maxLength={DISPLAY_NAME_MAX}
          autoComplete="name"
          autoFocus
          className="max-w-xs"
          placeholder={t`For example: Alex`}
          onChange={(event) => setText(event.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={!cleaned || cleaned === current || saving}
        >
          {saving ? t`Saving…` : t`Save`}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
          <Trans>Cancel</Trans>
        </Button>
      </div>
    </form>
  );
}

/** {@link DisplayNameFieldView} wired to the signed-in account. */
export function DisplayNameField({ showCurrent = true }: { showCurrent?: boolean } = {}) {
  const { data: session } = authClient.useSession();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const { t } = useLingui();
  if (!session) return null;

  return (
    <DisplayNameFieldView
      name={session.user.name}
      email={session.user.email}
      showCurrent={showCurrent}
      saving={saving}
      onSave={async (name) => {
        setSaving(true);
        const { error } = await authClient.updateUser({ name });
        setSaving(false);
        if (error) {
          toast.error(t`Could not save your name. Try again.`);
          return false;
        }
        toast.success(t`Name saved`);
        void queryClient.invalidateQueries({ queryKey: orpc.sharing.key() });
        return true;
      }}
    />
  );
}
