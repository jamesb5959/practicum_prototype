import { json } from '@sveltejs/kit';
import { runTlePrediction, warmPredictionModel } from '$lib/server/tlePrediction';
import type { RequestHandler } from './$types';

warmPredictionModel();

export const GET: RequestHandler = async ({ url }) => {
  if (url.searchParams.get('warmup') === '1') {
    warmPredictionModel();
    return json({ status: 'warming' });
  }

  return json({ error: 'Not found.' }, { status: 404 });
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      name?: string;
      line1?: string;
      line2?: string;
      hours?: number;
      stepMinutes?: number;
    };

    if (!body.name || !body.line1 || !body.line2) {
      return json({ error: 'name, line1, and line2 are required.' }, { status: 400 });
    }

    const result = await runTlePrediction({
      name: body.name,
      line1: body.line1,
      line2: body.line2,
      hours: body.hours ?? 24,
      stepMinutes: body.stepMinutes
    });

    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Prediction failed.';
    return json({ error: message }, { status: 500 });
  }
};
