export async function loginUser(username: string, password: string) {
  const r = await fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, server_password: password })
  });
  if (!r.ok) throw new Error("login failed");
  return (await r.json()).access_token as string;
}

export async function isUsernameAvailable(name: string): Promise<boolean> {
  const q = encodeURIComponent(name || "");
  const r = await fetch(`/user-available?name=${q}`);
  if (!r.ok) return true; // don't block if server can't check
  const d = await r.json();
  return !!d.available;
}

// Account-based auth (new)
export async function signUpUser(username: string, displayName: string, password: string): Promise<string> {
  const r = await fetch("/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, display_name: displayName, password })
  });
  if (!r.ok) {
    const msg = (await r.json().catch(() => ({} as any))).detail || "signup failed";
    throw new Error(msg);
  }
  return (await r.json()).access_token as string;
}

export async function signInUser(username: string, password: string): Promise<string> {
  const r = await fetch("/signin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!r.ok) {
    const msg = (await r.json().catch(() => ({} as any))).detail || "signin failed";
    throw new Error(msg);
  }
  return (await r.json()).access_token as string;
}

export async function isAccountAvailable(name: string): Promise<boolean> {
  const q = encodeURIComponent(name || "");
  const r = await fetch(`/account-available?name=${q}`);
  if (!r.ok) return true;
  const d = await r.json();
  return !!d.available;
}

export type AccountInfo = { username: string; display_name: string; created_at?: string | null; last_seen_ip?: string | null };

export async function getAccount(token: string): Promise<AccountInfo> {
  const r = await fetch("/account", { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error("failed to load account");
  return await r.json();
}

export async function updateAccount(token: string, data: { username?: string | null; display_name?: string | null; password?: string | null }): Promise<string> {
  const r = await fetch("/account/update", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
  if (!r.ok) {
    const msg = (await r.json().catch(() => ({} as any))).detail || "update failed";
    throw new Error(msg);
  }
  return (await r.json()).access_token as string;
}

export async function deleteAccount(token: string): Promise<boolean> {
  const r = await fetch("/account/delete", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    const msg = (await r.json().catch(() => ({} as any))).detail || "delete failed";
    throw new Error(msg);
  }
  const d = await r.json().catch(() => ({} as any));
  return !!d.ok;
}

// Admin (DEV) account management
export async function getAccountAdmin(token: string, username: string): Promise<AccountInfo> {
  const q = encodeURIComponent(username);
  const r = await fetch(`/admin/account?username=${q}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const msg = (await r.json().catch(() => ({} as any))).detail || "failed to load account";
    throw new Error(msg);
  }
  return await r.json();
}

export async function updateAccountAdmin(token: string, username: string, data: { username?: string | null; display_name?: string | null; password?: string | null }): Promise<AccountInfo> {
  const q = encodeURIComponent(username);
  const r = await fetch(`/admin/account/update?username=${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(data)
  });
  if (!r.ok) {
    const msg = (await r.json().catch(() => ({} as any))).detail || "update failed";
    throw new Error(msg);
  }
  return await r.json();
}

export async function deleteAccountAdmin(token: string, username: string): Promise<boolean> {
  const q = encodeURIComponent(username);
  const r = await fetch(`/admin/account/delete?username=${q}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    const msg = (await r.json().catch(() => ({} as any))).detail || "delete failed";
    throw new Error(msg);
  }
  const d = await r.json().catch(() => ({} as any));
  return !!d.ok;
}

// deprecated duplicates removed

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

type UploadCtx = { thread?: "main" | "dm" | "gc"; peer?: string; user?: string; gcid?: string };

async function postForm(f: File, ctx?: UploadCtx) {
  const fd = new FormData();
  fd.append("file", f, f.name || "upload" );
  if (ctx?.thread) fd.append("thread", ctx.thread);
  if (ctx?.peer) fd.append("peer", ctx.peer);
  if (ctx?.user) fd.append("user", ctx.user);
  if (ctx?.gcid) fd.append("gcid", ctx.gcid);
  const r = await fetch("/upload", { method: "POST", body: fd });
  return r;
}

export async function uploadFile(f: File, ctx?: UploadCtx) {
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

