import type { HomeWidgetAction, HomeWidgetView } from "./model";

/**
 * The Android home-screen widget's layout (#449), in react-native-android-widget's
 * widget components. Imported only by `platform.android.ts`, so the library
 * never loads on iOS.
 */

type Library = typeof import("react-native-android-widget");

type Palette = {
  background: `#${string}`;
  tile: `#${string}`;
  ink: `#${string}`;
  muted: `#${string}`;
  tones: Record<HomeWidgetAction, `#${string}`>;
};

// The app's paper, ink and log-kind tones (global.css).
const LIGHT: Palette = {
  background: "#fbf1ea",
  tile: "#f6e6dc",
  ink: "#2e211c",
  muted: "#7a665b",
  tones: { water: "#3f87a6", supplement: "#b9821c", log: "#c2512e" },
};
const DARK: Palette = {
  background: "#1d1613",
  tile: "#261d19",
  ink: "#f6ebe4",
  muted: "#b5a297",
  tones: { water: "#80c3de", supplement: "#e8b65a", log: "#f08a66" },
};

// Lucide's droplet, pill and plus.
const ICON_PATHS: Record<HomeWidgetAction, string> = {
  water:
    '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  supplement:
    '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
  log: '<path d="M5 12h14"/><path d="M12 5v14"/>',
};

const icon = (action: HomeWidgetAction, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[action]}</svg>`;

function WidgetLayout({
  lib,
  view,
  palette,
}: {
  lib: Library;
  view: HomeWidgetView;
  palette: Palette;
}) {
  const { FlexWidget, SvgWidget, TextWidget } = lib;
  if (view.type === "signed_out")
    return (
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: view.url }}
        accessibilityLabel={view.text}
        style={{
          height: "match_parent",
          width: "match_parent",
          justifyContent: "center",
          alignItems: "center",
          padding: 16,
          borderRadius: 22,
          backgroundColor: palette.background,
        }}
      >
        <TextWidget
          text={view.text}
          maxLines={3}
          style={{ fontSize: 14, color: palette.ink, textAlign: "center" }}
        />
      </FlexWidget>
    );
  return (
    <FlexWidget
      style={{
        height: "match_parent",
        width: "match_parent",
        flexDirection: "row",
        flexGap: 8,
        padding: 8,
        borderRadius: 22,
        backgroundColor: palette.background,
      }}
    >
      {view.buttons.map((button) => (
        <FlexWidget
          key={button.action}
          clickAction="OPEN_URI"
          clickActionData={{ uri: button.url }}
          accessibilityLabel={`${button.label}, ${button.detail}`}
          style={{
            flex: 1,
            height: "match_parent",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "flex-start",
            flexGap: 4,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 16,
            backgroundColor: palette.tile,
          }}
        >
          <SvgWidget
            svg={icon(button.action, palette.tones[button.action])}
            style={{ height: 22, width: 22 }}
          />
          <TextWidget
            text={button.label}
            maxLines={1}
            truncate="END"
            style={{ fontSize: 15, fontWeight: "600", color: palette.ink }}
          />
          <TextWidget
            text={button.detail}
            maxLines={1}
            truncate="END"
            style={{ fontSize: 13, color: palette.muted }}
          />
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}

/** The widget for light and dark home screens. */
export function widgetLayouts(lib: Library, view: HomeWidgetView) {
  return {
    light: <WidgetLayout lib={lib} view={view} palette={LIGHT} />,
    dark: <WidgetLayout lib={lib} view={view} palette={DARK} />,
  };
}
