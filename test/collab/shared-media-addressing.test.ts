// Un média de board partagé est désigné par `collab:<empreinte>` — jamais par un chemin. Deux règles
// en découlent, et chacune a déjà cassé des fonctionnalités entières en silence :
//   1. son adresse d'AFFICHAGE dépend du projet ouvert, et tout ce que la projection ne nomme pas un
//      par un (frames d'une séquence, pellicule, rendu d'export) doit passer par le même registre ;
//   2. le service Node ne connaît que des FICHIERS : lui remettre un `collab:` tel quel produit un
//      échec muet — c'est ainsi qu'un export .netsu s'écrivait entièrement en placeholders tout en
//      annonçant sa réussite.

import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
// @ts-expect-error — le registre teste la présence du pont Tauri, pas son contenu.
globalThis.window = { __TAURI_INTERNALS__: {} };

import {
  collabMediaSrc,
  setCurrentCollabProject,
  withLocalMediaPaths,
} from "../../src/lib/collab/currentProject";
import type { BoardItem } from "../../src/components/reference/referenceShared";

const item = (over: Partial<BoardItem>): BoardItem => ({
  id: "i", kind: "image", ref: "", src: "", x: 0, y: 0, w: 10, h: 10, rotation: 0, z: 0, ...over,
});

afterEach(() => {
  setCurrentCollabProject(null);
  invoke.mockReset();
});

describe("shared media addressing", () => {
  it("addresses a shared media through the project currently open", () => {
    setCurrentCollabProject("p1");
    expect(collabMediaSrc("collab:abc")).toContain("abc");
    expect(collabMediaSrc("collab:abc")).toContain("p1");
  });

  it("gives no address outside a shared board rather than a wrong one", () => {
    expect(collabMediaSrc("collab:abc")).toBe("");
  });

  it("hands the core real file paths, sequence frames included", async () => {
    setCurrentCollabProject("p1");
    invoke.mockImplementation((_command: string, args: { hash: string }) =>
      Promise.resolve(`C:/blobs/${args.hash}.bin`));

    const [picture, sequence] = await withLocalMediaPaths([
      item({ id: "a", ref: "collab:aaa", src: "http://collab.localhost/p1/aaa" }),
      item({ id: "b", kind: "sequence", ref: "collab:bbb", frames: ["collab:bbb", "collab:ccc"] }),
    ]);

    expect(picture.ref).toBe("C:/blobs/aaa.bin");
    // La src d'affichage vaut pour le projet ouvert, pas pour le fichier écrit : la garder ferait
    // persister une adresse morte dans le document exporté.
    expect(picture.src).toBe("");
    expect(sequence.frames).toEqual(["C:/blobs/bbb.bin", "C:/blobs/ccc.bin"]);
  });

  it("leaves a still-travelling media untouched instead of emptying it", async () => {
    setCurrentCollabProject("p1");
    invoke.mockResolvedValue(null); // les octets ne sont pas encore là

    const [waiting] = await withLocalMediaPaths([item({ ref: "collab:aaa" })]);
    // Intact : le core le signalera manquant, ce qui est réparable — un item vidé ne l'est pas.
    expect(waiting.ref).toBe("collab:aaa");
  });

  it("never asks the native side for anything outside a shared board", async () => {
    const items = [item({ ref: "C:/photos/a.png" })];
    expect(await withLocalMediaPaths(items)).toBe(items);
    expect(invoke).not.toHaveBeenCalled();
  });
});
