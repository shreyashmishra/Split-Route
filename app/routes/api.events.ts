import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { apiError, apiJson, isRecord, readJson } from "../lib/api.server";

const EVENT_TYPES = new Set(["impression", "conversion"]);

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return apiJson({}, undefined, true);
  }
  return apiError("Method not allowed", 405, true);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return apiJson({}, undefined, true);
  }
  if (request.method !== "POST") {
    return apiError("Method not allowed", 405, true);
  }

  let body: unknown;
  try {
    body = await readJson(request);
  } catch (error) {
    return apiError((error as Error).message, 400, true);
  }

  if (!isRecord(body)) {
    return apiError("Request body must be an object", 400, true);
  }

  const experimentId = body.experimentId;
  const variantId = body.variantId;
  const sessionId = body.sessionId;
  const type = body.type;
  if (
    typeof experimentId !== "string" ||
    typeof variantId !== "string" ||
    typeof sessionId !== "string" ||
    !sessionId.trim() ||
    typeof type !== "string" ||
    !EVENT_TYPES.has(type)
  ) {
    return apiError(
      "experimentId, variantId, sessionId, and type (impression or conversion) are required",
      400,
      true,
    );
  }

  const variant = await db.variant.findFirst({
    where: { id: variantId, experimentId },
    select: { id: true },
  });
  if (!variant) {
    return apiError("Variant does not belong to this experiment", 404, true);
  }

  // A conversion is a Bernoulli success, so require an impression first. This
  // prevents impossible conversion rates from entering the Beta posterior.
  if (type === "conversion") {
    const impression = await db.event.findFirst({
      where: { experimentId, variantId, sessionId, type: "impression" },
      select: { id: true },
    });
    if (!impression) {
      return apiError(
        "A conversion must follow an impression for the same session and variant",
        400,
        true,
      );
    }
  }

  const event = await db.event.create({
    data: { experimentId, variantId, sessionId: sessionId.trim(), type },
    select: { id: true, experimentId: true, variantId: true, type: true, createdAt: true },
  });

  return apiJson({ event }, { status: 201 }, true);
}
