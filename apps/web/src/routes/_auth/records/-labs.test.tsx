import { describe, expect, mock, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

// Loading the real `orpc` reads the server URL from `@/env`; the root test run
// has no web env unless an earlier file set one up.
mock.module("@/env", () => ({ ENV: { VITE_SERVER_URL: "https://health.example/" } }));

const { AddReadingForm } = await import("./labs");

function render() {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider i18n={englishI18n}>
        <AddReadingForm
          markers={[
            { code: "vitamin_d", displayName: "Vitamin D", unit: "ng/mL" },
            { code: "ldl_cholesterol", displayName: "LDL cholesterol", unit: "mg/dL" },
          ]}
          onSaved={() => {}}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("Labs add reading", () => {
  test("asks for the marker and does not default to the first one", () => {
    const html = render();
    expect(html).toInclude("Marker");
    expect(html).toInclude("Choose a marker");
    expect(html).not.toInclude("Vitamin D");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save<\/button>/);
  });
});
