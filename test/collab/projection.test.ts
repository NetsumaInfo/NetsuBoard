import { describe, expect, it } from "vitest";

import { projectBoard, type NativeProject } from "../../src/lib/collab/projection";

const geometry = { x: 1, y: 2, width: 300, height: 200, rotation: 5, detached: false };

describe("collaboration projection", () => {
  it("projects an empty native document to an empty board", () => {
    expect(projectBoard({ revision: 1, items: [], order: [], strokes: [], shapes: [] })).toEqual([]);
  });

  it("takes z only from order and never geometry", () => {
    const project: NativeProject = {
      revision: 2,
      order: ["b", "a"],
      items: [
        { itemId: "a", kind: "image", geometry: { ...geometry, z: 99 } as never },
        { itemId: "b", kind: "text", geometry },
      ],
      strokes: [],
      shapes: [],
    };
    expect(projectBoard(project).map((item) => [item.id, item.z])).toEqual([["b", 0], ["a", 1]]);
  });

  it("projects every palette field on the palette item", () => {
    const project: NativeProject = {
      revision: 3,
      order: ["palette"],
      items: [{
        itemId: "palette",
        kind: "palette",
        geometry,
        palette: {
          colors: ["#112233"], sourceItemIds: ["source"], showValues: true,
          colorFormat: "oklch", layout: "grid",
        },
      }],
      strokes: [],
      shapes: [],
    };
    expect(projectBoard(project)[0]).toMatchObject({
      colors: ["#112233"], sourceIds: ["source"], showHex: true,
      colorFormat: "oklch", paletteLayout: "grid",
    });
  });
});
