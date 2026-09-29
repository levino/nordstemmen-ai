#!/usr/bin/env node
/**
 * Builds compact meeting assets from documents/meetings/<folder>/metadata.json:
 *   public/meetings/index.json   – one compact entry per meeting (for list_meetings)
 *   public/meetings/<id>.json    – full agenda + files per meeting (for get_meeting)
 * Runs as part of the MCP server build step.
 *
 * Robust against known data issues:
 * - Several folders can share the same OParl meeting id (renumbered meetings).
 *   They are merged into one entry: the variant with the most data wins; on a tie
 *   the last folder in natural sort order wins.
 * - Many meetings only have a stub (no invitation / agendaItem). Missing fields are tolerated.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

const DOCUMENTS_DIR = resolve(import.meta.dirname, '..', 'documents');
const OUTPUT_DIR = resolve(import.meta.dirname, 'public', 'meetings');

const SECTION_MARKER = /^-\s*(nicht\s*)?öffentlicher\s+teil\s*-$/i;
const DS_PATTERN = /DS\s*(\d+)\s*[/-]\s*(\d{4})/i;

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

// Same filename derivation as pipeline/src/discovery.ts
function extractFilenameFromUrl(url) {
  const parts = url.split('/');
  return decodeURIComponent(parts[parts.length - 1]).replace(/[/\\:*?"<>|]/g, '_');
}

/**
 * Resolves the SHA256 file_hash for an OParl file object stored in `folder`,
 * using the same hash the pipeline stores (and get_document_text accepts).
 * Order: .fulltext.json (text available) → LFS pointer oid → hash of the real file.
 */
function resolveFile(folder, fileObj) {
  if (!fileObj?.accessUrl) return null;
  const fileName = extractFilenameFromUrl(fileObj.accessUrl);
  const pdfPath = join(folder, fileName);
  const base = join(folder, basename(fileName, extname(fileName)));

  let fileHash = null;
  let textAvailable = false;

  const fulltext = readJson(`${base}.fulltext.json`);
  if (fulltext?.file_hash) {
    fileHash = fulltext.file_hash;
    textAvailable = true;
  } else if (existsSync(pdfPath)) {
    try {
      const size = statSync(pdfPath).size;
      const head = size <= 200 ? readFileSync(pdfPath, 'utf-8') : '';
      const oid = head.startsWith('version https://git-lfs') ? head.match(/oid sha256:([a-f0-9]{64})/) : null;
      fileHash = oid ? oid[1] : createHash('sha256').update(readFileSync(pdfPath)).digest('hex');
    } catch {
      fileHash = null;
    }
  }

  return {
    name: fileObj.name || fileName,
    pdf_url: fileObj.accessUrl,
    file_hash: fileHash,
    text_available: textAvailable,
  };
}

function naturalCompare(a, b) {
  return a.localeCompare(b, 'de', { numeric: true });
}

function numericId(oparlId) {
  const match = String(oparlId).match(/(\d+)\/?$/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Papers: agendaItem / consultation URL → paper summary
// ---------------------------------------------------------------------------

function loadPapers() {
  const byAgendaItem = new Map();
  const byConsultation = new Map();
  const byReference = new Map();
  const papersDir = join(DOCUMENTS_DIR, 'papers');
  if (!existsSync(papersDir)) return { byAgendaItem, byConsultation, byReference };

  for (const dir of readdirSync(papersDir)) {
    const folder = join(papersDir, dir);
    const paper = readJson(join(folder, 'metadata.json'));
    if (!paper?.id) continue;

    const main = resolveFile(folder, paper.mainFile);
    const summary = {
      reference: paper.reference || null,
      name: paper.name || null,
      paper_type: paper.paperType || null,
      oparl_id: paper.id,
      pdf_url: main?.pdf_url || null,
      file_hash: main?.file_hash || null,
    };

    if (summary.reference) byReference.set(normalizeReference(summary.reference), summary);
    for (const consultation of paper.consultation ?? []) {
      if (typeof consultation !== 'object' || !consultation) continue;
      if (consultation.agendaItem) byAgendaItem.set(consultation.agendaItem, summary);
      if (consultation.id) byConsultation.set(consultation.id, summary);
    }
  }
  return { byAgendaItem, byConsultation, byReference };
}

function normalizeReference(ref) {
  const match = String(ref).match(/(\d+)\s*[/-]\s*(\d{4})/);
  return match ? `${Number(match[1])}/${match[2]}` : null;
}

function findPaper(item, papers) {
  const direct = papers.byAgendaItem.get(item.id);
  if (direct) return direct;
  const consultationId = typeof item.consultation === 'string' ? item.consultation : item.consultation?.id;
  if (consultationId && papers.byConsultation.has(consultationId)) return papers.byConsultation.get(consultationId);

  // Fallback: DS number mentioned in the TOP title
  const match = (item.name || '').match(DS_PATTERN);
  if (!match) return null;
  const key = `${Number(match[1])}/${match[2]}`;
  return papers.byReference.get(key) || { reference: `DS ${key}`, name: null, paper_type: null, oparl_id: null };
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

function dataScore(meeting) {
  return (
    (meeting.agendaItem?.length ?? 0) +
    (meeting.invitation ? 10 : 0) +
    (meeting.resultsProtocol ? 10 : 0) +
    (meeting.verbatimProtocol ? 10 : 0)
  );
}

function buildMeeting(folder, meeting, papers) {
  const files = [];
  const addFile = (role, fileObj) => {
    const f = resolveFile(folder, fileObj);
    if (f) files.push({ role, ...f });
  };
  addFile('invitation', meeting.invitation);
  addFile('resultsProtocol', meeting.resultsProtocol);
  addFile('verbatimProtocol', meeting.verbatimProtocol);
  for (const aux of meeting.auxiliaryFile ?? []) addFile('auxiliaryFile', aux);

  const agenda = [];
  let isPublic = true;
  const items = [...(meeting.agendaItem ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const item of items) {
    const name = (item.name || '').trim();
    const marker = name.match(SECTION_MARKER);
    if (marker) {
      isPublic = !marker[1];
      continue;
    }

    const entry = {
      number: item.number ?? null,
      name,
      public: typeof item.public === 'boolean' ? item.public : isPublic,
    };
    if (item.result) entry.result = item.result;
    if (item.resolutionText) entry.resolution_text = item.resolutionText;

    const paper = findPaper(item, papers);
    if (paper) entry.paper = paper;

    const itemFiles = [];
    const resolution = resolveFile(folder, item.resolutionFile);
    if (resolution) itemFiles.push({ role: 'resolutionFile', ...resolution });
    for (const aux of item.auxiliaryFile ?? []) {
      const f = resolveFile(folder, aux);
      if (f) itemFiles.push({ role: 'auxiliaryFile', ...f });
    }
    if (itemFiles.length > 0) entry.files = itemFiles;

    agenda.push(entry);
  }

  return {
    id: numericId(meeting.id),
    oparl_id: meeting.id,
    name: meeting.name || null,
    start: meeting.start || null,
    end: meeting.end || null,
    cancelled: meeting.cancelled === true,
    location: meeting.location?.description || meeting.location?.room || null,
    agenda,
    files,
  };
}

function main() {
  const meetingsDir = join(DOCUMENTS_DIR, 'meetings');
  const papers = loadPapers();

  // Group folders by OParl id
  const groups = new Map();
  for (const dir of readdirSync(meetingsDir).sort(naturalCompare)) {
    const folder = join(meetingsDir, dir);
    const meeting = readJson(join(folder, 'metadata.json'));
    if (!meeting?.id || !numericId(meeting.id)) continue;
    if (!groups.has(meeting.id)) groups.set(meeting.id, []);
    groups.get(meeting.id).push({ folder, meeting });
  }

  rmSync(OUTPUT_DIR, { recursive: true, force: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const index = [];
  let merged = 0;
  let totalBytes = 0;

  for (const variants of groups.values()) {
    // Folders are in natural order, so ">=" makes the last folder win on a tie
    let best = variants[0];
    for (const v of variants) {
      if (dataScore(v.meeting) >= dataScore(best.meeting)) best = v;
    }

    const detail = buildMeeting(best.folder, best.meeting, papers);
    if (variants.length > 1) {
      merged += variants.length - 1;
      const others = variants
        .filter((v) => v !== best)
        .map((v) => ({ name: v.meeting.name || null, start: v.meeting.start || null }));
      detail.alternative_versions = others;
    }

    const json = JSON.stringify(detail);
    writeFileSync(join(OUTPUT_DIR, `${detail.id}.json`), json, 'utf-8');
    totalBytes += Buffer.byteLength(json);

    index.push({
      id: detail.id,
      name: detail.name,
      start: detail.start,
      location: detail.location,
      agenda_items: detail.agenda.length,
      has_invitation: detail.files.some((f) => f.role === 'invitation'),
      has_protocol: detail.files.some((f) => f.role === 'resultsProtocol' || f.role === 'verbatimProtocol'),
      ...(detail.cancelled ? { cancelled: true } : {}),
    });
  }

  index.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  const indexJson = JSON.stringify(index);
  writeFileSync(join(OUTPUT_DIR, 'index.json'), indexJson, 'utf-8');

  console.log(
    `Wrote ${index.length} meetings to public/meetings/ (merged ${merged} duplicate folders; ` +
      `index ${(Buffer.byteLength(indexJson) / 1024).toFixed(0)} KB, details ${(totalBytes / 1024 / 1024).toFixed(1)} MB)`,
  );
}

main();
