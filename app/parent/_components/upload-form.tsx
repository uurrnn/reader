"use client";

import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { finalizeTrack } from "@/app/parent/actions";

function measureDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    audio.src = url;
  });
}

type FileStatus = {
  id: number;
  name: string;
  state: "uploading" | "saving" | "done" | "error";
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
        await finalizeTrack({ url: blob.url, filename: file.name, clientDurationSec });
        update({ state: "done" });
        router.refresh();
      } catch {
        update({ state: "error" });
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
          accept="audio/*"
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
                : "✗ failed"}
        </p>
      ))}
    </div>
  );
}
