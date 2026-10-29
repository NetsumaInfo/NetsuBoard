// Compact emoji grid for the callout block. A curated list, not the full emoji-mart dataset: that
// package is not a dependency of NetsuBoard and ~1 800 cells would weigh on the board.
import { useMemo, useState } from "react";
import { NetsuIcon } from "@/components/ui/netsu-icon";
import i18n from "@/i18n";

const EMOJIS = (
  "💡 📝 ℹ️ ⚠️ ❗ ❓ ✅ ❌ ⭐ 🔥 🎯 📌 📎 🔗 🔒 🔑 🧠 💭 💬 📣 🔔 ⏰ 📅 📷 🎬 🎞️ 🎨 🖌️ ✏️ 🎵 🎧 🎤 🎮 📺 📁 📂 📄 📊 📈 📉 🧩 🧪 🔧 🛠️ ⚙️ 🚀 🌟 ✨ 🎉 🏆 💎 🌈 ☀️ 🌙 ⚡ 💧 🍀 🌸 🌿 🐱 🐶 🦊 👀 👍 👎 👏 🙏 💪 ❤️ 💔 😀 😅 😂 😍 🤔 😎 😴 😡 😱"
).split(" ");

export function EmojiPicker({ onPick, className, heightClass = "max-h-56" }: { onPick: (ch: string) => void; className?: string; heightClass?: string }) {
  const [custom, setCustom] = useState("");
  const list = useMemo(() => EMOJIS, []);
  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-1.5 rounded-md border border-border bg-muted px-2">
        <NetsuIcon name="search" className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          autoComplete="off"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && custom.trim()) { e.preventDefault(); onPick(custom.trim()); setCustom(""); } }}
          placeholder={i18n.t("note:emoji.custom")}
          className="w-full bg-transparent py-1.5 text-sm outline-none"
        />
      </div>
      <div className={`${heightClass} overflow-y-auto pr-1`}>
        <div className="grid grid-cols-8 gap-0.5">
          {list.map((ch) => (
            <button
              key={ch}
              type="button"
              onClick={() => onPick(ch)}
              className="flex aspect-square items-center justify-center rounded-md text-xl leading-none transition-colors hover:bg-accent"
            >
              {ch}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
