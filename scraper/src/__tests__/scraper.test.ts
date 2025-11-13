import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import nock from 'nock';
import { fetchAllPapers } from '../client.ts';

nock.back.fixtures = `${import.meta.dirname}/nockFixtures`;

describe('fetchAllPapers', () => {
  it('should fetch all papers and return non-empty array', async () => {
    const { nockDone } = await nock.back('fetch-all-papers.json');

    const papers = await Effect.runPromise(fetchAllPapers());
    expect(papers).toBeInstanceOf(Array);
    expect(papers.length).toEqual(1564);

    nockDone();
  }, 600000);
});
