import type { EtsyDataSource } from './types';
import { MockEtsyDataSource } from './mock';
import { RealEtsyDataSource } from './real';

export type { EtsyDataSource, EtsyListing, EtsySearchResult } from './types';
export { MockEtsyDataSource } from './mock';
export { RealEtsyDataSource } from './real';

// ETSY_DATA_SOURCE explicitly set -> honored as-is. Otherwise: real if ETSY_API_KEY is
// present, mock if not — see .env.example and phase1-requirements.md decision 15.
// Nothing outside this file branches on mock vs. real; callers just get an EtsyDataSource.
export function getEtsyDataSource(): EtsyDataSource {
  const explicitMode = process.env.ETSY_DATA_SOURCE;
  const mode = explicitMode ?? (process.env.ETSY_API_KEY ? 'real' : 'mock');

  if (mode === 'real') {
    const apiKey = process.env.ETSY_API_KEY;
    if (!apiKey) {
      throw new Error('ETSY_DATA_SOURCE=real but ETSY_API_KEY is not set');
    }
    return new RealEtsyDataSource(apiKey);
  }

  return new MockEtsyDataSource();
}
