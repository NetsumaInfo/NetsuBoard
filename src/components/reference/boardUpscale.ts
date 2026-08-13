// Upscale d'un item média du board. Deux chemins pour un même travail :
//  - la popup (UpscaleItemDialog) quand on veut choisir modèle/échelle et voir un aperçu ;
//  - le chemin RAPIDE (`quickUpscale`) quand les Paramètres du board fixent déjà les réglages :
//    un seul clic, aucune boîte de dialogue, progression en notice.
// Les deux partagent la résolution du fichier local et l'application non destructive du résultat.

import { nr } from "@/lib/bridge";
import type { ShaderModel, UpscaleModel } from "@/lib/bridge";
import i18n from "@/i18n";
import { displaySrc, isRemoteRef, type BoardItem } from "./referenceShared";
import type { BoardPrefs } from "./boardPrefs";
import { useBoard } from "./useReferenceBoard";

const tr = (key: string, opts?: Record<string, unknown>) => i18n.t(`reference:${key}`, opts);

// Réglages effectifs d'un upscale. Le sélecteur ne porte qu'un id de shader : NetsuBoard n'a pas de
// moteur IA, et images comme vidéos passent par le même filtre GPU.
export interface UpscaleChoice {
  engine: "ia" | "turbo";
  model: UpscaleModel;
  shader: ShaderModel;
  scale: 1 | 2 | 4;
  denoise?: number;
}

// Un seul moteur, donc plus d'arbitrage : la sélection EST le shader, pour une image comme pour une
// vidéo (libplacebo traite une image comme une vidéo d'une seule frame). Le débruitage disparaît
// avec les réseaux IA qui l'exposaient — les variantes DS/DN des shaders le portent dans leurs poids.
export function upscaleChoiceFrom(selection: string, prefs: BoardPrefs, _isVideo: boolean, _denoise: number, scale: 1 | 2 | 4): UpscaleChoice {
  return {
    engine: "turbo",
    model: prefs.upModel as UpscaleModel,
    shader: (selection || prefs.upShader) as ShaderModel,
    scale,
  };
}

// Tous les shaders livrés savent rendre une image de test : l'aperçu est toujours disponible.
export const canPreviewUpscale = (_choice: UpscaleChoice) => true;

// L'upscale exige un fichier LOCAL. Un média distant/extrait (ref http) est d'abord résolu
// (resolveMedia, repli extractMedia). Un ref local est renvoyé tel quel.
export async function ensureLocalMedia(ref: string): Promise<string | null> {
  if (!isRemoteRef(ref)) return ref;
  const api = nr.reference;
  if (!api) return null;
  const r = await api.resolveMedia?.(ref);
  if (r?.ok && r.path) return r.path;
  const e = await api.extractMedia?.(ref);
  return e?.ok && e.items?.length ? e.items[0].path : null;
}

// Remplace le média de l'item par le fichier upscalé. Non destructif : l'ancien part dans `prevMedia`
// (bouton « revenir en arrière » de l'inspecteur). Rognage/portée retombent (dimensions changées).
export function applyUpscaled(item: BoardItem, path: string) {
  useBoard.getState().patchItem(item.id, {
    ref: path,
    src: displaySrc(item.kind, path),
    crop: undefined,
    trimIn: undefined,
    trimOut: undefined,
    prevMedia: { ref: item.ref, src: item.src, trimIn: item.trimIn, trimOut: item.trimOut, crop: item.crop },
  });
}

// Upscale « rapide » : les réglages viennent des Paramètres du board, rien à choisir. Progression en
// notice collante (l'utilisateur garde le board), erreurs remontées en notice rouge.
export async function quickUpscale(id: string): Promise<boolean> {
  const st = useBoard.getState();
  const item = st.items.find((i) => i.id === id);
  const api = nr.reference;
  if (!item) return false;
  if (!api) { st.setNotice({ kind: "error", text: tr("upscale.moduleUnavailable") }); return false; }
  const isVideo = item.kind === "video";
  const prefs = st.prefs;
  const selection = prefs.upShader;
  const choice = upscaleChoiceFrom(selection, prefs, isVideo, prefs.upDenoise, prefs.upScale);

  st.setNotice({ kind: "ok", sticky: true, text: tr("upscale.upscaling") });
  const offProgress = isVideo
    ? nr.onUpscaleProgress((p) => {
        if (p.pct != null) st.setNotice({ kind: "ok", sticky: true, text: tr("upscale.upscalingPct", { pct: Math.round(p.pct) }) });
      })
    : null;
  try {
    const input = await ensureLocalMedia(item.ref);
    if (!input) { st.setNotice({ kind: "error", text: tr("upscale.remoteFail") }); return false; }
    const r = await api.upscaleItem({
      path: input, kind: isVideo ? "video" : "image",
      in: item.trimIn, out: item.trimOut,
      engine: choice.engine, model: choice.model, shader: choice.shader, scale: choice.scale, denoise: choice.denoise,
    });
    if (!r.ok || !r.path) {
      st.setNotice({ kind: "error", text: r.error ? tr("notice.failedWith", { error: r.error }) : tr("upscale.upscaleFail") });
      return false;
    }
    applyUpscaled(item, r.path);
    st.setNotice({ kind: "ok", text: tr("upscale.upscaled") });
    return true;
  } catch (e) {
    st.setNotice({ kind: "error", text: tr("notice.failedWith", { error: String(e) }) });
    return false;
  } finally {
    offProgress?.();
  }
}
