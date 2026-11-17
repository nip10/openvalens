import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { accessStateQueryOptions } from "@/components/access-banner";

import { authClient } from "@/lib/auth-client";
import { useAppLocale } from "@/lib/i18n";
import { client } from "@/utils/orpc";

/**
 * Keeps the signed-in member's interface language on the server (#231), so
 * email and push arrive in it. Runs on sign-in and on every language change;
 * a failure is harmless (the next change or launch retries).
 */
export function LocaleSync() {
  const { locale } = useAppLocale();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;
  const access = useQuery({ ...accessStateQueryOptions(), enabled: !!userId });
  useEffect(() => {
    if (!userId || !access.data || access.data.demo) return;
    void client.preferences.setLocale({ locale }).catch(() => {});
  }, [locale, userId, access.data]);
  return null;
}
