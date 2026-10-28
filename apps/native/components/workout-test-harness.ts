import * as React from "react";
let domRegistered = false;

export async function setupMountedHarness() {
  const { GlobalRegistrator } =
    await import("../../web/node_modules/@happy-dom/global-registrator");
  if (!domRegistered) {
    GlobalRegistrator.register({ url: "http://localhost:3000" });
    domRegistered = true;
  }
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const host = (tag: string) => (props: Record<string, unknown>) => React.createElement(tag, props);
  const View = ({ children, accessibilityLabel, ...props }: Record<string, any>) =>
    React.createElement("div", { ...props, "aria-label": accessibilityLabel }, children);
  const Text = ({
    children,
    accessibilityRole,
    accessibilityLabel,
    ...props
  }: Record<string, any>) =>
    React.createElement(
      "span",
      { ...props, role: accessibilityRole, "aria-label": accessibilityLabel },
      children,
    );
  const TextInput = ({ onChangeText, accessibilityLabel, ...props }: Record<string, any>) =>
    React.createElement("input", {
      ...props,
      "aria-label": accessibilityLabel,
      onChange: (event: Event) => onChangeText?.((event.currentTarget as HTMLInputElement).value),
    });
  const Pressable = ({
    children,
    onPress,
    accessibilityRole,
    accessibilityLabel,
    accessibilityState,
    disabled,
    ...props
  }: Record<string, any>) =>
    React.createElement(
      "button",
      {
        ...props,
        type: "button",
        role: accessibilityRole,
        "aria-label": accessibilityLabel,
        "aria-checked": accessibilityState?.checked,
        disabled,
        onClick: onPress,
      },
      children,
    );
  const alerts: Array<{
    title: string;
    message?: string;
    buttons?: Array<{ text: string; onPress?: () => void }>;
  }> = [];
  const alert = (
    title: string,
    message?: string,
    buttons?: Array<{ text: string; onPress?: () => void }>,
  ) => alerts.push({ title, message, buttons });
  const { mock } = await import("bun:test");
  mock.module("react-native", () => ({
    View,
    Text,
    TextInput,
    Pressable,
    ScrollView: View,
    Modal: ({ visible, children }: Record<string, any>) =>
      visible ? React.createElement("div", { role: "dialog" }, children) : null,
    Alert: { alert },
    Platform: { OS: "ios" },
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  }));
  mock.module("heroui-native", () => ({
    Button: Object.assign(
      ({ children, onPress, isDisabled }: Record<string, any>) =>
        React.createElement(
          "button",
          { type: "button", disabled: isDisabled, onClick: onPress },
          children,
        ),
      { Label: ({ children }: { children: React.ReactNode }) => children },
    ),
    Card: "div",
    Spinner: "span",
  }));
  mock.module("react-native-svg", () => ({
    default: host("svg"),
    Circle: host("circle"),
    Path: host("path"),
    Rect: host("rect"),
  }));
  mock.module("react-native-gifted-charts", () => ({}));
  mock.module("expo-crypto", () => ({ randomUUID: () => "12345678-1234-4234-8234-123456789abc" }));
  mock.module("@/utils/theme", () => ({ useThemeColor: () => "#333" }));
  mock.module("@lingui/react/macro", () => ({
    Trans: ({ children }: { children: React.ReactNode }) => children,
    useLingui: () => ({
      t: (parts: TemplateStringsArray, ...values: unknown[]) =>
        String.raw({ raw: parts.raw }, ...(values as string[])),
      i18n: { locale: "en", _: (value: string) => value },
    }),
  }));
  mock.module("@lingui/core/macro", () => ({
    plural: (count: number, options: { one: string; other: string }) =>
      count === 1 ? options.one.replace("#", "1") : options.other.replace("#", String(count)),
  }));
  const [{ createRoot }, { I18nProvider }, { englishI18n }] = await Promise.all([
    import("react-dom/client"),
    import("@lingui/react"),
    import("@openvalens/i18n/testing"),
  ]);
  await englishI18n.loadAndActivate({ locale: "en", messages: {} });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (node: React.ReactNode) =>
    React.act(async () =>
      root.render(React.createElement(I18nProvider, { i18n: englishI18n }, node)),
    );
  const click = async (label: string) => {
    const button = Array.from(container.querySelectorAll("button")).find((element) =>
      element.textContent?.includes(label),
    );
    if (!button) throw new Error(`Missing button ${label}; rendered ${container.textContent}`);
    await React.act(async () => button.click());
  };
  const change = async (input: HTMLInputElement, value: string) =>
    React.act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  const cleanup = async () => {
    await React.act(async () => root.unmount());
    container.remove();
  };
  return { React, container, root, alerts, render, click, change, cleanup };
}
