import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "heroui-native";
import { Sparkles } from "lucide-react-native";
import { useState } from "react";
import { Linking, Text, View } from "react-native";

import { Section, Sheet } from "@/components/bloom";
import { orpc } from "@/utils/orpc";

/**
 * Issue #446 — "What's new in X.Y" on the Cockpit: the Highlights of the
 * version the connected server runs, once per version per member. "Dismiss"
 * records the version; Settings turns the card off. A server older than the
 * card has no `whatsNew` procedure, and the card simply stays hidden.
 * Self-contained, so it can sit beside the other cards on the Cockpit.
 */
export function WhatsNewCard() {
  const { t, i18n } = useLingui();
  const locale = i18n.locale === "pt-PT" ? "pt-PT" : "en";
  const queryClient = useQueryClient();
  const query = useQuery({
    ...orpc.whatsNew.get.queryOptions({ input: { locale } }),
    retry: false,
  });
  const [failed, setFailed] = useState(false);
  const dismiss = useMutation(
    orpc.whatsNew.dismiss.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.whatsNew.key() }),
      onError: () => setFailed(true),
    }),
  );
  const card = query.data?.card;
  if (!card || dismiss.isSuccess) return null;
  const { shortVersion } = card;

  return (
    <Section icon={Sparkles} tone="signal" title={t`What's new in ${shortVersion}`}>
      <Sheet className="gap-4">
        <View className="gap-2">
          {card.highlights.map((block, index) =>
            block.kind === "paragraph" ? (
              <Text key={index} className="font-sans text-base leading-relaxed text-ink-2">
                {block.text}
              </Text>
            ) : (
              <View key={index} className="gap-2">
                {block.items.map((item, itemIndex) => (
                  <View key={itemIndex} className="flex-row gap-2">
                    <Text
                      className="font-sans text-base leading-relaxed text-ink-3"
                      importantForAccessibility="no"
                      accessibilityElementsHidden
                    >
                      •
                    </Text>
                    <Text className="flex-1 font-sans text-base leading-relaxed text-ink-2">
                      {item}
                    </Text>
                  </View>
                ))}
              </View>
            ),
          )}
        </View>
        <View className="flex-row flex-wrap gap-3">
          <Button
            variant="secondary"
            onPress={() => void Linking.openURL(card.changelogUrl)}
            accessibilityRole="link"
          >
            <Button.Label>
              <Trans>Full changelog</Trans>
            </Button.Label>
          </Button>
          <Button
            variant="ghost"
            isDisabled={dismiss.isPending}
            onPress={() => {
              setFailed(false);
              dismiss.mutate({ version: card.version });
            }}
            testID="whats-new-dismiss"
          >
            <Button.Label>
              <Trans>Dismiss</Trans>
            </Button.Label>
          </Button>
        </View>
        {failed ? (
          <Text className="font-sans text-sm text-destructive" accessibilityRole="alert">
            <Trans>Could not dismiss it. Try again.</Trans>
          </Text>
        ) : null}
      </Sheet>
    </Section>
  );
}
