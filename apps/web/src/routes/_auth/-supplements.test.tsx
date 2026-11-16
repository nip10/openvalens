import { afterAll, afterEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import { renderToStaticMarkup } from "react-dom/server";

import { supplementIntakeWindowStart } from "@/utils/supplement-intake-window";

// Loading the real `orpc` reads the server URL from `@/env`; the root test run
// has no web env unless an earlier file set one up.
mock.module("@/env", () => ({ ENV: { VITE_SERVER_URL: "https://health.example/" } }));

// Record each query key the section asks for. Bun keeps module mocks for the
// rest of the process, so the exports are put back after this file.
const reactQuery = { ...(await import("@tanstack/react-query")) };
const intakeKeys: string[] = [];
mock.module("@tanstack/react-query", () => ({
  ...reactQuery,
  useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
  useMutation: () => ({ mutate: () => {}, isPending: false, isError: false }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = JSON.stringify(queryKey);
    if (key.includes("supplementIntake")) intakeKeys.push(key);
    return { data: undefined, isPending: true, isError: false, refetch: () => {} };
  },
}));
afterAll(() => {
  mock.module("@tanstack/react-query", () => reactQuery);
});

const { SupplementIntakeSection } = await import("./supplements");

afterEach(() => setSystemTime());

describe("supplement dose history query", () => {
  test("the window starts at local midnight seven days back", () => {
    const start = new Date(supplementIntakeWindowStart(new Date(2026, 10, 16, 15, 42, 7)));
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(10);
    expect(start.getDate()).toBe(9);
    expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0]);
  });

  test("rendering again later the same day asks for the same query key", () => {
    const supplements = [{ id: 1, name: "Vitamin D", dose: "1000 IU" }];
    const render = () =>
      renderToStaticMarkup(
        <I18nProvider i18n={englishI18n}>
          <SupplementIntakeSection supplements={supplements} />
        </I18nProvider>,
      );
    intakeKeys.length = 0;
    setSystemTime(new Date(2026, 10, 16, 9, 0, 0));
    render();
    setSystemTime(new Date(2026, 10, 16, 9, 0, 5));
    render();
    expect(intakeKeys).toHaveLength(2);
    expect(new Set(intakeKeys).size).toBe(1);
  });
});
