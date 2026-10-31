/**
 * Issue #302 — the simulator, the emulator and the e2e build of the app.
 *
 * The suite runs a **release** build (JS bundled in, no dev launcher, dev
 * menu, tools button or LogBox) built with `EXPO_PUBLIC_ALLOW_LOCAL_HTTP=true`
 * so it may talk to the plain-HTTP local server. Everything here only touches
 * the suite's own simulator (`OpenValens-E2E`) and AVD (`ov-e2e`).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { E2E, NATIVE_DIR } from "./config";

export type Platform = "ios" | "android";

const ANDROID_HOME =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  "/opt/homebrew/share/android-commandlinetools";
export const ADB = join(ANDROID_HOME, "platform-tools", "adb");
const EMULATOR = join(ANDROID_HOME, "emulator", "emulator");
const APK = join(
  NATIVE_DIR,
  "android",
  "app",
  "build",
  "outputs",
  "apk",
  "release",
  "app-release.apk",
);

function log(message: string) {
  console.log(`[e2e] ${message}`);
}

async function sh(
  cmd: string[],
  options: { env?: Record<string, string>; cwd?: string; quiet?: boolean } = {},
) {
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd ?? NATIVE_DIR,
    env: { ...process.env, ...options.env },
    stdout: options.quiet === false ? "inherit" : "pipe",
    stderr: options.quiet === false ? "inherit" : "pipe",
  });
  const [out, err, code] = await Promise.all([
    options.quiet === false ? "" : new Response(proc.stdout as ReadableStream).text(),
    options.quiet === false ? "" : new Response(proc.stderr as ReadableStream).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${cmd.join(" ")} failed (${code})\n${out}\n${err}`);
  return out.trim();
}

/** The build-time environment of the e2e build. */
const BUILD_ENV = {
  CI: "1",
  NODE_ENV: "production",
  EXPO_PUBLIC_ALLOW_LOCAL_HTTP: "true",
  // Never locked to one server: the suite tests the server choice.
  EXPO_PUBLIC_SERVER_URL: "",
};

// ─── iOS ────────────────────────────────────────────────────────

export async function iosDevice(): Promise<string> {
  const list = JSON.parse(await sh(["xcrun", "simctl", "list", "devices", "available", "-j"])) as {
    devices: Record<string, { name: string; udid: string; state: string }[]>;
  };
  const all = Object.values(list.devices).flat();
  let device = all.find((d) => d.name === E2E.iosSimulator);
  if (!device) {
    log(`creating simulator ${E2E.iosSimulator} (${E2E.iosDeviceType})`);
    const udid = await sh(["xcrun", "simctl", "create", E2E.iosSimulator, E2E.iosDeviceType]);
    device = { name: E2E.iosSimulator, udid, state: "Shutdown" };
  }
  if (device.state !== "Booted") {
    log(`booting ${E2E.iosSimulator}`);
    await sh(["xcrun", "simctl", "boot", device.udid]);
    await sh(["xcrun", "simctl", "bootstatus", device.udid]);
  }
  // Fixed status bar, so screenshots do not show the run's time or battery.
  await sh([
    "xcrun",
    "simctl",
    "status_bar",
    device.udid,
    "override",
    "--time",
    "9:41",
    "--batteryState",
    "charged",
    "--batteryLevel",
    "100",
    "--cellularBars",
    "4",
    "--wifiBars",
    "3",
  ]);
  return device.udid;
}

async function iosInstalled(udid: string): Promise<boolean> {
  try {
    await sh(["xcrun", "simctl", "get_app_container", udid, E2E.appId]);
    return true;
  } catch {
    return false;
  }
}

export async function iosBuildAndInstall(udid: string, force: boolean) {
  if (!force && (await iosInstalled(udid))) return;
  log("building the iOS e2e app (Release, simulator)");
  if (!existsSync(join(NATIVE_DIR, "ios"))) {
    await sh(["bunx", "expo", "prebuild", "--platform", "ios"], { env: BUILD_ENV, quiet: false });
  }
  await sh(
    ["bunx", "expo", "run:ios", "--configuration", "Release", "--device", udid, "--no-bundler"],
    { env: BUILD_ENV, quiet: false },
  );
}

export async function iosAppearance(udid: string, theme: "light" | "dark") {
  await sh(["xcrun", "simctl", "ui", udid, "appearance", theme]);
}

// ─── Android ────────────────────────────────────────────────────

async function runningEmulator(): Promise<string | null> {
  const out = await sh([ADB, "devices"]);
  for (const line of out.split("\n")) {
    const serial = line.split("\t")[0] ?? "";
    if (!serial.startsWith("emulator-") || !line.endsWith("device")) continue;
    try {
      const name = await sh([ADB, "-s", serial, "emu", "avd", "name"]);
      if (name.split("\n")[0]?.trim() === E2E.androidAvd) return serial;
    } catch {
      // not answering; skip
    }
  }
  return null;
}

export async function androidDevice(): Promise<string> {
  let serial = await runningEmulator();
  if (!serial) {
    log(`booting the ${E2E.androidAvd} emulator`);
    const proc = Bun.spawn(
      [EMULATOR, "-avd", E2E.androidAvd, "-no-audio", "-no-boot-anim", "-no-snapshot-save"],
      { stdout: "ignore", stderr: "ignore", env: { ...process.env, ANDROID_HOME } },
    );
    proc.unref();
    const deadline = Date.now() + 240_000;
    while (!serial && Date.now() < deadline) {
      await Bun.sleep(3000);
      serial = await runningEmulator();
    }
    if (!serial) throw new Error(`the ${E2E.androidAvd} emulator did not start`);
  }
  while ((await sh([ADB, "-s", serial, "shell", "getprop", "sys.boot_completed"])) !== "1") {
    await Bun.sleep(2000);
  }
  // The app and Maestro's helper reach the host's loopback ports through adb.
  for (const port of [E2E.serverPort, E2E.helperPort]) {
    await sh([ADB, "-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`]);
  }
  // "Create an account" opens Chrome; skip its first-run screens.
  await sh([
    ADB,
    "-s",
    serial,
    "shell",
    "echo '_ --disable-fre --no-default-browser-check --no-first-run' > /data/local/tmp/chrome-command-line",
  ]);
  await sh([
    ADB,
    "-s",
    serial,
    "shell",
    "am",
    "set-debug-app",
    "--persistent",
    "com.android.chrome",
  ]);
  // Calm the screen for screenshots: fixed clock, full battery, no notifications.
  const demo = (args: string[]) =>
    sh([
      ADB,
      "-s",
      serial!,
      "shell",
      "am",
      "broadcast",
      "-a",
      "com.android.systemui.demo",
      ...args,
    ]);
  await sh([ADB, "-s", serial, "shell", "settings", "put", "global", "sysui_demo_allowed", "1"]);
  await demo(["-e", "command", "enter"]);
  await demo(["-e", "command", "clock", "-e", "hhmm", "0941"]);
  await demo(["-e", "command", "battery", "-e", "level", "100", "-e", "plugged", "false"]);
  await demo(["-e", "command", "notifications", "-e", "visible", "false"]);
  return serial;
}

export async function androidBuildAndInstall(serial: string, force: boolean) {
  const installed = (await sh([ADB, "-s", serial, "shell", "pm", "list", "packages", E2E.appId]))
    .split("\n")
    .some((line) => line.trim() === `package:${E2E.appId}`);
  if (force || !existsSync(APK)) {
    log("building the Android e2e app (release APK)");
    await sh(["bunx", "expo", "prebuild", "--platform", "android"], {
      env: BUILD_ENV,
      quiet: false,
    });
    await sh(["./gradlew", ":app:assembleRelease", "-PreactNativeArchitectures=arm64-v8a"], {
      cwd: join(NATIVE_DIR, "android"),
      env: { ...BUILD_ENV, ANDROID_HOME },
      quiet: false,
    });
  } else if (installed) {
    return;
  }
  log("installing the APK");
  await sh([ADB, "-s", serial, "install", "-r", "-d", APK]);
}

export async function androidAppearance(serial: string, theme: "light" | "dark") {
  await sh([ADB, "-s", serial, "shell", "cmd", "uimode", "night", theme === "dark" ? "yes" : "no"]);
}
