import { describe, expect, mock, test } from "bun:test";
import { nutritionTemplate } from "@openvalens/api/contracts/nutrition-templates";
import { NUTRIENT_KEYS } from "@openvalens/api/contracts/nutrition-diary";

let React: typeof import("react");
let TestRenderer: typeof import("../../../../packages/ui/node_modules/react-test-renderer");
let NutritionTemplatePanel: typeof import("../../components/nutrition-template-panel").NutritionTemplatePanel;
let NutritionRecipeImport: typeof import("../../components/nutrition-recipe-import").NutritionRecipeImport;
let managerProps: Record<string, unknown> = {};
let sessionKey = "session-a";
let currentOutbox: Record<string, unknown>;
let apiCalls: {
  create: unknown[];
  search: unknown[];
  recipeImport: unknown[];
  cacheWrites: unknown[];
  deletes: unknown[];
  enqueues: unknown[];
  announcements: string[];
};
let cacheData: Record<string, unknown> = {};
let fromUrlPromise: Promise<unknown>;
let resolveFromUrl!: (value: unknown) => void;
let templateCreate: (input: unknown) => Promise<unknown>;

const host = (name: string) => (props: Record<string, unknown>) =>
  React.createElement(name, props, props.children as React.ReactNode);
const text = (children: React.ReactNode) => React.createElement("Text", null, children);
const Button = host("Button") as unknown as {
  (props: Record<string, unknown>): React.ReactElement;
  Label: (props: { children?: React.ReactNode }) => React.ReactElement;
};
Button.Label = ({ children }) => text(children);

const logTemplate = () => {
  const nutrients = Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, null]));
  return nutritionTemplate.parse({
    id: 17,
    revision: 6,
    kind: "recipe",
    name: "Oats",
    yieldServings: 4,
    ingredients: [
      {
        food: {
          snapshotId: 3,
          source: "manual",
          sourceQualifiedId: null,
          sourceVersion: null,
          attribution: null,
          name: "Oats",
          brand: null,
          barcode: null,
          basis: {
            nutrientBasisAmount: 100,
            nutrientBasisUnit: "g",
            servingSizeAmount: null,
            servingSizeUnit: null,
            servingLabel: null,
          },
          nutrientsPerBasis: { ...nutrients, energyKcal: 200 },
        },
        amount: 80,
        unit: "g",
        nutrients: { ...nutrients, energyKcal: 200 },
      },
      {
        food: {
          snapshotId: 4,
          source: "fdc",
          sourceQualifiedId: "fdc:4",
          sourceVersion: "r1",
          attribution: null,
          name: "Milk",
          brand: null,
          barcode: null,
          basis: {
            nutrientBasisAmount: 100,
            nutrientBasisUnit: "ml",
            servingSizeAmount: null,
            servingSizeUnit: null,
            servingLabel: null,
          },
          nutrientsPerBasis: { ...nutrients, energyKcal: 50 },
        },
        amount: 120,
        unit: "ml",
        nutrients: { ...nutrients, energyKcal: 50 },
      },
      {
        food: {
          snapshotId: 5,
          source: "manual",
          sourceQualifiedId: null,
          sourceVersion: null,
          attribution: null,
          name: "Honey",
          brand: null,
          barcode: null,
          basis: {
            nutrientBasisAmount: 100,
            nutrientBasisUnit: "g",
            servingSizeAmount: null,
            servingSizeUnit: null,
            servingLabel: null,
          },
          nutrientsPerBasis: { ...nutrients, energyKcal: 300 },
        },
        amount: 10,
        unit: "g",
        nutrients: { ...nutrients, energyKcal: 300 },
      },
    ],
    summary: {
      entryCount: 0,
      totals: Object.fromEntries(
        NUTRIENT_KEYS.map((key) => [
          key,
          { known: null, reported: 0, missing: 0, coverage: "none" },
        ]),
      ),
      sources: { fdc: 0, off: 0, custom: 0, manual: 0 },
    },
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
};

mock.module("react-native", () => ({
  AccessibilityInfo: {
    announceForAccessibility: (message: string) => apiCalls.announcements.push(message),
  },
  ScrollView: host("ScrollView"),
  Text: host("Text"),
  TextInput: host("TextInput"),
  View: host("View"),
}));
mock.module("heroui-native", () => ({ Button }));
mock.module("@/components/nutrition-template-manager", () => ({
  NutritionTemplateManager: (props: Record<string, unknown>) => {
    managerProps = props;
    const [draftOwner] = React.useState(props.ownerKey);
    return React.createElement(
      "Manager",
      { ownerKey: props.ownerKey, draftOwner, importedRecipeDraft: props.importedRecipeDraft },
      React.createElement(
        Button,
        {
          onPress: () =>
            (props.onLog as (template: ReturnType<typeof logTemplate>, servings?: number) => void)(
              logTemplate(),
              2,
            ),
        },
        text("Log recipe"),
      ),
      React.createElement(
        Button,
        {
          onPress: () =>
            void (props.onSearchFoods as (query: string) => Promise<unknown[]>)("remote oats"),
        },
        text("Search foods"),
      ),
    );
  },
}));
mock.module("@/lib/nutrition/sync", () => ({
  DIARY_CACHE_PREFIX: "diary:",
  useDiaryOutbox: () => currentOutbox,
}));
mock.module("@/lib/offline/sync", () => ({
  useOfflineWriteSessionKey: () => sessionKey,
  useCacheFirst: (key: string) => ({ data: cacheData[key] }),
  isOfflineWriteTicketCurrent: (ticket: { scope?: string } | null, scope: string) =>
    !!ticket && ticket.scope === scope,
}));
mock.module("@/lib/offline/cache", () => ({
  writeCache: (...args: unknown[]) => apiCalls.cacheWrites.push(args),
}));
mock.module("@/utils/orpc", () => ({
  client: {
    nutritionTemplates: {
      create: (input: unknown) => {
        apiCalls.create.push(input);
        return templateCreate(input);
      },
      list: () => Promise.resolve({ templates: [] }),
      update: () => Promise.resolve({ outcome: "applied" }),
      archive: () => Promise.resolve({ outcome: "applied" }),
    },
    nutritionFoods: {
      search: (input: unknown) => {
        apiCalls.search.push(input);
        return Promise.resolve({ results: [] });
      },
    },
    nutritionRecipeImport: {
      fromUrl: (input: unknown) => {
        apiCalls.recipeImport.push(input);
        return fromUrlPromise;
      },
    },
  },
  queryClient: { invalidateQueries: () => Promise.resolve() },
  orpc: {
    nutritionDiary: { listFoods: { queryOptions: () => ({ queryKey: ["foods"] }) } },
    nutritionTemplates: {
      list: { queryOptions: () => ({ queryKey: ["templates"] }), queryKey: () => ["templates"] },
    },
  },
}));

function initHarness() {
  apiCalls = {
    create: [],
    search: [],
    recipeImport: [],
    cacheWrites: [],
    deletes: [],
    enqueues: [],
    announcements: [],
  };
  sessionKey = "session-a";
  fromUrlPromise = new Promise((resolve) => {
    resolveFromUrl = resolve;
  });
  templateCreate = () => Promise.resolve({ outcome: "applied" });
  currentOutbox = {
    scope: "person-a",
    online: true,
    items: [],
    beginWrite: () => ({ scope: currentOutbox.scope }),
    enqueueForIntentWithHandle: (
      ticket: { scope?: string },
      input: { batchPreviews?: unknown[] },
    ) => {
      if (ticket.scope !== currentOutbox.scope) return null;
      apiCalls.enqueues.push(input);
      const handle = { id: "template-log-1", action: "queued" };
      // Keep this render's outbox snapshot immutable and stale, as the real hook does.
      return handle;
    },
    deleteEntry: (ticket: { scope?: string }, ref: unknown, mutationId: string) => {
      if (ticket.scope !== currentOutbox.scope) return null;
      apiCalls.deletes.push({ ref, mutationId });
      return { id: "undo-1", action: "queued" };
    },
  };
  cacheData = {
    "diary:foods": { recents: [], favorites: [], customFoods: [] },
    "diary:templates": { templates: [] },
  };
  managerProps = {};
}

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
async function setup() {
  initHarness();
  React = await import("../../../../packages/ui/node_modules/react");
  mock.module("react", () => React);
  TestRenderer = await import("../../../../packages/ui/node_modules/react-test-renderer");
  const { I18nProvider } = await import("@lingui/react");
  const { englishI18n } = await import("@openvalens/i18n/testing");
  ({ NutritionTemplatePanel } = await import("../../components/nutrition-template-panel"));
  ({ NutritionRecipeImport } = await import("../../components/nutrition-recipe-import"));
  const wrap = (child: React.ReactNode) =>
    React.createElement(I18nProvider, { i18n: englishI18n }, child);
  const panelProps = (ownerKey = "person-a") => ({
    localDate: "2026-10-27",
    timeZone: "UTC",
    slot: "dinner" as const,
    hideNumbers: false,
    ownerKey,
    recipeImportEnabled: false,
  });
  const renderPanel = async (ownerKey?: string) => {
    let root!: import("../../../../packages/ui/node_modules/react-test-renderer").ReactTestRenderer;
    await TestRenderer.act(async () => {
      root = TestRenderer.create(
        wrap(React.createElement(NutritionTemplatePanel, panelProps(ownerKey))),
      );
    });
    return { root, wrap, panelProps };
  };
  const renderImport = async (props: {
    enabled: boolean;
    online: boolean;
    canMutate: () => boolean;
    hideNumbers: boolean;
    onDraft: (draft: unknown) => void;
  }) => {
    let root!: import("../../../../packages/ui/node_modules/react-test-renderer").ReactTestRenderer;
    await TestRenderer.act(async () => {
      root = TestRenderer.create(wrap(React.createElement(NutritionRecipeImport, props)));
    });
    return { root, wrap };
  };
  return { renderPanel, renderImport, wrap, panelProps };
}

describe("production nutrition template panel", () => {
  test("recipe logging freezes revision and preview children; undo deletes every child ref", async () => {
    const { renderPanel } = await setup();
    const { root } = await renderPanel();
    await TestRenderer.act(async () => findButton(root, "Log recipe").props.onPress());
    expect(apiCalls.enqueues[0]).toMatchObject({
      op: {
        kind: "logTemplate",
        input: {
          templateId: 17,
          templateRevision: 6,
          servings: 2,
          slot: "dinner",
          localDate: "2026-10-27",
        },
      },
      batchPreviews: [
        {
          itemKey: "template-17-6-0",
          amount: 40,
          unit: "g",
          preview: { name: "Oats", nutrients: { energyKcal: 100 } },
        },
        {
          itemKey: "template-17-6-1",
          amount: 60,
          unit: "ml",
          preview: { name: "Milk", nutrients: { energyKcal: 25 } },
        },
        {
          itemKey: "template-17-6-2",
          amount: 5,
          unit: "g",
          preview: { name: "Honey", nutrients: { energyKcal: 150 } },
        },
      ],
    });
    expect(
      root.root.findAllByType("Button").some((button) => findText(button).includes("Undo")),
    ).toBe(true);
    await TestRenderer.act(async () => findButton(root, "Undo").props.onPress());
    expect(apiCalls.deletes.map((call) => call.ref)).toEqual([
      { kind: "pending", mutationId: "template-log-1", itemKey: "template-17-6-0" },
      { kind: "pending", mutationId: "template-log-1", itemKey: "template-17-6-1" },
      { kind: "pending", mutationId: "template-log-1", itemKey: "template-17-6-2" },
    ]);
    const undoMutationIds = apiCalls.deletes.map((call) => call.mutationId);
    expect(new Set(undoMutationIds).size).toBe(3);
    expect(undoMutationIds.every((id) => id.startsWith("undo-template-"))).toBe(true);
  });

  test("owner and session changes reject retained manager callbacks before network or enqueue", async () => {
    const { renderPanel, wrap, panelProps } = await setup();
    const { root } = await renderPanel();
    const previousOwner = root.root.findByType("Manager").props.draftOwner;
    const stale = { ...managerProps };
    currentOutbox = { ...currentOutbox, scope: "person-b" };
    sessionKey = "session-b";
    await TestRenderer.act(async () =>
      root.update(wrap(React.createElement(NutritionTemplatePanel, panelProps("person-b")))),
    );
    const recipe = logTemplate();
    (stale.onLog as (template: typeof recipe, servings?: number) => void)(recipe, 2);
    await expect(
      (stale.onSearchFoods as (query: string) => Promise<unknown[]>)("oats"),
    ).resolves.toEqual([]);
    await expect(
      (stale.onCreate as (input: unknown) => Promise<unknown>)({
        clientMutationId: "old",
        content: {},
      }),
    ).rejects.toThrow("Template owner is no longer current");
    expect(apiCalls.enqueues).toHaveLength(0);
    expect(apiCalls.search).toHaveLength(0);
    expect(apiCalls.create).toHaveLength(0);
    expect(root.root.findByType("Manager").props.ownerKey).toContain("person-b");
    expect(root.root.findByType("Manager").props.draftOwner).not.toBe(previousOwner);
    expect(managerProps.importedRecipeDraft).toBeNull();
  });

  test("an in-flight old-owner create cannot refresh or write into replacement cache", async () => {
    let resolveCreate!: (value: unknown) => void;
    apiCalls.create = [];
    const { renderPanel, wrap, panelProps } = await setup();
    const { root } = await renderPanel();
    const staleCreate = managerProps.onCreate as (input: unknown) => Promise<unknown>;
    // Swap the service implementation after the real panel callback is captured.
    const pending = new Promise((resolve) => {
      resolveCreate = resolve;
    });
    templateCreate = () => pending;
    const result = staleCreate({ clientMutationId: "valid-old", content: {} });
    expect(apiCalls.create).toHaveLength(1);
    currentOutbox = { ...currentOutbox, scope: "person-b" };
    await TestRenderer.act(async () =>
      root.update(wrap(React.createElement(NutritionTemplatePanel, panelProps("person-b")))),
    );
    resolveCreate({ outcome: "applied" });
    await result;
    expect(apiCalls.cacheWrites).toHaveLength(0);
    expect(apiCalls.announcements).toHaveLength(0);
    templateCreate = () => Promise.resolve({ outcome: "applied" });
  });
});

describe("production recipe import consent and handoff", () => {
  test("disabled opt-in and changed mutation authority refuse retained URL handlers before request", async () => {
    const { renderImport, wrap } = await setup();
    let allowed = true;
    const { root } = await renderImport({
      enabled: true,
      online: true,
      canMutate: () => allowed,
      hideNumbers: false,
      onDraft: () => undefined,
    });
    await TestRenderer.act(async () => findButton(root, "Import a recipe").props.onPress());
    const url = root.root
      .findAllByType("TextInput")
      .find((field) => field.props.keyboardType === "url")!;
    await TestRenderer.act(async () => url.props.onChangeText("https://example.test/recipe"));
    const staleRequest = findButton(root, "Importing").props.onPress as () => void;
    allowed = false;
    await TestRenderer.act(async () =>
      root.update(
        wrap(
          React.createElement(NutritionRecipeImport, {
            enabled: true,
            online: true,
            canMutate: () => allowed,
            hideNumbers: false,
            onDraft: () => undefined,
          }),
        ),
      ),
    );
    await TestRenderer.act(async () => staleRequest());
    expect(apiCalls.recipeImport).toHaveLength(0);
    allowed = true;
    await TestRenderer.act(async () =>
      root.update(
        wrap(
          React.createElement(NutritionRecipeImport, {
            enabled: true,
            online: true,
            canMutate: () => allowed,
            hideNumbers: false,
            onDraft: () => undefined,
          }),
        ),
      ),
    );
    const enabledUrl = root.root
      .findAllByType("TextInput")
      .find((field) => field.props.keyboardType === "url")!;
    await TestRenderer.act(async () =>
      enabledUrl.props.onChangeText("https://example.test/recipe"),
    );
    const disabledByOptIn = findButton(root, "Importing").props.onPress as () => void;
    await TestRenderer.act(async () =>
      root.update(
        wrap(
          React.createElement(NutritionRecipeImport, {
            enabled: false,
            online: true,
            canMutate: () => true,
            hideNumbers: false,
            onDraft: () => undefined,
          }),
        ),
      ),
    );
    await TestRenderer.act(async () => disabledByOptIn());
    expect(apiCalls.recipeImport).toHaveLength(0);
    const { root: disabledRoot } = await renderImport({
      enabled: false,
      online: true,
      canMutate: () => true,
      hideNumbers: false,
      onDraft: () => undefined,
    });
    expect(disabledRoot.toJSON()).toBeNull();
  });

  test("pasted candidates require explicit review and hide serving quantities", async () => {
    const { renderImport } = await setup();
    const received: unknown[] = [];
    const { root } = await renderImport({
      enabled: true,
      online: false,
      canMutate: () => true,
      hideNumbers: true,
      onDraft: (draft) => received.push(draft),
    });
    await TestRenderer.act(async () => findButton(root, "Import a recipe").props.onPress());
    const source = root.root
      .findAllByType("TextInput")
      .find((field) => field.props.accessibilityLabel === "Ingredients or JSON-LD")!;
    await TestRenderer.act(async () =>
      source.props.onChangeText(
        JSON.stringify({
          "@type": "Recipe",
          name: "Oats",
          recipeYield: "4 servings",
          recipeIngredient: ["2 cups oats"],
        }),
      ),
    );
    await TestRenderer.act(async () => findButton(root, "Review recipe").props.onPress());
    expect(received).toHaveLength(0);
    expect(
      root.root.findAllByType("Text").some((node) => findText(node).includes("Servings: 4")),
    ).toBe(false);
    const review = root.root
      .findAllByType("Button")
      .filter((button) => findText(button) === "Review recipe")
      .at(-1)!;
    await TestRenderer.act(async () => review.props.onPress());
    expect(received).toHaveLength(1);
  });

  test("production import review masks raw ingredient and serving amounts unless explicitly visible", async () => {
    const sourceText = JSON.stringify({
      "@type": "Recipe",
      name: "Oats",
      recipeYield: "4 servings",
      recipeIngredient: ["200 g oats", "1/2 cup milk"],
    });
    for (const hideNumbers of [true, undefined, false]) {
      const { renderImport } = await setup();
      const received: unknown[] = [];
      const { root } = await renderImport({
        enabled: true,
        online: false,
        canMutate: () => true,
        hideNumbers: hideNumbers as boolean,
        onDraft: (draft) => received.push(draft),
      });
      await TestRenderer.act(async () => findButton(root, "Import a recipe").props.onPress());
      const source = root.root
        .findAllByType("TextInput")
        .find((field) => field.props.accessibilityLabel === "Ingredients or JSON-LD")!;
      await TestRenderer.act(async () => source.props.onChangeText(sourceText));
      await TestRenderer.act(async () => findButton(root, "Review recipe").props.onPress());
      const candidateView = root.root.findAllByType("ScrollView")[0];
      const serialized = [
        ...candidateView.findAllByType("Text").map(findText),
        ...candidateView.findAll(() => true).map((node) => node.props.accessibilityLabel ?? ""),
      ].join(" ");
      if (hideNumbers === false) {
        expect(serialized).toContain("200 g oats");
        expect(serialized).toContain("4 servings");
      } else {
        expect(serialized).not.toContain("200 g oats");
        expect(serialized).not.toContain("1/2 cup milk");
        expect(serialized).not.toContain("4 servings");
        expect(serialized).toContain("Hidden");
      }
      expect(received).toHaveLength(0);
      root.unmount();
    }
  });

  test("unmounted URL import cannot hand off a draft after its request resolves", async () => {
    const { renderImport } = await setup();
    const handedOff: unknown[] = [];
    const { root } = await renderImport({
      enabled: true,
      online: true,
      canMutate: () => true,
      hideNumbers: false,
      onDraft: (draft) => handedOff.push(draft),
    });
    await TestRenderer.act(async () => findButton(root, "Import a recipe").props.onPress());
    const url = root.root
      .findAllByType("TextInput")
      .find((field) => field.props.keyboardType === "url")!;
    await TestRenderer.act(async () => url.props.onChangeText("https://example.test/recipe"));
    let request!: Promise<void>;
    await TestRenderer.act(async () => {
      request = findButton(root, "Importing").props.onPress();
    });
    expect(apiCalls.recipeImport).toHaveLength(1);
    await TestRenderer.act(async () => root.unmount());
    resolveFromUrl({
      candidates: [{ id: "draft", title: "Oats", servingsText: "4", ingredients: [] }],
      message: null,
    });
    await TestRenderer.act(async () => await request);
    expect(handedOff).toHaveLength(0);
  });

  test("URL response after owner authority changes is discarded", async () => {
    const { renderImport, wrap } = await setup();
    let allowed = true;
    const handedOff: unknown[] = [];
    const { root } = await renderImport({
      enabled: true,
      online: true,
      canMutate: () => allowed,
      hideNumbers: false,
      onDraft: (draft) => handedOff.push(draft),
    });
    await TestRenderer.act(async () => findButton(root, "Import a recipe").props.onPress());
    const url = root.root
      .findAllByType("TextInput")
      .find((field) => field.props.keyboardType === "url")!;
    await TestRenderer.act(async () => url.props.onChangeText("https://example.test/recipe"));
    let request!: Promise<void>;
    await TestRenderer.act(async () => {
      request = findButton(root, "Importing").props.onPress();
    });
    expect(apiCalls.recipeImport).toHaveLength(1);
    allowed = false;
    await TestRenderer.act(async () =>
      root.update(
        wrap(
          React.createElement(NutritionRecipeImport, {
            enabled: true,
            online: true,
            canMutate: () => allowed,
            hideNumbers: false,
            onDraft: (draft: unknown) => handedOff.push(draft),
          }),
        ),
      ),
    );
    resolveFromUrl({
      candidates: [{ id: "late-draft", title: "Late oats", servingsText: "4", ingredients: [] }],
      message: null,
    });
    await TestRenderer.act(async () => await request);
    expect(handedOff).toHaveLength(0);
    expect(
      root.root.findAllByType("Text").some((node) => findText(node).includes("Late oats")),
    ).toBe(false);
  });
});
