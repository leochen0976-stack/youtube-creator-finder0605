import { describe, expect, it } from "vitest";
import {
  computeCreatorEngagementScore,
  computeCreatorScore,
  computeLogScaledScore,
  computeSubscriberScore
} from "./scoringService.js";

describe("creator score", () => {
  it("computes the weighted Creator Score from 0-100 component scores", () => {
    const score = computeCreatorScore({
      avg_views: 999_999,
      engagement_rate: 0.025,
      subscribers: 999_999
    });

    expect(score.avg_views_score).toBeCloseTo(100, 3);
    expect(score.creator_engagement_score).toBeCloseTo(50, 3);
    expect(score.subscriber_score).toBeCloseTo(100, 3);
    expect(score.creator_score).toBeCloseTo(85, 3);
    expect(score.creator_score_breakdown).toEqual({
      avg_views_score: score.avg_views_score,
      creator_engagement_score: score.creator_engagement_score,
      subscriber_score: score.subscriber_score
    });
  });

  it("caps engagement score at 100 after the target engagement rate", () => {
    expect(computeCreatorEngagementScore(0.05)).toBe(100);
    expect(computeCreatorEngagementScore(0.25)).toBe(100);
  });

  it("uses log scale for subscriber scoring so big channels do not scale linearly", () => {
    const tenThousand = computeSubscriberScore(10_000);
    const hundredThousand = computeSubscriberScore(100_000);
    const linearDelta = 90_000;

    expect(hundredThousand - tenThousand).toBeLessThan(linearDelta / 1000);
    expect(hundredThousand).toBeGreaterThan(tenThousand);
  });

  it("normalizes log-scaled scores into the 0-100 range", () => {
    expect(computeLogScaledScore(0, 1_000_000)).toBe(0);
    expect(computeLogScaledScore(1_000_000, 1_000_000)).toBe(100);
    expect(computeLogScaledScore(10_000_000, 1_000_000)).toBe(100);
  });
});
