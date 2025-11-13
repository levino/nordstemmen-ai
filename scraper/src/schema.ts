import { Schema as S } from 'effect';

/**
 * OParl File
 */
export const OParlFileSchema = S.Struct({
  id: S.String,
  name: S.optional(S.String),
  mimeType: S.optional(S.String),
  accessUrl: S.optional(S.String),
  downloadUrl: S.optional(S.String),
});

export type OParlFile = S.Schema.Type<typeof OParlFileSchema>;

/**
 * OParl Consultation
 */
export const OParlConsultationSchema = S.Struct({
  meeting: S.optional(S.String),
  role: S.optional(S.String),
});

export type OParlConsultation = S.Schema.Type<typeof OParlConsultationSchema>;

/**
 * OParl AgendaItem
 */
export const OParlAgendaItemSchema = S.Struct({
  id: S.optional(S.String),
  number: S.optional(S.String),
  name: S.optional(S.String),
  consultation: S.optional(S.String),
  result: S.optional(S.String),
  auxiliaryFile: S.optional(S.Array(S.Unknown)),
});

export type OParlAgendaItem = S.Schema.Type<typeof OParlAgendaItemSchema>;

/**
 * OParl Organization
 */
export const OParlOrganizationSchema = S.Struct({
  id: S.optional(S.String),
  name: S.optional(S.String),
});

export type OParlOrganization = S.Schema.Type<typeof OParlOrganizationSchema>;

/**
 * OParl Location
 */
export const OParlLocationSchema = S.Struct({
  description: S.optional(S.String),
});

export type OParlLocation = S.Schema.Type<typeof OParlLocationSchema>;

/**
 * OParl Paper
 */
export const OParlPaperSchema = S.Struct({
  id: S.String,
  reference: S.optional(S.String),
  name: S.optional(S.String),
  paperType: S.optional(S.String),
  date: S.optional(S.String),
  mainFile: S.optional(S.Unknown),
  auxiliaryFile: S.optional(S.Array(S.Unknown)),
  consultation: S.optional(S.Array(S.Unknown)),
  relatedPaper: S.optional(S.Array(S.String)),
});

export type OParlPaper = S.Schema.Type<typeof OParlPaperSchema>;

/**
 * OParl Meeting
 */
export const OParlMeetingSchema = S.Struct({
  id: S.String,
  name: S.optional(S.String),
  start: S.optional(S.String),
  location: S.optional(S.Unknown),
  organization: S.optional(S.Array(S.Unknown)),
  invitation: S.optional(S.Unknown),
  resultsProtocol: S.optional(S.Unknown),
  verbatimProtocol: S.optional(S.Unknown),
  agendaItem: S.optional(S.Array(S.Unknown)),
});

export type OParlMeeting = S.Schema.Type<typeof OParlMeetingSchema>;

/**
 * Pagination response
 */
export const PaperListResponseSchema = S.Struct({
  data: S.Array(OParlPaperSchema),
  links: S.optional(
    S.Struct({
      next: S.optional(S.String),
      last: S.optional(S.String),
    }),
  ),
});

export type PaperListResponse = S.Schema.Type<typeof PaperListResponseSchema>;

export const MeetingListResponseSchema = S.Struct({
  data: S.Array(OParlMeetingSchema),
  links: S.optional(
    S.Struct({
      next: S.optional(S.String),
      last: S.optional(S.String),
    }),
  ),
});

export type MeetingListResponse = S.Schema.Type<typeof MeetingListResponseSchema>;

/**
 * Metadata structures
 */
export interface PaperFileMetadata {
  file_id: string;
  oparl_file_id: string;
  role: 'mainFile' | 'auxiliaryFile';
  name?: string;
  local_path: string;
  access_url: string;
}

export interface MeetingFileMetadata {
  file_id: string;
  oparl_file_id: string;
  role: 'invitation' | 'resultsProtocol' | 'verbatimProtocol' | 'auxiliaryFile';
  name?: string;
  local_path: string;
  access_url: string;
}

export interface PaperMetadata {
  type: 'Paper';
  oparl_paper_id: string;
  reference?: string;
  name?: string;
  paper_type?: string;
  date?: string;
  files: PaperFileMetadata[];
  consultations: Array<{
    meeting_id?: string;
    role?: string;
  }>;
  related_papers: string[];
}

export interface MeetingMetadata {
  type: 'Meeting';
  oparl_meeting_id: string;
  name?: string;
  date?: string;
  start?: string;
  location?: string;
  organization: Array<{
    id?: string;
    name?: string;
  }>;
  files: MeetingFileMetadata[];
  agenda_items: Array<{
    oparl_agendaitem_id?: string;
    number?: string;
    name?: string;
    consultation?: string;
    result?: string;
    auxiliary_files: MeetingFileMetadata[];
  }>;
}
