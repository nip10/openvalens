import type { Hono } from "hono";

type PublishedAsset = {
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png";
  size: number;
};

export type ExerciseCatalogAssetReader = {
  readPublishedAsset(assetId: string): Promise<PublishedAsset | null>;
};

/** Registers the production public route; disabled capability installs no route. */
export function registerExerciseCatalogAssetRoute(
  app: Hono,
  options: {
    enabled: boolean;
    getService: () => Promise<ExerciseCatalogAssetReader | null>;
  },
): void {
  if (!options.enabled) return;
  app.get("/api/exercise-assets/:assetId", async (c) => {
    const assetId = c.req.param("assetId");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assetId)) {
      return c.json({ error: "NOT_FOUND" }, 404);
    }
    try {
      const service = await options.getService();
      if (!service) return c.json({ error: "NOT_FOUND" }, 404);
      const asset = await service.readPublishedAsset(assetId);
      if (!asset) return c.json({ error: "NOT_FOUND" }, 404);
      return c.body(Uint8Array.from(asset.bytes), 200, {
        "Content-Type": asset.contentType,
        "Content-Length": String(asset.size),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Cache-Control": "no-store",
      });
    } catch {
      return c.json({ error: "INTERNAL" }, 500);
    }
  });
}
