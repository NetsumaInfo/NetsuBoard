// Dialog « Ajouter une vidéo en ligne » — partagé par la barre d'outils et le menu contextuel.
// Soumet le lien au routage unifié du board (addUrl : YouTube/embed/extraction/download) avec un
// état occupé pendant la résolution et un message d'erreur si le lien n'aboutit à rien.

import { useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { BoardHandle } from "./ReferenceBoard";

export function AddLinkDialog({
  board,
  open,
  onOpenChange,
  asCard = false,
}: {
  board: RefObject<BoardHandle | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Site card: the link is put as a card (preview of the page), nothing is downloaded.
  asCard?: boolean;
}) {
  const { t } = useTranslation("reference");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !url.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const ok = asCard ? board.current?.addLinkCard(url) : await board.current?.addUrl(url, { allowGenericEmbed: true });
      if (ok) {
        setUrl("");
        onOpenChange(false);
      } else {
        setErr(t("linkDialog.notFound"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return; // résolution en cours : on ne ferme pas sous les pieds de l'utilisateur
        setErr(null);
        // le champ ne survit pas à la fermeture : sinon la prochaine ouverture repropose le lien
        // qui vient d'échouer, et l'utilisateur le resoumet sans le voir.
        if (!o) setUrl("");
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(asCard ? "linkDialog.cardTitle" : "linkDialog.title")}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={url}
          disabled={busy}
          onChange={(e) => { setUrl(e.target.value); setErr(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
          placeholder={t(asCard ? "linkDialog.cardPlaceholder" : "linkDialog.placeholder")}
        />
        {err && <p className="text-xs text-destructive">{err}</p>}
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={!url.trim() || busy}>
            {busy && <Spinner />}
            {busy ? t("linkDialog.adding") : t("common:action.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
