import { describe, expect, test } from "bun:test";
import {
  WATER_COPY,
  buildWaterDayView,
  type WaterDayWire,
} from "@openvalens/api/presenters/plain-water";
import { I18nProvider } from "@lingui/react";
import { englishI18n, inEnglish } from "@openvalens/i18n/testing";
import { renderToStaticMarkup } from "react-dom/server";

import { PlainWaterDayView, type PlainWaterDayViewProps } from "./plain-water-day-view";
import { createMountedRouter } from "../../mounted-tests/router-fixture";

const ENTRY_CANARY = 123_456;
const GOAL_CANARY = 987_654;

const rawDay = (overrides: Partial<WaterDayWire> = {}): WaterDayWire => ({
  date: "2026-07-01",
  timeZone: "Europe/Lisbon",
  label: "Plain water subtotal",
  enabled: true,
  quantityMl: ENTRY_CANARY,
  personalGoalMl: GOAL_CANARY,
  entries: [
    {
      id: 12,
      observedAt: "2026-07-01T13:05:00.000Z",
      timeZone: "Europe/Lisbon",
      quantityMl: ENTRY_CANARY,
      revision: 3,
      deleted: false,
    },
  ],
  ...overrides,
});

async function render(overrides: Partial<PlainWaterDayViewProps> = {}) {
  const { router, RouterProvider } = createMountedRouter(
    <PlainWaterDayView
      view={buildWaterDayView(rawDay(), [], false)}
      load="ready"
      enabled
      hideNumbers={false}
      unit="ml"
      onUnitChange={() => {}}
      localDate="2026-07-01"
      timeZone="Europe/Lisbon"
      busy={null}
      formError={null}
      onRetry={() => {}}
      onToggleEnabled={() => {}}
      onAdd={async () => true}
      onChange={async () => true}
      onDelete={() => {}}
      {...overrides}
    />,
  );
  await router.load();
  return renderToStaticMarkup(
    <I18nProvider i18n={englishI18n}>
      <RouterProvider router={router} />
    </I18nProvider>,
  );
}

describe("PlainWaterDayView", () => {
  test("shows a labelled plain-water subtotal and the member's own goal", async () => {
    const html = await render();
    expect(html).toContain("Plain water");
    expect(html).toContain(inEnglish(WATER_COPY.scopeNote));
    expect(html).toContain("Plain water subtotal");
    expect(html).toContain("123,456 ml");
    expect(html).toContain("987,654 ml");
    expect(html).toContain("A reference you set yourself. Optional.");
    expect(html).not.toInclude("hydration");
    // The five meal nutrients are not part of this surface.
    for (const label of ["Energy", "Protein", "Carbohydrate", "Fat", "Fibre"])
      expect(html).not.toInclude(`>${label}<`);
  });

  test("an empty day reads as nothing logged, never zero", async () => {
    const html = await render({
      view: buildWaterDayView(rawDay({ entries: [], quantityMl: 0 }), [], false),
    });
    expect(html).toContain("Nothing logged for this day.");
    expect(html).not.toMatch(/>0( |<)/);
  });

  test("an unresolved add with no visible rows never claims the day is empty", async () => {
    const view = {
      ...buildWaterDayView(rawDay({ entries: [], quantityMl: null }), [], false),
      reconciliationUnknown: true,
    };
    const html = await render({ view });
    expect(html).toContain(inEnglish(WATER_COPY.reconciliationUnknown));
    expect(html).not.toContain(inEnglish(WATER_COPY.empty));
  });

  test("an unset linked goal is shown as unset without an independent target editor", async () => {
    const html = await render({
      view: buildWaterDayView(rawDay({ personalGoalMl: null }), [], false),
    });
    expect(html).toContain("Personal goal:");
    expect(html).toContain("No personal goal set.");
    expect(html).not.toContain("Set a goal");
    expect(html).not.toContain('placeholder="Goal amount"');
    expect(html).toContain('href="/goals"');
    expect(html).toContain("Manage water goal");
    expect(html).not.toInclude("2 L");
  });

  test("hide-numbers hides water amounts while retaining Goals navigation, without a target editor", async () => {
    const html = await render({ hideNumbers: true });
    for (const canary of ["123,456", "123456", "987,654", "987654"])
      expect(html).not.toInclude(canary);
    expect(html).not.toInclude(`${ENTRY_CANARY}`);
    expect(html).toContain("Hidden");
    expect(html).toContain("Numbers are hidden. You can still log water.");
    expect(html).toContain('href="/goals"');
    expect(html).toContain("Manage water goal");
    expect(html).not.toContain('placeholder="Goal amount"');
    expect(html).not.toMatch(/placeholder="\d/);
    expect(html).not.toInclude('aria-label="Plain water subtotal: 123');
  });

  test("off hides entries, numbers and the goal, and offers turning it on", async () => {
    const html = await render({ enabled: false });
    expect(html).toContain("Plain water is off.");
    expect(html).toContain("Saved entries are kept but not shown while it");
    expect(html).toContain("Turn on");
    expect(html).not.toInclude("Plain water subtotal");
    expect(html).not.toInclude("123,456");
    expect(html).not.toInclude("Add plain water");
  });

  test("an unknown or failed preference never shows a number", async () => {
    const html = await render({ enabled: null, view: buildWaterDayView(rawDay(), [], true) });
    expect(html).toContain(inEnglish(WATER_COPY.readError));
    expect(html).not.toInclude("123,456");
    expect(html).not.toInclude("Hidden");
  });

  test("a loading day shows no amounts yet", async () => {
    const html = await render({ load: "loading", view: null });
    expect(html).not.toInclude("Plain water subtotal");
    expect(html).not.toInclude("123,456");
  });

  test("a failed day read offers a retry and no amounts", async () => {
    const html = await render({ load: "error", view: null, enabled: null });
    expect(html).toContain(inEnglish(WATER_COPY.readError));
    expect(html).toContain("Retry");
    expect(html).not.toInclude("123,456");
  });
});
