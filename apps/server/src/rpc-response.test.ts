import { expect, test } from "bun:test";
import { os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";
import { forwardRpcResponse } from "./rpc-response";

test("a private photo RPC retains its multipart boundary and middleware headers", async () => {
  const handler = new RPCHandler({
    photo: os.handler(() => new Blob(["synthetic photo"], { type: "image/png" })),
  });
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.header("access-control-allow-origin", "https://app.example.test");
    c.header("x-content-type-options", "nosniff");
    await next();
  });
  app.post("/rpc/*", async (c) => {
    const result = await handler.handle(c.req.raw, { prefix: "/rpc" });
    if (!result.matched) return c.notFound();
    return forwardRpcResponse(c, result.response);
  });
  const response = await app.request("/rpc/photo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: {} }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
  expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example.test");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  const parts = await response.formData();
  const files = [...parts.values()].filter((part) => typeof part !== "string");
  expect(files).toHaveLength(1);
  expect(await files[0]!.text()).toBe("synthetic photo");
});
