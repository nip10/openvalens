import { describe, expect, jest, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ProductSettingsForm, type ProductSettingsFormProps } from "./product-settings-form";

function render(view: React.ReactElement) {
  return renderToStaticMarkup(view);
}

function readyProps(overrides?: Partial<ProductSettingsFormProps>): ProductSettingsFormProps {
  return {
    ownerId: "user-1",
    readState: {
      status: "ready",
      snapshot: {
        units: "metric",
        locale: "en-US",
        revision: 1,
        canEdit: true,
      },
    },
    onSave: jest.fn(async () => ({
      units: "metric" as const,
      locale: "en-US" as const,
      revision: 1,
      canEdit: true,
    })),
    ...overrides,
  };
}

describe("ProductSettingsForm", () => {
  test("loading state shows skeleton and no editable controls", () => {
    const html = render(
      <ProductSettingsForm {...readyProps()} readState={{ status: "loading" }} />,
    );

    expect(html).toInclude("Display defaults");
    expect(html).toInclude('data-slot="skeleton"');
    expect(html).not.toInclude("Save");
    expect(html).not.toInclude("Reset");
  });

  test("error state shows retry and no editable controls", () => {
    const onRetry = jest.fn();
    const html = render(
      <ProductSettingsForm
        {...readyProps()}
        readState={{
          status: "error",
          message: "Load failed",
          onRetry,
        }}
      />,
    );

    expect(html).toInclude("Load failed");
    expect(html).toInclude("Retry");
    expect(html).not.toInclude("Save");
  });

  test("ready editable state renders units and locale controls", () => {
    const html = render(<ProductSettingsForm {...readyProps()} />);

    expect(html).toInclude("Display defaults");
    expect(html).toInclude("Units");
    expect(html).toInclude("Locale");
    expect(html).toInclude("Metric");
    expect(html).toInclude("United States");
    expect(html).toInclude("Save");
    expect(html).toInclude("Reset");
  });

  test("locale hints use actual formatted dates", () => {
    const html = render(<ProductSettingsForm {...readyProps()} />);

    expect(html).toInclude("Jan 15, 2026");
    expect(html).not.toInclude("M/d/yyyy");
    expect(html).not.toInclude("yyyy-MM-dd");
  });

  test("read-only state hides write affordances but shows effective values", () => {
    const html = render(
      <ProductSettingsForm
        {...readyProps({
          readState: {
            status: "ready",
            snapshot: {
              units: "imperial",
              locale: "en-GB",
              revision: 3,
              canEdit: false,
            },
          },
        })}
      />,
    );

    expect(html).toInclude("Imperial");
    expect(html).toInclude("United Kingdom");
    expect(html).toInclude("You can view these settings but cannot edit them");
    expect(html).not.toInclude('type="submit"');
    expect(html).not.toInclude(">Save<");
    expect(html).not.toInclude(">Reset<");
  });

  test("preview reflects the selected units and locale", () => {
    const html = render(
      <ProductSettingsForm
        {...readyProps({
          readState: {
            status: "ready",
            snapshot: {
              units: "imperial",
              locale: "en-GB",
              revision: 1,
              canEdit: true,
            },
          },
        })}
      />,
    );

    expect(html).toInclude("220.5 lb");
    expect(html).toInclude("3.1 mi");
  });

  test("preview uses metric values by default", () => {
    const html = render(<ProductSettingsForm {...readyProps()} />);

    expect(html).toInclude("100.0 kg");
    expect(html).toInclude("5.0 km");
  });

  test("does not render secret fields or provider values", () => {
    const html = render(<ProductSettingsForm {...readyProps()} />);

    expect(html).not.toInclude("secret");
    expect(html).not.toInclude("password");
    expect(html).not.toInclude("token");
    expect(html).not.toInclude("VITE_");
  });

  test("associates labels with controls", () => {
    const html = render(<ProductSettingsForm {...readyProps()} />);

    const labelForUnits = html.match(new RegExp('<label[^>]*for="([^"]*)"[^>]*>Units</label>'));
    const labelForLocale = html.match(new RegExp('<label[^>]*for="([^"]*)"[^>]*>Locale</label>'));
    expect(labelForUnits).not.toBeNull();
    expect(labelForLocale).not.toBeNull();
    expect(html).toInclude(`id="${labelForUnits?.[1]}"`);
    expect(html).toInclude(`id="${labelForLocale?.[1]}"`);
  });
});
