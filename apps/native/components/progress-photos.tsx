import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card } from "heroui-native";
import { useEffect, useState } from "react";
import { Alert, Image, Text, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { client } from "@/utils/orpc";

/**
 * Private progress photos (#85) on mobile: view and delete. Adding photos
 * happens in the web app for now; the server strips metadata on upload.
 * Images load through the authenticated API, never a shareable link.
 */
export function ProgressPhotos({
  subject,
}: {
  subject: { userId: string; organizationId: string };
}) {
  const qc = useQueryClient();
  const key = ["privateBody", "photos", subject.organizationId, subject.userId] as const;
  const photos = useQuery({ queryKey: key, queryFn: () => client.privateBody.photos({}) });
  const [notice, setNotice] = useState("");
  const remove = useMutation({
    mutationFn: (objectId: string) => client.storage.delete({ objectId }),
    onSuccess: () => {
      setNotice("Photo deleted.");
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: () => setNotice("Could not delete this photo. Try again."),
  });
  const confirmDelete = (id: string) =>
    Alert.alert("Delete this photo?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => remove.mutate(id) },
    ]);

  return (
    <CardStack title="Progress photos">
      <Card variant="secondary" className="gap-3 p-4">
        <Text className="text-sm text-muted-foreground">
          Only you can see these photos. Location, camera and other hidden details are removed
          before a photo is stored. Add photos from the web app.
        </Text>
        {photos.isPending ? (
          <Text className="text-sm text-muted-foreground">Loading photos…</Text>
        ) : photos.isError ? (
          <Button size="sm" variant="secondary" onPress={() => void photos.refetch()}>
            Could not load photos. Try again
          </Button>
        ) : !photos.data.storage ? (
          <Text className="text-sm text-muted-foreground">
            Photo storage is not set up on this server.
          </Text>
        ) : photos.data.photos.length === 0 ? (
          <Text className="text-sm text-muted-foreground">No photos yet.</Text>
        ) : (
          <View className="flex-row flex-wrap gap-3">
            {photos.data.photos.map((photo) => (
              <View key={photo.id} className="w-[47%] gap-2">
                <PhotoImage id={photo.id} createdAt={photo.createdAt} />
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={remove.isPending}
                  onPress={() => confirmDelete(photo.id)}
                >
                  Delete photo
                </Button>
              </View>
            ))}
          </View>
        )}
        {notice ? (
          <Text accessibilityLiveRegion="polite" className="text-sm text-muted-foreground">
            {notice}
          </Text>
        ) : null}
      </Card>
    </CardStack>
  );
}

function PhotoImage({ id, createdAt }: { id: string; createdAt: string }) {
  const file = useQuery({
    queryKey: ["privateBody", "photoFile", id],
    queryFn: () => client.privateBody.photoFile({ id }),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    if (!file.data) return;
    const reader = new FileReader();
    reader.onload = () => setUri(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file.data);
    return () => reader.abort();
  }, [file.data]);
  const label = `Progress photo from ${new Date(createdAt).toLocaleDateString()}`;
  if (file.isError)
    return <Text className="text-sm text-muted-foreground">This photo could not be loaded.</Text>;
  return uri ? (
    <Image
      source={{ uri }}
      accessibilityLabel={label}
      className="aspect-square w-full rounded-lg"
    />
  ) : (
    <View
      accessibilityLabel={`Loading ${label}`}
      className="aspect-square w-full rounded-lg bg-muted"
    />
  );
}
