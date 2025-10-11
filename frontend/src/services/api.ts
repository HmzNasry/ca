export async function loginUser(username: string, password: string) {
  const r = await fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, server_password: password })
  });
  if (!r.ok) throw new Error("login failed");
  return (await r.json()).access_token as string;
}

// Compress image with canvas (progressive downscale)
async function compressImage(file: File, { maxDim = 1920, quality = 0.82, mime = "image/jpeg" } = {}): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    let w = img.width;
    let h = img.height;
    if (w >= h) {
      if (w > maxDim) { h = Math.round((h * maxDim) / w); w = maxDim; }
    } else {
      if (h > maxDim) { w = Math.round((w * maxDim) / h); h = maxDim; }
    }

    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    const blob: Blob = await new Promise((resolve) => canvas.toBlob(b => resolve(b as Blob), mime, quality));
    const base = (file.name && file.name.split(".")[0]) || "upload";
    return new File([blob], `${base}.jpg`, { type: mime });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function postForm(f: File, ctx?: { thread?: "main" | "dm"; peer?: string; user?: string }) {
  const fd = new FormData();
  fd.append("file", f, f.name || "upload" );
  if (ctx?.thread) fd.append("thread", ctx.thread);
  if (ctx?.peer) fd.append("peer", ctx.peer);
  if (ctx?.user) fd.append("user", ctx.user);
  const r = await fetch("/upload", { method: "POST", body: fd });
  return r;
}

export async function uploadFile(f: File, ctx?: { thread?: "main" | "dm"; peer?: string; user?: string }) {
  let fileToSend = f;
  // Proactively compress very large images to reduce proxy rejections
  const big = f.type.startsWith("image/") && f.size > 6 * 1024 * 1024; // >6MB
  if (big) {
    fileToSend = await compressImage(f, { maxDim: 1920, quality: 0.82 });
  }

  // Try first
  let r = await postForm(fileToSend, ctx);
  if (r.ok) return await r.json() as { url: string; mime: string };

  // If proxy rejects size (413), progressively compress if it is an image
  if (r.status === 413 && f.type.startsWith("image/")) {
    const attempts = [
      { maxDim: 1920, quality: 0.82 },
      { maxDim: 1600, quality: 0.78 },
      { maxDim: 1280, quality: 0.74 },
      { maxDim: 1024, quality: 0.70 },
      { maxDim: 900, quality: 0.68 }
    ];
    for (const opt of attempts) {
      const cf = await compressImage(f, opt);
      r = await postForm(cf, ctx);
      if (r.ok) return await r.json() as { url: string; mime: string };
      if (r.status !== 413) break; // stop on other errors
    }
  }

  const text = r.status === 413 ? "upload too large (proxy limit)" : "upload failed";
  throw new Error(text);
}

