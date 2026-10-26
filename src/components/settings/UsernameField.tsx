import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uiLocale } from "@/lib/utils";

type Result =
  | { status: "ok"; username: string }
  | { status: "cooldown"; nextChangeAt: number }
  | { status: "format" | "reserved" | "taken" | "noProfile" };

/**
 * The NetsuBoard pseudonym: what friends type to add this account. Kept apart from the Discord
 * username, which is shown next to it and never edited here.
 */
export function UsernameField({ username, discordUsername }: { username: string | null; discordUsername: string | null }) {
  const { t } = useTranslation("settings");
  const setUsername = useMutation(api.social.setUsername);
  const [value, setValue] = useState(username ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => setValue(username ?? ""), [username]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = (await setUsername({ username: value })) as Result;
      if (res.status === "ok") setMessage({ text: t("collab.username.saved"), error: false });
      else if (res.status === "cooldown")
        setMessage({
          text: t("collab.username.cooldown", { date: new Date(res.nextChangeAt).toLocaleDateString(uiLocale()) }),
          error: true,
        });
      else setMessage({ text: t(`collab.username.${res.status}`), error: true });
    } catch {
      setMessage({ text: t("collab.username.error"), error: true });
    } finally {
      setBusy(false);
    }
  };

  const normalized = value.trim().replace(/^@/, "").toLowerCase();

  return (
    <form onSubmit={submit} className="mt-3 space-y-1.5">
      <p className="text-xs font-medium">{t("collab.username.label")}</p>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("collab.username.placeholder")}
          maxLength={21}
          className="h-8"
          disabled={busy}
        />
        <Button type="submit" size="sm" variant="outline" disabled={busy || !normalized || normalized === username}>
          {t("collab.username.save")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("collab.username.hint")}</p>
      {discordUsername && (
        <p className="text-xs text-muted-foreground">{t("collab.username.discord", { name: discordUsername })}</p>
      )}
      {message && (
        <p className={message.error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{message.text}</p>
      )}
    </form>
  );
}
