import { Trans } from "@lingui/react/macro";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";

/**
 * Licence notice and source link (Issue #56). AGPL-3.0 section 13 requires a
 * network service to offer its users the source; the server reports the
 * operator's `SOURCE_CODE_URL`, which points at a fork for modified versions.
 */
export function AboutSection() {
  const about = useQuery(orpc.about.info.queryOptions({ input: {} }));
  return <AboutCard sourceCodeUrl={about.data?.sourceCodeUrl ?? null} />;
}

export function AboutCard({ sourceCodeUrl }: { sourceCodeUrl: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>About</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <p>
          <Trans>
            OpenValens is free software under the GNU Affero General Public License, version 3 or
            later.
          </Trans>
        </p>
        {sourceCodeUrl ? (
          <a href={sourceCodeUrl} target="_blank" rel="noreferrer" className="w-fit underline">
            <Trans>Source code for this server</Trans>
          </a>
        ) : null}
      </CardContent>
    </Card>
  );
}
