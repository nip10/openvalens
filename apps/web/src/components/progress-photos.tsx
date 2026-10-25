import { Trans, useLingui } from "@lingui/react/macro";
import { isPayloadTooLarge, photoUploadProblem } from "@openvalens/api/photo-upload";
import { Button } from "@openvalens/ui/components/button";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { EmptyState, ErrorState, Section } from "@/components/page";
import { client } from "@/utils/orpc";

/**
 * Private progress photos (#85). Shown only while private body tracking is on.
 * Photos are re-encoded on the server (metadata such as GPS is removed) and
 * are only ever loaded through the authenticated API, never a shareable link.
 */

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
    onError: (error) =>
      setNotice(
        isPayloadTooLarge(error)
          ? t`This photo is larger than 10 MB. Choose a smaller JPEG or PNG.`
          : t`Could not save this photo. Use a JPEG or PNG up to 10 MB.`,
      ),
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
    // Checked before sending so a large phone photo gets a clear message
    // instead of a failed upload; the server enforces the same limits.
    const problem = photoUploadProblem(file);
    if (problem === "too_large") {
      setNotice(t`This photo is larger than 10 MB. Choose a smaller JPEG or PNG.`);
      return;
    }
    if (problem) {
      setNotice(t`Use a JPEG or PNG photo up to 10 MB.`);
      return;
    }
    upload.mutate(file);
  };

  return (
    <Section
      title={<Trans>Progress photos</Trans>}
      description={
        <Trans>
          Only you can see these photos. Workspace owners and other members cannot. Location, camera
          and other hidden details are removed before a photo is stored.
        </Trans>
      }
    >
      <div className="grid gap-4">
        {photos.isPending ? (
          <div className="grid gap-3">
            <p role="status" className="text-sm text-ink-3">
              <Trans>Loading photos…</Trans>
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Skeleton className="aspect-square w-full" />
              <Skeleton className="aspect-square w-full" />
              <Skeleton className="aspect-square w-full" />
            </div>
          </div>
        ) : photos.isError ? (
          <ErrorState
            title={<Trans>Could not load your photos.</Trans>}
            action={
              <Button variant="outline" onClick={() => void photos.refetch()}>
                <Trans>Try again</Trans>
              </Button>
            }
          />
        ) : !photos.data.storage ? (
          <EmptyState
            title={
              <Trans>Photo storage is not set up on this server, so photos cannot be added.</Trans>
            }
          />
        ) : (
          <>
            <div className="well grid gap-1.5 px-5 py-4">
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
                className="text-sm text-ink-2 file:mr-3 file:h-9 file:cursor-pointer file:rounded-sm file:border file:border-rule-2 file:bg-sheet file:px-3 file:font-display file:text-sm file:font-medium file:text-ink hover:file:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55"
              />
            </div>
            {upload.isPending ? (
              <p role="status" className="text-sm text-ink-3">
                <Trans>Saving photo…</Trans>
              </p>
            ) : null}
            {photos.data.photos.length === 0 ? (
              <EmptyState title={<Trans>No photos yet.</Trans>} />
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.data.photos.map((photo) => (
                  <li key={photo.id} className="grid gap-2">
                    <PhotoImage id={photo.id} createdAt={photo.createdAt} />
                    <Button
                      variant="destructive"
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
          <p role="status" aria-live="polite" className="text-sm text-ink-3">
            {notice}
          </p>
        ) : null}
      </div>
    </Section>
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
      <p className="text-sm text-ink-3">
        <Trans>This photo could not be loaded.</Trans>
      </p>
    );
  return src ? (
    <img
      src={src}
      alt={t`Progress photo from ${date}`}
      className="aspect-square w-full bg-paper-3 object-cover"
    />
  ) : (
    <Skeleton
      role="status"
      aria-label={t`Loading progress photo from ${date}`}
      className="aspect-square w-full"
    />
  );
}
