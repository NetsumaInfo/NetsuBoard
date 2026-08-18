import { describe, expect, it } from "vitest";

import { collabErrorMessage } from "../../src/lib/collab/client";

describe("collaboration client errors", () => {
  it("extracts the message from a structured Tauri failure", () => {
    expect(
      collabErrorMessage(
        { code: "validation", message: "device registration failed" },
        "fallback",
      ),
    ).toBe("device registration failed");
  });

  it("keeps Error messages and rejects opaque values", () => {
    expect(collabErrorMessage(new Error("network unavailable"), "fallback")).toBe(
      "network unavailable",
    );
    expect(collabErrorMessage({ message: "" }, "fallback")).toBe("fallback");
    expect(collabErrorMessage({ nested: true }, "fallback")).toBe("fallback");
  });
});
