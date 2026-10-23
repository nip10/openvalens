module.exports = {
  presets: ["babel-preset-expo"],
  plugins: [
    require("@varlock/expo-integration/babel-plugin"),
    // Lingui macros (#67); the config is found at the repository root.
    "@lingui/babel-plugin-lingui-macro",
  ],
};
