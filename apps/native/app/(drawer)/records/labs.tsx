import { formatLabDate, formatLabValue } from "@openhealth/api/presenters/labs";
import { useQuery } from "@tanstack/react-query";
import { Card, Spinner } from "heroui-native";
import { Pressable, RefreshControl, Text, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

export default function LabsScreen() {
  const foreground = useThemeColor("foreground");
  const markers = useQuery(orpc.labs.latest.queryOptions({ input: { recentLimit: 10 } }));

  if (markers.isPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );

  if (markers.isError || !markers.data)
    return (
      <Container className="items-center justify-center gap-3 p-6" isScrollable={false}>
        <Text className="text-base text-foreground">Could not load labs.</Text>
        <Pressable
          onPress={() => void markers.refetch()}
          className="min-h-11 justify-center px-4"
          accessibilityRole="button"
        >
          <Text className="font-medium text-foreground underline">Retry</Text>
        </Pressable>
      </Container>
    );

  const list = markers.data;

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={markers.isRefetching}
            onRefresh={() => void markers.refetch()}
            tintColor={foreground}
          />
        ),
      }}
    >
      <View className="gap-6 p-4">
        <View>
          <Text className="text-sm text-muted-foreground">Labs</Text>
          <Text className="font-mono text-3xl text-foreground">Latest markers</Text>
        </View>

        {list.length === 0 ? (
          <Card variant="secondary" className="items-center gap-1 p-8">
            <Text className="font-medium text-foreground">No lab markers yet</Text>
            <Text className="text-center text-sm text-muted-foreground">
              Import a lab PDF to add markers.
            </Text>
          </Card>
        ) : (
          <CardStack>
            <Card variant="secondary" className="p-0">
              {list.map((marker, index) => (
                <View
                  key={marker.code}
                  className={`flex-row items-center justify-between gap-3 px-4 py-3 ${
                    index < list.length - 1 ? "border-b border-border" : ""
                  }`}
                >
                  <View className="min-w-0 flex-1">
                    <Text className="text-base text-foreground">{marker.displayName}</Text>
                    <Text className="text-xs text-muted-foreground">
                      {marker.latestValue === null
                        ? "No readings yet"
                        : `${formatLabDate(marker.latestSampledAt)} · ${marker.sampleCount} reading${marker.sampleCount === 1 ? "" : "s"}`}
                    </Text>
                  </View>
                  <View className="shrink-0 items-end">
                    <Text className="font-mono text-base text-foreground">
                      {formatLabValue(marker.latestValue, marker.unit)}
                    </Text>
                    {marker.unit ? (
                      <Text className="text-xs text-muted-foreground">{marker.unit}</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </Card>
          </CardStack>
        )}
      </View>
    </Container>
  );
}
