import "@/testing/varlock-test-setup";
import { describe, expect, mock, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import { firstLogKinds, phoneAppLink } from "@openvalens/api/presenters/onboarding";
import { EMPTY_WELLNESS_PROFILE } from "@openvalens/api/wellness-profile-contract";
import type { ReactNode } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";

mock.module("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({
    children,
    to,
    hash,
    params,
  }: {
    children: ReactNode;
    to: string;
    hash?: string;
    params?: Record<string, string>;
  }) => {
    const path = Object.entries(params ?? {}).reduce(
      (current, [key, value]) => current.replace(`$${key}`, value),
      to,
    );
    return <a href={hash ? `${path}#${hash}` : path}>{children}</a>;
  },
  useNavigate: () => () => {},
}));

const { FinishSetupCardView } = await import("./finish-setup-card");
const { AgeBody, ConnectBody, ConsentBody, FirstLogCards, ModulesBody, StepFrame } =
  await import("./onboarding-steps");
const { ServerChecklistView } = await import("./server-checklist");
const { serverAddress } = await import("./setup-steps");

function render(node: ReactNode): string {
  return renderMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}
const noop = () => {};
const adult = { state: "recorded", value: "adult" } as const;

describe("Finish setting up card", () => {
  test("lists every item, ticks the answered ones and links each to its own screen", () => {
    const html = render(
      <FinishSetupCardView
        snapshot={{ ...EMPTY_WELLNESS_PROFILE, setupStatus: "completed", eligibility: adult }}
        facts={{ goalCount: 1, hasEntries: true }}
        dismissing={false}
        error={null}
        onDismiss={noop}
      />,
    );
    expect(html).toContain("Finish setting up, 2 of 6");
    for (const item of ["first_log", "connect", "modules", "basics", "goal", "privacy"]) {
      expect(html).toContain(`href="/setup/${item}"`);
    }
    expect(html.match(/\(done\)/g)?.length).toBe(2);
    expect(html).toContain("Dismiss");
  });

  test("hidden once dismissed, or once everything has an answer", () => {
    const dismissed = render(
      <FinishSetupCardView
        snapshot={{ ...EMPTY_WELLNESS_PROFILE, setupStatus: "skipped" }}
        facts={{}}
        dismissing={false}
        error={null}
        onDismiss={noop}
      />,
    );
    expect(dismissed).toBe("");
    const finished = render(
      <FinishSetupCardView
        snapshot={{
          ...EMPTY_WELLNESS_PROFILE,
          setupStatus: "completed",
          enabledModules: ["sleep"],
          region: { state: "declined" },
        }}
        facts={{ goalCount: 1, hasEntries: true, connected: true, remindersOn: true }}
        dismissing={false}
        error={null}
        onDismiss={noop}
      />,
    );
    expect(finished).toBe("");
  });
});

describe("first run screens", () => {
  test("Step N of 3, with Skip only when the screen offers it", () => {
    const required = render(
      <StepFrame
        titleId="t"
        title="Before you start"
        progress={{ index: 1, total: 3, label: "Before you start" }}
        onContinue={noop}
      />,
    );
    expect(required).toContain("Step 1 of 3: Before you start");
    expect(required).not.toContain(">Skip<");
    const optional = render(
      <StepFrame
        titleId="t"
        title="Your first entry"
        progress={{ index: 2, total: 3, label: "Your first entry" }}
        onSkip={noop}
        onBack={noop}
      />,
    );
    expect(optional).toContain(">Skip<");
    expect(optional).toContain(">Back<");
    // A card item's screen has no counter.
    expect(render(<StepFrame titleId="t" title="A few basics" onContinue={noop} />)).not.toContain(
      "Step ",
    );
  });

  test("the age check uses the profile's question and shows the under-18 rule", () => {
    const html = render(
      <AgeBody value={{ state: "recorded", value: "under_18" }} onChange={noop} />,
    );
    expect(html).toContain("Are you 18 or older?");
    expect(html).toContain("Yes, I&#x27;m 18 or older");
    expect(html).toContain("adult-only personalisation stays off");
  });

  test("the consent shows its version and the privacy policy", () => {
    const html = render(
      <ConsentBody
        currentVersion="2026-11"
        privacyUrl="https://example.org/privacy"
        checked={false}
        onCheckedChange={noop}
      />,
    );
    expect(html).toContain("Consent version: 2026-11");
    expect(html).toContain('href="https://example.org/privacy"');
    expect(html).toContain("I agree to this health data processing.");
  });

  test("first log: three cards, and Water says it turns water logging on", () => {
    const kinds = firstLogKinds({ enabledModules: null });
    const off = render(<FirstLogCards kinds={kinds} plainWaterEnabled={false} onPick={noop} />);
    expect(off).toContain("Weight");
    expect(off).toContain("Water");
    expect(off).toContain("Last night&#x27;s sleep");
    expect(off).toContain("This turns on water logging");
    const on = render(<FirstLogCards kinds={kinds} plainWaterEnabled={true} onPick={noop} />);
    expect(on).not.toContain("This turns on water logging");
    expect(render(<FirstLogCards kinds={[]} plainWaterEnabled={null} onPick={noop} />)).toContain(
      "can&#x27;t add entries",
    );
  });

  test("connect: a QR code for the phone app and the operator's wearables", () => {
    const html = render(
      <ConnectBody
        phoneLink={phoneAppLink("https://health.example.org")}
        serverUrl="https://health.example.org"
        providers={[
          { provider: "oura", displayName: "Oura", status: "not_connected" },
          { provider: "whoop", displayName: "WHOOP", status: "active" },
        ]}
        busyProvider={null}
        onConnect={noop}
      />,
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('<path d="M');
    expect(html).toContain("https://health.example.org");
    expect(html).toContain("play.google.com");
    expect(html).toContain("Oura");
    expect(html.match(/>Connect</g)?.length).toBe(1);
  });

  test("connect hides the wearables when the operator set none up", () => {
    const html = render(
      <ConnectBody
        phoneLink="openvalens://server"
        serverUrl="https://x"
        providers={[]}
        busyProvider={null}
        onConnect={noop}
      />,
    );
    expect(html).not.toContain("Wearable accounts");
  });

  test("the server address is absolute, without a trailing slash", () => {
    expect(serverAddress("https://api.example.org/", "https://app.example.org")).toBe(
      "https://api.example.org",
    );
    expect(serverAddress("/api", "https://app.example.org")).toBe("https://app.example.org/api");
  });

  test("module cards show the chosen ones pressed and explain the coach", () => {
    const html = render(
      <ModulesBody
        focus={{ state: "recorded", value: ["nutrition"] }}
        onFocusChange={noop}
        modules={["food"]}
        onToggleModule={noop}
      />,
    );
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(2);
    expect(html).toContain("The coach also needs AI to be turned on for this server");
  });
});

describe("server checklist", () => {
  test("links to the existing admin pages and shows reported readiness", () => {
    const html = render(
      <ServerChecklistView
        state={{
          emailDelivery: false,
          backups: "ok",
          aiProviderConfigured: true,
          workspaceAiOn: false,
        }}
        onContinue={noop}
      />,
    );
    expect(html).toContain('href="/admin/settings"');
    expect(html).toContain('href="/admin/invitations"');
    expect(html).toContain('href="/settings#ai"');
    expect(html).toContain("Not set up");
    expect(html).toContain("Backups healthy");
    expect(html).toContain("Provider set, AI off");
  });
});
