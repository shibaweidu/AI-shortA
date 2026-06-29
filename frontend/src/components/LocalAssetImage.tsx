import { useEffect, useState } from "react";
import { cn, getDisplayAssetUrl } from "../lib/utils";
import { getObjectUrlFromPersistedAssetFile } from "../services/localFiles";

interface LocalAssetImageProps {
  itemId: string;
  src?: string;
  alt: string;
  className?: string;
  loading?: "eager" | "lazy";
}

export function LocalAssetImage({ itemId, src, alt, className, loading }: LocalAssetImageProps) {
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [localReady, setLocalReady] = useState(false);
  const [failedLocal, setFailedLocal] = useState(false);
  const [failedRemote, setFailedRemote] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setLocalUrl(null);
    setLocalReady(false);
    setFailedLocal(false);
    setFailedRemote(false);

    const loadLocalFile = async () => {
      try {
        const nextUrl = await getObjectUrlFromPersistedAssetFile(itemId);
        if (cancelled) return;
        if (!nextUrl) {
          setLocalReady(true);
          return;
        }
        objectUrl = nextUrl;
        setLocalUrl(nextUrl);
        setLocalReady(true);
        setFailedLocal(false);
      } catch {
        if (!cancelled) {
          setLocalReady(true);
          setFailedLocal(true);
        }
      }
    };

    void loadLocalFile();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [itemId, src]);

  const remoteImageUrl = localReady ? getDisplayAssetUrl(src) : undefined;
  const localImageUrl = !failedLocal && localUrl ? localUrl : undefined;
  const displaySrc = (!failedRemote ? remoteImageUrl : undefined) ?? localImageUrl;

  if (!displaySrc) {
    return <div role="img" aria-label={alt} className={cn("bg-white/[0.03]", className)} />;
  }

  return (
    <img
      src={displaySrc}
      alt={alt}
      className={className}
      loading={loading}
      onError={() => {
        if (displaySrc === remoteImageUrl && !failedRemote) setFailedRemote(true);
        if (displaySrc === localUrl && !failedLocal) setFailedLocal(true);
      }}
    />
  );
}
