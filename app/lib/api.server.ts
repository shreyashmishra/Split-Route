const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
};

const publicCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function apiJson(
  body: unknown,
  init: ResponseInit = {},
  publicCors = false,
): Response {
  const headers = new Headers(init.headers);
  Object.entries(jsonHeaders).forEach(([key, value]) => headers.set(key, value));
  if (publicCors) {
    Object.entries(publicCorsHeaders).forEach(([key, value]) =>
      headers.set(key, value),
    );
  }

  return new Response(JSON.stringify(body), { ...init, headers });
}

export function apiError(
  message: string,
  status: number,
  publicCors = false,
): Response {
  return apiJson({ error: message }, { status }, publicCors);
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
