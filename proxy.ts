import { NextResponse, type NextRequest } from "next/server";
import {
  FAMILY_COOKIE,
  PARENT_COOKIE,
  isValidFamilyToken,
  isValidParentToken,
} from "@/lib/auth";
import { requiredEnv } from "@/lib/env";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const familyOk = await isValidFamilyToken(
    request.cookies.get(FAMILY_COOKIE)?.value,
    requiredEnv("FAMILY_PASSWORD"),
  );
  if (!familyOk) {
    if (pathname.startsWith("/api")) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname.startsWith("/parent") && pathname !== "/parent/pin") {
    const parentOk = await isValidParentToken(
      request.cookies.get(PARENT_COOKIE)?.value,
      requiredEnv("PARENT_PIN"),
    );
    if (!parentOk) {
      return NextResponse.redirect(new URL("/parent/pin", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!login|api/upload|_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js).*)",
  ],
};
