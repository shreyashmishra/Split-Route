import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import styles from "./app.experiments/styles.module.css";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const experiments = await db.experiment.findMany({
    where: { shopDomain: session.shop },
    orderBy: { createdAt: "desc" },
    include: {
      variants: {
        orderBy: { name: "asc" },
        include: { _count: { select: { events: true } } },
      },
    },
  });

  return {
    experiments: experiments.map((experiment) => ({
      ...experiment,
      createdAt: experiment.createdAt.toISOString(),
      variants: experiment.variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
        events: variant._count.events,
      })),
    })),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return { error: "Method not allowed" };
  }

  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const name = formData.get("name");
  const productId = formData.get("productId");

  if (typeof name !== "string" || !name.trim()) {
    return { error: "Give the experiment a name." };
  }
  if (typeof productId !== "string" || !productId.trim()) {
    return { error: "Enter the Shopify product ID or product GID." };
  }

  const experiment = await db.experiment.create({
    data: {
      shopDomain: session.shop,
      name: name.trim(),
      productId: productId.trim(),
      status: "draft",
      variants: {
        create: [
          { name: "A", config: {} },
          { name: "B", config: {} },
        ],
      },
    },
    select: { id: true },
  });

  return redirect(`/app/experiments/${experiment.id}`);
}

export default function ExperimentsPage() {
  const { experiments } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Experiments">
      <s-section heading="Create an experiment">
        <Form method="post" className={styles.form}>
          <div className={styles.formRow}>
            <label>
              Experiment name
              <input className={styles.input} name="name" placeholder="Homepage CTA test" />
            </label>
            <label>
              Product ID or GID
              <input
                className={styles.input}
                name="productId"
                placeholder="gid://shopify/Product/123"
              />
            </label>
          </div>
          {actionData?.error && <p className={styles.error}>{actionData.error}</p>}
          <s-button type="submit">Create draft</s-button>
        </Form>
      </s-section>

      <s-section heading="Your experiments">
        {experiments.length === 0 ? (
          <div className={styles.muted}>
            <s-paragraph>No experiments yet. Create a draft above to get started.</s-paragraph>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Product</th>
                <th>Status</th>
                <th>Events</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((experiment) => (
                <tr key={experiment.id}>
                  <td>
                    <s-link href={`/app/experiments/${experiment.id}`}>
                      {experiment.name}
                    </s-link>
                  </td>
                  <td>{experiment.productId}</td>
                  <td>{experiment.status}</td>
                  <td>{experiment.variants.reduce((sum, variant) => sum + variant.events, 0)}</td>
                  <td>{new Date(experiment.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>
    </s-page>
  );
}
