// Switching a text element between its modes (text / block / sheet). The conversions that need the
// BlockNote serialisers load them on demand (the editor never weighs on a board with no sheet).

import i18n from "@/i18n";
import { logError } from "@/lib/appLog";
import { errorText } from "@/lib/errorText";
import { useBoard } from "./useReferenceBoard";
import { blockSource, modePatch, noteMode, plainToMarkdown, sheetIsRich, type NoteMode } from "./blockModel";

export async function switchNoteMode(id: string, to: NoteMode): Promise<void> {
  const st = useBoard.getState();
  const item = st.items.find((it) => it.id === id);
  if (!item || item.kind !== "text") return;
  const from = noteMode(item);
  if (from === to) return;
  try {
    let conv: Parameters<typeof modePatch>[2] = {};
    if (from === "sheet") {
      // A sheet with images, embeds, callouts… cannot become text without losing them: it stays a sheet.
      if (sheetIsRich(item.doc)) {
        st.setNotice({ kind: "error", text: i18n.t("reference:textMode.rich", { mode: i18n.t(`reference:textMode.${to}`) }) });
        return;
      }
      const note = await import("./note/noteExport");
      conv = to === "block" ? { markdown: await note.blocksToMarkdown(item.doc ?? []) } : { plain: note.blocksToPlain(item.doc ?? []) };
    } else if (to === "sheet") {
      const note = await import("./note/noteExport");
      const source = from === "block" ? blockSource(item) : plainToMarkdown(item.text ?? "");
      const blocks = source.trim() ? await note.markdownToBlocks(source) : [];
      conv = { blocks, plain: from === "block" ? note.blocksToPlain(blocks) : item.text ?? "" };
    }
    // The item may have changed or gone while the serialisers loaded.
    const now = useBoard.getState().items.find((it) => it.id === id);
    if (!now || noteMode(now) !== from) return;
    useBoard.getState().patchItem(id, modePatch(now, to, conv));
  } catch (e) {
    logError("board:note", `mode ${from} -> ${to}: ${errorText(e)}`);
    st.setNotice({ kind: "error", text: i18n.t("reference:textMode.failed") });
  }
}
