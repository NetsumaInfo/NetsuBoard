import { describe, expect, it } from "vitest";
import { COLLAB_PROTOCOL_VERSION } from "../../src/lib/collab/types";

describe("collaboration contract", () => {
  it("starts at protocol version one", () => {
    expect(COLLAB_PROTOCOL_VERSION).toBe(1);
  });
});
