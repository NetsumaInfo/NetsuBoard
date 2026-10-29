// Inspector controls of a text element: the mode switch (Text | Block | Sheet) and, for a Markdown
// block, its accent and size. The conversion itself lives in blockActions.

import { useTranslation } from "react-i18next";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import { ModeBlockGlyph, ModeSheetGlyph, ModeTextGlyph } from "./netsuIcons";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useBoard } from "./useReferenceBoard";
import { switchNoteMode } from "./blockActions";
import {
  BLOCK_ACCENTS, BLOCK_SIZES, BLOCK_STEPS, DEFAULT_BLOCK_SIZE, blockAccent, blockSurface, noteMode,
  type BlockLook, type BlockStep, type NoteMode,
} from "./blockModel";
import { FONT_FAMILIES, type BoardItem } from "./referenceShared";
import { ColorControl, FontPicker, IconAction, IconToggle, NumberSpin } from "./inspectorControls";
import { Separator } from "@/components/ui/separator";

export const MODE_ICONS = { text: ModeTextGlyph, block: ModeBlockGlyph, sheet: ModeSheetGlyph } as const;
export const NOTE_MODES: NoteMode[] = ["text", "block", "sheet"];

function Seg({ value, label, children }: { value: string; label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<ToggleGroupItem value={value} aria-label={label} className="px-2" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function NoteModeSwitch({ item }: { item: BoardItem }) {
  const { t } = useTranslation("reference");
  const mode = noteMode(item);
  return (
    <ToggleGroup
      value={[mode]}
      onValueChange={(v) => v[0] && void switchNoteMode(item.id, v[0] as NoteMode)}
      variant="outline"
      size="sm"
      spacing={0}
      aria-label={t("textMode.label")}
    >
      {NOTE_MODES.map((m) => {
        const Icon = MODE_ICONS[m];
        return <Seg key={m} value={m} label={t(`textMode.${m}`)}><Icon /></Seg>;
      })}
    </ToggleGroup>
  );
}

// Three-step choice (S / M / L) bound to one field of the block's look.
function StepGroup({ label, value, onChange }: { label: string; value: BlockStep; onChange: (v: BlockStep) => void }) {
  const { t } = useTranslation("reference");
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(v) => v[0] && onChange(v[0] as BlockStep)}
      variant="outline"
      size="sm"
      spacing={0}
      aria-label={label}
    >
      {BLOCK_STEPS.map((k) => (
        <Seg key={k} value={k} label={`${label} · ${t(`textMode.size${k.toUpperCase()}`)}`}>
          <span className="text-xs font-medium">{k.toUpperCase()}</span>
        </Seg>
      ))}
    </ToggleGroup>
  );
}

// Look of a Markdown block. Font, size, text colour, surface (`highlight`) and accent (`bg`) are
// synced fields; border, radius and padding live in the local `blockLook` (see blockModel).
export function BlockControls({ item }: { item: BoardItem }) {
  const { t } = useTranslation("reference");
  const patchItem = useBoard((s) => s.patchItem);
  const accent = blockAccent(item);
  const size = item.fontSize ?? DEFAULT_BLOCK_SIZE;
  const look: BlockLook = item.blockLook ?? {};
  const setLook = (p: Partial<BlockLook>) => patchItem(item.id, { blockLook: { ...look, ...p } });
  const customAccent = accent && !BLOCK_ACCENTS.includes(accent);
  return (
    <>
      <FontPicker value={item.fontFamily ?? FONT_FAMILIES[1].value} onChange={(v) => patchItem(item.id, { fontFamily: v })} />
      <ToggleGroup
        value={BLOCK_SIZES.includes(size as (typeof BLOCK_SIZES)[number]) ? [String(size)] : []}
        onValueChange={(v) => v[0] != null && patchItem(item.id, { fontSize: Number(v[0]) })}
        variant="outline"
        size="sm"
        spacing={0}
        aria-label={t("textMode.size")}
      >
        {BLOCK_SIZES.map((px, i) => (
          <Seg key={px} value={String(px)} label={t(`textMode.size${"SML"[i]}`)}>
            <span className="text-xs font-medium">{"SML"[i]}</span>
          </Seg>
        ))}
      </ToggleGroup>
      <NumberSpin value={size} min={8} max={96} ariaLabel={t("textMode.sizeCustom")} onCommit={(v) => patchItem(item.id, { fontSize: v })} />
      <Separator orientation="vertical" className="h-6" />
      <ColorControl
        label={t("textMode.textColor")}
        value={item.color ?? "var(--color-foreground)"}
        onChange={(c) => patchItem(item.id, { color: c })}
      />
      {/* Transparent stands for "the theme surface": no fill is stored. */}
      <ColorControl
        label={t("textMode.surface")}
        value={blockSurface(item) ?? "transparent"}
        onChange={(c) => patchItem(item.id, { highlight: c === "transparent" ? undefined : c })}
        allowTransparent
      />
      <Separator orientation="vertical" className="h-6" />
      <div className="flex items-center gap-1" role="radiogroup" aria-label={t("textMode.accent")}>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                role="radio"
                aria-checked={!accent}
                aria-label={t("textMode.accentNone")}
                onClick={() => patchItem(item.id, { bg: undefined })}
                className={cn(
                  "inline-flex size-5 items-center justify-center rounded-full border border-border text-muted-foreground",
                  !accent && "ring-2 ring-primary ring-offset-1 ring-offset-card",
                )}
              />
            }
          >
            <NetsuIcon name="ban" className="size-3" />
          </TooltipTrigger>
          <TooltipContent>{t("textMode.accentNone")}</TooltipContent>
        </Tooltip>
        {BLOCK_ACCENTS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={accent === c}
            aria-label={c}
            onClick={() => patchItem(item.id, { bg: c })}
            className={cn(
              "size-5 rounded-full transition-transform hover:scale-110",
              accent === c && "ring-2 ring-primary ring-offset-1 ring-offset-card",
            )}
            style={{ background: c }}
          />
        ))}
        <ColorControl label={t("textMode.accentCustom")} value={customAccent ? accent : "#3b82f6"} onChange={(c) => patchItem(item.id, { bg: c })} />
      </div>
      <Separator orientation="vertical" className="h-6" />
      <IconToggle on={look.border !== false} label={t("textMode.border")} onClick={() => setLook({ border: look.border === false })}>
        <NetsuIcon name="solid" />
      </IconToggle>
      <StepGroup label={t("textMode.radius")} value={look.radius ?? "m"} onChange={(radius) => setLook({ radius })} />
      <StepGroup label={t("textMode.padding")} value={look.pad ?? "m"} onChange={(pad) => setLook({ pad })} />
      <IconAction
        label={t("textMode.resetLook")}
        onClick={() => patchItem(item.id, {
          fontFamily: undefined, fontSize: DEFAULT_BLOCK_SIZE, color: undefined, highlight: undefined, bg: undefined, blockLook: undefined,
        })}
      >
        <NetsuIcon name="reset" />
      </IconAction>
    </>
  );
}
