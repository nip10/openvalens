import { describe, expect, test } from "bun:test";

import { issueConnectToken, TelegramConnectTokenError, verifyConnectToken } from "./connect-token";

const SECRET = "webhook-secret-at-least-16-chars";
const USER_ID = "user-1";
const ORG_ID = "org-1";

describe("issueConnectToken + verifyConnectToken", () => {
  test("round-trips the payload", async () => {
    const { token, expiresAt } = await issueConnectToken(
      { userId: USER_ID, organizationId: ORG_ID, expiresInSeconds: 600 },
      SECRET,
    );

    const payload = await verifyConnectToken(token, SECRET);

    expect(payload).toEqual({ userId: USER_ID, organizationId: ORG_ID, expiresAt });
    expect(token.split(".")).toHaveLength(2);
  });

  test("rejects a tampered signature with CONNECT_TOKEN_INVALID", async () => {
    const { token } = await issueConnectToken(
      { userId: USER_ID, organizationId: ORG_ID, expiresInSeconds: 600 },
      SECRET,
    );

    const [payloadB64] = token.split(".");
    const tampered = `${payloadB64}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

    await expect(verifyConnectToken(tampered, SECRET)).rejects.toMatchObject({
      code: "CONNECT_TOKEN_INVALID",
    });
  });

  test("rejects a token signed with a different secret", async () => {
    const { token } = await issueConnectToken(
      { userId: USER_ID, organizationId: ORG_ID, expiresInSeconds: 600 },
      "another-secret-at-least-16-chars",
    );

    await expect(verifyConnectToken(token, SECRET)).rejects.toBeInstanceOf(
      TelegramConnectTokenError,
    );
  });

  test("rejects an expired token with CONNECT_TOKEN_EXPIRED", async () => {
    const { token } = await issueConnectToken(
      { userId: USER_ID, organizationId: ORG_ID, expiresInSeconds: -1 },
      SECRET,
    );

    await expect(verifyConnectToken(token, SECRET)).rejects.toMatchObject({
      code: "CONNECT_TOKEN_EXPIRED",
    });
  });

  test("rejects a malformed token", async () => {
    await expect(verifyConnectToken("not-a-token", SECRET)).rejects.toMatchObject({
      code: "CONNECT_TOKEN_INVALID",
    });
  });

  test("rejects a payload whose JSON was replaced but re-signed with a bad secret", async () => {
    const { token } = await issueConnectToken(
      { userId: USER_ID, organizationId: ORG_ID, expiresInSeconds: 600 },
      SECRET,
    );

    const parts = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({
        userId: "attacker",
        organizationId: ORG_ID,
        expiresAt: "2999-01-01T00:00:00.000Z",
      }),
    ).toString("base64url");
    const forged = `${forgedPayload}.${parts[1]}`;

    await expect(verifyConnectToken(forged, SECRET)).rejects.toMatchObject({
      code: "CONNECT_TOKEN_INVALID",
    });
  });
});
