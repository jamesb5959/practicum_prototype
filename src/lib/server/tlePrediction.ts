import { env } from '$env/dynamic/private';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);
const predictionCache = new Map<string, PredictionResult>();
let warmupStarted = false;

export type PredictionRequest = {
  name: string;
  line1: string;
  line2: string;
  hours: number;
  stepMinutes?: number;
};

export type PredictionSample = {
  minutesSinceEpoch: number;
  isoTime: string;
  positionKm: [number, number, number];
  velocityKmS: [number, number, number];
};

export type PredictionResult = {
  name: string;
  epochIso: string;
  frame: 'TEME';
  hours: number;
  sampleStepHours: number;
  samples: PredictionSample[];
};

export async function runTlePrediction(request: PredictionRequest): Promise<PredictionResult> {
  const hours = clampHours(request.hours);
  const stepMinutes = clampStepMinutes(request.stepMinutes ?? 60);
  const cacheKey = JSON.stringify({
    name: request.name,
    line1: request.line1,
    line2: request.line2,
    hours,
    stepMinutes
  });

  const cached = predictionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const python = env.TLE_PREDICTION_PYTHON ?? 'python3';
  const modelPath =
    env.TLE_PREDICTION_MODEL_PATH ??
    resolve(process.cwd(), 'TLE_Prediction', 'models', 'mldsgp4_best_model_improved.pth');
  const scriptPath = resolve(process.cwd(), 'TLE_Prediction', 'predict_trajectory.py');
  const cacheDir = resolve(process.cwd(), 'TLE_Prediction', 'cache');

  let stdout = '';
  let stderr = '';
  try {
    const result = await execFileAsync(
      python,
      [
        scriptPath,
        '--name',
        request.name,
        '--line1',
        request.line1,
        '--line2',
        request.line2,
        '--hours',
        String(hours),
        '--step-minutes',
        String(stepMinutes),
        '--model-path',
        modelPath
      ],
      {
        cwd: process.cwd(),
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          MPLCONFIGDIR: cacheDir,
          XDG_CACHE_HOME: cacheDir,
          HOME: process.env.HOME ?? tmpdir()
        }
      }
    );
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const message = extractProcessError(error);
    throw new Error(message);
  }

  if (stderr?.trim()) {
    throw new Error(stderr.trim());
  }

  const parsed = JSON.parse(extractJsonLine(stdout)) as PredictionResult & { error?: string };
  if (parsed.error) {
    throw new Error(parsed.error);
  }

  predictionCache.set(cacheKey, parsed);
  return parsed;
}

export function warmPredictionModel() {
  if (warmupStarted) return;
  warmupStarted = true;

  void runTlePrediction({
    name: 'Warmup',
    line1: '1 62577U 25007C   25013.84768675 -.00000211  00000-0  00000+0 0 09997',
    line2: '2 62577 054.9795 125.2905 0012558 297.5868 062.4026 14.75575077000095',
    hours: 24
  }).catch(() => {
    warmupStarted = false;
  });
}

function clampHours(hours: number) {
  const rounded = Math.floor(hours);
  return Math.max(1, Math.min(240, rounded));
}

function clampStepMinutes(stepMinutes: number) {
  const rounded = Math.floor(stepMinutes);
  return Math.max(1, Math.min(120, rounded));
}

function extractJsonLine(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].startsWith('{') && lines[i].endsWith('}')) {
      return lines[i];
    }
  }
  return text.trim();
}

function extractProcessError(error: unknown) {
  if (!(error instanceof Error)) {
    return 'Prediction process failed.';
  }

  const processError = error as Error & { stdout?: string; stderr?: string };
  const stdout = processError.stdout ? extractJsonLine(processError.stdout) : '';
  const stderr = processError.stderr?.trim() ?? '';

  if (stdout) {
    try {
      const parsed = JSON.parse(stdout) as { error?: string };
      if (parsed.error) {
        return parsed.error;
      }
    } catch {
      // fall through
    }
  }

  if (stderr) {
    return stderr;
  }

  return error.message;
}
