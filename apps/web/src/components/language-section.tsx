import { Trans } from "@lingui/react/macro";
import { LOCALE_NAMES, LOCALES, isLocale, reviewStatusOf } from "@openvalens/i18n";
import { Badge } from "@openvalens/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { useId } from "react";

import { useAppLocale } from "@/lib/i18n";

/**
 * Interface language (#67). Applies immediately, without a reload. A
 * community translation is marked as such; its safety-critical strings
 * (units, reference ranges, medication and consent text) stay in English
 * until a reviewer approves them.
 */
export function LanguageSection() {
  const { locale, setLocale } = useAppLocale();
  const id = useId();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Language</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <label htmlFor={id} className="grid gap-1">
          <Trans>Interface language</Trans>
          <select
            id={id}
            className="min-h-9 w-fit rounded-md border bg-background px-2"
            value={locale}
            onChange={(event) => {
              if (isLocale(event.target.value)) setLocale(event.target.value);
            }}
          >
            {LOCALES.map((option) => (
              <option key={option} value={option} lang={option}>
                {LOCALE_NAMES[option]}
              </option>
            ))}
          </select>
        </label>
        {reviewStatusOf(locale) === "community" ? (
          <p className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              <Trans>Community translation</Trans>
            </Badge>
            <span className="text-muted-foreground">
              <Trans>
                Not yet reviewed. Units, reference ranges, medication and consent text stay in
                English until a reviewer approves them.
              </Trans>
            </span>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
