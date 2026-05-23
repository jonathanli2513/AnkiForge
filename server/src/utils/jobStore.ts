import { GenerationJob } from '../types';

const jobs = new Map<string, GenerationJob>();

export const jobStore = {
  create(jobId: string, files: string[]): GenerationJob {
    const job: GenerationJob = {
      jobId,
      status: 'pending',
      progress: 0,
      message: 'Queued',
      files,
    };
    jobs.set(jobId, job);
    return job;
  },

  update(jobId: string, patch: Partial<GenerationJob>) {
    const job = jobs.get(jobId);
    if (job) {
      Object.assign(job, patch);
    }
  },

  get(jobId: string): GenerationJob | undefined {
    return jobs.get(jobId);
  },

  delete(jobId: string) {
    jobs.delete(jobId);
  },
};
