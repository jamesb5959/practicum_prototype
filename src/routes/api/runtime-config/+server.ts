import { json } from '@sveltejs/kit';

export function GET() {
  return json({
    demoPerformanceMode: process.env.PUBLIC_DEMO_PERFORMANCE_MODE === 'true'
  });
}
