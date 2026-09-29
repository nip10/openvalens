import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { expo } from "@better-auth/expo";
import type { Database } from "@openhealth/db";
import * as schema from "@openhealth/db/schema/auth";
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins/magic-link";

import { sendAuthMagicLink } from "./magic-link";

const MAGIC_LINK_EXPIRES_IN_SECONDS = 600;

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
};

export function createAuth(
  env: AuthConfig,
  database: Database,
  desktopOrigins: readonly string[] = [],
) {
  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "pg",
      schema,
    }),
    trustedOrigins: [
      env.CORS_ORIGIN,
      ...desktopOrigins,
      // TODO(#7 / #29): replace with the finalized native app scheme origin
      // once mobile device-session auth lands.
      "openhealth://",
      // Expo Go / dev-client deep links.
      "exp://",
      "exp://*",
      "http://localhost:8081",
    ],
    emailAndPassword: { enabled: false },
    socialProviders: {},
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
      },
    },
    plugins: [
      expo(),
      magicLink({
        disableSignUp: false,
        expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
        sendMagicLink: (data, ctx) =>
          sendAuthMagicLink(
            {
              email: data.email,
              url: data.url,
              token: data.token,
              correlationId: ctx?.getHeader("x-correlation-id"),
              requestId: ctx?.getHeader("x-request-id"),
            },
            { expiresInSeconds: MAGIC_LINK_EXPIRES_IN_SECONDS },
          ),
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
