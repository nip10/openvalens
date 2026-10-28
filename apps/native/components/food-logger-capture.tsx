import type { FoodDraftCandidateWire } from "@openvalens/api/contracts/nutrition-food-drafts";
import { FOOD_DRAFT_COPY, PHOTO_DRAFT_COPY } from "@openvalens/api/presenters/food-draft";
import {
  FOOD_LOGGER_CAPTURE_COPY as COPY,
  identifyCaptureCandidates,
} from "@openvalens/api/presenters/food-logger-capture";
import { isPayloadTooLarge, photoUploadProblem } from "@openvalens/api/photo-upload";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Camera, CameraView, type CameraView as CameraViewType } from "expo-camera";
import { File } from "expo-file-system";
import { Button } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { Linking, Switch, Text, TextInput, View } from "react-native";

import { client } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

export type FoodLoggerCaptureMode = "describe" | "photo";
export interface FoodLoggerCaptureProps {
  mode: FoodLoggerCaptureMode;
  /** Parent supplies availability from its existing nutrition opt-in settings. */
  available: boolean;
  canMutate: boolean;
  /** Parent must also hide candidate amount hints when this is true. */
  hideNumbers?: boolean;
  /** Draft-only candidates; matching and explicit enqueue remain parent-owned. */
  onCandidates: (items: FoodDraftCandidateWire[]) => void;
  onSearchItem?: (item: FoodDraftCandidateWire) => void;
  onStatus?: (status: "ready" | "error") => void;
}

type CameraState = "idle" | "asking" | "ready" | "denied" | "unavailable" | "failed";
type ParseRun = {
  id: number;
  transcript: string;
  useAi: boolean;
  provider: string | null;
  host: string | null;
};
type PhotoRun = { id: number; file: File; provider: string; host: string | null };

/** Inline draft-only capture; never persists or logs candidates. */
export function FoodLoggerCapture({
  mode,
  available,
  canMutate,
  hideNumbers: _hideNumbers = false,
  onCandidates,
  onStatus,
}: FoodLoggerCaptureProps) {
  const { i18n } = useLingui();
  const placeholder = useThemeColor("ink-3");
  const [transcript, setTranscript] = useState("");
  const [useAi, setUseAi] = useState(false);
  const [textConsent, setTextConsent] = useState<string | null>(null);
  const [photoConsent, setPhotoConsent] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [photo, setPhoto] = useState<File | null>(null);
  const cameraRef = useRef<CameraViewType>(null);
  const sequence = useRef(0);
  const authority = useRef({ mode, available, canMutate });
  authority.current = { mode, available, canMutate };
  const isCurrent = (id: number, requiredMode: FoodLoggerCaptureMode) =>
    sequence.current === id &&
    authority.current.mode === requiredMode &&
    authority.current.available &&
    authority.current.canMutate;

  const provider = useQuery({
    queryKey: ["nutritionFoodDrafts", "provider"],
    queryFn: () => client.nutritionFoodDrafts.provider({}),
    enabled: available,
  });
  const providerId =
    provider.data?.provider && provider.data.available
      ? `${provider.data.provider}\u0000${provider.data.host ?? ""}`
      : "";
  const providerName = provider.data?.host
    ? `${provider.data.provider} (${provider.data.host})`
    : (provider.data?.provider ?? "");

  const publish = (candidates: FoodDraftCandidateWire[], id: number) => {
    if (!isCurrent(id, mode)) return;
    onCandidates(identifyCaptureCandidates(candidates, `capture-${id}`));
  };
  const report = (message: string, result: "ready" | "error") => {
    setStatus(message);
    onStatus?.(result);
  };
  const parse = useMutation({
    mutationFn: (run: ParseRun) =>
      client.nutritionFoodDrafts.parse({
        transcript: run.transcript,
        mode: run.useAi ? "ai" : "local",
        ...(run.useAi ? { sendToProvider: { provider: run.provider ?? "", host: run.host } } : {}),
      }),
    onSuccess: (result, run) => {
      if (!isCurrent(run.id, "describe")) return;
      setTextConsent(null);
      if (result.status === "ready") {
        publish(result.candidates, run.id);
        report(i18n._(FOOD_DRAFT_COPY.status.ready), "ready");
      } else report(i18n._(FOOD_DRAFT_COPY.status[result.status]), "error");
    },
    onError: (_error, run) => {
      if (isCurrent(run.id, "describe")) report(i18n._(COPY.draftFailed), "error");
    },
  });
  const parsePhoto = useMutation({
    mutationFn: (run: PhotoRun) =>
      client.nutritionFoodDrafts.parsePhoto({
        photo: run.file,
        sendToProvider: { provider: run.provider, host: run.host },
      }),
    onSuccess: (result, run) => {
      if (!isCurrent(run.id, "photo")) return;
      setPhotoConsent(null);
      if (result.status === "ready") {
        publish(result.candidates, run.id);
        report(i18n._(PHOTO_DRAFT_COPY.status.ready), "ready");
      } else report(i18n._(PHOTO_DRAFT_COPY.status[result.status]), "error");
    },
    onError: (error, run) => {
      if (!isCurrent(run.id, "photo")) return;
      report(
        i18n._(
          isPayloadTooLarge(error)
            ? PHOTO_DRAFT_COPY.status.invalid_photo
            : PHOTO_DRAFT_COPY.status.provider_error,
        ),
        "error",
      );
    },
  });

  useEffect(() => {
    sequence.current += 1;
    setStatus(null);
    setTranscript("");
    setUseAi(false);
    setTextConsent(null);
    setPhotoConsent(null);
    setPhoto(null);
    setCameraActive(false);
    setCameraReady(false);
    setCameraState("idle");
  }, [mode, available, canMutate]);
  useEffect(() => {
    setTextConsent(null);
    setPhotoConsent(null);
  }, [providerId]);
  useEffect(
    () => () => {
      sequence.current += 1;
    },
    [],
  );

  if (!available) return null;

  const openCamera = async () => {
    if (
      !authority.current.available ||
      !authority.current.canMutate ||
      authority.current.mode !== "photo"
    )
      return;
    const id = ++sequence.current;
    setCameraState("asking");
    try {
      if (!(await CameraView.isAvailableAsync())) {
        if (isCurrent(id, "photo")) setCameraState("unavailable");
        return;
      }
      if (!isCurrent(id, "photo")) return;
      const permission = await Camera.requestCameraPermissionsAsync();
      if (!isCurrent(id, "photo")) return;
      if (!permission.granted) {
        setCameraState("denied");
        return;
      }
      setCameraReady(false);
      setCameraActive(true);
      setCameraState("ready");
    } catch {
      if (isCurrent(id, "photo")) setCameraState("unavailable");
    }
  };
  const takePhoto = async () => {
    if (
      !authority.current.available ||
      !authority.current.canMutate ||
      authority.current.mode !== "photo" ||
      !cameraReady ||
      !cameraRef.current
    )
      return;
    const id = sequence.current;
    const camera = cameraRef.current;
    try {
      const result = await camera.takePictureAsync({ quality: 0.8 });
      if (!isCurrent(id, "photo")) return;
      setCameraActive(false);
      if (!result?.uri) {
        setCameraState("failed");
        return;
      }
      const file = new File(result.uri);
      const extension = result.uri
        .split(/[?#]/, 1)[0]
        ?.toLowerCase()
        .match(/\.([a-z0-9]+)$/)?.[1];
      const inferredType =
        extension === "png"
          ? "image/png"
          : extension === "jpg" || extension === "jpeg"
            ? "image/jpeg"
            : "";
      const type = file.type || inferredType;
      if (photoUploadProblem({ size: file.size, type })) {
        report(i18n._(PHOTO_DRAFT_COPY.status.invalid_photo), "error");
        return;
      }
      setPhoto(file);
      setPhotoConsent(null);
      setStatus(null);
    } catch {
      if (isCurrent(id, "photo")) {
        setCameraActive(false);
        setCameraState("failed");
      }
    }
  };

  if (mode === "photo")
    return (
      <View className="gap-3 rounded-2xl border border-rule bg-sheet p-4">
        <Text className="font-display text-lg font-medium text-ink">
          {i18n._(PHOTO_DRAFT_COPY.intro)}
        </Text>
        {cameraActive ? (
          <View className="gap-3">
            <CameraView
              ref={cameraRef}
              style={{ height: 280, borderRadius: 16, overflow: "hidden" }}
              facing="back"
              onCameraReady={() => {
                if (
                  authority.current.mode === "photo" &&
                  authority.current.available &&
                  authority.current.canMutate
                )
                  setCameraReady(true);
              }}
              onMountError={() => {
                if (authority.current.mode === "photo" && authority.current.available) {
                  setCameraActive(false);
                  setCameraState("failed");
                }
              }}
            />
            <Button isDisabled={!cameraReady || !canMutate} onPress={() => void takePhoto()}>
              <Button.Label>{i18n._(COPY.takePhotoAction)}</Button.Label>
            </Button>
          </View>
        ) : (
          <Button
            isDisabled={!canMutate || cameraState === "asking"}
            onPress={() => void openCamera()}
          >
            <Button.Label>
              {i18n._(cameraState === "asking" ? COPY.cameraOpening : COPY.takePhoto)}
            </Button.Label>
          </Button>
        )}
        {cameraState === "denied" ? (
          <View className="gap-2">
            <Text accessibilityLiveRegion="polite">{i18n._(COPY.cameraDenied)}</Text>
            <Button
              isDisabled={!canMutate}
              onPress={() => {
                if (authority.current.canMutate) void Linking.openSettings();
              }}
            >
              <Button.Label>{i18n._(COPY.openSettings)}</Button.Label>
            </Button>
          </View>
        ) : null}
        {cameraState === "unavailable" || cameraState === "failed" ? (
          <Text accessibilityLiveRegion="polite">{i18n._(COPY.cameraUnavailable)}</Text>
        ) : null}
        {photo ? (
          <View className="gap-2">
            <Text>{i18n._(COPY.photoReady)}</Text>
            <Text className="text-sm text-ink-2">{i18n._(PHOTO_DRAFT_COPY.disclosure)}</Text>
            {provider.data?.available ? (
              <>
                <Text className="text-sm text-ink-2">
                  {i18n._(COPY.sendPhoto.id, { provider: providerName })}
                </Text>
                <View className="min-h-11 flex-row items-center justify-between gap-3">
                  <Text className="flex-1">{i18n._(COPY.agreePhotoLabel)}</Text>
                  <Switch
                    value={photoConsent === providerId && !!providerId}
                    disabled={!canMutate}
                    onValueChange={(value) => setPhotoConsent(value ? providerId : null)}
                    accessibilityLabel={i18n._(COPY.agreePhoto)}
                  />
                </View>
                <Button
                  isDisabled={
                    !canMutate || photoConsent !== providerId || !providerId || parsePhoto.isPending
                  }
                  onPress={() => {
                    if (
                      !authority.current.available ||
                      !authority.current.canMutate ||
                      photoConsent !== providerId ||
                      !providerId
                    )
                      return;
                    const id = ++sequence.current;
                    parsePhoto.mutate({
                      id,
                      file: photo,
                      provider: provider.data!.provider!,
                      host: provider.data!.host,
                    });
                  }}
                >
                  <Button.Label>
                    {i18n._(parsePhoto.isPending ? COPY.working : COPY.makePhotoDraft)}
                  </Button.Label>
                </Button>
              </>
            ) : (
              <Text className="text-sm text-ink-2">
                {i18n._(PHOTO_DRAFT_COPY.status.ai_unavailable)}
              </Text>
            )}
          </View>
        ) : null}
        {status ? (
          <Text accessibilityLiveRegion="polite" className="text-sm text-ink-2">
            {status}
          </Text>
        ) : null}
      </View>
    );

  return (
    <View className="gap-3 rounded-2xl border border-rule bg-sheet p-4">
      <Text className="font-display text-lg font-medium text-ink">{i18n._(COPY.what)}</Text>
      <Text className="font-sans text-sm text-ink-2">{i18n._(FOOD_DRAFT_COPY.intro)}</Text>
      <TextInput
        value={transcript}
        onChangeText={(value) => {
          if (authority.current.canMutate && authority.current.mode === "describe")
            setTranscript(value);
        }}
        multiline
        maxLength={2000}
        textAlignVertical="top"
        placeholder={i18n._(COPY.example)}
        accessibilityLabel={i18n._(COPY.what)}
        accessibilityState={{ disabled: !canMutate }}
        editable={canMutate}
        placeholderTextColor={placeholder}
        className="min-h-28 rounded-xl border border-rule bg-sheet px-3 py-2 font-sans text-base text-ink"
      />
      <Text className="font-sans text-sm text-ink-3">{i18n._(FOOD_DRAFT_COPY.dictation)}</Text>
      {provider.data?.available ? (
        <View className="gap-2 rounded-xl bg-paper-2 p-3">
          <View className="min-h-11 flex-row items-center justify-between gap-3">
            <Text className="flex-1 text-ink-2">{i18n._(COPY.aiToggle)}</Text>
            <Switch
              value={useAi}
              disabled={!canMutate}
              accessibilityLabel={i18n._(COPY.aiToggle)}
              onValueChange={(value) => {
                if (!authority.current.canMutate) return;
                setUseAi(value);
                setTextConsent(null);
              }}
            />
          </View>
          {useAi ? (
            <View className="min-h-11 flex-row items-center justify-between gap-3">
              <Text className="flex-1 text-sm text-ink-2">
                {i18n._(COPY.sendText.id, { provider: providerName })}{" "}
                {i18n._(FOOD_DRAFT_COPY.aiDisclosure)}
              </Text>
              <Switch
                value={textConsent === providerId && !!providerId}
                disabled={!canMutate}
                accessibilityLabel={i18n._(COPY.agreeText)}
                onValueChange={(value) => {
                  if (authority.current.canMutate) setTextConsent(value ? providerId : null);
                }}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      <Button
        isDisabled={
          !canMutate ||
          !transcript.trim() ||
          (useAi && (textConsent !== providerId || !providerId)) ||
          parse.isPending
        }
        onPress={() => {
          if (
            !authority.current.available ||
            !authority.current.canMutate ||
            authority.current.mode !== "describe" ||
            !transcript.trim()
          )
            return;
          const id = ++sequence.current;
          parse.mutate({
            id,
            transcript,
            useAi,
            provider: providerId ? (provider.data?.provider ?? null) : null,
            host: provider.data?.host ?? null,
          });
        }}
      >
        <Button.Label>{i18n._(parse.isPending ? COPY.working : COPY.makeDraft)}</Button.Label>
      </Button>
      {status ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-ink-2">
          {status}
        </Text>
      ) : null}
    </View>
  );
}
