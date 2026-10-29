// Visibilité RÉELLE à l'écran d'un élément monté. La zone de culling couvre jusqu'à 6× l'aire du
// viewport : ce qui y est monté n'est pas forcément visible, et une vidéo qui joue hors champ décode
// pour personne — pire, une boucle aller-retour y fait 15 seeks par seconde. IntersectionObserver
// natif, un observateur par élément : le navigateur calcule l'intersection lui-même, transforms
// comprises, sans jamais forcer de layout côté JS.

import { useEffect, useState, type RefObject } from "react";

export interface OnScreenOptions {
  // Marge d'avance autour du viewport, en px écran (défaut 128).
  margin?: number;
  // Valeur avant la première mesure (défaut : visible, pour qu'un média démarre sans attendre). Un
  // élément COÛTEUX à monter (iframe) part à false : il n'est monté que s'il est réellement vu.
  initial?: boolean;
}

export function useOnScreen(ref: RefObject<Element | null>, opts: OnScreenOptions = {}): boolean {
  const { margin = 128, initial = true } = opts;
  // Sans IntersectionObserver (tests, moteur ancien) personne ne mesurera : on reste visible.
  const [on, setOn] = useState(() => initial || typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => setOn(e.isIntersecting),
      // Marge d'avance : la lecture reprend juste AVANT d'entrer à l'écran, pour ne pas voir la
      // première frame figée le temps du play().
      { rootMargin: `${margin}px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return on;
}
