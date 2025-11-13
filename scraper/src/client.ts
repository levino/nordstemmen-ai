import { Effect, Schema as S, pipe, flow } from 'effect';
import { PaperListResponseSchema, MeetingListResponseSchema } from './schema.ts';
import type { OParlPaper, OParlMeeting } from './schema.ts';

export const PAPER_LIST_URL = 'https://nordstemmen.ratsinfomanagement.net/webservice/oparl/v1.1/body/1/paper';
export const MEETING_LIST_URL = 'https://nordstemmen.ratsinfomanagement.net/webservice/oparl/v1.1/body/1/meeting';

export const effectFetch = (url: string): Effect.Effect<Response, Error> =>
  pipe(
    Effect.tryPromise(() => fetch(url)),
    Effect.flatMap((response) =>
      response.ok ? Effect.succeed(response) : Effect.fail(new Error(`HTTP ${response.status}`)),
    ),
  );

export const effectFetchJson = flow(effectFetch, Effect.flatMap((response) => Effect.tryPromise(() => response.json())));

const fetchPaperPage = flow(
  effectFetchJson,
  Effect.flatMap(S.decodeUnknown(PaperListResponseSchema)),
  Effect.map((decoded) => ({
    papers: [...decoded.data],
    nextUrl: decoded.links?.next,
  })),
);

const fetchMeetingPage = flow(
  effectFetchJson,
  Effect.flatMap(S.decodeUnknown(MeetingListResponseSchema)),
  Effect.map((decoded) => ({
    meetings: [...decoded.data],
    nextUrl: decoded.links?.next,
  })),
);

const fetchAllPaperPages = (startUrl: string): Effect.Effect<OParlPaper[], Error> =>
  Effect.gen(function* () {
    const firstPage = yield* effectFetchJson(startUrl);
    const decoded = yield* S.decodeUnknown(PaperListResponseSchema)(firstPage);

    const pageUrls: string[] = [startUrl];

    if (decoded.links?.last) {
      const lastUrl = new URL(decoded.links.last);
      const lastPage = Number.parseInt(lastUrl.searchParams.get('page') || '1');

      for (let i = 2; i <= lastPage; i++) {
        const pageUrl = new URL(startUrl);
        pageUrl.searchParams.set('page', i.toString());
        pageUrls.push(pageUrl.toString());
      }
    }

    const results = yield* Effect.all(
      pageUrls.map((url) => fetchPaperPage(url)),
      { concurrency: 32 }
    );

    return results.flatMap(r => r.papers);
  });

const fetchAllMeetingPages = (startUrl: string): Effect.Effect<OParlMeeting[], Error> =>
  Effect.gen(function* () {
    const firstPage = yield* effectFetchJson(startUrl);
    const decoded = yield* S.decodeUnknown(MeetingListResponseSchema)(firstPage);

    const pageUrls: string[] = [startUrl];

    if (decoded.links?.last) {
      const lastUrl = new URL(decoded.links.last);
      const lastPage = Number.parseInt(lastUrl.searchParams.get('page') || '1');

      for (let i = 2; i <= lastPage; i++) {
        const pageUrl = new URL(startUrl);
        pageUrl.searchParams.set('page', i.toString());
        pageUrls.push(pageUrl.toString());
      }
    }

    const results = yield* Effect.all(
      pageUrls.map((url) => fetchMeetingPage(url)),
      { concurrency: 32 }
    );

    return results.flatMap(r => r.meetings);
  });

export const fetchAllPapers = (): Effect.Effect<OParlPaper[], Error> => fetchAllPaperPages(PAPER_LIST_URL);

export const fetchAllMeetings = (): Effect.Effect<OParlMeeting[], Error> => fetchAllMeetingPages(MEETING_LIST_URL);

export const downloadFile = flow(
  effectFetch,
  Effect.flatMap((response) => Effect.tryPromise(() => response.arrayBuffer())),
);
