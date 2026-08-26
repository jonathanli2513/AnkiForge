export type CardType = 'basic' | 'cloze' | 'image_occlusion';

export interface OcclusionMask {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  answer: string;
}

export interface CardSource {
  fileName: string;
  pageNumber?: number;
  sectionTitle?: string;
}

export interface Flashcard {
  id: string;
  cardType: CardType;
  front: string;
  back: string;
  clozeText?: string;
  image?: string;
  occlusionMasks?: OcclusionMask[];
  tags: string[];
  source: CardSource;
  confidenceScore: number;
  approvedForExport: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UploadedFile {
  name: string;
  size: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
}

export type JobStatus = 'pending' | 'extracting' | 'detecting' | 'generating' | 'complete' | 'error';

export interface GenerationJob {
  jobId: string;
  status: JobStatus;
  progress: number;
  message: string;
  files: string[];
  cards?: Flashcard[];
  error?: string;
  partial?: boolean;
  warning?: string;
}
