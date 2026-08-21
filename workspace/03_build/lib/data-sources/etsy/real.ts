import type { EtsyDataSource, EtsyListing, EtsySearchResult } from './types';

const ETSY_API_BASE = 'https://openapi.etsy.com/v3/application';

interface EtsyMoney {
  amount: number;
  divisor: number;
  currency_code: string;
}

interface EtsyListingRecord {
  listing_id: number;
  title: string;
  num_favorers?: number;
  views?: number;
  price: EtsyMoney;
}

interface EtsyActiveListingsResponse {
  count: number;
  results: EtsyListingRecord[];
}

function toEtsyListing(record: EtsyListingRecord): EtsyListing {
  return {
    listingId: String(record.listing_id),
    title: record.title,
    numFavorers: record.num_favorers ?? 0,
    views: record.views ?? 0,
    price: record.price.amount / record.price.divisor,
    currencyCode: record.price.currency_code,
  };
}

// Verified live 2026-08-21 against a real approved Etsy developer app (decision 9).
// Etsy requires "x-api-key: keystring:sharedSecret" as of a Feb 9, 2026 policy change —
// keystring alone (this file's original assumption, written before a real key existed
// to test against) returns 403 "Shared secret is required in x-api-key header." Fixed
// after reproducing that exact error on the live API, not from docs alone.
export class RealEtsyDataSource implements EtsyDataSource {
  constructor(
    private readonly apiKey: string,
    private readonly sharedSecret: string,
  ) {}

  async searchListings(keywords: string[], options?: { limit?: number }): Promise<EtsySearchResult> {
    const limit = options?.limit ?? 20;
    const url = new URL(`${ETSY_API_BASE}/listings/active`);
    url.searchParams.set('keywords', keywords.join(' '));
    url.searchParams.set('limit', String(limit));

    const response = await fetch(url.toString(), {
      headers: { 'x-api-key': `${this.apiKey}:${this.sharedSecret}` },
    });

    if (!response.ok) {
      // Never leak the API key or raw provider error text (spec §2: no secrets in error messages)
      throw new Error(`Etsy API request failed with status ${response.status}`);
    }

    const body = (await response.json()) as EtsyActiveListingsResponse;

    return {
      totalCount: body.count,
      listings: body.results.map(toEtsyListing),
    };
  }
}
