import assert from "node:assert/strict";
import test from "node:test";
import { betaParameters, posteriorSummary, probabilityBBeatsA } from "./bayesian";

test("uses the Beta(1, 1) prior when there is no data", () => {
  const probability = probabilityBBeatsA(
    { impressions: 0, conversions: 0 },
    { impressions: 0, conversions: 0 },
  );

  assert.ok(probability > 0.47 && probability < 0.53);
  assert.deepEqual(betaParameters({ impressions: 0, conversions: 0 }), {
    alpha: 1,
    beta: 1,
  });
});

test("identifies a clear winner", () => {
  const probability = probabilityBBeatsA(
    { impressions: 1_000, conversions: 100 },
    { impressions: 1_000, conversions: 250 },
  );

  assert.ok(probability > 0.999);
});

test("keeps a near-tie close to 50 percent", () => {
  const probability = probabilityBBeatsA(
    { impressions: 200, conversions: 20 },
    { impressions: 200, conversions: 21 },
  );

  assert.ok(probability > 0.40 && probability < 0.60);
});

test("does not become overconfident with a small sample", () => {
  const probability = probabilityBBeatsA(
    { impressions: 1, conversions: 0 },
    { impressions: 1, conversions: 1 },
  );

  assert.ok(probability > 0.15 && probability < 0.85);
});

test("reports posterior uncertainty with a 95 percent credible interval", () => {
  const posterior = posteriorSummary({ impressions: 1_000, conversions: 100 });

  assert.equal(posterior.alpha, 101);
  assert.equal(posterior.beta, 901);
  assert.equal(posterior.mean, 101 / 1002);
  assert.ok(posterior.credibleInterval95[0] < posterior.mean);
  assert.ok(posterior.credibleInterval95[1] > posterior.mean);
  assert.ok(posterior.credibleInterval95[1] - posterior.credibleInterval95[0] < 0.06);
});
