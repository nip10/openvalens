import {
  parseRecipeDraft,
  RECIPE_IMPORT_COPY,
  type RecipeDraft,
} from "@openvalens/api/presenters/recipe-draft";
import {
  NUTRITION_TEMPLATES_COPY as COPY,
  TEMPLATE_RECIPE_IMPORT_COPY,
} from "@openvalens/api/presenters/nutrition-templates";
import { HIDDEN_VALUE } from "@openvalens/api/presenters/nutrition-targets";
import { useLingui } from "@lingui/react/macro";
import { Button } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { client } from "@/utils/orpc";

const MAX_INPUT = 1024 * 1024;
export type NutritionRecipeImportProps = {
  enabled: boolean;
  online: boolean;
  canMutate: () => boolean;
  hideNumbers: boolean;
  onDraft: (draft: RecipeDraft) => void;
};

export function NutritionRecipeImport({
  enabled,
  online,
  canMutate,
  hideNumbers,
  onDraft,
}: NutritionRecipeImportProps) {
  const { i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"ingredients" | "json-ld">("ingredients");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [candidates, setCandidates] = useState<RecipeDraft[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const canMutateRef = useRef(canMutate);
  canMutateRef.current = canMutate;
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const canAct = () => enabledRef.current && mounted.current && canMutateRef.current();
  useEffect(
    () => () => {
      mounted.current = false;
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    if (!enabled) {
      generation.current++;
      setOpen(false);
      setCandidates([]);
      setMessage("");
    }
  }, [enabled]);
  if (!enabled) return null;
  const start = () => {
    if (!canAct()) return;
    setOpen((value) => !value);
  };
  const parse = () => {
    if (!canAct()) return;
    if (new TextEncoder().encode(text).byteLength > MAX_INPUT) {
      setCandidates([]);
      setMessage(i18n._(COPY.recipeTooLarge));
      return;
    }
    const result = parseRecipeDraft({ text, format: mode, importedAt: new Date().toISOString() });
    setCandidates(result.candidates);
    setMessage(
      result.message
        ? i18n._(result.message)
        : result.candidates.length
          ? i18n._(COPY.recipeChoose)
          : i18n._(COPY.recipeNoDraft),
    );
  };
  const importUrl = async () => {
    if (!enabledRef.current || !mounted.current || !onlineRef.current || !canAct() || !url.trim())
      return;
    const run = ++generation.current;
    setBusy(true);
    setMessage("");
    try {
      const result = await client.nutritionRecipeImport.fromUrl({ url: url.trim() });
      if (!enabledRef.current || !mounted.current || generation.current !== run || !canAct())
        return;
      setCandidates(result.candidates);
      setMessage(result.message ? i18n._(result.message) : i18n._(COPY.recipeChoose));
    } catch {
      if (enabledRef.current && mounted.current && generation.current === run && canAct())
        setMessage(i18n._(COPY.recipeImportFailed));
    } finally {
      if (mounted.current && generation.current === run) setBusy(false);
    }
  };
  return (
    <View className="gap-2 rounded-2xl border border-rule bg-sheet p-3">
      <Button variant="outline" onPress={start}>
        <Button.Label>{i18n._(COPY.recipeImport)}</Button.Label>
      </Button>
      {open ? (
        <View className="gap-3">
          <Text className="text-sm text-ink-2">
            {i18n._(COPY.recipeImportHelp)} {i18n._(TEMPLATE_RECIPE_IMPORT_COPY.disclosure)}
          </Text>
          <View className="flex-row gap-2">
            <Button
              variant={mode === "ingredients" ? "secondary" : "outline"}
              onPress={() => setMode("ingredients")}
            >
              <Button.Label>{i18n._(COPY.ingredientsMode)}</Button.Label>
            </Button>
            <Button
              variant={mode === "json-ld" ? "secondary" : "outline"}
              onPress={() => setMode("json-ld")}
            >
              <Button.Label>{i18n._(COPY.jsonLdMode)}</Button.Label>
            </Button>
          </View>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            accessibilityLabel={i18n._(COPY.recipeText)}
            className="min-h-24 rounded-xl border border-rule px-3 py-2 text-ink"
          />
          <Button
            isDisabled={!canAct() || new TextEncoder().encode(text).byteLength > MAX_INPUT}
            onPress={parse}
          >
            <Button.Label>{i18n._(COPY.parseDraft)}</Button.Label>
          </Button>
          <Text className="text-sm text-ink-2">
            {i18n._(RECIPE_IMPORT_COPY.settingDescription)}
          </Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            editable={online}
            autoCapitalize="none"
            keyboardType="url"
            accessibilityLabel={i18n._(RECIPE_IMPORT_COPY.urlLabel)}
            className="min-h-11 rounded-xl border border-rule px-3 text-ink"
          />
          <Text className="text-sm text-ink-2">
            {i18n._(TEMPLATE_RECIPE_IMPORT_COPY.urlDisclosure)}
          </Text>
          <Button
            isDisabled={!onlineRef.current || !canAct() || busy || !url.trim()}
            onPress={() => void importUrl()}
          >
            <Button.Label>{i18n._(RECIPE_IMPORT_COPY.importing)}</Button.Label>
          </Button>
          {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
          {candidates.length > 1 ? <Text>{i18n._(COPY.chooseRecipe)}</Text> : null}
          <ScrollView className="max-h-56 gap-2">
            {candidates.map((draft) => (
              <View key={draft.id} className="gap-1 rounded-xl bg-paper-2 p-3">
                <Text className="font-medium text-ink">{draft.title ?? i18n._(COPY.imported)}</Text>
                <Text className="text-sm text-ink-2">
                  {hideNumbers === false
                    ? draft.ingredients.map((item) => item.rawText).join(" · ")
                    : i18n._(HIDDEN_VALUE)}
                </Text>
                {hideNumbers === false && draft.servingsText ? (
                  <Text className="text-sm text-ink-2">
                    {i18n._(COPY.servingsPreview)}: {draft.servingsText}
                  </Text>
                ) : null}
                <Button
                  isDisabled={!canAct()}
                  onPress={() => {
                    if (!canAct()) return;
                    generation.current++;
                    onDraft(draft);
                    setCandidates([]);
                    setOpen(false);
                    setMessage(i18n._(COPY.recipeImported));
                  }}
                >
                  <Button.Label>{i18n._(COPY.parseDraft)}</Button.Label>
                </Button>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
