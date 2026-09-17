#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";

const DEFAULTS = {
  apiUrl: "http://localhost:3000/api/events",
  visitors: 1_000,
  rateA: 0.1,
  rateB: 0.14,
  concurrency: 100,
  seed: 42,
  timeoutMs: 10_000,
};

const options = parseArgs(process.argv.slice(2));
if (options.help || !options.experimentId || !options.variantA || !options.variantB) {
  printUsage();
  process.exit(options.help ? 0 : 1);
}

const config = {
  apiUrl: options.apiUrl ?? DEFAULTS.apiUrl,
  experimentId: options.experimentId,
  variantA: options.variantA,
  variantB: options.variantB,
  visitors: integerOption(options.visitors, DEFAULTS.visitors, "visitors"),
  rateA: rateOption(options.rateA, DEFAULTS.rateA, "rate-a"),
  rateB: rateOption(options.rateB, DEFAULTS.rateB, "rate-b"),
  concurrency: integerOption(options.concurrency, DEFAULTS.concurrency, "concurrency"),
  seed: integerOption(options.seed, DEFAULTS.seed, "seed"),
  runId: options.runId ?? randomUUID(),
  timeoutMs: integerOption(options.timeoutMs, DEFAULTS.timeoutMs, "timeout-ms"),
};

if (config.timeoutMs > 2_147_483_647) throw new Error("--timeout-ms must be at most 2147483647");
if (config.variantA === config.variantB) throw new Error("A and B must use different variant IDs");
const endpoint = new URL(config.apiUrl);
if (!["http:", "https:"].includes(endpoint.protocol)) {
  throw new Error("--api-url must use HTTP or HTTPS");
}

const namespace = createHash("sha256").update(JSON.stringify([
  config.experimentId, config.variantA, config.variantB, config.runId,
  config.seed, config.rateA, config.rateB,
])).digest("hex");
const random = mulberry32(config.seed);
const summary = {
  A: { visitors: 0, conversions: 0 },
  B: { visitors: 0, conversions: 0 },
};

console.log(`Simulating ${config.visitors.toLocaleString()} visitors`);
console.log(`A true conversion rate: ${(config.rateA * 100).toFixed(2)}%`);
console.log(`B true conversion rate: ${(config.rateB * 100).toFixed(2)}%`);
console.log(`Run ID: ${config.runId}`);
console.log(`Posting events to ${config.apiUrl}`);

for (let start = 0; start < config.visitors; start += config.concurrency) {
  const end = Math.min(start + config.concurrency, config.visitors);
  await Promise.all(
    Array.from({ length: end - start }, (_, offset) => simulateVisitor(start + offset)),
  );
  process.stdout.write(`\rProcessed ${end.toLocaleString()} / ${config.visitors.toLocaleString()}`);
}

console.log("\n\nObserved results:");
for (const variant of ["A", "B"]) {
  const result = summary[variant];
  console.log(
    `${variant}: ${result.visitors} visitors, ${result.conversions} conversions, ` +
      `${result.visitors ? ((result.conversions / result.visitors) * 100).toFixed(2) + "%" : "N/A"} observed rate`,
  );
}
console.log("\nOpen the experiment detail page to inspect the Bayesian win probability.");
console.log("For a no-effect control run, repeat with --rate-a=0.10 --rate-b=0.10.");

async function simulateVisitor(index) {
  const variantName = random() < 0.5 ? "A" : "B";
  const variantId = variantName === "A" ? config.variantA : config.variantB;
  const trueRate = variantName === "A" ? config.rateA : config.rateB;
  const sessionId = `simulation-${namespace}-${index}`;
  const converted = random() < trueRate;

  summary[variantName].visitors += 1;
  await postEvent({
    experimentId: config.experimentId,
    variantId,
    sessionId,
    idempotencyKey: `simulation:${namespace}:${index}:impression`,
    type: "impression",
  });

  if (converted) {
    summary[variantName].conversions += 1;
    await postEvent({
      experimentId: config.experimentId,
      variantId,
      sessionId,
      idempotencyKey: `simulation:${namespace}:${index}:conversion`,
      type: "conversion",
    });
  }
}

async function postEvent(event) {
  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const message = await response.text();
  if (!response.ok) {
    throw new Error(`Event failed (${response.status}): ${message}`);
  }
}

function parseArgs(args) {
  const allowed = new Set([
    "api-url", "experiment-id", "variant-a", "variant-b", "visitors",
    "rate-a", "rate-b", "concurrency", "seed", "run-id", "timeout-ms",
  ]);
  const parsed = {};
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") { parsed.help = true; continue; }
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match || !allowed.has(match[1]) || !match[2].trim()) {
      throw new Error(`Invalid option: ${arg}. Use --help for supported --name=value options.`);
    }
    const key = camelCase(match[1]);
    if (key in parsed) throw new Error(`Duplicate option: --${match[1]}`);
    parsed[key] = match[2].trim();
  }
  return parsed;
}

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function integerOption(value, fallback, name) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`--${name} must be a positive integer`);
  return result;
}

function rateOption(value, fallback, name) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(result) || result < 0 || result > 1) throw new Error(`--${name} must be between 0 and 1`);
  return result;
}

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function printUsage() {
  console.log(`Usage:
  node scripts/simulate-ab-test.mjs \\
    --experiment-id=<id> --variant-a=<id> --variant-b=<id> [options]

Options:
  --api-url=<url>       Event endpoint (default: ${DEFAULTS.apiUrl})
  --visitors=<n>        Visitors to simulate (default: ${DEFAULTS.visitors})
  --rate-a=<0..1>       True conversion rate for A (default: ${DEFAULTS.rateA})
  --rate-b=<0..1>       True conversion rate for B (default: ${DEFAULTS.rateB})
  --concurrency=<n>     In-flight visitors (default: ${DEFAULTS.concurrency})
  --timeout-ms=<n>      Per-request timeout (default: ${DEFAULTS.timeoutMs} ms)
  --run-id=<id>         Reuse to replay a run idempotently (default: new UUID)
  --seed=<n>            Reproducible random seed (default: ${DEFAULTS.seed})`);
}
