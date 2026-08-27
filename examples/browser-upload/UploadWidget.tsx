/**
 * Direct browser upload with progress and cancellation.
 *
 * React is used here only to show the SDK in context -- `@ark/client` itself
 * imports no framework and works the same in Vue, Svelte or plain JS.
 */

import { useCallback, useRef, useState } from "react";
import { ArkClient, ArkError, type ArkUploadHandle } from "@ark/client";

export function UploadWidget() {
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const uploadRef = useRef<ArkUploadHandle | null>(null);

  const onSelect = useCallback(async (file: File) => {
    setError(null);
    setProgress(0);

    // Fetched per upload: sessions are short-lived by design.
    const response = await fetch("/api/ark-session", { method: "POST" });
    const { token } = await response.json();

    const ark = new ArkClient({ token });
    const upload = ark.files.upload(file, {
      onProgress: ({ percentage }) => setProgress(percentage),
    });
    uploadRef.current = upload;

    try {
      const uploaded = await upload;
      console.log("Uploaded", uploaded.id, uploaded.url);
    } catch (err) {
      if (err instanceof ArkError) {
        // Ark codes are stable, so the UI can react to specific failures
        // rather than parsing messages.
        setError(
          err.code === "QUOTA_EXCEEDED"
            ? "You are out of storage. Upgrade your plan to continue."
            : err.code === "UPLOAD_ABORTED"
              ? "Upload cancelled."
              : `Upload failed (${err.code}). Reference: ${err.requestId ?? "n/a"}`,
        );
      } else {
        setError("Upload failed.");
      }
    } finally {
      uploadRef.current = null;
    }
  }, []);

  return (
    <div>
      <input
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onSelect(file);
        }}
      />
      {progress > 0 && progress < 100 && (
        <>
          <progress value={progress} max={100} />
          <button onClick={() => uploadRef.current?.abort()}>Cancel</button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
