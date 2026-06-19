const API_BASE = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, "") || "";

export type UploadedImageFile = {
  url: string;
  name: string;
  size: number;
  mimeType: string;
};

export type UploadedFile = UploadedImageFile;

export async function uploadImageFiles(files: File[]): Promise<UploadedImageFile[]> {
  const formData = new FormData();
  files.forEach((file) => formData.append("images", file));

  const response = await fetch(`${API_BASE}/api/uploads/images`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(error?.error || `Upload failed: ${response.status}`);
  }

  const data = await response.json() as { files?: UploadedImageFile[] };
  return data.files ?? [];
}

export async function uploadFiles(files: File[]): Promise<UploadedFile[]> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  const response = await fetch(`${API_BASE}/api/uploads/files`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(error?.error || `Upload failed: ${response.status}`);
  }

  const data = await response.json() as { files?: UploadedFile[] };
  return data.files ?? [];
}
