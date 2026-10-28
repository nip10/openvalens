import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NUTRIENT_KEYS } from "@openvalens/api/contracts/nutrition-diary";

let React: typeof import("react");
let TestRenderer: typeof import("../../../../packages/ui/node_modules/react-test-renderer");
let AddFood: typeof import("../../app/(drawer)/(tabs)/nutrition").AddFood;
let NutritionScreen: typeof import("../../app/(drawer)/(tabs)/nutrition").default;
let captured: { announces: string[]; closes: number; enqueues: number; payloads: unknown[] };
let routeParams: Record<string, unknown> = {};
const routeCalls: { pushes: unknown[]; setParams: unknown[] } = { pushes: [], setParams: [] };
const testRouter = {
  push: (value: unknown) => routeCalls.pushes.push(value),
  setParams: (value: unknown) => routeCalls.setParams.push(value),
  back: () => undefined,
};
let diaryOutbox: Record<string, unknown>;
let createResult: Promise<unknown>;
let deletionCalls: unknown[] = [];
let deletionTickets: unknown[] = [];
let updateCalls: unknown[] = [];
let cachedReads: Record<string, unknown> = {};
let renderRows: unknown[] = [];
let diaryEntries: unknown[] = [];
let editorProps: Record<string, unknown> | null = null;
let favoriteCalls: unknown[] = [];
let offlineSessionKey: string | null = "session-1";
let beginWriteCalls = 0;
let resolveCreate!: (value: unknown) => void;
let rejectCreate!: (reason?: unknown) => void;

const host = (name: string) => (props: Record<string, unknown>) =>
  React.createElement(name, props, props.children as React.ReactNode);
const text = (children: React.ReactNode) => React.createElement("Text", null, children);

const Button = host("Button") as typeof host extends (...args: never[]) => infer T ? T : never;
(Button as unknown as { Label: unknown }).Label = ({ children }: { children?: React.ReactNode }) =>
  text(children);
const Icon = host("Icon");
const noop = () => undefined;

mock.module("react-native", () => ({
  AccessibilityInfo: {
    announceForAccessibility: (message: string) => captured.announces.push(message),
  },
  Alert: { alert: noop },
  Keyboard: { dismiss: noop },
  KeyboardAvoidingView: host("KeyboardAvoidingView"),
  Platform: { OS: "ios" },
  Pressable: host("Pressable"),
  ScrollView: host("ScrollView"),
  Text: host("Text"),
  TextInput: host("TextInput"),
  View: host("View"),
}));
mock.module("expo-router", () => ({
  Link: host("Link"),
  useLocalSearchParams: () => routeParams,
  useRouter: () => testRouter,
}));
mock.module("heroui-native", () => ({
  Button,
  Spinner: host("Spinner"),
  cn: (...values: string[]) => values.join(" "),
}));
mock.module("lucide-react-native", () =>
  Object.fromEntries(
    [
      "Apple",
      "Bookmark",
      "ChevronLeft",
      "ChevronRight",
      "CircleCheck",
      "CloudOff",
      "Coffee",
      "Copy",
      "Pencil",
      "Plus",
      "RefreshCw",
      "Sandwich",
      "ScanBarcode",
      "Search",
      "SlidersHorizontal",
      "Soup",
      "Square",
      "SquareCheck",
      "Star",
      "Trash2",
      "TriangleAlert",
      "Utensils",
      "UtensilsCrossed",
      "Zap",
    ].map((name) => [name, host(name)]),
  ),
);
mock.module("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey?: unknown[] }) => ({
    data:
      options?.queryKey?.[0] === "search"
        ? { results: [] }
        : options?.queryKey?.[0] === "targets"
          ? { settings: { hideNumbers: false }, targetsOn: { targets: [] } }
          : undefined,
    isPending: false,
    isError: false,
    isSuccess: options?.queryKey?.[0] === "targets",
    refetch: noop,
  }),
  useMutation: () => ({ mutate: (input: unknown) => favoriteCalls.push(input) }),
  useQueryClient: () => ({ invalidateQueries: noop }),
}));
mock.module("@/components/barcode-scanner", () => ({ BarcodeScanner: host("BarcodeScanner") }));
mock.module("@/components/food-logger-capture", () => ({
  FoodLoggerCapture: host("FoodLoggerCapture"),
}));
mock.module("@/components/nutrition-date-picker", () => ({
  NutritionDatePicker: host("NutritionDatePicker"),
}));
mock.module("@/components/nutrition-entry-editor", () => ({
  NutritionEntryEditor: (props: Record<string, unknown>) => {
    editorProps = props;
    return React.createElement(
      "Editor",
      null,
      React.createElement("TextInput", {
        accessibilityLabel: "Editor amount",
        value: props.amount,
        onChangeText: props.onAmount,
      }),
      React.createElement(
        "Button",
        { onPress: () => (props.onSlot as (slot: string) => void)("lunch") },
        "Set lunch",
      ),
      React.createElement("Button", { onPress: props.onSave as () => void }, "Save editor"),
      React.createElement("Button", { onPress: props.onFavorite as () => void }, "Favorite editor"),
      React.createElement("Button", { onPress: props.onDelete as () => void }, "Delete editor"),
    );
  },
}));
mock.module("@/components/nutrition-meal-actions", () => ({
  NutritionMealActions: host("NutritionMealActions"),
}));
mock.module("@/components/nutrition-template-panel", () => ({
  NutritionTemplatePanel: host("NutritionTemplatePanel"),
}));
mock.module("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
mock.module("@/components/bloom", () => ({
  Details: host("Details"),
  ErrorState: host("ErrorState"),
  Icon,
  InfoTip: host("InfoTip"),
  Page: host("Page"),
  PageHeader: host("PageHeader"),
  Prose: host("Prose"),
  Section: host("Section"),
  Sheet: host("Sheet"),
  StatusPill: host("StatusPill"),
  ToneChip: host("ToneChip"),
  ToneIcon: host("ToneIcon"),
}));
mock.module("@/components/container", () => ({ Container: host("Container") }));
mock.module("@/components/logging-streak-card", () => ({
  LoggingStreakCard: host("LoggingStreakCard"),
}));
mock.module("@/components/nutrition-day-totals", () => ({
  NutritionDayTotals: host("NutritionDayTotals"),
}));
mock.module("@/components/plain-water-section", () => ({
  PlainWaterSection: host("PlainWaterSection"),
}));
mock.module("@/components/module-hidden-note", () => ({
  ModuleHiddenNote: host("ModuleHiddenNote"),
}));
mock.module("@/lib/nutrition/barcode", () => ({
  barcodeCacheKey: (value: string) => value,
  resolveBarcode: noop,
}));
mock.module("@/lib/nutrition/outbox", () => ({
  mergeDay: () => renderRows,
  cachedCopyDayInput: () => ({ op: {} }),
}));
mock.module("@/lib/nutrition/sync", () => ({
  DIARY_CACHE_PREFIX: "diary:",
  useDiaryOutbox: () => diaryOutbox,
}));
mock.module("@/lib/offline/cache", () => ({ readCache: () => null, writeCache: noop }));
mock.module("@/lib/offline/sync", () => ({
  isOfflineWriteTicketCurrent: () => true,
  useOfflineWriteSessionKey: () => offlineSessionKey,
  useCacheFirst: (key: string) => ({
    data: key.startsWith("diary:day:") ? { entries: diaryEntries } : cachedReads[key],
    isPending: false,
    isError: false,
    refetch: noop,
  }),
}));
mock.module("@/utils/friendly", () => ({ friendlyDate: (_i18n: unknown, date: string) => date }));
mock.module("@/utils/theme", () => ({ useThemeColor: () => "#000000" }));
mock.module("@/utils/orpc", () => ({
  client: { nutritionDiary: { createFood: () => createResult } },
  orpc: {
    nutritionFoods: { search: { queryOptions: () => ({ queryKey: ["search"] }) } },
    nutritionDiary: {
      getDay: { queryOptions: () => ({ queryKey: ["day"] }) },
      listFoods: { queryOptions: () => ({ queryKey: ["foods"] }), key: () => ["foods"] },
      setFavorite: { mutationOptions: () => ({}) },
    },
    nutritionTargets: {
      get: { queryOptions: () => ({ queryKey: ["targets"] }) },
      loggingStreak: { queryOptions: () => ({ queryKey: ["streak"] }) },
    },
  },
}));

const candidateFood = {
  ref: { kind: "custom" as const, foodId: 11 },
  source: "custom" as const,
  sourceQualifiedId: null,
  attribution: null,
  name: "Oats",
  brand: null,
  basis: {
    nutrientBasisAmount: 100,
    nutrientBasisUnit: "g" as const,
    servingSizeAmount: null,
    servingSizeUnit: null,
    servingLabel: null,
  },
  nutrientsPerBasis: Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, null])),
  lastLoggedAt: null,
  lastAmount: null,
  lastUnit: null,
  lastSlot: null,
};
const emptyFoods = { recents: [candidateFood], favorites: [], customFoods: [] };
const ticket = {};
const outbox = {
  scope: "person-a",
  online: true,
  items: [],
  beginWrite: () => {
    beginWriteCalls += 1;
    return ticket;
  },
  enqueueForIntent: (_ticket: unknown, payload: unknown) => {
    captured.enqueues += 1;
    captured.payloads.push(payload);
    return true;
  },
  deleteEntry: (writeTicket: unknown, ref: unknown) => {
    deletionTickets.push(writeTicket);
    deletionCalls.push(ref);
    return { id: "undo", action: "queued" };
  },
  updateEntry: (_ticket: unknown, _ref: unknown, input: unknown) => {
    updateCalls.push(input);
    return { id: "update", action: "queued" };
  },
};
const props = (
  onClose: () => void,
  hideNumbers = false,
  contextKey = "person-a\u001fsession-1\u001f2026-10-27\u001fUTC",
) => ({
  initialQuery: "",
  contextKey,
  localDate: "2026-10-27",
  timeZone: "UTC",
  foods: emptyFoods,
  outbox,
  hideNumbers,
  initialMeal: "dinner" as const,
  onClose,
});

function findText(
  node: import("../../../../packages/ui/node_modules/react-test-renderer").ReactTestInstance,
): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : findText(child)))
    .join("");
}

function findButton(
  root: import("../../../../packages/ui/node_modules/react-test-renderer").ReactTestRenderer,
  label: string,
) {
  return root.root.findAllByType("Button").find((button) => findText(button).includes(label))!;
}

function currentEditorProps() {
  if (!editorProps) throw new Error("The production diary editor has not rendered");
  return editorProps;
}

async function render(hideNumbers = false, contextKey?: string) {
  captured = { announces: [], closes: 0, enqueues: 0, payloads: [] };
  deletionCalls = [];
  updateCalls = [];
  cachedReads = {};
  renderRows = [];
  diaryEntries = [];
  const react = await import("../../../../packages/ui/node_modules/react");
  React = react as typeof React;
  mock.module("react", () => React);
  TestRenderer =
    (await import("../../../../packages/ui/node_modules/react-test-renderer")) as typeof TestRenderer;
  const { I18nProvider } = await import("@lingui/react");
  const { englishI18n } = await import("@openvalens/i18n/testing");
  ({ AddFood, default: NutritionScreen } = await import("../../app/(drawer)/(tabs)/nutrition"));
  let root!: import("../../../../packages/ui/node_modules/react-test-renderer").ReactTestRenderer;
  await TestRenderer.act(async () => {
    root = TestRenderer.create(
      React.createElement(
        I18nProvider,
        { i18n: englishI18n },
        React.createElement(
          AddFood,
          props(() => (captured.closes += 1), hideNumbers, contextKey),
        ),
      ),
    );
  });
  return root;
}

async function renderDiary() {
  captured = { announces: [], closes: 0, enqueues: 0, payloads: [] };
  deletionCalls = [];
  deletionTickets = [];
  updateCalls = [];
  favoriteCalls = [];
  beginWriteCalls = 0;
  editorProps = null;
  const react = await import("../../../../packages/ui/node_modules/react");
  React = react as typeof React;
  mock.module("react", () => React);
  TestRenderer =
    (await import("../../../../packages/ui/node_modules/react-test-renderer")) as typeof TestRenderer;
  const { I18nProvider } = await import("@lingui/react");
  const { englishI18n } = await import("@openvalens/i18n/testing");
  let root!: import("../../../../packages/ui/node_modules/react-test-renderer").ReactTestRenderer;
  const element = () =>
    React.createElement(I18nProvider, { i18n: englishI18n }, React.createElement(NutritionScreen));
  await TestRenderer.act(async () => {
    root = TestRenderer.create(element());
  });
  return { root, element };
}

function deferred() {
  createResult = new Promise((resolve, reject) => {
    resolveCreate = resolve;
    rejectCreate = reject;
  });
}

function diaryEntry(id = 7, name = "Oats") {
  const nutrientsPerBasis = Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, null])) as Record<
    (typeof NUTRIENT_KEYS)[number],
    number | null
  >;
  nutrientsPerBasis.energyKcal = 200;
  nutrientsPerBasis.proteinG = 10;
  return {
    id,
    localDate: "2026-10-27",
    timeZone: "UTC",
    slot: "dinner" as const,
    amount: 100,
    unit: "g" as const,
    method: "manual" as const,
    clientMutationId: null,
    revision: 2,
    deleted: false,
    createdAt: "",
    updatedAt: "",
    food: {
      snapshotId: id + 100,
      source: "manual" as const,
      sourceQualifiedId: null,
      sourceVersion: null,
      attribution: null,
      name,
      brand: null,
      basis: {
        nutrientBasisAmount: 100,
        nutrientBasisUnit: "g" as const,
        servingSizeAmount: 50,
        servingSizeUnit: "g" as const,
        servingLabel: "half cup",
      },
      nutrientsPerBasis,
    },
    nutrients: nutrientsPerBasis,
  };
}

describe("production AddFood component", () => {
  test("masks amount and quick-add numeric fields without changing hidden drafts", async () => {
    const root = await render(true);
    const amount = root.root
      .findAllByType("TextInput")
      .find((field) => field.props.accessibilityLabel === "Amount");
    expect(amount?.props.value).toBe("");
    expect(amount?.props.editable).toBe(false);
    await TestRenderer.act(async () => amount?.props.onChangeText("999"));
    expect(amount?.props.value).toBe("");
    await TestRenderer.act(async () => amount?.props.onChangeText("1"));
    await TestRenderer.act(async () => amount?.props.onChangeText("12"));
    expect(amount?.props.value).toBe("");
    const quickChip = root.root
      .findAllByType("Pressable")
      .find((button) => findText(button).includes("Quick add"));
    await TestRenderer.act(async () => quickChip?.props.onPress());
    const basis = root.root
      .findAllByType("TextInput")
      .find((field) => field.props.accessibilityLabel === "Values per amount");
    expect(basis?.props.value).toBe("");
    expect(basis?.props.editable).toBe(false);
    await TestRenderer.act(async () => basis?.props.onChangeText("999"));
    await TestRenderer.act(async () => basis?.props.onChangeText("1"));
    await TestRenderer.act(async () => basis?.props.onChangeText("12"));
    expect(basis?.props.value).toBe("");
    expect(
      root.root
        .findAllByType("TextInput")
        .filter((field) => field.props.keyboardType === "numeric")
        .every((field) => field.props.value === ""),
    ).toBe(true);
    expect(amount?.props.placeholder).toBe("Hidden");
  });

  test("selected candidate keeps its intended default amount in the enqueue payload", async () => {
    const root = await render();
    const candidate = root.root
      .findAllByType("Pressable")
      .find((button) => findText(button).includes("Oats"));
    await TestRenderer.act(async () => candidate?.props.onPress());
    await TestRenderer.act(async () => findButton(root, "Save to").props.onPress());
    expect((captured.payloads[0] as { op: { input: { amount: number } } }).op.input.amount).toBe(
      100,
    );
  });

  test("Cancel during deferred create warns honestly and late success cannot enqueue", async () => {
    deferred();
    const root = await render();
    const quickChip = root.root
      .findAllByType("Pressable")
      .find((button) => findText(button).includes("Quick add"));
    await TestRenderer.act(async () => quickChip?.props.onPress());
    const name = root.root
      .findAllByType("TextInput")
      .find((field) => field.props.accessibilityLabel === "Food name");
    await TestRenderer.act(async () => name?.props.onChangeText("Oats"));
    const saveAsFood = root.root
      .findAllByType("Pressable")
      .find((button) => button.props.accessibilityRole === "checkbox");
    await TestRenderer.act(async () => saveAsFood?.props.onPress());
    let pendingSave!: Promise<void>;
    TestRenderer.act(() => {
      pendingSave = findButton(root, "Save to").props.onPress() as Promise<void>;
    });
    await TestRenderer.act(async () => findButton(root, "Cancel").props.onPress());
    expect(captured.announces).toContain(
      "Save cancelled. A food creation already sent may still complete.",
    );
    await TestRenderer.act(async () => {
      resolveCreate({ ref: { kind: "custom", food: { id: "food-1" } } });
      await pendingSave;
    });
    expect(captured.enqueues).toBe(0);
    expect(captured.announces).toHaveLength(1);
  }, 30_000);

  test("navigation unmount during deferred creation invalidates and announces once", async () => {
    deferred();
    const root = await render();
    const quickChip = root.root
      .findAllByType("Pressable")
      .find((button) => findText(button).includes("Quick add"));
    await TestRenderer.act(async () => quickChip?.props.onPress());
    const name = root.root
      .findAllByType("TextInput")
      .find((field) => field.props.accessibilityLabel === "Food name");
    await TestRenderer.act(async () => name?.props.onChangeText("Oats"));
    const saveAsFood = root.root
      .findAllByType("Pressable")
      .find((button) => button.props.accessibilityRole === "checkbox");
    await TestRenderer.act(async () => saveAsFood?.props.onPress());
    let pendingSave!: Promise<void>;
    TestRenderer.act(() => {
      pendingSave = findButton(root, "Save to").props.onPress() as Promise<void>;
    });
    await TestRenderer.act(async () => root.unmount());
    expect(captured.announces).toEqual([
      "Save cancelled. A food creation already sent may still complete.",
    ]);
    await TestRenderer.act(async () => {
      resolveCreate({ ref: { kind: "custom", food: { id: "food-1" } } });
      await pendingSave;
    });
    expect(captured.enqueues).toBe(0);
    expect(captured.announces).toHaveLength(1);
  }, 30_000);

  test("successful save closes without a cancellation announcement", async () => {
    createResult = Promise.resolve({ ref: { kind: "custom", food: { id: "food-1" } } });
    const root = await render();
    const quickChip = root.root
      .findAllByType("Pressable")
      .find((button) => findText(button).includes("Quick add"));
    await TestRenderer.act(async () => quickChip?.props.onPress());
    const name = root.root
      .findAllByType("TextInput")
      .find((field) => field.props.accessibilityLabel === "Food name");
    await TestRenderer.act(async () => name?.props.onChangeText("Oats"));
    await TestRenderer.act(async () => findButton(root, "Save to").props.onPress());
    expect(captured.enqueues).toBe(1);
    expect((captured.payloads[0] as { op: { input: { amount: number } } }).op.input.amount).toBe(
      100,
    );
    expect(captured.announces.some((message) => message === "Nothing saved")).toBe(false);
  }, 30_000);

  test("owner/date context change retires captured Save and Change handlers", async () => {
    const root = await render(false, "person-a\u001fsession-1\u001f2026-10-27\u001fUTC");
    const food = root.root
      .findAllByType("Pressable")
      .find((button) => findText(button).includes("Oats"));
    await TestRenderer.act(async () => food?.props.onPress());
    const staleChange = findButton(root, "Change").props.onPress as () => void;
    const staleSave = findButton(root, "Save to").props.onPress as () => void;
    await TestRenderer.act(async () => {
      root.update(
        React.createElement(
          (await import("@lingui/react")).I18nProvider,
          { i18n: (await import("@openvalens/i18n/testing")).englishI18n },
          React.createElement(
            AddFood,
            props(
              () => (captured.closes += 1),
              false,
              "person-b\u001fsession-2\u001f2026-10-28\u001fUTC",
            ),
          ),
        ),
      );
    });
    await TestRenderer.act(async () => {
      staleChange();
      staleSave();
    });
    expect(captured.enqueues).toBe(0);
    expect(
      root.root.findAllByType("Button").some((button) => findText(button).includes("Change")),
    ).toBe(true);
  }, 30_000);

  test("keyed logger resets selection for owner, session, and date changes", async () => {
    const initial = "person-a\u001fsession-1\u001f2026-10-27\u001fUTC";
    const changes = [
      "person-b\u001fsession-1\u001f2026-10-27\u001fUTC",
      "person-a\u001fsession-2\u001f2026-10-27\u001fUTC",
      "person-a\u001fsession-1\u001f2026-10-28\u001fUTC",
    ];
    const { I18nProvider } = await import("@lingui/react");
    const { englishI18n } = await import("@openvalens/i18n/testing");
    const root = await render();
    const rerender = (key: string) =>
      React.createElement(
        I18nProvider,
        { i18n: englishI18n },
        React.createElement(AddFood, { ...props(() => undefined, false, key), key }),
      );
    await TestRenderer.act(async () => root.update(rerender(initial)));
    const candidate = root.root
      .findAllByType("Pressable")
      .find((button) => findText(button).includes("Oats"));
    await TestRenderer.act(async () => candidate?.props.onPress());
    expect(
      root.root.findAllByType("Button").some((button) => findText(button).includes("Change")),
    ).toBe(true);
    for (const key of changes) {
      await TestRenderer.act(async () => root.update(rerender(key)));
      const freshSave = findButton(root, "Save to").props.onPress as () => void;
      await TestRenderer.act(async () => freshSave());
      expect(captured.enqueues).toBe(0);
      expect(
        root.root.findAllByType("Button").some((button) => findText(button).includes("Change")),
      ).toBe(false);
    }
    const routeSource = readFileSync(`${import.meta.dir}/../../app/log-food.tsx`, "utf8");
    expect(routeSource).toMatch(
      /key=\{`\$\{outbox\.scope\}.*\$\{sessionKey \?\? "signed-out"\}.*\$\{localDate\}.*\$\{timeZone\}`\}/s,
    );
  }, 30_000);

  test("diary consumes and routes repeated food drafts on the same mounted screen", async () => {
    diaryOutbox = {
      scope: "person-a",
      online: true,
      items: [],
      counts: { queued: 0, syncing: 0, needs_attention: 0 },
    };
    routeCalls.pushes.length = 0;
    routeCalls.setParams.length = 0;
    routeParams = { food: "Oats" };
    const { root, element } = await renderDiary();
    expect(routeCalls.pushes).toHaveLength(1);
    expect(routeCalls.setParams).toEqual([{ food: undefined }]);
    await TestRenderer.act(async () => {
      routeParams = {};
      root.update(element());
    });
    expect(routeCalls.pushes).toHaveLength(1);
    await TestRenderer.act(async () => {
      routeParams = { food: "Oats" };
      root.update(element());
    });
    expect(routeCalls.pushes).toHaveLength(2);
    await TestRenderer.act(async () => root.update(element()));
    expect(routeCalls.pushes).toHaveLength(2);
    await TestRenderer.act(async () => {
      routeParams = {};
      root.update(element());
    });
    await TestRenderer.act(async () => {
      routeParams = { food: "Rice" };
      root.update(element());
    });
    expect(routeCalls.pushes).toHaveLength(3);
    expect(routeCalls.pushes[2]).toMatchObject({ params: { food: "Rice" } });
  }, 30_000);

  test("reopened logger rejects retired Save and late create error", async () => {
    deferred();
    const oldRoot = await render();
    const quickChip = oldRoot.root
      .findAllByType("Pressable")
      .find((button) => findText(button).includes("Quick add"));
    await TestRenderer.act(async () => quickChip?.props.onPress());
    const name = oldRoot.root
      .findAllByType("TextInput")
      .find((field) => field.props.accessibilityLabel === "Food name");
    await TestRenderer.act(async () => name?.props.onChangeText("Oats"));
    const saveAsFood = oldRoot.root
      .findAllByType("Pressable")
      .find((button) => button.props.accessibilityRole === "checkbox");
    await TestRenderer.act(async () => saveAsFood?.props.onPress());
    const staleSave = findButton(oldRoot, "Save to").props.onPress as () => Promise<void>;
    let oldSave!: Promise<void>;
    TestRenderer.act(() => {
      oldSave = staleSave();
    });
    const oldCapture = captured;
    await TestRenderer.act(async () => oldRoot.unmount());

    const newRoot = await render(false, "person-a\u001fsession-1\u001f2026-10-28\u001fUTC");
    await TestRenderer.act(async () => {
      staleSave();
    });
    await TestRenderer.act(async () => {
      rejectCreate(new Error("late failure"));
      await oldSave;
    });
    expect(oldCapture.announces).toEqual([
      "Save cancelled. A food creation already sent may still complete.",
    ]);
    expect(captured.enqueues).toBe(0);
    expect(captured.announces).toEqual([]);
    expect(newRoot.root.findAllByType("TextInput").length).toBeGreaterThan(0);
  }, 30_000);

  test("saved-food quick log uses the selected meal and default portion, then undoes its exact pending row", async () => {
    const root = await render();
    const quick = root.root
      .findAllByType("Pressable")
      .find((button) => button.props.accessibilityLabel === "Add Oats to Dinner");
    expect(quick).toBeDefined();
    await TestRenderer.act(async () => quick?.props.onPress());
    expect(captured.enqueues).toBe(1);
    expect(captured.payloads[0]).toMatchObject({
      op: { input: { slot: "dinner", amount: 100, unit: "g" } },
    });
    const undo = findButton(root, "Undo");
    await TestRenderer.act(async () => undo.props.onPress());
    expect(deletionCalls).toEqual([{ kind: "pending", mutationId: expect.any(String) }]);
  }, 30_000);

  test("production entry editor sends changed amount, unit and meal through update callback", async () => {
    const entry = {
      id: 7,
      localDate: "2026-10-27",
      timeZone: "UTC",
      slot: "dinner",
      amount: 100,
      unit: "g",
      method: "manual",
      clientMutationId: null,
      revision: 2,
      deleted: false,
      createdAt: "",
      updatedAt: "",
      food: {
        snapshotId: 3,
        source: "manual",
        sourceQualifiedId: null,
        sourceVersion: null,
        attribution: null,
        name: "Oats",
        brand: null,
        basis: {
          nutrientBasisAmount: 100,
          nutrientBasisUnit: "g",
          servingSizeAmount: null,
          servingSizeUnit: null,
          servingLabel: null,
        },
        nutrientsPerBasis: Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, null])),
      },
      nutrients: Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, null])),
    };
    renderRows = [{ kind: "server", key: "7", entry, sync: "synced", pendingKind: null }];
    diaryEntries = [entry];
    diaryOutbox = { ...outbox, counts: { queued: 0, syncing: 0, needs_attention: 0 }, items: [] };
    const { root } = await renderDiary();
    const edit = root.root
      .findAllByType("Button")
      .find((button) => button.props.accessibilityLabel === "Edit Oats");
    await TestRenderer.act(async () => edit?.props.onPress());
    const amount = root.root
      .findAllByType("TextInput")
      .find((input) => input.props.accessibilityLabel === "Editor amount");
    await TestRenderer.act(async () => amount?.props.onChangeText("125"));
    await TestRenderer.act(async () => findButton(root, "Set lunch").props.onPress());
    await TestRenderer.act(async () => findButton(root, "Save editor").props.onPress());
    expect(updateCalls[0]).toMatchObject({
      amount: 125,
      unit: "g",
      slot: "lunch",
      localDate: "2026-10-27",
      timeZone: "UTC",
    });
  }, 30_000);

  test("queued copy/template rows and moved projections render in production meal grouping and delete by ref", async () => {
    const copyRef = { kind: "pending", mutationId: "copy-op", itemKey: "copy-child" };
    const templateRef = { kind: "pending", mutationId: "template-op", itemKey: "template-child" };
    const movedRef = { kind: "server", entryId: 44, revision: 3 };
    const preview = { name: "Copied oats", source: "manual", nutrients: diaryEntry().nutrients };
    const localRow = (
      key: string,
      name: string,
      slot: string,
      ref: unknown,
      op: string,
      entry?: unknown,
    ) => ({
      kind: "local",
      key,
      change: {
        id: key,
        op: { kind: op, input: {} },
        status: "queued",
        preview: { ...preview, name },
      },
      sync: "queued",
      localEntry: {
        amount: 1,
        unit: "serving",
        slot,
        localDate: "2026-10-27",
        ref,
        ...(entry ? { entry } : {}),
      },
    });
    renderRows = [
      localRow("copy:child", "Copied oats", "breakfast", copyRef, "copyDay"),
      localRow("template:child", "Template soup", "lunch", templateRef, "logTemplate"),
      localRow("move:44", "Moved rice", "dinner", movedRef, "update", diaryEntry(44, "Moved rice")),
    ];
    diaryEntries = [];
    diaryOutbox = { ...outbox, counts: { queued: 3, syncing: 0, needs_attention: 0 }, items: [] };
    const { root } = await renderDiary();

    const rendered = findText(root.root);
    expect(rendered).toContain("Copied oats");
    expect(rendered).toContain("Template soup");
    expect(rendered).toContain("Moved rice");
    for (const name of ["Copied oats", "Template soup", "Moved rice"]) {
      const remove = root.root
        .findAllByType("Button")
        .find((button) => button.props.accessibilityLabel === `Delete ${name}`);
      expect(remove).toBeDefined();
      await TestRenderer.act(async () => remove?.props.onPress());
    }
    expect(deletionCalls).toEqual([copyRef, templateRef, movedRef]);
    expect(deletionTickets).toEqual([ticket, ticket, ticket]);
  }, 30_000);

  test("retained editor Save and Favorite expire on diary date change; a reopened editor remains live", async () => {
    const entry = diaryEntry();
    renderRows = [{ kind: "server", key: "7", entry, sync: "synced", pendingKind: null }];
    diaryEntries = [entry];
    diaryOutbox = {
      ...outbox,
      scope: "person-a",
      counts: { queued: 0, syncing: 0, needs_attention: 0 },
      items: [],
    };
    const { root } = await renderDiary();
    const edit = root.root
      .findAllByType("Button")
      .find((button) => button.props.accessibilityLabel === "Edit Oats");
    await TestRenderer.act(async () => edit?.props.onPress());
    const staleSave = currentEditorProps().onSave as () => void;
    const staleFavorite = currentEditorProps().onFavorite as () => void;
    expect(staleSave).toBeFunction();
    expect(staleFavorite).toBeFunction();

    const nextDate = root.root
      .findAllByType("Button")
      .find((button) => button.props.accessibilityLabel === "Next");
    await TestRenderer.act(async () => nextDate?.props.onPress());
    await TestRenderer.act(async () => {
      staleSave();
      staleFavorite();
    });
    expect(updateCalls).toHaveLength(0);
    expect(favoriteCalls).toHaveLength(0);

    const reopen = root.root
      .findAllByType("Button")
      .find((button) => button.props.accessibilityLabel === "Edit Oats");
    await TestRenderer.act(async () => reopen?.props.onPress());
    await TestRenderer.act(async () => (currentEditorProps().onSave as () => void)());
    expect(updateCalls).toHaveLength(1);
  }, 30_000);

  test("retained editor callbacks expire on outbox scope change", async () => {
    const entry = diaryEntry();
    renderRows = [{ kind: "server", key: "7", entry, sync: "synced", pendingKind: null }];
    diaryEntries = [entry];
    diaryOutbox = {
      ...outbox,
      scope: "person-a",
      counts: { queued: 0, syncing: 0, needs_attention: 0 },
      items: [],
    };
    const { root, element } = await renderDiary();
    const edit = root.root
      .findAllByType("Button")
      .find((button) => button.props.accessibilityLabel === "Edit Oats");
    await TestRenderer.act(async () => edit?.props.onPress());
    const staleSave = currentEditorProps().onSave as () => void;
    const staleFavorite = currentEditorProps().onFavorite as () => void;
    diaryOutbox = { ...diaryOutbox, scope: "person-b" };
    await TestRenderer.act(async () => root.update(element()));
    await TestRenderer.act(async () => {
      staleSave();
      staleFavorite();
    });
    expect(updateCalls).toHaveLength(0);
    expect(favoriteCalls).toHaveLength(0);
  }, 30_000);

  test("same mounted row rejects retained callbacks across same-scope session swap before ticket creation", async () => {
    const entry = diaryEntry();
    const sameRow = { kind: "server", key: "7", entry, sync: "synced", pendingKind: null };
    renderRows = [sameRow];
    diaryEntries = [entry];
    offlineSessionKey = "session-A";
    diaryOutbox = {
      ...outbox,
      scope: "person-a",
      counts: { queued: 0, syncing: 0, needs_attention: 0 },
      items: [],
    };
    const { root, element } = await renderDiary();
    const edit = root.root
      .findAllByType("Button")
      .find((button) => button.props.accessibilityLabel === "Edit Oats");
    await TestRenderer.act(async () => edit?.props.onPress());
    const staleSave = currentEditorProps().onSave as () => void;
    const staleFavorite = currentEditorProps().onFavorite as () => void;
    const staleDelete = currentEditorProps().onDelete as () => void;

    offlineSessionKey = "session-B";
    await TestRenderer.act(async () => root.update(element()));
    expect(renderRows[0]).toBe(sameRow);
    await TestRenderer.act(async () => {
      staleSave();
      staleFavorite();
      staleDelete();
    });
    expect(beginWriteCalls).toBe(0);
    expect(captured.enqueues).toBe(0);
    expect(updateCalls).toHaveLength(0);
    expect(favoriteCalls).toHaveLength(0);

    const freshEdit = root.root
      .findAllByType("Button")
      .find((button) => button.props.accessibilityLabel === "Edit Oats");
    await TestRenderer.act(async () => freshEdit?.props.onPress());
    const freshFavorite = currentEditorProps().onFavorite as () => void;
    const freshSave = currentEditorProps().onSave as () => void;
    await TestRenderer.act(async () => freshFavorite());
    await TestRenderer.act(async () => freshSave());
    expect(favoriteCalls).toHaveLength(1);
    expect(beginWriteCalls).toBe(1);
    expect(updateCalls).toHaveLength(1);

    const deleteEdit = root.root
      .findAllByType("Button")
      .find((button) => button.props.accessibilityLabel === "Edit Oats");
    await TestRenderer.act(async () => deleteEdit?.props.onPress());
    const freshDelete = currentEditorProps().onDelete as () => void;
    await TestRenderer.act(async () => freshDelete());
    expect(captured.enqueues).toBe(1);
    expect(captured.payloads[0]).toMatchObject({
      op: { kind: "delete", input: { entryId: entry.id } },
    });
  }, 30_000);

  test("unknown session cannot authorize editor Save or Favorite", async () => {
    const entry = diaryEntry();
    renderRows = [{ kind: "server", key: "7", entry, sync: "synced", pendingKind: null }];
    diaryEntries = [entry];
    offlineSessionKey = null;
    diaryOutbox = {
      ...outbox,
      scope: "person-a",
      counts: { queued: 0, syncing: 0, needs_attention: 0 },
      items: [],
    };
    const { root } = await renderDiary();
    const edit = root.root
      .findAllByType("Button")
      .find((button) => button.props.accessibilityLabel === "Edit Oats");
    await TestRenderer.act(async () => edit?.props.onPress());
    const save = currentEditorProps().onSave as () => void;
    const favorite = currentEditorProps().onFavorite as () => void;
    await TestRenderer.act(async () => {
      save();
      favorite();
    });
    expect(beginWriteCalls).toBe(0);
    expect(updateCalls).toHaveLength(0);
    expect(favoriteCalls).toHaveLength(0);
  }, 30_000);

  test("same-scope session replacement unmount retires Save and Favorite; new session callback works", async () => {
    const entry = diaryEntry();
    offlineSessionKey = "session-1";
    renderRows = [{ kind: "server", key: "7", entry, sync: "synced", pendingKind: null }];
    diaryEntries = [entry];
    diaryOutbox = {
      ...outbox,
      scope: "person-a",
      counts: { queued: 0, syncing: 0, needs_attention: 0 },
      items: [],
    };
    const { root } = await renderDiary();
    const edit = root.root
      .findAllByType("Button")
      .find((button) => button.props.accessibilityLabel === "Edit Oats");
    await TestRenderer.act(async () => edit?.props.onPress());
    const staleSave = currentEditorProps().onSave as () => void;
    const staleFavorite = currentEditorProps().onFavorite as () => void;
    const previousCounters = captured;
    await TestRenderer.act(async () => root.unmount());
    await TestRenderer.act(async () => {
      staleSave();
      staleFavorite();
    });
    expect(updateCalls).toHaveLength(0);
    expect(favoriteCalls).toHaveLength(0);
    expect(previousCounters.enqueues).toBe(0);

    const reopened = await renderDiary();
    const freshEdit = reopened.root.root
      .findAllByType("Button")
      .find((button) => button.props.accessibilityLabel === "Edit Oats");
    await TestRenderer.act(async () => freshEdit?.props.onPress());
    await TestRenderer.act(async () => (currentEditorProps().onSave as () => void)());
    expect(updateCalls).toHaveLength(1);
  }, 30_000);

  test("production editor amount and unit previews match canonical conversion including zero and unknown nutrients", async () => {
    const entry = diaryEntry();
    offlineSessionKey = "session-1";
    entry.food.nutrientsPerBasis.energyKcal = null;
    entry.food.nutrientsPerBasis.proteinG = 0;
    const nutrientCopy = { ...entry.food.nutrientsPerBasis };
    renderRows = [{ kind: "server", key: "7", entry, sync: "synced", pendingKind: null }];
    diaryEntries = [entry];
    diaryOutbox = { ...outbox, counts: { queued: 0, syncing: 0, needs_attention: 0 }, items: [] };
    const { root } = await renderDiary();
    const edit = root.root
      .findAllByType("Button")
      .find((button) => button.props.accessibilityLabel === "Edit Oats");
    await TestRenderer.act(async () => edit?.props.onPress());
    const { previewNutrients } = await import("@openvalens/api/presenters/nutrition-diary");
    const { formatNutrientSummaryLine } =
      await import("@openvalens/api/presenters/nutrition-targets");
    const { englishI18n } = await import("@openvalens/i18n/testing");
    const canonical = (amount: number, unit: "g" | "serving") => {
      const values = previewNutrients(entry.food.basis, nutrientCopy, amount, unit);
      return formatNutrientSummaryLine(
        values ?? Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, null])),
        false,
        englishI18n,
      );
    };
    await TestRenderer.act(async () => {
      (currentEditorProps().onAmount as (value: string) => void)("1");
      (currentEditorProps().onUnit as (value: string) => void)("serving");
    });
    expect(currentEditorProps().preview).toBe(canonical(1, "serving"));
    await TestRenderer.act(async () => {
      (currentEditorProps().onAmount as (value: string) => void)("100");
      (currentEditorProps().onUnit as (value: string) => void)("g");
    });
    expect(currentEditorProps().preview).toBe(canonical(100, "g"));
    await TestRenderer.act(async () =>
      (currentEditorProps().onAmount as (value: string) => void)("0"),
    );
    expect(currentEditorProps().preview).toBe(canonical(0, "g"));
    expect(previewNutrients(entry.food.basis, nutrientCopy, 0, "g")).toBeNull();
    expect(currentEditorProps().preview).not.toContain("Protein 0");
  }, 30_000);
});
