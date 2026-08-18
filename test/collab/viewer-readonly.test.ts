import { afterEach, describe, expect, it } from "vitest";
import { useBoard } from "../../src/components/reference/useReferenceBoard";

afterEach(() => useBoard.getState().newScene("test"));

describe("collaborative viewer boundary", () => {
  it("rejects durable renderer mutations before native IPC", () => {
    useBoard.getState().loadScene({
      id: "scene",
      name: "shared",
      collaboration: { projectId: "project" },
      items: [],
    });
    useBoard.setState({ collabRole: "viewer" });

    const id = useBoard.getState().addItem({
      kind: "text",
      ref: "",
      src: "",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      rotation: 0,
    });
    useBoard.getState().setDrawMode(true);

    expect(id).toBe("");
    expect(useBoard.getState().items).toEqual([]);
    expect(useBoard.getState().drawMode).toBe(false);
    expect(useBoard.getState().dirty).toBe(false);
  });
});
