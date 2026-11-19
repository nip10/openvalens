import type { Context } from "hono";

/** Preserve RPC transport metadata while adding Hono's prepared headers. */
export function forwardRpcResponse(context: Pick<Context, "newResponse">, response: Response) {
  // Bun generates a FormData boundary lazily. Reading the stream first loses
  // that implicit header when Hono copies it, so materialize headers first.
  response.headers.get("content-type");
  return context.newResponse(response.body, response);
}
