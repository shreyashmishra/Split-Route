export interface ConversionCounts {
  impressions: number;
  conversions: number;
}

export interface BetaParameters {
  alpha: number;
  beta: number;
}

export interface BayesianWinProbabilityOptions {
  samples?: number;
  random?: () => number;
}

export const DEFAULT_MONTE_CARLO_SAMPLES = 10_000;

/** Convert observed binary outcomes into the requested Beta(1 + conversions, 1 + failures) prior/posterior. */
export function betaParameters(counts: ConversionCounts): BetaParameters {
  if (!Number.isInteger(counts.impressions) || counts.impressions < 0) {
    throw new Error("Impressions must be a non-negative integer");
  }
  if (!Number.isInteger(counts.conversions) || counts.conversions < 0) {
    throw new Error("Conversions must be a non-negative integer");
  }
  if (counts.conversions > counts.impressions) {
    throw new Error("Conversions cannot exceed impressions");
  }

  return {
    alpha: 1 + counts.conversions,
    beta: 1 + counts.impressions - counts.conversions,
  };
}

/**
 * Estimate P(B's conversion rate > A's conversion rate) using independent
 * Beta posterior draws. The random function is injectable to make tests
 * reproducible without changing the production Monte Carlo algorithm.
 */
export function probabilityBBeatsA(
  variantA: ConversionCounts,
  variantB: ConversionCounts,
  options: BayesianWinProbabilityOptions = {},
): number {
  const samples = options.samples ?? DEFAULT_MONTE_CARLO_SAMPLES;
  if (!Number.isInteger(samples) || samples <= 0) {
    throw new Error("samples must be a positive integer");
  }

  const parametersA = betaParameters(variantA);
  const parametersB = betaParameters(variantB);
  const random = options.random ?? Math.random;
  let bWins = 0;

  for (let index = 0; index < samples; index += 1) {
    const drawA = sampleBeta(parametersA.alpha, parametersA.beta, random);
    const drawB = sampleBeta(parametersB.alpha, parametersB.beta, random);
    if (drawB > drawA) bWins += 1;
  }

  return bWins / samples;
}

function sampleBeta(alpha: number, beta: number, random: () => number): number {
  const x = sampleGamma(alpha, random);
  const y = sampleGamma(beta, random);
  return x / (x + y);
}

// Marsaglia-Tsang gamma sampler. Our Beta shapes are always >= 1 because of
// the one-success/one-failure prior, so no shape<1 branch is required.
function sampleGamma(shape: number, random: () => number): number {
  if (shape === 1) return -Math.log(randomOpenUnit(random));

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  let sample = 0;
  let accepted = false;

  while (!accepted) {
    const normal = sampleStandardNormal(random);
    const candidate = 1 + c * normal;
    if (candidate <= 0) continue;

    const v = candidate ** 3;
    const uniform = randomOpenUnit(random);
    if (
      uniform < 1 - 0.0331 * normal ** 4 ||
      Math.log(uniform) < 0.5 * normal ** 2 + d * (1 - v + Math.log(v))
    ) {
      sample = d * v;
      accepted = true;
    }
  }

  return sample;
}

function sampleStandardNormal(random: () => number): number {
  const u1 = randomOpenUnit(random);
  const u2 = randomOpenUnit(random);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function randomOpenUnit(random: () => number): number {
  return Math.min(Math.max(random(), Number.EPSILON), 1 - Number.EPSILON);
}
