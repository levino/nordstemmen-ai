import { Effect, Schema as S, pipe } from 'effect';
import { OParlFileSchema, FileListResponseSchema } from './schema.ts';
import type { OParlFile, FileListResponse } from './schema.ts';

export const FILE_LIST_URL = 'https://nordstemmen.ratsinfomanagement.net/webservice/oparl/v1.1/body/1/file';

/**
 * Fetch a single page and decode files
 */
const fetchPage = (url: string): Effect.Effect<{ files: OParlFile[]; nextUrl?: string }, Error> =>
  pipe(
    Effect.tryPromise({
      try: () => fetch(url),
      catch: (error) => new Error(`Failed to fetch ${url}: ${error}`),
    }),
    Effect.flatMap((response) =>
      response.ok
        ? Effect.succeed(response)
        : Effect.fail(new Error(`HTTP ${response.status}: ${response.statusText}`))
    ),
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: () => response.json(),
        catch: (error) => new Error(`Failed to parse JSON: ${error}`),
      })
    ),
    Effect.flatMap((json) => S.decodeUnknown(FileListResponseSchema)(json)),
    Effect.flatMap((decoded) =>
      pipe(
        Effect.all(
          decoded.data.map((item) => S.decodeUnknown(OParlFileSchema)(item))
        ),
        Effect.map((files) => ({
          files,
          nextUrl: decoded.links?.next,
        }))
      )
    )
  );

/**
 * Recursively fetch all pages
 */
const fetchAllPagesRec = (
  url: string,
  accumulated: OParlFile[]
): Effect.Effect<OParlFile[], Error> =>
  pipe(
    fetchPage(url),
    Effect.flatMap(({ files, nextUrl }) =>
      nextUrl
        ? fetchAllPagesRec(nextUrl, [...accumulated, ...files])
        : Effect.succeed([...accumulated, ...files])
    )
  );

/**
 * Fetch all files from OParl API with pagination
 */
export const fetchAllFiles = (): Effect.Effect<OParlFile[], Error> =>
  fetchAllPagesRec(FILE_LIST_URL, []);

/**
 * Download a file
 */
export const downloadFile = (url: string): Effect.Effect<ArrayBuffer, Error> =>
  pipe(
    Effect.tryPromise({
      try: () => fetch(url),
      catch: (error) => new Error(`Failed to download ${url}: ${error}`),
    }),
    Effect.flatMap((response) =>
      response.ok
        ? Effect.succeed(response)
        : Effect.fail(new Error(`HTTP ${response.status}: ${response.statusText}`))
    ),
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: () => response.arrayBuffer(),
        catch: (error) => new Error(`Failed to read response: ${error}`),
      })
    )
  );
