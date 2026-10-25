import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";

import { Section } from "@/components/page";
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
    <Section title={<Trans>About</Trans>}>
      <div className="grid gap-2 border-t border-rule pt-4">
        <p className="max-w-[65ch]">
          <Trans>
            OpenValens is free software under the GNU Affero General Public License, version 3 or
            later.
          </Trans>
        </p>
        {sourceCodeUrl ? (
          <a
            href={sourceCodeUrl}
            target="_blank"
            rel="noreferrer"
            className="w-fit underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:decoration-2"
          >
            <Trans>Source code for this server</Trans>
          </a>
        ) : null}
      </div>
    </Section>
  );
}
