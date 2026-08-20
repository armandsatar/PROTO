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

// UNVERIFIED — cannot be smoke-tested until the Etsy developer app is approved
// (phase1-requirements.md decision 9, "in progress" as of 2026-08-19). Written against
// Etsy's documented Open API v3 shape (findAllListingsActive / GET listings/active) —
// see the sources list at the bottom of phase1-requirements.md. Re-verify field names
// against a live response the first time a real key is used; Etsy's docs have moved
// fields before (flagged in phase1-requirements.md §2.1).
export class RealEtsyDataSource implements EtsyDataSource {
  constructor(private readonly apiKey: string) {}

  async searchListings(keywords: string[], options?: { limit?: number }): Promise<EtsySearchResult> {
    const limit = options?.limit ?? 20;
    const url = new URL(`${ETSY_API_BASE}/listings/active`);
    url.searchParams.set('keywords', keywords.join(' '));
    url.searchParams.set('limit', String(limit));

    const response = await fetch(url.toString(), {
      headers: { 'x-api-key': this.apiKey },
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
