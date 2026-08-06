import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import {
  posteriorSummary,
  probabilityBBeatsA,
  type ConversionCounts,
} from "../lib/bayesian";
import { apiError, apiJson } from "../lib/api.server";
import { authenticate } from "../shopify.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const experimentId = params.id;
  if (!experimentId) return apiError("Experiment id is required", 400);

  const experiment = await db.experiment.findFirst({
    where: { id: experimentId, shopDomain: session.shop },
    include: { variants: { orderBy: { name: "asc" } } },
  });
  if (!experiment) return apiError("Experiment not found", 404);
  if (experiment.variants.length !== 2) {
    return apiError("Experiment must have exactly two variants", 500);
  }

  const variantResults = await Promise.all(
    experiment.variants.map(async (variant) => {
      const [impressions, conversions] = await Promise.all([
        db.event.count({ where: { experimentId, variantId: variant.id, type: "impression" } }),
        db.event.count({ where: { experimentId, variantId: variant.id, type: "conversion" } }),
      ]);
      const counts: ConversionCounts = { impressions, conversions };
      const posterior = posteriorSummary(counts);
      return {
        id: variant.id,
        name: variant.name,
        config: variant.config,
        impressions,
        conversions,
        conversionRate: impressions === 0 ? 0 : conversions / impressions,
        alpha: posterior.alpha,
        beta: posterior.beta,
        posteriorMean: posterior.mean,
        credibleInterval95: posterior.credibleInterval95,
        counts,
      };
    }),
  );

  const variantA = variantResults.find((variant) => variant.name === "A") ?? variantResults[0];
  const variantB = variantResults.find((variant) => variant.name === "B") ?? variantResults[1];
  const probabilityBBeatsA = probabilityBBeatsAValue(variantA.counts, variantB.counts);

  return apiJson({
    experiment: {
      id: experiment.id,
      shopDomain: experiment.shopDomain,
      name: experiment.name,
      productId: experiment.productId,
      status: experiment.status,
      createdAt: experiment.createdAt,
    },
    variants: variantResults,
    winProbability: {
      variantA: variantA.name,
      variantB: variantB.name,
      probabilityBBeatsA,
      samples: 10_000,
    },
  });
}

// Keep the route-level response explicit about the configured Monte Carlo
// size while leaving the stats engine reusable for tests and other callers.
function probabilityBBeatsAValue(a: ConversionCounts, b: ConversionCounts): number {
  return probabilityBBeatsA(a, b, { samples: 10_000 });
}
