// Lightweight, dependency-free browser fingerprint.
// Stable enough to detect "different device" but not personally identifying.
// Uses canvas + screen + UA + language signals, hashed to 32 hex chars.

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function canvasSignal(): string {
  try {
    const c = document.createElement("canvas");
    c.width = 240;
    c.height = 60;
    const ctx = c.getContext("2d");
    if (!ctx) return "no-canvas";
    ctx.textBaseline = "top";
    ctx.font = "16px Arial";
    ctx.fillStyle = "#f60";
    ctx.fillRect(0, 0, 240, 60);
    ctx.fillStyle = "#069";
    ctx.fillText("CBT-fp-1.0 ✓", 4, 12);
    ctx.fillStyle = "rgba(102,204,0,0.7)";
    ctx.fillText("CBT-fp-1.0 ✓", 6, 16);
    return c.toDataURL().slice(-128);
  } catch {
    return "canvas-error";
  }
}

let cached: string | null = null;

export async function getDeviceFingerprint(): Promise<string> {
  if (cached) return cached;
  const stored = localStorage.getItem("cbt_fp");
  if (stored && /^[a-f0-9]{32}$/.test(stored)) {
    cached = stored;
    return stored;
  }
  const parts = [
    navigator.userAgent,
    navigator.language,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    new Date().getTimezoneOffset().toString(),
    navigator.hardwareConcurrency?.toString() ?? "?",
    (navigator as any).deviceMemory?.toString() ?? "?",
    canvasSignal(),
  ];
  const fp = await sha256Hex(parts.join("|"));
  try {
    localStorage.setItem("cbt_fp", fp);
  } catch {
    /* ignore quota */
  }
  cached = fp;
  return fp;
}
