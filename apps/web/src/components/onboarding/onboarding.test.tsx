import "@/testing/varlock-test-setup";
import { describe, expect, mock, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import { EMPTY_WELLNESS_PROFILE } from "@openvalens/api/wellness-profile-contract";
import type { ReactNode } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";

mock.module("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ children, to, hash }: { children: ReactNode; to: string; hash?: string }) => (
    <a href={hash ? `${to}#${hash}` : to}>{children}</a>
  ),
  useNavigate: () => () => {},
}));

const { FinishSetupCardView } = await import("./finish-setup-card");
const { AgeBody, ModulesBody, StepFrame, StepRail, TodayPreview } =
  await import("./onboarding-steps");
const { ServerChecklistView } = await import("./server-checklist");

function render(node: ReactNode): string {
  return renderMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
}
const noop = () => {};

describe("Finish setting up card", () => {
  test("shows N of 8 with Continue to /welcome and Dismiss", () => {
    const html = render(
      <FinishSetupCardView
        snapshot={{
          ...EMPTY_WELLNESS_PROFILE,
          setupStatus: "in_progress",
          eligibility: { state: "recorded", value: "adult" },
        }}
        extras={{}}
        dismissing={false}
        error={null}
        onDismiss={noop}
      />,
    );
    expect(html).toContain("Finish setting up, 2 of 8");
    expect(html).toContain('href="/welcome"');
    expect(html).toContain("Dismiss");
  });

  test("hidden once completed or dismissed", () => {
    for (const setupStatus of ["completed", "skipped"] as const) {
      const html = render(
        <FinishSetupCardView
          snapshot={{ ...EMPTY_WELLNESS_PROFILE, setupStatus }}
          extras={{}}
          dismissing={false}
          error={null}
          onDismiss={noop}
        />,
      );
      expect(html).toBe("");
    }
  });
});

describe("steps", () => {
  test("the age step has no Skip; others have Skip and Back", () => {
    const age = render(
      <StepFrame
        step="age"
        titleId="t"
        title="Age"
        onContinue={noop}
        onSkip={noop}
        onBack={noop}
      />,
    );
    expect(age).not.toContain(">Skip<");
    expect(age).toContain(">Back<");
    expect(age).toContain("Step 2 of 8: Age check");
    const goal = render(
      <StepFrame
        step="goal"
        titleId="t"
        title="Goal"
        onContinue={noop}
        onSkip={noop}
        onBack={noop}
      />,
    );
    expect(goal).toContain(">Skip<");
    expect(goal).toContain(">Back<");
  });

  test("the age check uses the profile's question and shows the under-18 rule", () => {
    const html = render(
      <AgeBody value={{ state: "recorded", value: "under_18" }} onChange={noop} />,
    );
    expect(html).toContain("Are you 18 or older?");
    expect(html).toContain("Yes, I&#x27;m 18 or older");
    expect(html).toContain("adult-only personalisation stays off");
  });

  test("the rail locks steps past the age check until it is answered", () => {
    const html = render(
      <StepRail
        current="age"
        done={() => false}
        eligibility={EMPTY_WELLNESS_PROFILE.eligibility}
        onJump={noop}
      />,
    );
    expect(html).toContain('aria-current="step"');
    expect(html.match(/disabled=""/g)?.length).toBe(6);
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

  test("Your Today previews the chosen modules and the menu", () => {
    const html = render(<TodayPreview modules={["sleep", "food"]} />);
    expect(html).toContain("Food &amp; water");
    expect(html).toContain("The menu will show: Dashboard, Sleep, Food &amp; water, Timeline");
    expect(render(<TodayPreview modules={[]} />)).toContain("No modules picked.");
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
