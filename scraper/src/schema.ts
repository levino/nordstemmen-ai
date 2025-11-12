import { Schema as S } from 'effect';

// Minimal File schema - nur was wir wirklich brauchen
export const OParlFileSchema = S.Struct({
  id: S.String,
  name: S.optional(S.String),
  mimeType: S.optional(S.String),
  date: S.optional(S.String),
  accessUrl: S.optional(S.String),
  downloadUrl: S.optional(S.String),
});

export type OParlFile = S.Schema.Type<typeof OParlFileSchema>;

// Pagination response
export const FileListResponseSchema = S.Struct({
  data: S.Array(S.Unknown), // Will be decoded to OParlFile[]
  links: S.optional(
    S.Struct({
      next: S.optional(S.String),
      self: S.optional(S.String),
    })
  ),
});

export type FileListResponse = S.Schema.Type<typeof FileListResponseSchema>;

// Metadata we store
export interface DocumentMetadata {
  oparl_id: string;
  filename: string;
  access_url: string;
  mime_type?: string;
  name?: string;
  date?: string;
  downloaded_at: string;
}
