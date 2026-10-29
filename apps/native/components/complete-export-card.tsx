import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { File } from "expo-file-system";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { Archive, Download, X } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Button, Spinner } from "heroui-native";

import { Icon, Section, Sheet } from "@/components/bloom";
import { authClient } from "@/lib/auth-client";
import {
  deleteCompleteExportFile,
  downloadCompleteExport,
  sweepCompleteExportCache,
} from "@/lib/complete-export-download";
import { shareCompleteExportFile } from "@/lib/complete-export-transfer";
import { completeExportPollInterval } from "@/lib/complete-export-utils";
import { getServerUrl, useServer } from "@/lib/server/server-url";
import { client } from "@/utils/orpc";

export function CompleteExportCard() {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const router = useRouter();
  const server = useServer();
  const serverUrl = server.status === "set" ? server.url : null;
  const session = authClient.useSession();
  const statusKey = useMemo(() => ["dataRights", "exportStatus", serverUrl] as const, [serverUrl]);
  const controller = useRef<AbortController | null>(null);
  const activeFile = useRef<File | null>(null);
  const [downloadError, setDownloadError] = useState<"download" | "share" | null>(null);
  const [actionError, setActionError] = useState<"generic" | "auth" | null>(null);
  const [downloading, setDownloading] = useState(false);

  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => client.dataRights.exportStatus({}),
    refetchInterval: (query) => completeExportPollInterval(query.state.data),
    enabled: !!serverUrl && !!session.data,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: statusKey });
  const request = useMutation({
    mutationFn: () => client.dataRights.exportRequest({}),
    onSuccess: (data) => {
      setActionError(null);
      queryClient.setQueryData(statusKey, data);
    },
    onError: (error) =>
      setActionError(
        (error as { code?: unknown } | null)?.code === "UNAUTHORIZED" ? "auth" : "generic",
      ),
  });
  const cancel = useMutation({
    mutationFn: (jobId: string) => client.dataRights.exportCancel({ jobId }),
    onSuccess: refresh,
    onError: (error) =>
      setActionError(
        (error as { code?: unknown } | null)?.code === "UNAUTHORIZED" ? "auth" : "generic",
      ),
  });

  useEffect(() => {
    try {
      sweepCompleteExportCache();
    } catch {
      // Cache cleanup is best-effort and never blocks a data-rights action.
    }
    return () => {
      controller.current?.abort();
      controller.current = null;
      deleteCompleteExportFile(activeFile.current);
      activeFile.current = null;
    };
  }, [serverUrl]);

  useEffect(() => {
    if (session.isPending || session.data) return;
    controller.current?.abort();
    controller.current = null;
    deleteCompleteExportFile(activeFile.current);
    activeFile.current = null;
    setDownloading(false);
    queryClient.removeQueries({ queryKey: statusKey });
  }, [queryClient, session.data, session.isPending, statusKey]);

  const current = status.data;
  const pending = current?.state === "queued" || current?.state === "running";

  const download = async () => {
    if (!current || current.state !== "ready" || !serverUrl || downloading) return;
    const liveServer = getServerUrl();
    if (!liveServer || liveServer !== serverUrl) return;
    setDownloadError(null);
    setDownloading(true);
    const abort = new AbortController();
    controller.current = abort;
    let file: File | null = null;
    try {
      const cookie = await authClient.getCookie();
      if (abort.signal.aborted || getServerUrl() !== serverUrl) return;
      file = await downloadCompleteExport({
        serverUrl,
        jobId: current.id,
        cookie: typeof cookie === "string" ? cookie : "",
        signal: abort.signal,
      });
      if (abort.signal.aborted || getServerUrl() !== serverUrl || !session.data) {
        deleteCompleteExportFile(file);
        return;
      }
      activeFile.current = file;
      const shared = await shareCompleteExportFile(file, {
        isAvailable: () => Sharing.isAvailableAsync(),
        isCurrent: () => !abort.signal.aborted && getServerUrl() === serverUrl && !!session.data,
        share: async (sharedFile) => {
          setDownloading(false);
          await Sharing.shareAsync(sharedFile.uri, {
            mimeType: "application/zip",
            dialogTitle: t`Save or share your export`,
            UTI: "public.zip-archive",
          });
        },
      });
      if (!shared) {
        deleteCompleteExportFile(file);
        activeFile.current = null;
        return;
      }
    } catch (error) {
      if (file && file !== activeFile.current) deleteCompleteExportFile(file);
      if (
        !abort.signal.aborted &&
        error instanceof Error &&
        error.message === "EXPORT_UNAUTHORIZED"
      ) {
        setActionError("auth");
      } else if (!abort.signal.aborted) {
        setDownloadError(file && file === activeFile.current ? "share" : "download");
      }
    } finally {
      if (controller.current === abort) controller.current = null;
      setDownloading(false);
    }
  };

  const signInRequired = (status.error as { code?: unknown } | null)?.code === "UNAUTHORIZED";
  return (
    <Section
      icon={Archive}
      tone="water"
      title={t`Download everything`}
      description={t`Prepare one ZIP file with your JSON records and stored attachments.`}
    >
      <Sheet className="gap-3">
        <Text className="font-sans text-sm text-ink-2">
          {t`Preparation runs in the background. When it is ready, the download is available for 24 hours.`}
        </Text>
        {server.status === "loading" || session.isPending || status.isPending ? <Spinner /> : null}
        {status.isPending ? (
          <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-3">
            {t`Checking export status…`}
          </Text>
        ) : null}
        {server.status === "unset" ? (
          <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-2">
            {t`Choose a server and sign in to request an export.`}
          </Text>
        ) : null}
        {serverUrl && !session.isPending && !session.data ? (
          <View className="gap-2">
            <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-2">
              {t`Sign in to request and download your export.`}
            </Text>
            <Button variant="secondary" onPress={() => router.push("/")}>
              <Button.Label>{t`Sign in`}</Button.Label>
            </Button>
          </View>
        ) : null}
        {signInRequired ? (
          <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-2">
            {t`Your session has ended. Sign in again to check your export.`}
          </Text>
        ) : null}
        {status.isError && !signInRequired ? (
          <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-destructive">
            {t`Could not check your export status.`}
          </Text>
        ) : null}
        {current?.state === "queued" ? (
          <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-2">
            {t`Waiting to prepare your export…`}
          </Text>
        ) : null}
        {current?.state === "running" ? (
          <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-2">
            {t`Preparing your export…`}
          </Text>
        ) : null}
        {current?.state === "ready" ? (
          <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-2">
            {t`Your export is ready. It will be available for 24 hours after preparation.`}
          </Text>
        ) : null}
        {current?.state === "failed" ? (
          <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-destructive">
            {current.failure === "LIMIT_EXCEEDED"
              ? t`This export is too large to prepare. Try the exports below.`
              : current.failure === "ATTACHMENT_UNAVAILABLE"
                ? t`Some stored attachments could not be included. You can try again.`
                : current.failure === "STORAGE_UNAVAILABLE"
                  ? t`Export storage is unavailable right now. Try again later.`
                  : current.failure === "INTERRUPTED"
                    ? t`Preparation stopped before it finished. You can try again.`
                    : t`Could not prepare the export. You can try again.`}
          </Text>
        ) : null}
        {current?.state === "cancelled" ? (
          <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-2">
            {t`Export preparation was cancelled.`}
          </Text>
        ) : null}
        {current?.state === "expired" ? (
          <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-2">
            {t`This export has expired. Request a new one if you still need it.`}
          </Text>
        ) : null}
        {downloadError ? (
          <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-destructive">
            {downloadError === "share"
              ? t`The file was downloaded, but sharing is unavailable on this device.`
              : t`Could not download the export. Check your connection and try again.`}
          </Text>
        ) : null}
        {actionError ? (
          <View className="gap-2">
            <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-destructive">
              {actionError === "auth"
                ? t`Your session has ended. Sign in again to continue.`
                : t`That action did not complete. Try again.`}
            </Text>
            {actionError === "auth" ? (
              <Button variant="secondary" onPress={() => router.push("/")}>
                <Button.Label>{t`Sign in`}</Button.Label>
              </Button>
            ) : null}
          </View>
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          {downloading ? (
            <Button variant="secondary" onPress={() => controller.current?.abort()}>
              <Icon icon={X} size={18} color="ink" />
              <Button.Label>{t`Cancel download`}</Button.Label>
            </Button>
          ) : null}
          {current?.state === "ready" ? (
            <Button isDisabled={downloading || !serverUrl} onPress={() => void download()}>
              <Icon icon={Download} size={18} color="primary-foreground" />
              <Button.Label>{downloading ? t`Downloading…` : t`Save or share ZIP`}</Button.Label>
            </Button>
          ) : null}
          {pending ? (
            <Button
              variant="secondary"
              isDisabled={cancel.isPending}
              onPress={() => current && cancel.mutate(current.id)}
            >
              <Icon icon={X} size={18} color="ink" />
              <Button.Label>{cancel.isPending ? t`Stopping…` : t`Cancel`}</Button.Label>
            </Button>
          ) : null}
          {serverUrl && session.data && !pending && !status.isPending && !status.isError ? (
            <Button
              variant={current?.state === "ready" ? "secondary" : "primary"}
              isDisabled={request.isPending}
              onPress={() => {
                setActionError(null);
                request.mutate();
              }}
            >
              <Button.Label>
                {request.isPending
                  ? t`Requesting…`
                  : current
                    ? t`Prepare a new export`
                    : t`Prepare export`}
              </Button.Label>
            </Button>
          ) : null}
          {status.isError ? (
            <Button variant="secondary" onPress={() => void status.refetch()}>
              <Button.Label>{t`Try again`}</Button.Label>
            </Button>
          ) : null}
        </View>
      </Sheet>
    </Section>
  );
}
