import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { apiError, apiJson, isRecord, readJson } from "../lib/api.server";

const EXPERIMENT_STATUSES = new Set(["draft", "running", "completed"]);
const VARIANT_NAMES = ["A", "B"] as const;

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const experiments = await db.experiment.findMany({
    where: { shopDomain: session.shop },
    orderBy: { createdAt: "desc" },
    include: { variants: { orderBy: { name: "asc" } } },
  });

  return apiJson({ experiments });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return apiError("Method not allowed", 405);

  const { session } = await authenticate.admin(request);
  let body: unknown;
  try {
    body = await readJson(request);
  } catch (error) {
    return apiError((error as Error).message, 400);
  }

  if (!isRecord(body)) return apiError("Request body must be an object", 400);

  const name = body.name;
  const productId = body.productId;
  if (typeof name !== "string" || !name.trim()) {
    return apiError("name is required", 400);
  }
  if (typeof productId !== "string" || !productId.trim()) {
    return apiError("productId is required", 400);
  }

  const status = body.status ?? "draft";
  if (typeof status !== "string" || !EXPERIMENT_STATUSES.has(status)) {
    return apiError("status must be draft, running, or completed", 400);
  }

  const variants = body.variants === undefined ? undefined : body.variants;
  if (variants !== undefined && !Array.isArray(variants)) {
    return apiError("variants must be an array with exactly A and B", 400);
  }
  if (Array.isArray(variants)) {
    const names = variants.map((variant) =>
      isRecord(variant) && typeof variant.name === "string" ? variant.name : "",
    );
    if (
      variants.length !== 2 ||
      names[0] !== VARIANT_NAMES[0] ||
      names[1] !== VARIANT_NAMES[1]
    ) {
      return apiError("variants must contain exactly A followed by B", 400);
    }
    if (
      variants.some(
        (variant) =>
          !isRecord(variant) ||
          !isRecord(variant.config ?? {}),
      )
    ) {
      return apiError("each variant config must be a JSON object", 400);
    }
  }

  const variantData = (variants ?? VARIANT_NAMES.map((name) => ({ name, config: {} }))).map(
    (variant) => ({
      name: isRecord(variant) ? (variant.name as string) : variant,
      config: (isRecord(variant) ? variant.config ?? {} : {}) as Prisma.InputJsonValue,
    }),
  );

  const experiment = await db.experiment.create({
    data: {
      shopDomain: session.shop,
      name: name.trim(),
      productId: productId.trim(),
      status,
      variants: { create: variantData },
    },
    include: { variants: true },
  });

  return apiJson({ experiment }, { status: 201 });
}
