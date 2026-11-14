import { describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { findLogKind } from "@openvalens/api/presenters/log-kinds";
import { quickFormDefaults } from "@openvalens/api/presenters/quick-log";
import { trackerLogKind, type TrackerForLogKind } from "@openvalens/api/presenters/trackers";
import { englishI18n } from "@openvalens/i18n/testing";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@openvalens/ui/components/command";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { QuickForm } from "./quick-form";

const render = (node: ReactNode) =>
  renderToStaticMarkup(<I18nProvider i18n={englishI18n}>{node}</I18nProvider>);
const noop = () => {};

describe("QuickForm", () => {
  test("weight: labelled value with a kg/lb choice and a time", () => {
    const kind = findLogKind("weight")!;
    const html = render(
      <QuickForm
        kind={kind}
        values={quickFormDefaults(kind)}
        errors={["value"]}
        showErrors
        supplements={null}
        pending={false}
        failed={false}
        onChange={noop}
        onSubmit={noop}
        onBack={noop}
      />,
    );
    expect(html).toContain('for="quick-log-weight-value"');
    expect(html).toContain('aria-label="Unit for Weight"');
    expect(html).toContain('<option value="lb">lb</option>');
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Check the highlighted values.");
  });

  test("a number that reads two ways names both readings (#455)", () => {
    const kind = findLogKind("weight")!;
    const form = (value: string) =>
      render(
        <QuickForm
          kind={kind}
          values={{ ...quickFormDefaults(kind), value }}
          errors={[]}
          showErrors={false}
          supplements={null}
          pending={false}
          failed={false}
          onChange={noop}
          onSubmit={noop}
          onBack={noop}
        />,
      );
    expect(form("1,250")).toContain(
      "“1,250” could mean 1250 or 1.25. Type 1250 or 1.25, whichever you mean.",
    );
    expect(form("82,4")).not.toContain("could mean");
    expect(form("1.250")).not.toContain("could mean");
  });

  test("supplement: the member's own supplements with their dose", () => {
    const kind = findLogKind("supplement_intake")!;
    const html = render(
      <QuickForm
        kind={kind}
        values={quickFormDefaults(kind)}
        errors={[]}
        showErrors={false}
        supplements={[{ id: 3, name: "Magnesium", dose: "200 mg" }]}
        pending={false}
        failed={false}
        onChange={noop}
        onSubmit={noop}
        onBack={noop}
      />,
    );
    expect(html).toContain("Magnesium · 200 mg");
    expect(html).not.toContain('role="alert"');
  });

  test("sleep quality is a set of toggle buttons", () => {
    const kind = findLogKind("sleep")!;
    const html = render(
      <QuickForm
        kind={kind}
        values={{ ...quickFormDefaults(kind), quality: "4" }}
        errors={[]}
        showErrors={false}
        supplements={null}
        pending={false}
        failed={false}
        onChange={noop}
        onSubmit={noop}
        onBack={noop}
      />,
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Good");
  });

  const tracker = (type: TrackerForLogKind["type"]) =>
    trackerLogKind({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Sauna",
      icon: "flame",
      type,
      unit: null,
      decimals: 0,
      canLog: true,
      archivedAt: null,
    });
  const renderTracker = (type: TrackerForLogKind["type"], values = {}, errors: string[] = []) => {
    const kind = tracker(type);
    return render(
      <QuickForm
        kind={kind}
        values={{ ...quickFormDefaults(kind), ...values }}
        errors={errors}
        showErrors={errors.length > 0}
        supplements={null}
        pending={false}
        failed={false}
        onChange={noop}
        onSubmit={noop}
        onBack={noop}
      />,
    );
  };

  test("a tracker's duration is typed, with an example and a note field", () => {
    const html = renderTracker("duration", {}, ["value"]);
    expect(html).toContain("<h2");
    expect(html).toContain("Sauna");
    expect(html).toContain("Such as 20 min, 1:30 or 45 s.");
    expect(html).toContain("Enter a duration such as 20 min, 1:30 or 45 s.");
    expect(html).toContain("<textarea");
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('type="datetime-local"');
  });

  test("a tracker's yes/no and 1–5 rating are toggle buttons", () => {
    const yesNo = renderTracker("yes_no", { value: "yes" });
    expect(yesNo).toContain(">Yes</button>");
    expect(yesNo).toContain(">No</button>");
    expect(yesNo).toContain('aria-pressed="true"');
    const rating = renderTracker("scale", { value: "3" });
    expect(rating).toContain(">5</button>");
    expect(rating).not.toContain("(optional)</span></legend>");
  });
});

test("Command renders a labelled combobox with grouped options", () => {
  const html = render(
    <Command label="Log or go to">
      <CommandInput placeholder="Search" />
      <CommandList>
        <CommandGroup heading="Log">
          <CommandItem value="water">Water</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>,
  );
  expect(html).toContain('role="combobox"');
  expect(html).toContain('role="listbox"');
  expect(html).toContain('role="option"');
  expect(html).toContain("Water");
});
