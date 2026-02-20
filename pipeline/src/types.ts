// === Document Discovery ===

export interface DocumentInfo {
  folderPath: string;
  entityType: 'paper' | 'meeting';
  metadata: PaperMetadata | MeetingMetadata;
  files: FileInfo[];
}

export interface FileInfo {
  pdfPath: string;
  fileHash: string;
  fileType: string;
  fileId: string;
  accessUrl: string;
  downloadUrl: string;
  fileName: string;
  relativePath: string;
}

// === Pipeline Results ===

export interface ProcessingResult {
  file: FileInfo;
  status: 'processed' | 'skipped' | 'failed';
  error?: string;
  pages?: number;
}

// === Sparse Vectors ===

export interface SparseVector {
  indices: number[];
  values: number[];
}

// === Cache Files ===

export interface FulltextData {
  file_hash: string;
  filename: string;
  pages: Array<{ page: number; text: string }>;
  full_text: string;
  skipped?: boolean;
  extraction?: {
    model: string;
    prompt: string;
    extracted_at: string;
    total_input_tokens: number;
    total_output_tokens: number;
  };
}

export interface EmbeddingsData {
  file_hash: string;
  filename: string;
  chunks: Array<{
    page: number;
    chunk_index: number;
    text: string;
    vector: number[];
    sparseVector?: SparseVector;
  }>;
}

// === Qdrant Payload ===

export interface QdrantPayload {
  filename: string;
  file_hash: string;
  page: number;
  chunk_index: number;
  text: string;
  source: 'oparl';
  entity_type: 'paper' | 'meeting';
  entity_id: string;
  entity_name: string;
  date: string;
  paper_reference?: string;
  paper_type?: string;
  file_type: string;
  file_id: string;
  pdf_access_url: string;
  pdf_download_url: string;
}

// === Metadata ===

export interface PaperMetadata {
  id: string;
  reference?: string;
  name?: string;
  paperType?: string;
  date?: string;
  mainFile?: OParlFileObject;
  auxiliaryFile?: OParlFileObject[];
  consultation?: unknown[];
}

export interface MeetingMetadata {
  id: string;
  name?: string;
  start?: string;
  location?: unknown;
  organization?: unknown[];
  invitation?: OParlFileObject;
  resultsProtocol?: OParlFileObject;
  verbatimProtocol?: OParlFileObject;
  agendaItem?: Array<{
    auxiliaryFile?: OParlFileObject[];
    [key: string]: unknown;
  }>;
}

export interface OParlFileObject {
  id: string;
  accessUrl?: string;
  downloadUrl?: string;
  name?: string;
  mimeType?: string;
}

// === CLI Config ===

export interface PipelineConfig {
  documentsDir: string;
  limit: number;
  force: boolean;
  dryRun: boolean;
  skipQdrant: boolean;
  only?: string;
  concurrency: number;
  maxPdfSize: number;
}
