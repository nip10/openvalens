import { useEffect } from "react";

import { authClient } from "@/lib/auth-client";
import { useAppLocale } from "@/lib/i18n/provider";
import { client } from "@/utils/orpc";
import { useCloudAccess } from "@/lib/cloud-access";

/**
 * Keeps the signed-in member's interface language on the server (#231), so
 * email and push arrive in it. Runs on sign-in and on every language change;
 * a failure is harmless (the next change or launch retries).
 */
export function LocaleSync() {
  const { locale } = useAppLocale();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;
  const access = useCloudAccess(!!userId);
  useEffect(() => {
    if (!userId || !access.data || access.data.demo) return;
    void client.preferences.setLocale({ locale }).catch(() => {});
  }, [locale, userId, access.data]);
  return null;
}
