import { describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { findLogKind } from "@openvalens/api/presenters/log-kinds";
import { quickFormDefaults } from "@openvalens/api/presenters/quick-log";
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
