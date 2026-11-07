import type { ReactNode } from "react";
import { useRef } from "react";

import { getAuthClient } from "@/lib/auth-client";

/** Mounts server-bound app lifecycles only after the compatibility gate admits this URL. */
export function ServerRuntime({ children }: { children: ReactNode }) {
  // A magic link that cold-starts the app installs its session in this store.
  const initialized = useRef(false);
  if (!initialized.current) {
    getAuthClient();
    initialized.current = true;
  }
  return <>{children}</>;
}
