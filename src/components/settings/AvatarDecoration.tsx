// Discord avatar decoration: a PNG frame with a transparent centre laid OVER the avatar. Discord
// authors it at ≈1.2× the avatar box, centred. The parent must be `relative`.
export function AvatarDecoration({ url, scale = 1.2 }: { url?: string | null; scale?: number }) {
  if (!url) return null;
  const pct = `${scale * 100}%`;
  return (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      referrerPolicy="no-referrer"
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 object-contain"
      style={{ width: pct, height: pct }}
    />
  );
}
