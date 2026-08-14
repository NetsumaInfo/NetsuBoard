import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import releases from "@/data/releases.json";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// What is new in the INSTALLED version, shown once after an update. Looking for a newer version does
// NOT live here: that belongs to `UpdateButton` (see the store), which is also mounted on the setup
// screens where this dialog does not exist.
export function UpdateBootstrap() {
  const { t, i18n } = useTranslation("settings");
  const language = i18n.language.startsWith("fr") ? "fr" : "en";
  const latest = useMemo(() => releases[0], []);
  const [open, setOpen] = useState(() => {
    try { return !!latest && localStorage.getItem("nr.release.seen") !== latest.id; } catch { return false; }
  });

  function close() {
    try { localStorage.setItem("nr.release.seen", latest.id); } catch { /* noop */ }
    setOpen(false);
  }

  if (!latest) return null;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); else setOpen(true); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("updates.whatsNew", { version: latest.version })}</DialogTitle>
          <DialogDescription>{latest.title[language]}</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          {latest.highlights[language].map((highlight) => <li key={highlight}>{highlight}</li>)}
        </ul>
        <DialogFooter><Button onClick={close}>{t("updates.gotIt")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
