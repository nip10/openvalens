import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "heroui-native";
import { Camera, Lock } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Image, Text, View } from "react-native";

import { EmptyState, ErrorState, Section, Sheet, ToneIcon } from "@/components/bloom";
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
  const { t } = useLingui();
  const key = ["privateBody", "photos", subject.organizationId, subject.userId] as const;
  const photos = useQuery({ queryKey: key, queryFn: () => client.privateBody.photos({}) });
  const [notice, setNotice] = useState("");
  const remove = useMutation({
    mutationFn: (objectId: string) => client.storage.delete({ objectId }),
    onSuccess: () => {
      setNotice(t`Photo deleted.`);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: () => setNotice(t`Could not delete this photo. Try again.`),
  });
  const confirmDelete = (id: string) =>
    Alert.alert(t`Delete this photo?`, t`This cannot be undone.`, [
      { text: t`Cancel`, style: "cancel" },
      { text: t`Delete`, style: "destructive", onPress: () => remove.mutate(id) },
    ]);

  return (
    <Section icon={Camera} tone="weight" title={t`Progress photos`}>
      <Sheet className="flex-row items-start gap-3 p-4">
        <ToneIcon icon={Lock} tone="weight" size="sm" />
        <Text className="min-w-0 flex-1 font-sans text-sm leading-relaxed text-ink-2">
          {t`Only you can see these photos. Location, camera and other hidden details are removed before a photo is stored. Add photos from the web app.`}
        </Text>
      </Sheet>
      {photos.isPending ? (
        <Text className="font-sans text-sm text-ink-3">{t`Loading photos…`}</Text>
      ) : photos.isError ? (
        <ErrorState
          title={t`Could not load photos. Try again`}
          action={
            <Button size="sm" variant="outline" onPress={() => void photos.refetch()}>
              {t`Try again`}
            </Button>
          }
        />
      ) : !photos.data.storage ? (
        <EmptyState
          icon={Camera}
          tone="weight"
          title={t`Photo storage is not set up on this server.`}
        />
      ) : photos.data.photos.length === 0 ? (
        <EmptyState icon={Camera} tone="weight" title={t`No photos yet.`} />
      ) : (
        <View className="flex-row flex-wrap gap-3">
          {photos.data.photos.map((photo) => (
            <Sheet key={photo.id} className="w-[47%] gap-3 p-2 pb-3">
              <PhotoImage id={photo.id} createdAt={photo.createdAt} />
              <Button
                size="sm"
                variant="ghost"
                isDisabled={remove.isPending}
                onPress={() => confirmDelete(photo.id)}
              >
                {t`Delete photo`}
              </Button>
            </Sheet>
          ))}
        </View>
      )}
      {notice ? (
        <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-3">
          {notice}
        </Text>
      ) : null}
    </Section>
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
  const { t } = useLingui();
  const date = new Date(createdAt).toLocaleDateString();
  if (file.isError)
    return (
      <Text className="font-sans text-sm text-ink-3">{t`This photo could not be loaded.`}</Text>
    );
  return uri ? (
    <Image
      source={{ uri }}
      accessibilityLabel={t`Progress photo from ${date}`}
      className="aspect-square w-full rounded-2xl"
    />
  ) : (
    <View
      accessibilityLabel={t`Loading progress photo from ${date}`}
      className="aspect-square w-full rounded-2xl bg-paper-2"
    />
  );
}
