import { NextResponse, type NextRequest } from "next/server";
import { PARENT_COOKIE, isValidParentToken } from "@/lib/auth";
import { requiredEnv } from "@/lib/env";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
  matcher: ["/parent/:path*"],
};
