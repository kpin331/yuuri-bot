const MAX_PLAY_THUMBNAIL_BYTES = 8 * 1024 * 1024;
const PLAY_THUMBNAIL_TIMEOUT_MS = 10_000;

export interface PlayThumbnail {
  data: Buffer;
  fileName: string;
}

export async function fetchPlayThumbnail(url: string): Promise<PlayThumbnail | null> {
  if (!/^https?:\/\//i.test(url)) return null;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PLAY_THUMBNAIL_TIMEOUT_MS) });
    if (!response.ok || !response.body) return null;

    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    const fileName = contentType === "image/jpeg"
      ? "thumbnail.jpg"
      : contentType === "image/png"
        ? "thumbnail.png"
        : contentType === "image/webp"
          ? "thumbnail.webp"
          : null;
    if (!fileName) return null;

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_PLAY_THUMBNAIL_BYTES) return null;

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PLAY_THUMBNAIL_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return size > 0 ? { data: Buffer.concat(chunks, size), fileName } : null;
  } catch {
    return null;
  }
}
