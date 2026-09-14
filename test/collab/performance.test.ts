import { describe, expect, it } from "vitest";

import { getCollaborationPerformanceSettings } from "../../src/lib/collab/performance";

describe("collaboration performance profiles", () => {
  it("keeps the three device profiles explicit", () => {
    expect(getCollaborationPerformanceSettings("live", 8)).toMatchObject({
      coalesceMs: 60,
      previewConcurrency: 6,
      originalConcurrency: 2,
      autoResolveOriginals: true,
    });
    expect(getCollaborationPerformanceSettings("balanced", 8)).toMatchObject({
      coalesceMs: 200,
      previewConcurrency: 4,
      originalConcurrency: 2,
      autoResolveOriginals: true,
    });
    expect(getCollaborationPerformanceSettings("economy", 8)).toMatchObject({
      coalesceMs: 900,
      previewConcurrency: 2,
      originalConcurrency: 1,
      autoResolveOriginals: false,
    });
  });

  it("caps preview concurrency on a weaker device without changing the selected mode", () => {
    expect(getCollaborationPerformanceSettings("live", 4)).toMatchObject({
      mode: "live",
      previewConcurrency: 2,
      originalConcurrency: 2,
    });
  });
});
