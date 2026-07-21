"use client";

import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { finalizeTrack } from "@/app/parent/actions";

function measureDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let settled = false;
    const settle = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => settle(null), 10_000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () =>
      settle(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
    audio.onerror = () => settle(null);
    audio.src = url;
  });
}

type FileStatus = {
  id: number;
  name: string;
  state: "uploading" | "saving" | "done" | "upload-error" | "save-error";
  pct: number;
};

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const [statuses, setStatuses] = useState<FileStatus[]>([]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const id = nextId.current++;
      const update = (patch: Partial<FileStatus>) =>
        setStatuses((prev) =>
          prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
        );
      setStatuses((prev) => [...prev, { id, name: file.name, state: "uploading", pct: 0 }]);
      try {
        const clientDurationSec = await measureDuration(file);
        const blob = await upload(`audio/${file.name}`, file, {
          access: "public",
          handleUploadUrl: "/api/upload",
          onUploadProgress: ({ percentage }) => update({ pct: Math.round(percentage) }),
        });
        update({ state: "saving", pct: 100 });
        try {
          await finalizeTrack({ url: blob.url, filename: file.name, clientDurationSec });
        } catch {
          update({ state: "save-error" });
          continue;
        }
        update({ state: "done" });
        router.refresh();
      } catch {
        update({ state: "upload-error" });
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-slate-700 p-8 text-center text-slate-400 hover:border-slate-500">
        Tap to add audio files
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.m4b"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </label>
      {statuses.map((s) => (
        <p key={s.id} className="text-sm text-slate-400">
          {s.name} —{" "}
          {s.state === "uploading"
            ? `${s.pct}%`
            : s.state === "saving"
              ? "extracting details…"
              : s.state === "done"
                ? "✓ added"
                : s.state === "save-error"
                  ? "✗ uploaded but couldn't save — try again"
                  : "✗ upload failed"}
        </p>
      ))}
    </div>
  );
}
