import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import db from "../db.server";
import {
  DEFAULT_MONTE_CARLO_SAMPLES,
  probabilityBBeatsA,
  type ConversionCounts,
} from "../lib/bayesian";
import { authenticate } from "../shopify.server";
import styles from "./app.experiments/styles.module.css";

const MAX_HISTORY_POINTS = 20;
const HISTORY_SAMPLES = 1_000;

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return { error: "Method not allowed" };
  }

  const { session } = await authenticate.admin(request);
  const experimentId = params.id;
  const formData = await request.formData();
  const status = formData.get("status");
  if (
    !experimentId ||
    typeof status !== "string" ||
    !["draft", "running", "completed"].includes(status)
  ) {
    return { error: "Status must be draft, running, or completed." };
  }

  await db.experiment.updateMany({
    where: { id: experimentId, shopDomain: session.shop },
    data: { status },
  });
  return redirect(`/app/experiments/${experimentId}`);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const experimentId = params.id;
  if (!experimentId) throw new Response("Experiment id is required", { status: 400 });

  const experiment = await db.experiment.findFirst({
    where: { id: experimentId, shopDomain: session.shop },
    include: { variants: { orderBy: { name: "asc" } } },
  });
  if (!experiment) throw new Response("Experiment not found", { status: 404 });
  if (experiment.variants.length !== 2) {
    throw new Response("Experiment must have exactly two variants", { status: 500 });
  }

  const events = await db.event.findMany({
    where: { experimentId },
    orderBy: { createdAt: "asc" },
    select: { variantId: true, type: true, createdAt: true },
  });

  const variantA = experiment.variants.find((variant) => variant.name === "A") ?? experiment.variants[0];
  const variantB = experiment.variants.find((variant) => variant.name === "B") ?? experiment.variants[1];
  const countsByVariant = new Map<string, ConversionCounts>([
    [variantA.id, { impressions: 0, conversions: 0 }],
    [variantB.id, { impressions: 0, conversions: 0 }],
  ]);

  for (const event of events) addEventToCounts(countsByVariant, event.variantId, event.type);

  const currentA = countsByVariant.get(variantA.id)!;
  const currentB = countsByVariant.get(variantB.id)!;
  const history = buildHistory(experiment.createdAt, events, variantA.id, variantB.id);

  return {
    experiment: {
      id: experiment.id,
      name: experiment.name,
      productId: experiment.productId,
      status: experiment.status,
      createdAt: experiment.createdAt.toISOString(),
    },
    variants: [
      summarizeVariant(variantA, currentA),
      summarizeVariant(variantB, currentB),
    ],
    winProbability: probabilityBBeatsA(currentA, currentB),
    samples: DEFAULT_MONTE_CARLO_SAMPLES,
    history,
  };
}

function addEventToCounts(
  countsByVariant: Map<string, ConversionCounts>,
  variantId: string,
  type: string,
) {
  const counts = countsByVariant.get(variantId);
  if (!counts) return;
  if (type === "impression") counts.impressions += 1;
  if (type === "conversion") counts.conversions += 1;
}

function buildHistory(
  createdAt: Date,
  events: Array<{ variantId: string; type: string; createdAt: Date }>,
  variantAId: string,
  variantBId: string,
) {
  const history = [
    { timestamp: createdAt.toISOString(), probability: 0.5, totalEvents: 0 },
  ];
  if (events.length === 0) return history;

  const counts = new Map<string, ConversionCounts>([
    [variantAId, { impressions: 0, conversions: 0 }],
    [variantBId, { impressions: 0, conversions: 0 }],
  ]);
  const checkpointEvery = Math.max(1, Math.ceil(events.length / MAX_HISTORY_POINTS));

  events.forEach((event, index) => {
    addEventToCounts(counts, event.variantId, event.type);
    const isCheckpoint = (index + 1) % checkpointEvery === 0 || index === events.length - 1;
    if (!isCheckpoint) return;

    history.push({
      timestamp: event.createdAt.toISOString(),
      probability: probabilityBBeatsA(counts.get(variantAId)!, counts.get(variantBId)!, {
        samples: HISTORY_SAMPLES,
      }),
      totalEvents: index + 1,
    });
  });

  return history;
}

function summarizeVariant(
  variant: { id: string; name: string; config: unknown },
  counts: ConversionCounts,
) {
  return {
    id: variant.id,
    name: variant.name,
    config: variant.config,
    impressions: counts.impressions,
    conversions: counts.conversions,
    conversionRate:
      counts.impressions === 0 ? 0 : counts.conversions / counts.impressions,
  };
}

export default function ExperimentDetailPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading={data.experiment.name}>
      <s-link slot="primary-action" href="/app/experiments">
        All experiments
      </s-link>

      <s-section heading="Overview">
        <div className={styles.metricGrid}>
          <Metric label="Status" value={data.experiment.status} />
          <Metric label="Product" value={data.experiment.productId} />
          <Metric label="B beats A" value={`${(data.winProbability * 100).toFixed(1)}%`} />
          <Metric label="Monte Carlo draws" value={data.samples.toLocaleString()} />
        </div>
        <Form method="post" className={styles.statusForm}>
          <label>
            Experiment status
            <select className={styles.input} name="status" defaultValue={data.experiment.status}>
              <option value="draft">Draft</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
            </select>
          </label>
          <s-button type="submit">Save status</s-button>
        </Form>
      </s-section>

      <s-section heading="Variant performance">
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Variant</th>
              <th>Impressions</th>
              <th>Conversions</th>
              <th>Conversion rate</th>
              <th>Config</th>
            </tr>
          </thead>
          <tbody>
            {data.variants.map((variant) => (
              <tr key={variant.id}>
                <td>{variant.name}</td>
                <td>{variant.impressions.toLocaleString()}</td>
                <td>{variant.conversions.toLocaleString()}</td>
                <td>{(variant.conversionRate * 100).toFixed(2)}%</td>
                <td>{JSON.stringify(variant.config)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </s-section>

      <s-section heading="Win probability over time">
        <WinProbabilityChart history={data.history} />
        <div className={styles.muted}>
          <s-paragraph>
            Each point replays the event stream up to that checkpoint and estimates
            P(B beats A) from 1,000 posterior draws.
          </s-paragraph>
        </div>
      </s-section>
    </s-page>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <p className={styles.metricLabel}>{label}</p>
      <p className={styles.metricValue}>{value}</p>
    </div>
  );
}

function WinProbabilityChart({
  history,
}: {
  history: Array<{ timestamp: string; probability: number; totalEvents: number }>;
}) {
  const width = 720;
  const height = 240;
  const padding = { top: 16, right: 16, bottom: 34, left: 44 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const points = history.map((point, index) => {
    const x =
      padding.left +
      (history.length === 1 ? chartWidth / 2 : (index / (history.length - 1)) * chartWidth);
    const y = padding.top + (1 - point.probability) * chartHeight;
    return `${x},${y}`;
  });

  return (
    <div className={styles.chart}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Bayesian win probability chart">
        {[0, 0.5, 1].map((value) => {
          const y = padding.top + (1 - value) * chartHeight;
          return (
            <g key={value}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#e1e3e5" />
              <text className={styles.chartLabel} x={padding.left - 8} y={y + 4} textAnchor="end">
                {Math.round(value * 100)}%
              </text>
            </g>
          );
        })}
        <polyline fill="none" points={points.join(" ")} stroke="#008060" strokeWidth="3" />
        {history.map((point, index) => {
          const [x, y] = points[index].split(",");
          return <circle key={`${point.timestamp}-${index}`} cx={x} cy={y} fill="#008060" r="3" />;
        })}
        <text className={styles.chartLabel} x={padding.left} y={height - 8}>
          Start
        </text>
        <text className={styles.chartLabel} x={width - padding.right} y={height - 8} textAnchor="end">
          Latest ({history[history.length - 1]?.totalEvents ?? 0} events)
        </text>
      </svg>
    </div>
  );
}
