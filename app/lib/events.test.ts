import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";

// Replace the database before importing the route: no development data is touched.
const event = {
  experimentId: "experiment", variantId: "variant", sessionId: "visitor",
  type: "conversion", idempotencyKey: "retry",
};
let collision = false;
let lookups = 0;
let existing = { ...event };
let impressionSession: unknown;
global.prismaGlobal = {
  variant: { findFirst: async () => ({ id: event.variantId }) },
  event: {
    findUnique: async () => ++lookups === 1 ? null : existing,
    findFirst: async ({ where }: { where: { sessionId: string } }) => {
      impressionSession = where.sessionId;
      return where.sessionId === "visitor" ? { id: "impression" } : null;
    },
    create: async () => {
      if (collision) throw new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002", clientVersion: "6",
      });
      return event;
    },
  },
} as unknown as PrismaClient;
const { action } = await import("../routes/api.events");

async function submit() {
  lookups = 0;
  return action({ request: new Request("http://localhost/api/events", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...event, sessionId: " visitor " }),
  }) } as ActionFunctionArgs);
}

test("normalizes sessions and checks identity after concurrent key collisions", async () => {
  assert.equal((await submit()).status, 201);
  assert.equal(impressionSession, "visitor");
  collision = true;
  const duplicate = await submit();
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
  for (const key of ["experimentId", "variantId", "sessionId", "type"] as const) {
    existing = { ...event, [key]: "different" };
    assert.equal((await submit()).status, 409, key);
  }
});
