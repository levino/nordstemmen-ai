import { readFile } from 'node:fs/promises';
import { GoogleGenAI } from '@google/genai';
import { GEMINI_MODEL, OCR_PROMPT } from './config.ts';
import { withRetry } from './retry.ts';

export interface OcrResult {
  pages: Array<{ page: number; text: string }>;
  fullText: string;
  inputTokens: number;
  outputTokens: number;
}

export interface GeminiConfig {
  project: string;
  location: string;
}

/** Vertex AI client. Auth via Application Default Credentials (Workload Identity in CI). */
export function createGeminiClient({ project, location }: GeminiConfig): GoogleGenAI {
  return new GoogleGenAI({ vertexai: true, project, location });
}

export async function ocrPdf(pdfPath: string, genAI: GoogleGenAI): Promise<OcrResult> {
  const pdfBuffer = await readFile(pdfPath);

  // Vertex AI has no Files API — the PDF is always sent inline (size is capped by --max-pdf-size).
  const response = await withRetry(
    () =>
      genAI.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              { text: OCR_PROMPT },
              { inlineData: { mimeType: 'application/pdf', data: pdfBuffer.toString('base64') } },
            ],
          },
        ],
      }),
    {
      retries: 5,
      baseDelay: 2000,
      shouldRetry: (error) => {
        const msg = String(error);
        return msg.includes('429') || msg.includes('500') || msg.includes('503');
      },
    },
  );

  const text = response.text ?? '';
  const usage = response.usageMetadata ?? {};

  const pages = parsePageMarkers(text);

  return {
    pages,
    fullText: pages.map((p) => p.text).join('\n\n'),
    inputTokens: (usage as Record<string, number>).promptTokenCount ?? 0,
    outputTokens: (usage as Record<string, number>).candidatesTokenCount ?? 0,
  };
}

export function parsePageMarkers(text: string): Array<{ page: number; text: string }> {
  const regex = /^--- Page (\d+) ---$/gm;
  const pages: Array<{ page: number; text: string }> = [];
  let lastIndex = 0;

  for (let match = regex.exec(text); match !== null; match = regex.exec(text)) {
    if (pages.length > 0) {
      pages[pages.length - 1].text = text.slice(lastIndex, match.index).trim();
    }
    pages.push({ page: parseInt(match[1], 10), text: '' });
    lastIndex = match.index + match[0].length;
  }

  if (pages.length > 0) {
    pages[pages.length - 1].text = text.slice(lastIndex).trim();
  }

  // Fallback: if no page markers found, treat entire text as page 1
  if (pages.length === 0 && text.trim().length > 0) {
    pages.push({ page: 1, text: text.trim() });
  }

  return pages;
}
