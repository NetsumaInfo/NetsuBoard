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

  // Un média hashé est servi par le protocole natif ; tout le reste garde la règle d'affichage du
  // board. Sans `src`, un lecteur YouTube et une carte embed arrivaient VIDES chez le destinataire —
  // donc sans lecture, sans boucle et sans in/out, alors que le document, lui, portait tout.
  it("gives a shared YouTube item the playable source its player needs", () => {
    const project: NativeProject = {
      revision: 4,
      order: ["yt"],
      items: [{
        itemId: "yt",
        kind: "youtube",
        geometry,
        media: { primary: { youtubeId: "dQw4w9WgXcQ", displayName: "YouTube", mime: "video/youtube", size: 0 } },
        trim: { start: 12, end: 30, duration: 240 },
      }],
      strokes: [],
      shapes: [],
    };
    expect(projectBoard(project)[0]).toMatchObject({
      ref: "dQw4w9WgXcQ",
      src: "dQw4w9WgXcQ",
      trimIn: 12,
      trimOut: 30,
      dur: 240,
    });
  });

  it("rebuilds the iframe address of a shared embed card", () => {
    const project: NativeProject = {
      revision: 5,
      order: ["card"],
      items: [{
        itemId: "card",
        kind: "embed",
        geometry,
        media: {
          primary: {
            remoteUrl: "https://vimeo.com/76979871",
            displayName: "76979871", mime: "video/*", size: 0,
          },
        },
      }],
      strokes: [],
      shapes: [],
    };
    const [card] = projectBoard(project);
    expect(card.ref).toBe("https://vimeo.com/76979871");
    expect(card.src).toContain("player.vimeo.com");
  });

  it("addresses a hashed media through the native protocol, previous and local variants included", () => {
    const project: NativeProject = {
      revision: 6,
      order: ["shot"],
      items: [{
        itemId: "shot",
        kind: "image",
        geometry,
        media: {
          primary: { contentHash: "aaa", displayName: "a.png", mime: "image/png", size: 10 },
          previous: {
            kind: "image",
            asset: { contentHash: "bbb", displayName: "b.png", mime: "image/png", size: 10 },
          },
          local: {
            kind: "video",
            asset: { contentHash: "ccc", displayName: "c.mp4", mime: "video/mp4", size: 10 },
          },
        },
      }],
      strokes: [],
      shapes: [],
    };
    const [shot] = projectBoard(project, (hash) => `native://${hash}`);
    expect(shot.src).toBe("native://aaa");
    expect(shot.prevMedia?.src).toBe("native://bbb");
    expect(shot.localMedia?.src).toBe("native://ccc");
  });
});
