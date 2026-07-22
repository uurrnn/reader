import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { PARENT_COOKIE, isValidParentToken } from "@/lib/auth";
import { requiredEnv } from "@/lib/env";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const cookieStore = await cookies();
        const ok = await isValidParentToken(
          cookieStore.get(PARENT_COOKIE)?.value,
          requiredEnv("PARENT_PIN"),
        );
        if (!ok) throw new Error("Not authorized");
        return {
          allowedContentTypes: [
            "audio/mpeg",
            "audio/mp4",
            "audio/x-m4a",
            "audio/m4a",
            "audio/aac",
            "audio/ogg",
            "audio/wav",
            "audio/flac",
            "audio/x-m4b",
            "audio/m4b",
          ],
          addRandomSuffix: true,
          maximumSizeInBytes: 500 * 1024 * 1024,
        };
      },
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 400 },
    );
  }
}
