import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = new URL("./simulate-ab-test.mjs", import.meta.url);
const required = ["--experiment-id=e", "--variant-a=a", "--variant-b=b"];

test("simulator rejects malformed options before posting events", () => {
  for (const option of ["--visitors", "--visitors=", "--visitors=0", "--visitors=1.2",
    "--visitors=9007199254740992", "--rate-a=2", "--rate-b=NaN", "--typo=1",
    "--api-url=file:///tmp/events", "--seed= "]) {
    const result = spawnSync(process.execPath, [fileURLToPath(script), ...required, option], { encoding: "utf8" });
    assert.notEqual(result.status, 0, option);
    assert.doesNotMatch(result.stdout, /Posting events/);
  }
});

test("simulator help succeeds without experiment identifiers", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(script), "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});

async function runSimulator(endpoint, extra = []) {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(script), ...required,
      `--api-url=${endpoint}`, "--visitors=8", "--rate-a=1", "--rate-b=1", ...extra]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("simulation runs are isolated, reproducible, and post impressions first", async () => {
  const { createServer } = await import("node:http");
  const events = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    events.push(JSON.parse(body));
    response.writeHead(201).end('{}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/api/events`;
    const run = async (args) => {
      events.length = 0;
      const result = await runSimulator(endpoint, args);
      assert.equal(result.code, 0, result.stderr);
      return [...events].sort((a, b) => a.idempotencyKey.localeCompare(b.idempotencyKey));
    };
    const first = await run(["--run-id=repeat"]);
    assert.equal(first.length, 16);
    assert.deepEqual(await run(["--run-id=repeat", "--concurrency=1"]), first);
    const independent = await run([]);
    assert.ok(independent.every((event) => !first.some((prior) => prior.idempotencyKey === event.idempotencyKey)));
    const next = await run([]);
    assert.ok(next.every((event) => !independent.some((prior) => prior.idempotencyKey === event.idempotencyKey)));
    const seen = new Set();
    for (const event of events) {
      if (event.type === "impression") seen.add(event.sessionId);
      else assert.ok(seen.has(event.sessionId));
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
