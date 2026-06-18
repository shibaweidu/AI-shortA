import { getDisplayAssetUrl } from "../lib/utils";

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Failed to read reference image"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read reference image"));
    reader.readAsDataURL(blob);
  });
}

function detectImageMimeFromBase64(base64: string) {
  const normalized = base64.replace(/\s+/g, "");
  if (normalized.startsWith("iVBORw0KGgo")) return "image/png";
  if (normalized.startsWith("/9j/")) return "image/jpeg";
  if (normalized.startsWith("UklGR")) return "image/webp";
  if (normalized.startsWith("R0lGOD")) return "image/gif";
  return undefined;
}

export function normalizeImageDataUrlMime(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/i);
  if (!match) return dataUrl;
  const mime = match[1].toLowerCase();
  if (mime.startsWith("image/")) return dataUrl;

  const detectedMime = detectImageMimeFromBase64(match[2]);
  if (!detectedMime) return dataUrl;
  return `data:${detectedMime};base64,${match[2].replace(/\s+/g, "")}`;
}

export async function resolveReferenceImageDataUrl(imageUrl: string) {
  const trimmedUrl = imageUrl.trim();
  if (!trimmedUrl) return trimmedUrl;
  if (/^data:/i.test(trimmedUrl)) return normalizeImageDataUrlMime(trimmedUrl);
  if (typeof fetch === "undefined" || typeof FileReader === "undefined") return trimmedUrl;

  try {
    const response = await fetch(getDisplayAssetUrl(trimmedUrl) ?? trimmedUrl, {
      headers: { Accept: "image/*,*/*;q=0.8" },
    });
    if (!response.ok) return trimmedUrl;

    const blob = await response.blob();
    if (blob.type && !blob.type.toLowerCase().startsWith("image/") && blob.type.toLowerCase() !== "application/octet-stream") {
      return trimmedUrl;
    }
    return normalizeImageDataUrlMime(await readBlobAsDataUrl(blob));
  } catch {
    return trimmedUrl;
  }
}

export async function resolveReferenceImageDataUrls(imageUrls: string[]) {
  const uniqueUrls = imageUrls.filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);
  const resolvedUrls: string[] = [];

  for (const imageUrl of uniqueUrls) {
    const resolvedUrl = await resolveReferenceImageDataUrl(imageUrl);
    if (resolvedUrl && !resolvedUrls.includes(resolvedUrl)) {
      resolvedUrls.push(resolvedUrl);
    }
  }

  return resolvedUrls;
}
