import { Database } from "bun:sqlite";
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { OFFLINE_SCHEMA_SQL } from "../offline/schema";

const sqlite = new Database(":memory:");
sqlite.exec(OFFLINE_SCHEMA_SQL);
const expoDb = {
  execSync: (sql: string) => sqlite.exec(sql),
  getAllSync: <T,>(sql: string, ...params: unknown[]) =>
    sqlite.query(sql).all(...(params as never[])) as T[],
  getFirstSync: <T,>(sql: string, ...params: unknown[]) =>
    (sqlite.query(sql).get(...(params as never[])) ?? null) as T | null,
  runSync: (sql: string, ...params: unknown[]) => sqlite.query(sql).run(...(params as never[])),
};
let session: any = {
  user: { id: "lifecycle-a" },
  session: { id: "session-1", activeOrganizationId: "org" },
};
mock.module("expo-sqlite", () => ({ openDatabaseSync: () => expoDb }));
mock.module("expo-network", () => ({
  getNetworkStateAsync: async () => ({ isConnected: false }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
mock.module("react-native", () => ({
  AppState: { currentState: "background", addEventListener: () => ({ remove() {} }) },
}));
mock.module("@tanstack/react-query", () => ({ useQuery: () => ({}), useQueryClient: () => ({}) }));
mock.module("@/lib/auth-client", () => ({ authClient: { useSession: () => ({ data: session }) } }));
mock.module("@/utils/orpc", () => ({
  client: {
    nutritionDiary: {
      logEntry: async () => undefined,
      updateEntry: async () => ({}),
      deleteEntry: async () => ({}),
      restoreEntry: async () => ({}),
      setDayStatus: async () => undefined,
      copyDay: async () => undefined,
    },
  },
  orpc: { nutritionDiary: { key: () => ["diary"] } },
  queryClient: { invalidateQueries: async () => undefined, removeQueries: () => undefined },
}));
globalThis.setInterval = (() => 0) as typeof setInterval;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let React: typeof import("react");
let TestRenderer: typeof import("../../../../packages/ui/node_modules/react-test-renderer");
let useDiaryOutbox: typeof import("./sync").useDiaryOutbox;
let useOfflineScope: typeof import("../offline/sync").useOfflineScope;
let useAddFoodSaveLifecycle: typeof import("./save-intent").useAddFoodSaveLifecycle;
let completeAddFoodCreation: typeof import("./save-intent").completeAddFoodCreation;
let clearDiaryOutbox: typeof import("./store").clearDiaryOutbox;
let captured: any;
let closes: number;

beforeAll(async () => {
  const rendererReact = await import("../../../../packages/ui/node_modules/react");
  React = rendererReact as typeof import("react");
  mock.module("react", () => React);
  TestRenderer =
    (await import("../../../../packages/ui/node_modules/react-test-renderer")) as typeof TestRenderer;
  ({ useDiaryOutbox } = await import("./sync"));
  ({ useOfflineScope } = await import("../offline/sync"));
  ({ useAddFoodSaveLifecycle, completeAddFoodCreation } = await import("./save-intent"));
  ({ clearDiaryOutbox } = await import("./store"));
});

const scope = "lifecycle-a:org";
const diaryInput = (id: string) => ({
  op: {
    kind: "log" as const,
    input: {
      clientMutationId: id,
      localDate: "2026-10-21",
      timeZone: "UTC",
      slot: "breakfast" as const,
      food: { kind: "custom" as const, food: { id: "food-1" } as never },
      amount: 100,
      unit: "g" as const,
      method: "quick_add" as const,
    },
  },
  preview: { name: "Oats", source: "custom" as const, nutrients: null },
});
const context = (date: string, zone: string, sessionId = session.session.id) =>
  `${scope}\u001f${sessionId}\u001f${date}\u001f${zone}`;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function Subject({ contextKey }: { contextKey: string }) {
  useOfflineScope();
  const lifecycle = useAddFoodSaveLifecycle(contextKey);
  const outbox = useDiaryOutbox();
  const [draft, setDraft] = React.useState("initial draft");
  const onChangeText = lifecycle.bindMutation((value: string) => setDraft(value));
  const onCancel = () => {
    closes++;
    lifecycle.invalidate();
  };
  captured = { lifecycle, outbox, draft, onChangeText, onCancel };
  return React.createElement(
    React.Fragment,
    null,
    React.createElement("TextInput", {
      accessibilityLabel: "Food name",
      value: draft,
      editable: lifecycle.editable,
      onChangeText,
    }),
    React.createElement("Button", {
      accessibilityLabel: "Cancel",
      disabled: false,
      onPress: onCancel,
    }),
  );
}

async function mount(contextKey: string) {
  let root!: import("../../../../packages/ui/node_modules/react-test-renderer").ReactTestRenderer;
  await TestRenderer.act(async () => {
    root = TestRenderer.create(React.createElement(Subject, { contextKey }));
  });
  return root;
}
async function update(
  root: import("../../../../packages/ui/node_modules/react-test-renderer").ReactTestRenderer,
  contextKey: string,
) {
  await TestRenderer.act(async () => root.update(React.createElement(Subject, { contextKey })));
}
function begin(origin: string) {
  const ticket = captured.outbox.beginWrite();
  let intent!: ReturnType<typeof captured.lifecycle.begin>;
  TestRenderer.act(() => {
    intent = captured.lifecycle.begin(ticket, "foods-and-amount", () => crypto.randomUUID());
  });
  if (!intent) throw new Error("Expected an active intent");
  const isCurrent = () =>
    captured.lifecycle.controller.isCurrent(intent) &&
    intent.contextKey === origin &&
    captured.outbox.scope === scope &&
    intent.ticket === ticket;
  return { ticket, intent, isCurrent };
}
function complete(
  origin: string,
  deferredCreate: ReturnType<typeof deferred<{ ref: unknown }>>,
  callbacks: { error?: () => void; success?: () => void },
) {
  const { ticket, intent, isCurrent } = begin(origin);
  return completeAddFoodCreation({
    intent,
    isCurrent,
    create: async () => deferredCreate.promise,
    enqueue: () => captured.outbox.enqueueForIntent(ticket, diaryInput(intent.diaryMutationId)),
    finish: captured.lifecycle.finish,
    release: captured.lifecycle.release,
    onError: () => callbacks.error?.(),
    onStored: () => {
      callbacks.success?.();
      captured.lifecycle.invalidate();
      closes++;
    },
  });
}
function outboxRows() {
  return sqlite.query("select id from nutrition_outbox where scope = ?").all(scope);
}

describe("mounted Add Food lifecycle and edit gates", () => {
  test("retained Save and edit callbacks lose authority after invalidation and context replacement", async () => {
    session = {
      user: { id: "lifecycle-a" },
      session: { id: "session-retained", activeOrganizationId: "org" },
    };
    clearDiaryOutbox(scope);
    closes = 0;
    const origin = context("2026-10-21", "UTC");
    const next = context("2026-10-22", "UTC");
    const root = await mount(origin);
    const old = captured.lifecycle;
    const oldEdit = captured.onChangeText;
    const oldCanMutate = old.canMutate;

    const active = begin(origin);
    expect(active.intent).toBeTruthy();
    await TestRenderer.act(async () => captured.onCancel());
    await TestRenderer.act(async () => oldEdit("stale edit"));
    let staleBegin!: ReturnType<typeof old.begin>;
    TestRenderer.act(() => {
      staleBegin = old.begin(active.ticket, "foods-and-amount", () => crypto.randomUUID());
    });
    expect(staleBegin).toBeNull();
    expect(oldCanMutate()).toBe(false);

    await update(root, next);
    await TestRenderer.act(async () => oldEdit("old-context edit"));
    TestRenderer.act(() => {
      staleBegin = old.begin(active.ticket, "foods-and-amount", () => crypto.randomUUID());
    });
    expect(staleBegin).toBeNull();
    expect(oldCanMutate()).toBe(false);
    expect(root.root.findByProps({ accessibilityLabel: "Food name" }).props.value).toBe(
      "initial draft",
    );
    expect(outboxRows()).toHaveLength(0);

    // Current callbacks on the replacement context retain ordinary behavior.
    await TestRenderer.act(async () =>
      root.root.findByProps({ accessibilityLabel: "Food name" }).props.onChangeText("live edit"),
    );
    expect(root.root.findByProps({ accessibilityLabel: "Food name" }).props.value).toBe(
      "live edit",
    );
    await TestRenderer.act(async () => root.unmount());
  });

  test("retained callbacks cannot start another intent after unmount", async () => {
    session = {
      user: { id: "lifecycle-a" },
      session: { id: "session-retired", activeOrganizationId: "org" },
    };
    clearDiaryOutbox(scope);
    const origin = context("2026-10-21", "UTC");
    const root = await mount(origin);
    const old = captured.lifecycle;
    const oldEdit = captured.onChangeText;
    await TestRenderer.act(async () => root.unmount());
    await TestRenderer.act(async () => oldEdit("stale after unmount"));
    let staleBegin!: ReturnType<typeof old.begin>;
    TestRenderer.act(() => {
      staleBegin = old.begin(null, "foods-and-amount", () => crypto.randomUUID());
    });
    expect(staleBegin).toBeNull();
    expect(old.canMutate()).toBe(false);
    expect(outboxRows()).toHaveLength(0);
  });

  test("retained keyboard input handler is blocked while pending; Cancel remains accessible", async () => {
    session = {
      user: { id: "lifecycle-a" },
      session: { id: "session-1", activeOrganizationId: "org" },
    };
    clearDiaryOutbox(scope);
    closes = 0;
    const root = await mount(context("2026-10-21", "UTC"));
    const savedHandler = root.root.findByProps({ accessibilityLabel: "Food name" }).props
      .onChangeText;
    const origin = context("2026-10-21", "UTC");
    const { intent } = begin(origin);
    await TestRenderer.act(async () => savedHandler("keyboard edit after submit"));
    const fieldNode = root.root.findByProps({ accessibilityLabel: "Food name" });
    const cancelNode = root.root.findByProps({ accessibilityLabel: "Cancel" });
    expect(fieldNode.props.editable).toBe(false);
    expect(fieldNode.props.value).toBe("initial draft");
    expect(cancelNode.props.disabled).toBe(false);
    await TestRenderer.act(async () => cancelNode.props.onPress());
    expect(captured.lifecycle.controller.isCurrent(intent)).toBe(false);
    expect(closes).toBe(1);
    await TestRenderer.act(async () => root.unmount());
  });

  test("date/time-zone replacement preserves new draft and fences old deferred ACK", async () => {
    session = {
      user: { id: "lifecycle-a" },
      session: { id: "session-2", activeOrganizationId: "org" },
    };
    clearDiaryOutbox(scope);
    closes = 0;
    const origin = context("2026-10-21", "UTC");
    const next = context("2026-10-22", "America/Los_Angeles");
    const root = await mount(origin);
    const ack = deferred<{ ref: unknown }>();
    let successes = 0;
    let errors = 0;
    const completion = complete(origin, ack, { success: () => successes++, error: () => errors++ });
    await update(root, next);
    const fieldNode = root.root.findByProps({ accessibilityLabel: "Food name" });
    await TestRenderer.act(async () => fieldNode.props.onChangeText("new-day draft"));
    ack.resolve({ ref: { id: "food-1" } });
    await TestRenderer.act(async () => completion);
    expect(outboxRows()).toHaveLength(0);
    expect(successes).toBe(0);
    expect(errors).toBe(0);
    expect(closes).toBe(0);
    expect(root.root.findByProps({ accessibilityLabel: "Food name" }).props.value).toBe(
      "new-day draft",
    );
    const errorAck = deferred<{ ref: unknown }>();
    const errorCompletion = complete(next, errorAck, {
      success: () => successes++,
      error: () => errors++,
    });
    await update(root, context("2026-10-23", "America/Los_Angeles"));
    errorAck.reject(new Error("late create failure"));
    await TestRenderer.act(async () => errorCompletion);
    expect(errors).toBe(0);
    expect(closes).toBe(0);
    await TestRenderer.act(async () => root.unmount());
  });

  test("unmount rejects delayed ACK; remounted identical context can still save", async () => {
    session = {
      user: { id: "lifecycle-a" },
      session: { id: "session-3", activeOrganizationId: "org" },
    };
    clearDiaryOutbox(scope);
    closes = 0;
    const origin = context("2026-10-21", "UTC");
    const root = await mount(origin);
    const ack = deferred<{ ref: unknown }>();
    let successes = 0;
    let errors = 0;
    const completion = complete(origin, ack, { success: () => successes++, error: () => errors++ });
    await TestRenderer.act(async () => root.unmount());
    ack.resolve({ ref: { id: "food-1" } });
    await TestRenderer.act(async () => completion);
    expect(outboxRows()).toHaveLength(0);
    expect(successes).toBe(0);
    expect(errors).toBe(0);
    expect(closes).toBe(0);

    const remount = await mount(origin);
    const positive = deferred<{ ref: unknown }>();
    let positiveSuccess = 0;
    const liveSave = complete(origin, positive, { success: () => positiveSuccess++ });
    positive.resolve({ ref: { id: "food-1" } });
    await TestRenderer.act(async () => liveSave);
    expect(outboxRows()).toHaveLength(1);
    expect(positiveSuccess).toBe(1);
    expect(closes).toBe(1);
    await TestRenderer.act(async () => remount.unmount());
  });

  test("same-context rerender retains active intent and queues one diary operation", async () => {
    session = {
      user: { id: "lifecycle-a" },
      session: { id: "session-4", activeOrganizationId: "org" },
    };
    clearDiaryOutbox(scope);
    closes = 0;
    const origin = context("2026-10-21", "UTC");
    const root = await mount(origin);
    const ack = deferred<{ ref: unknown }>();
    let successes = 0;
    const completion = complete(origin, ack, { success: () => successes++ });
    await update(root, origin);
    ack.resolve({ ref: { id: "food-1" } });
    await TestRenderer.act(async () => completion);
    expect(outboxRows()).toHaveLength(1);
    expect(successes).toBe(1);
    expect(closes).toBe(1);
    await TestRenderer.act(async () => root.unmount());
  });
});
