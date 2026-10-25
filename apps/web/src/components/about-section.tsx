import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Code2, Info, Scale } from "lucide-react";

import { Section } from "@/components/page";
import { SettingsGroup, SettingsRow } from "@/components/settings-rows";
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
    <Section title={<Trans>About</Trans>} icon={Info} tone="signal">
      <SettingsGroup>
        <SettingsRow
          icon={Scale}
          label={
            <Trans>
              OpenValens is free software under the GNU Affero General Public License, version 3 or
              later.
            </Trans>
          }
        />
        {sourceCodeUrl ? (
          <SettingsRow
            icon={Code2}
            label={
              <a
                href={sourceCodeUrl}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:decoration-2"
              >
                <Trans>Source code for this server</Trans>
              </a>
            }
          />
        ) : null}
      </SettingsGroup>
    </Section>
  );
}
