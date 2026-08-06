#!/usr/bin/env node

const DEFAULTS = {
  apiUrl: "http://localhost:3000/api/events",
  visitors: 1_000,
  rateA: 0.1,
  rateB: 0.14,
  concurrency: 100,
  seed: 42,
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
};

const random = mulberry32(config.seed);
const summary = {
  A: { visitors: 0, conversions: 0 },
  B: { visitors: 0, conversions: 0 },
};

console.log(`Simulating ${config.visitors.toLocaleString()} visitors`);
console.log(`A true conversion rate: ${(config.rateA * 100).toFixed(2)}%`);
console.log(`B true conversion rate: ${(config.rateB * 100).toFixed(2)}%`);
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
      `${((result.conversions / result.visitors) * 100).toFixed(2)}% observed rate`,
  );
}
console.log("\nOpen the experiment detail page to inspect the Bayesian win probability.");
console.log("For a no-effect control run, repeat with --rate-a=0.10 --rate-b=0.10.");

async function simulateVisitor(index) {
  const variantName = random() < 0.5 ? "A" : "B";
  const variantId = variantName === "A" ? config.variantA : config.variantB;
  const trueRate = variantName === "A" ? config.rateA : config.rateB;
  const sessionId = `simulation-${config.seed}-${index}-${Math.floor(random() * 1e9)}`;
  const converted = random() < trueRate;

  summary[variantName].visitors += 1;
  await postEvent({
    experimentId: config.experimentId,
    variantId,
    sessionId,
    type: "impression",
  });

  if (converted) {
    summary[variantName].conversions += 1;
    await postEvent({
      experimentId: config.experimentId,
      variantId,
      sessionId,
      type: "conversion",
    });
  }
}

async function postEvent(event) {
  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Event failed (${response.status}): ${message}`);
  }
}

function parseArgs(args) {
  return Object.fromEntries(args.map((arg) => {
    if (arg === "--help" || arg === "-h") return ["help", true];
    const [key, ...valueParts] = arg.replace(/^--/, "").split("=");
    return [camelCase(key), valueParts.join("=") || true];
  }));
}

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function integerOption(value, fallback, name) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result <= 0) throw new Error(`--${name} must be a positive integer`);
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
  --seed=<n>            Reproducible random seed (default: ${DEFAULTS.seed})`);
}
