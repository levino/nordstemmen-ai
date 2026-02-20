import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isCompleted } from './cache.ts';
import { computeFileHash, isLfsPointer } from './hash.ts';
import type {
  DocumentInfo,
  FileInfo,
  MeetingMetadata,
  OParlFileObject,
  PaperMetadata,
  PipelineConfig,
} from './types.ts';

function extractFilenameFromUrl(url: string): string {
  const parts = url.split('/');
  const last = parts[parts.length - 1];
  return decodeURIComponent(last).replace(/[/\\:*?"<>|]/g, '_');
}

async function toFileInfo(
  folderPath: string,
  documentsDir: string,
  fileObj: OParlFileObject,
  fileType: string,
): Promise<FileInfo | null> {
  if (!fileObj?.accessUrl) return null;
  const fileName = extractFilenameFromUrl(fileObj.accessUrl);
  const pdfPath = join(folderPath, fileName);

  try {
    if (await isLfsPointer(pdfPath)) return null;
    const fileHash = await computeFileHash(pdfPath);
    const relativePath = pdfPath.replace(`${documentsDir}/`, '');

    return {
      pdfPath,
      fileHash,
      fileType,
      fileId: fileObj.id,
      accessUrl: fileObj.accessUrl,
      downloadUrl: fileObj.downloadUrl ?? '',
      fileName,
      relativePath,
    };
  } catch {
    return null;
  }
}

async function loadDocumentInfo(folderPath: string, documentsDir: string): Promise<DocumentInfo | null> {
  try {
    const metaPath = join(folderPath, 'metadata.json');
    const raw = await readFile(metaPath, 'utf-8');
    const metadata = JSON.parse(raw);

    const entityType = folderPath.includes('/papers/') ? ('paper' as const) : ('meeting' as const);
    const files: FileInfo[] = [];

    if (entityType === 'paper') {
      const paper = metadata as PaperMetadata;
      if (paper.mainFile) {
        const fi = await toFileInfo(folderPath, documentsDir, paper.mainFile, 'mainFile');
        if (fi) files.push(fi);
      }
      for (const aux of paper.auxiliaryFile ?? []) {
        const fi = await toFileInfo(folderPath, documentsDir, aux, 'auxiliaryFile');
        if (fi) files.push(fi);
      }
    } else {
      const meeting = metadata as MeetingMetadata;
      if (meeting.invitation) {
        const fi = await toFileInfo(folderPath, documentsDir, meeting.invitation, 'invitation');
        if (fi) files.push(fi);
      }
      if (meeting.resultsProtocol) {
        const fi = await toFileInfo(folderPath, documentsDir, meeting.resultsProtocol, 'resultsProtocol');
        if (fi) files.push(fi);
      }
      if (meeting.verbatimProtocol) {
        const fi = await toFileInfo(folderPath, documentsDir, meeting.verbatimProtocol, 'verbatimProtocol');
        if (fi) files.push(fi);
      }
      for (const item of meeting.agendaItem ?? []) {
        for (const aux of item.auxiliaryFile ?? []) {
          const fi = await toFileInfo(folderPath, documentsDir, aux, 'auxiliaryFile');
          if (fi) files.push(fi);
        }
      }
    }

    if (files.length === 0) return null;
    return { folderPath, entityType, metadata, files };
  } catch {
    return null;
  }
}

export async function discoverDocuments(config: PipelineConfig): Promise<DocumentInfo[]> {
  const papersDir = join(config.documentsDir, 'papers');
  const meetingsDir = join(config.documentsDir, 'meetings');

  const [paperFolders, meetingFolders] = await Promise.all([
    readdir(papersDir).catch(() => [] as string[]),
    readdir(meetingsDir).catch(() => [] as string[]),
  ]);

  let allFolders = [...paperFolders.map((f) => join(papersDir, f)), ...meetingFolders.map((f) => join(meetingsDir, f))];

  if (config.only) {
    allFolders = allFolders.filter((f) => f.includes(config.only as string));
  }

  const results = await Promise.all(allFolders.map((f) => loadDocumentInfo(f, config.documentsDir)));

  return results.filter((d): d is DocumentInfo => d !== null);
}

export async function needsProcessing(
  file: FileInfo,
  config: PipelineConfig,
): Promise<boolean> {
  if (config.force) return true;
  return !(await isCompleted(file.pdfPath, file.fileHash));
}
