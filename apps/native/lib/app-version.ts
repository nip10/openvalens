import { appSourceCodeUrl } from "@openvalens/api/source-code";
import * as Application from "expo-application";
import Constants from "expo-constants";

/**
 * Issue #306 — what the About screen says about this build.
 *
 * `version` is the release (`app.json` → `expo.version`, set from the root
 * `package.json` by `bun run release:version`). The JavaScript bundle carries
 * it, so it is right even in a development client. `build` is the store build
 * number EAS assigns (`appVersionSource: remote`), read from the native
 * binary; it is null on the web.
 */
export type AppBuildInfo = {
  version: string | null;
  build: string | null;
  /** The source at the release tag (LICENSE-APP-STORE notice). */
  sourceUrl: string;
};

export function appBuildInfo(): AppBuildInfo {
  const version = Constants.expoConfig?.version ?? Application.nativeApplicationVersion ?? null;
  return {
    version,
    build: Application.nativeBuildVersion ?? null,
    sourceUrl: appSourceCodeUrl(version),
  };
}
