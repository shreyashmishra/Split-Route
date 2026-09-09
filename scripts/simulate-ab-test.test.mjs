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
