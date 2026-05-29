import { nanoid } from 'nanoid';
import { getDb } from '../db/client.js';
import type { DbJob } from '../db/schema.js';
import type { JobType } from '../config/constants.js';
import { env } from '../config/env.js';

export type JobPayloadMap = {
  PROCESS_DOCUMENT: { documentId: string; sessionId: string };
  PROCESS_SELFIE: { selfieId: string; sessionId: string };
  PROCESS_ADDRESS: { addressId: string; sessionId: string };
  SCORE_SESSION: { sessionId: string };
  DELIVER_WEBHOOK: { deliveryId: string };
};

export function enqueueJob<T extends JobType>(type: T, payload: JobPayloadMap[T]): string {
  const db = getDb();
  const id = `job_${nanoid(12)}`;
  db.prepare(`
    INSERT INTO jobs (id, job_type, payload, status, max_attempts)
    VALUES (?, ?, ?, 'QUEUED', 3)
  `).run(id, type, JSON.stringify(payload));
  return id;
}

type JobProcessor = (payload: Record<string, unknown>) => Promise<void>;
const processors = new Map<JobType, JobProcessor>();

export function registerProcessor<T extends JobType>(
  type: T,
  fn: (payload: JobPayloadMap[T]) => Promise<void>,
): void {
  processors.set(type, fn as JobProcessor);
}

let running = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let activeJobs = 0;

export function startQueue(): void {
  if (running) return;
  running = true;
  schedulePoll();
}

export function stopQueue(): void {
  running = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function schedulePoll(): void {
  if (!running) return;
  pollTimer = setTimeout(() => {
    poll().finally(() => schedulePoll());
  }, env.JOB_POLL_INTERVAL_MS);
}

async function poll(): Promise<void> {
  if (activeJobs >= env.JOB_MAX_CONCURRENCY) return;

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const job = db
    .prepare(`
      SELECT * FROM jobs
      WHERE status = 'QUEUED' AND attempts < max_attempts
      ORDER BY created_at ASC
      LIMIT 1
    `)
    .get() as DbJob | undefined;

  if (!job) return;

  // Claim the job
  const changed = db
    .prepare(`
      UPDATE jobs SET status = 'PROCESSING', attempts = attempts + 1
      WHERE id = ? AND status = 'QUEUED'
    `)
    .run(job.id).changes;

  if (changed === 0) return; // another worker claimed it

  activeJobs++;

  const processor = processors.get(job.job_type);
  if (!processor) {
    db.prepare("UPDATE jobs SET status = 'FAILED', error = ? WHERE id = ?").run(
      `No processor registered for job type: ${job.job_type}`,
      job.id,
    );
    activeJobs--;
    return;
  }

  try {
    await processor(JSON.parse(job.payload) as Record<string, unknown>);
    db.prepare("UPDATE jobs SET status = 'DONE', processed_at = ? WHERE id = ?").run(now, job.id);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const newStatus = job.attempts + 1 >= job.max_attempts ? 'FAILED' : 'QUEUED';
    db.prepare('UPDATE jobs SET status = ?, error = ? WHERE id = ?').run(newStatus, error, job.id);
  } finally {
    activeJobs--;
  }
}
