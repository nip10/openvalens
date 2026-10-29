import { describe, expect, mock, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let queryState: Record<string, unknown>;
let queryOptions:
  | { refetchInterval?: (query: { state: { data?: unknown } }) => unknown }
  | undefined;
mock.module("@/utils/orpc", () => ({ client: { dataRights: {} } }));
mock.module("@/env", () => ({ ENV: { VITE_SERVER_URL: "https://health.example/" } }));
mock.module("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
mock.module("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: () => Promise.resolve(), setQueryData: () => {} }),
  useQuery: (options: typeof queryOptions) => {
    queryOptions = options;
    return queryState;
  },
  useMutation: () => ({ mutate: () => {}, isPending: false }),
}));

const { CompleteExportCard } = await import("./complete-export-card");
const jobId = "2d49e6d8-8d64-4d69-81c1-15e56a82ca43";
const status = (state: string) => ({
  id: jobId,
  state,
  createdAt: "2026-10-29T00:00:00Z",
  expiresAt: state === "ready" ? "2026-10-30T00:00:00Z" : null,
  bytes: state === "ready" ? 4_096 : null,
  failure: state === "failed" ? "STORAGE_UNAVAILABLE" : null,
});
const render = () =>
  renderToStaticMarkup(
    <I18nProvider i18n={englishI18n}>
      <CompleteExportCard />
    </I18nProvider>,
  );

describe("complete export card", () => {
  test("offers the request section regardless of billing state", () => {
    queryState = { data: null, isPending: false, isError: false };
    const html = render();
    expect(html).toContain("Download everything");
    expect(html).toContain("Prepare export");
    expect(html).toContain("stored attachments");
  });

  test("shows neutral queued status and cancel without fabricated progress", () => {
    queryState = { data: status("queued"), isPending: false, isError: false };
    const html = render();
    expect(html).toContain("Waiting to prepare your export");
    expect(html).toContain("Cancel");
    expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(/\d+\s*%/);
    expect(queryOptions?.refetchInterval?.({ state: { data: status("queued") } })).toBe(2_000);
  });

  test("ready state uses a fixed native download URL, not an in-memory blob", () => {
    queryState = { data: status("ready"), isPending: false, isError: false };
    const html = render();
    expect(html).toContain("https://health.example/api/data-rights/exports/");
    expect(html).toContain(`${jobId}/download`);
    expect(html).not.toContain("blob:");
    expect(queryOptions?.refetchInterval?.({ state: { data: status("ready") } })).toBe(false);
  });

  test("uses safe mapped failure copy and stops polling", () => {
    queryState = { data: status("failed"), isPending: false, isError: false };
    const html = render();
    expect(html).toContain("Export storage is unavailable right now");
    expect(html).not.toContain("INTERNAL");
    expect(queryOptions?.refetchInterval?.({ state: { data: status("failed") } })).toBe(false);
  });

  test("renders expired and cancelled states without offering a stale download", () => {
    for (const state of ["expired", "cancelled"]) {
      queryState = { data: status(state), isPending: false, isError: false };
      const html = render();
      expect(html).toContain(
        state === "expired" ? "This export has expired" : "preparation was cancelled",
      );
      expect(html).not.toContain("/download");
    }
  });

  test("shows a sign-in path when the session is no longer valid", () => {
    queryState = {
      data: undefined,
      isPending: false,
      isError: true,
      error: { code: "UNAUTHORIZED" },
      refetch: () => {},
    };
    const html = render();
    expect(html).toContain("Your session has ended");
    expect(html).toContain('href="/login"');
  });
});
