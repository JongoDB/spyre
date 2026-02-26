import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPipeline } from '$lib/server/pipeline-engine';
import { getEnvironment } from '$lib/server/environments';
import { getDb } from '$lib/server/db';
import { getServicesForEnv, scanAndStoreServices } from '$lib/server/service-detector';
import { extractFilePaths, verifyFilesExist } from '$lib/server/output-extractor';
import type { PipelineOutputArtifacts } from '$lib/types/pipeline';

/** GET — Return cached artifacts + current services */
export const GET: RequestHandler = async ({ params }) => {
  const pipeline = getPipeline(params.id);
  if (!pipeline) {
    return json({ code: 'NOT_FOUND', message: 'Pipeline not found' }, { status: 404 });
  }

  let artifacts: PipelineOutputArtifacts | null = null;
  if (pipeline.output_artifacts) {
    try {
      artifacts = JSON.parse(pipeline.output_artifacts);
    } catch { /* corrupted JSON */ }
  }

  // Also fetch current services from DB (no SSH needed)
  const services = pipeline.env_id ? getServicesForEnv(pipeline.env_id) : [];

  return json({ artifacts, services });
};

/** POST — Re-scan: detect services, re-verify files, update cached artifacts */
export const POST: RequestHandler = async ({ params }) => {
  const pipeline = getPipeline(params.id);
  if (!pipeline) {
    return json({ code: 'NOT_FOUND', message: 'Pipeline not found' }, { status: 404 });
  }

  const env = getEnvironment(pipeline.env_id);
  if (!env || env.status !== 'running') {
    return json({ code: 'INVALID_STATE', message: 'Environment must be running to rescan' }, { status: 409 });
  }

  const db = getDb();
  const projectDir = env.project_dir ?? '/project';

  // Re-detect services
  let detectedServices: Array<{ port: number; name: string }> = [];
  try {
    const services = await scanAndStoreServices(pipeline.env_id);
    detectedServices = services
      .filter(s => s.status === 'up')
      .map(s => ({ port: s.port, name: s.name }));
  } catch { /* non-critical */ }

  // Re-extract and verify files from step results
  let outputFiles: Array<{ path: string; filename: string; size: number }> = [];
  try {
    const steps = db.prepare(
      "SELECT result_summary FROM pipeline_steps WHERE pipeline_id = ? AND status = 'completed' AND result_summary IS NOT NULL"
    ).all(params.id) as Array<{ result_summary: string }>;

    const summaries = steps.map(s => s.result_summary);
    const candidates = extractFilePaths(summaries, projectDir);
    if (candidates.length > 0) {
      outputFiles = await verifyFilesExist(pipeline.env_id, projectDir, candidates);
    }
  } catch { /* non-critical */ }

  // Update cached artifacts
  const artifacts: PipelineOutputArtifacts = {
    services: detectedServices,
    files: outputFiles,
    projectDir,
    scannedAt: new Date().toISOString()
  };

  db.prepare('UPDATE pipelines SET output_artifacts = ? WHERE id = ?')
    .run(JSON.stringify(artifacts), params.id);

  const services = getServicesForEnv(pipeline.env_id);

  return json({ artifacts, services });
};
