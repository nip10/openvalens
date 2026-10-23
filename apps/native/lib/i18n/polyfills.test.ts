import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

/**
 * Hermes plural test (#67). Hermes ships without Intl.PluralRules and
 * Intl.Locale; this runs the app's polyfill module in a fresh process with
 * both removed, then checks plural selection for Portuguese (pt-PT) and
 * Polish (one/few/many), through Intl and through Lingui.
 */
const SCRIPT = `
delete Intl.PluralRules;
delete Intl.Locale;
await import(${JSON.stringify(fileURLToPath(new URL("./polyfills.ts", import.meta.url)))});
const { setupI18n } = await import("@lingui/core");
const { compileMessage } = await import("@lingui/message-utils/compileMessage");
const i18n = setupI18n();
const message = "{count, plural, one {# one} few {# few} many {# many} other {# other}}";
const out = {};
for (const locale of ["pt-PT", "pl"]) {
  i18n.loadAndActivate({ locale, messages: { m: compileMessage(message) } });
  out[locale] = [0, 1, 2, 5, 22].map((count) => i18n._("m", { count }));
}
out.polyfilled = typeof Intl.PluralRules.__addLocaleData === "function";
out.locale = new Intl.Locale("pt-PT").language;
console.log(JSON.stringify(out));
`;

describe("Hermes Intl polyfills", () => {
  test("plural selection works for pt-PT and Polish without native Intl.PluralRules", async () => {
    const child = Bun.spawn(["bun", "-e", SCRIPT], {
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = [
      await new Response(child.stdout).text(),
      await new Response(child.stderr).text(),
    ];
    expect(await child.exited, stderr).toBe(0);
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(result.polyfilled).toBe(true);
    expect(result.locale).toBe("pt");
    // CLDR pt-PT: "one" is exactly 1; 0 is "other" (unlike pt-BR).
    expect(result["pt-PT"]).toEqual(["0 other", "1 one", "2 other", "5 other", "22 other"]);
    expect(result.pl).toEqual(["0 many", "1 one", "2 few", "5 many", "22 few"]);
  });
});
