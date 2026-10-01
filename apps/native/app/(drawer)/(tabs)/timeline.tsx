import { Ionicons } from "@expo/vector-icons";
import { Card, Chip } from "heroui-native";
import { useThemeColor } from "@/utils/theme";
import { Text, View } from "react-native";

import { CardStack, ListRow } from "@/components/list-row";
import { Container } from "@/components/container";

type EventStatus = "success" | "warning" | "info" | "danger";

const MOCK_EVENTS: {
  id: string;
  timestamp: string;
  title: string;
  subtitle: string;
  status: EventStatus;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    id: "1",
    timestamp: "2026-09-30 08:42",
    title: "Health Connect sync",
    subtitle: "240 records imported",
    status: "success",
    label: "Complete",
    icon: "sync-outline",
  },
  {
    id: "2",
    timestamp: "2026-09-29 14:15",
    title: "LDL",
    subtitle: "142 mg/dL, reference range 125–200 mg/dL",
    status: "warning",
    label: "Near limit",
    icon: "fitness-outline",
  },
  {
    id: "3",
    timestamp: "2026-09-28 09:03",
    title: "Weight",
    subtitle: "72.4 kg",
    status: "success",
    label: "In range",
    icon: "scale-outline",
  },
  {
    id: "4",
    timestamp: "2026-09-27 22:10",
    title: "Supplementation plan updated",
    subtitle: "Vitamin D and magnesium",
    status: "info",
    label: "Updated",
    icon: "medical-outline",
  },
  {
    id: "5",
    timestamp: "2026-09-26 07:50",
    title: "Server sync failed",
    subtitle: "12 records queued",
    status: "danger",
    label: "Failed",
    icon: "cloud-offline-outline",
  },
];

function chipColor(status: EventStatus) {
  if (status === "info") return "default";
  return status;
}

export default function TimelineScreen() {
  const foreground = useThemeColor("foreground");

  return (
    <Container className="p-4">
      <View className="gap-4">
        <View className="rounded-lg border border-warning/20 bg-warning/10 p-3">
          <Text className="text-sm text-warning">
            Sample data — wire to /api/timeline when available.
          </Text>
        </View>

        <CardStack>
          <Card variant="secondary" className="overflow-hidden p-0">
            {MOCK_EVENTS.map((event, index) => (
              <ListRow
                key={event.id}
                icon={<Ionicons name={event.icon} size={20} color={foreground} />}
                title={event.title}
                subtitle={`${event.timestamp} · ${event.subtitle}`}
                trailing={
                  <Chip size="sm" color={chipColor(event.status)}>
                    <Chip.Label>{event.label}</Chip.Label>
                  </Chip>
                }
                showDivider={index < MOCK_EVENTS.length - 1}
              />
            ))}
          </Card>
        </CardStack>
      </View>
    </Container>
  );
}
