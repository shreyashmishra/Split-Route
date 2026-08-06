import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { apiError, apiJson } from "../lib/api.server";

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") return apiJson({}, undefined, true);
  if (request.method !== "GET") return apiError("Method not allowed", 405, true);

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId")?.trim();
  const shopDomain = url.searchParams.get("shop")?.trim();
  if (!productId || !shopDomain) {
    return apiError("productId and shop are required", 400, true);
  }

  const numericProductId = productId.match(/^gid:\/\/shopify\/Product\/(\d+)$/)?.[1];
  const productIds = numericProductId ? [productId, numericProductId] : [productId];
  const experiment = await db.experiment.findFirst({
    where: {
      shopDomain,
      status: "running",
      productId: { in: productIds },
    },
    orderBy: { createdAt: "desc" },
    include: { variants: { orderBy: { name: "asc" } } },
  });

  if (!experiment) return apiJson({ experiment: null }, undefined, true);

  return apiJson(
    {
      experiment: {
        id: experiment.id,
        productId: experiment.productId,
        variants: experiment.variants.map((variant) => ({
          id: variant.id,
          name: variant.name,
          config: variant.config,
        })),
      },
    },
    undefined,
    true,
  );
}
