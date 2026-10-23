import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Label } from "@openvalens/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { client } from "@/utils/orpc";

/**
 * Private progress photos (#85). Shown only while private body tracking is on.
 * Photos are re-encoded on the server (metadata such as GPS is removed) and
 * are only ever loaded through the authenticated API, never a shareable link.
 */

const MAX_BYTES = 10 * 1024 * 1024;

type Subject = { userId: string; organizationId: string };

export function ProgressPhotos({ subject }: { subject: Subject }) {
  const qc = useQueryClient();
  const { t } = useLingui();
  const key = ["privateBody", "photos", subject.organizationId, subject.userId] as const;
  const photos = useQuery({ queryKey: key, queryFn: () => client.privateBody.photos({}) });
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: key });

  const upload = useMutation({
    mutationFn: (photo: File) => client.privateBody.uploadPhoto({ photo }),
    onSuccess: () => {
      setNotice(t`Photo saved privately. Location and camera details were removed.`);
      if (fileRef.current) fileRef.current.value = "";
      refresh();
    },
    onError: () => setNotice(t`Could not save this photo. Use a JPEG or PNG up to 10 MB.`),
  });
  const remove = useMutation({
    mutationFn: (objectId: string) => client.storage.delete({ objectId }),
    onSuccess: () => {
      setNotice(t`Photo deleted.`);
      refresh();
    },
    onError: () => setNotice(t`Could not delete this photo. Try again.`),
  });

  const choose = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES || !["image/jpeg", "image/png"].includes(file.type)) {
      setNotice(t`Use a JPEG or PNG photo up to 10 MB.`);
      return;
    }
    upload.mutate(file);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Progress photos</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          <Trans>
            Only you can see these photos. Workspace owners and other members cannot. Location,
            camera and other hidden details are removed before a photo is stored.
          </Trans>
        </p>
        {photos.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            <Trans>Loading photos…</Trans>
          </p>
        ) : photos.isError ? (
          <div className="grid gap-2">
            <p role="alert">
              <Trans>Could not load your photos.</Trans>
            </p>
            <Button className="w-fit" variant="outline" onClick={() => void photos.refetch()}>
              <Trans>Try again</Trans>
            </Button>
          </div>
        ) : !photos.data.storage ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Photo storage is not set up on this server, so photos cannot be added.</Trans>
          </p>
        ) : (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="progress-photo">
                <Trans>Add a photo (JPEG or PNG, up to 10 MB)</Trans>
              </Label>
              <input
                ref={fileRef}
                id="progress-photo"
                type="file"
                accept="image/jpeg,image/png"
                disabled={upload.isPending}
                onChange={(event) => choose(event.target.files?.[0])}
                className="text-sm"
              />
            </div>
            {upload.isPending ? (
              <p role="status" className="text-sm text-muted-foreground">
                <Trans>Saving photo…</Trans>
              </p>
            ) : null}
            {photos.data.photos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                <Trans>No photos yet.</Trans>
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.data.photos.map((photo) => (
                  <li key={photo.id} className="grid gap-2">
                    <PhotoImage id={photo.id} createdAt={photo.createdAt} />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(t`Delete this photo? This cannot be undone.`))
                          remove.mutate(photo.id);
                      }}
                    >
                      <Trans>Delete photo</Trans>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {notice ? (
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PhotoImage({ id, createdAt }: { id: string; createdAt: string }) {
  const file = useQuery({
    queryKey: ["privateBody", "photoFile", id],
    queryFn: () => client.privateBody.photoFile({ id }),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!file.data) return;
    const url = URL.createObjectURL(file.data);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file.data]);
  const { t } = useLingui();
  const date = new Date(createdAt).toLocaleDateString();
  if (file.isError)
    return (
      <p className="text-sm text-muted-foreground">
        <Trans>This photo could not be loaded.</Trans>
      </p>
    );
  return src ? (
    <img
      src={src}
      alt={t`Progress photo from ${date}`}
      className="aspect-square w-full rounded-md object-cover"
    />
  ) : (
    <div
      role="status"
      aria-label={t`Loading progress photo from ${date}`}
      className="aspect-square w-full animate-pulse rounded-md bg-muted"
    />
  );
}
