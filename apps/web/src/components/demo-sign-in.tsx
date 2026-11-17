import { Trans, useLingui } from "@lingui/react/macro";
import { signInToDemo, type DemoSignInFetch } from "@openvalens/api/demo-sign-in";
import { Button } from "@openvalens/ui/components/button";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export function DemoSignIn({ start = false }: { start?: boolean }) {
  const { t } = useLingui();
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const inFlight = useRef(false);
  async function open() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const outcome = await signInToDemo(authClient.$fetch as unknown as DemoSignInFetch);
    if (outcome === "signed-in") window.location.assign("/dashboard");
    else {
      toast.error(
        outcome === "rate-limited"
          ? t`Too many attempts. Wait a moment, then try again.`
          : t`The demo is unavailable right now. Please try again later.`,
      );
      setBusy(false);
      inFlight.current = false;
    }
  }
  useEffect(() => {
    if (!start || started.current) return;
    started.current = true;
    void open();
  }, [start]);
  return (
    <div className="grid gap-2 text-center">
      <Button variant="outline" onClick={() => void open()} disabled={busy}>
        {busy ? <Trans>Opening demo…</Trans> : <Trans>Try the demo</Trans>}
      </Button>
      <p className="text-sm text-ink-3">
        <Trans>Explore synthetic data. Read-only, no sign-up needed.</Trans>
      </p>
    </div>
  );
}
