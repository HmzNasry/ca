export const getDataUrlMime = (u: string) => (u.match(/^data:([^;]+);base64,/i)?.[1] || "");
export const extractFirstUrl = (t?: string) => {
  if (!t) return null;
  const m = t.match(/(https?:\/\/[^ ^\s]+|data:[^\s]+)/i);
  return m ? m[1] : null;
};
export const isImgUrl = (u: string) => /^data:image\//i.test(u) || /\.(png|jpe?g|gif|webp|avif)$/i.test(u);
export const isVidUrl = (u: string) => /^data:video\//i.test(u) || /\.(mp4|webm|ogg)$/i.test(u);
