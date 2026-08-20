import { describe, it, expect } from 'vitest';
import { computeDemandScore } from '../lib/scoring/demand';
import { computeCompetitionScore } from '../lib/scoring/competition';
import { scoreToColor } from '../lib/scoring/colors';
import type { EtsyListing } from '../lib/data-sources/etsy';

function listing(numFavorers: number, views: number): EtsyListing {
  return { listingId: 'x', title: 't', numFavorers, views, price: 10, currencyCode: 'USD' };
}

describe('scoreToColor', () => {
  it('matches the decision-4 thresholds exactly: green >=7, amber 5-6, red <=4', () => {
    expect(scoreToColor(10)).toBe('green');
    expect(scoreToColor(7)).toBe('green');
    expect(scoreToColor(6)).toBe('amber');
    expect(scoreToColor(5)).toBe('amber');
    expect(scoreToColor(4)).toBe('red');
    expect(scoreToColor(1)).toBe('red');
  });
});

describe('computeDemandScore (§3.1 bucket table, hand-computed expectations)', () => {
  it('strong favorers + strong views -> sub-scores 10/10, weighted 10 -> score 10 green', () => {
    // avgFavorers=100 (76+ -> 10), avgViews=3000 (2001+ -> 10)
    // weighted = 10*0.6 + 10*0.4 = 10
    const result = computeDemandScore([listing(100, 3000), listing(100, 3000)]);
    expect(result.detail.avgFavorers).toBe(100);
    expect(result.detail.avgViews).toBe(3000);
    expect(result.score).toBe(10);
    expect(result.color).toBe('green');
  });

  it('weak favorers + weak views -> sub-scores 1/1, weighted 1 -> score 1 red', () => {
    // avgFavorers=2 (<5 -> 1), avgViews=50 (<100 -> 1)
    const result = computeDemandScore([listing(2, 50)]);
    expect(result.score).toBe(1);
    expect(result.color).toBe('red');
  });

  it('mixed signals land in the amber band via the documented weighting', () => {
    // avgFavorers=10 (5-20 -> sub 4), avgViews=1000 (501-2000 -> sub 7)
    // weighted = 4*0.6 + 7*0.4 = 2.4 + 2.8 = 5.2 -> round 5 -> amber
    const result = computeDemandScore([listing(10, 1000), listing(10, 1000)]);
    expect(result.score).toBe(5);
    expect(result.color).toBe('amber');
  });

  it('bucket boundaries match the table exactly (5, 20, 75, 76 for favorers)', () => {
    expect(computeDemandScore([listing(4, 100)]).detail.favorersSubScore).toBe(1); // <5
    expect(computeDemandScore([listing(5, 100)]).detail.favorersSubScore).toBe(4); // 5-20
    expect(computeDemandScore([listing(20, 100)]).detail.favorersSubScore).toBe(4); // 5-20
    expect(computeDemandScore([listing(21, 100)]).detail.favorersSubScore).toBe(7); // 21-75
    expect(computeDemandScore([listing(75, 100)]).detail.favorersSubScore).toBe(7); // 21-75
    expect(computeDemandScore([listing(76, 100)]).detail.favorersSubScore).toBe(10); // 76+
  });

  it('bucket boundaries match the table exactly (100, 500, 2000, 2001 for views)', () => {
    expect(computeDemandScore([listing(0, 99)]).detail.viewsSubScore).toBe(1); // <100
    expect(computeDemandScore([listing(0, 100)]).detail.viewsSubScore).toBe(4); // 100-500
    expect(computeDemandScore([listing(0, 500)]).detail.viewsSubScore).toBe(4); // 100-500
    expect(computeDemandScore([listing(0, 501)]).detail.viewsSubScore).toBe(7); // 501-2000
    expect(computeDemandScore([listing(0, 2000)]).detail.viewsSubScore).toBe(7); // 501-2000
    expect(computeDemandScore([listing(0, 2001)]).detail.viewsSubScore).toBe(10); // 2001+
  });

  it('degrades gracefully to score 1/red when there are zero exact-angle-match listings', () => {
    const result = computeDemandScore([]);
    expect(result.detail.avgFavorers).toBe(0);
    expect(result.detail.avgViews).toBe(0);
    expect(result.score).toBe(1);
    expect(result.color).toBe('red');
    expect(result.detail.exactAngleMatchListingCount).toBe(0);
  });

  it('every score stays within the documented 1-10 range', () => {
    const cases: EtsyListing[][] = [[], [listing(0, 0)], [listing(1000, 100000)]];
    for (const listings of cases) {
      const { score } = computeDemandScore(listings);
      expect(score).toBeGreaterThanOrEqual(1);
      expect(score).toBeLessThanOrEqual(10);
    }
  });
});

describe('computeCompetitionScore (§3.1 bucket table, hand-computed expectations)', () => {
  it('zero exact-angle matches + low volume -> sub-scores 10/10, weighted 10 -> green', () => {
    const result = computeCompetitionScore(0, 30);
    expect(result.score).toBe(10);
    expect(result.color).toBe('green');
  });

  it('crowded exact-angle matches + high volume -> sub-scores 1/2, weighted 1.3 -> red', () => {
    // exactAngle=8 (6+ -> sub 1), totalCount=1000 (500+ -> sub 2)
    // weighted = 1*0.7 + 2*0.3 = 0.7 + 0.6 = 1.3 -> round 1
    const result = computeCompetitionScore(8, 1000);
    expect(result.score).toBe(1);
    expect(result.color).toBe('red');
  });

  it('mixed signals land in the green/amber boundary via the documented weighting', () => {
    // exactAngle=2 (1-2 -> sub 7), totalCount=200 (50-500 -> sub 6)
    // weighted = 7*0.7 + 6*0.3 = 4.9 + 1.8 = 6.7 -> round 7 -> green
    const result = computeCompetitionScore(2, 200);
    expect(result.score).toBe(7);
    expect(result.color).toBe('green');
  });

  it('a different mix lands in amber', () => {
    // exactAngle=3 (3-5 -> sub 4), totalCount=500 (50-500 -> sub 6)
    // weighted = 4*0.7 + 6*0.3 = 2.8 + 1.8 = 4.6 -> round 5 -> amber
    const result = computeCompetitionScore(3, 500);
    expect(result.score).toBe(5);
    expect(result.color).toBe('amber');
  });

  it('bucket boundaries match the table exactly for exact-angle count (0,1,2,3,5,6)', () => {
    expect(computeCompetitionScore(0, 30).detail.exactAngleSubScore).toBe(10);
    expect(computeCompetitionScore(1, 30).detail.exactAngleSubScore).toBe(7);
    expect(computeCompetitionScore(2, 30).detail.exactAngleSubScore).toBe(7);
    expect(computeCompetitionScore(3, 30).detail.exactAngleSubScore).toBe(4);
    expect(computeCompetitionScore(5, 30).detail.exactAngleSubScore).toBe(4);
    expect(computeCompetitionScore(6, 30).detail.exactAngleSubScore).toBe(1);
  });

  it('bucket boundaries match the table exactly for total volume (49,50,500,501)', () => {
    expect(computeCompetitionScore(0, 49).detail.broadVolumeSubScore).toBe(10);
    expect(computeCompetitionScore(0, 50).detail.broadVolumeSubScore).toBe(6);
    expect(computeCompetitionScore(0, 500).detail.broadVolumeSubScore).toBe(6);
    expect(computeCompetitionScore(0, 501).detail.broadVolumeSubScore).toBe(2);
  });

  it('every score stays within the documented 1-10 range', () => {
    const cases: Array<[number, number]> = [[0, 0], [6, 501], [3, 200]];
    for (const [exact, total] of cases) {
      const { score } = computeCompetitionScore(exact, total);
      expect(score).toBeGreaterThanOrEqual(1);
      expect(score).toBeLessThanOrEqual(10);
    }
  });
});
