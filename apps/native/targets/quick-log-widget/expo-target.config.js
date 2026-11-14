// The iOS home-screen widget (#449), built by @bacons/apple-targets at prebuild.
// It is static: three buttons that open the app through a deep link. No App
// Group, shared keychain or credential, so it reads nothing from the app.
// Colours are the app's paper, ink and log-kind tones (global.css).

/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: "widget",
  name: "QuickLogWidget",
  bundleIdentifier: ".quicklogwidget",
  deploymentTarget: "17.0",
  frameworks: ["SwiftUI", "WidgetKit"],
  colors: {
    $accent: { light: "#c2512e", dark: "#f08a66" },
    $widgetBackground: { light: "#fbf1ea", dark: "#1d1613" },
    tile: { light: "#f6e6dc", dark: "#261d19" },
    ink: { light: "#2e211c", dark: "#f6ebe4" },
    muted: { light: "#7a665b", dark: "#b5a297" },
    water: { light: "#3f87a6", dark: "#80c3de" },
    supplement: { light: "#b9821c", dark: "#e8b65a" },
    log: { light: "#c2512e", dark: "#f08a66" },
  },
};
