import { describe, expect, it } from 'vitest';
import { buildMeetingIndex, collectFiles, filesToDownload, isUpToDate } from '../sync.ts';

const file = (name: string, modified?: string) => ({
  id: `file/${name}`,
  accessUrl: `https://example.org/files/token/${name}.pdf`,
  modified,
});

describe('collectFiles', () => {
  it('collects meeting files incl. agenda item attachments', () => {
    const meeting = {
      id: 'meeting/1',
      invitation: file('einladung'),
      resultsProtocol: file('protokoll'),
      auxiliaryFile: [file('anlage')],
      agendaItem: [{ number: '1' }, { auxiliaryFile: [file('top-anlage')] }],
    };
    expect(collectFiles(meeting).map((f) => f.id)).toEqual([
      'file/einladung',
      'file/protokoll',
      'file/anlage',
      'file/top-anlage',
    ]);
  });

  it('ignores missing and URL-less file objects', () => {
    expect(collectFiles({ id: 'paper/1', mainFile: { id: 'x' }, auxiliaryFile: [] })).toEqual([]);
  });
});

describe('filesToDownload', () => {
  it('downloads files that are missing locally', () => {
    const files = [file('a'), file('b')];
    const result = filesToDownload(files, undefined, (name) => name === 'a.pdf');
    expect(result.map((f) => f.id)).toEqual(['file/b']);
  });

  it('re-downloads files whose modified timestamp changed', () => {
    const stored = { id: 'm', invitation: file('a', '2026-01-01') };
    const result = filesToDownload([file('a', '2026-02-01')], stored, () => true);
    expect(result.map((f) => f.id)).toEqual(['file/a']);
  });

  it('keeps existing files when no previous timestamp is known', () => {
    const stored = { id: 'm', invitation: { id: 'file/a', accessUrl: 'https://example.org/a.pdf' } };
    expect(filesToDownload([file('a', '2026-02-01')], stored, () => true)).toEqual([]);
  });

  it('deduplicates files resolving to the same filename', () => {
    expect(filesToDownload([file('a'), file('a')], undefined, () => false)).toHaveLength(1);
  });
});

describe('isUpToDate', () => {
  it('is up to date only if modified matches and nothing is pending', () => {
    const entity = { id: 'm', modified: '2026-09-18' };
    expect(isUpToDate(entity, { id: 'm', modified: '2026-09-18' }, 0)).toBe(true);
    expect(isUpToDate(entity, { id: 'm', modified: '2026-09-18' }, 1)).toBe(false);
    expect(isUpToDate(entity, { id: 'm', modified: '2026-01-01' }, 0)).toBe(false);
    expect(isUpToDate(entity, { id: 'm' }, 0)).toBe(false);
    expect(isUpToDate(entity, undefined, 0)).toBe(false);
  });
});

describe('buildMeetingIndex', () => {
  it('maps ids to a single folder, preferring folders with files, then the last name', () => {
    const index = buildMeetingIndex([
      { folder: '2026-09-29_Rat_(26._Sitzung)', id: 'meeting/5786', fileCount: 0 },
      { folder: '2026-09-29_Rat_(33._Sitzung)', id: 'meeting/5786', fileCount: 0 },
      { folder: '2026-02-05_Ortsrat_(14._Sitzung)', id: 'meeting/5855', fileCount: 4 },
      { folder: '2026-02-17_Ortsrat_(14._Sitzung)', id: 'meeting/5855', fileCount: 0 },
    ]);
    expect(index.get('meeting/5786')).toBe('2026-09-29_Rat_(33._Sitzung)');
    expect(index.get('meeting/5855')).toBe('2026-02-05_Ortsrat_(14._Sitzung)');
  });
});
