// The mock/real swap boundary (build plan, decision 15 in phase1-requirements.md).
// Everything downstream — classification, scoring, persistence — consumes only these
// types and never knows or cares which implementation produced them.

export interface EtsyListing {
  listingId: string;
  title: string;
  numFavorers: number;
  views: number;
  price: number;
  currencyCode: string;
}

export interface EtsySearchResult {
  /** Total matching listings for the keyword search — the "broad-topic volume" signal (§2.1). */
  totalCount: number;
  /** Top-N listings actually returned (N = the `limit` passed to searchListings). */
  listings: EtsyListing[];
}

export interface EtsyDataSource {
  searchListings(keywords: string[], options?: { limit?: number }): Promise<EtsySearchResult>;
}
