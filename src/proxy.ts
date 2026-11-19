import { NextResponse, type NextRequest } from "next/server";
import { authorize, isCrossSiteWrite } from "@/lib/auth";

/**
 * HTTP Basic authentication for the whole app (pages and API routes) with one
 * shared credential from APP_USERNAME / APP_PASSWORD, plus a same-origin
 * check on state-changing requests (browsers replay Basic credentials on
 * cross-site requests, so auth alone does not stop CSRF).
 */
export function proxy(request: NextRequest) {
  if (
    isCrossSiteWrite({
      method: request.method,
      host: request.headers.get("host"),
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
    })
  ) {
    return new NextResponse("Cross-site request blocked", { status: 403 });
  }

  const decision = authorize(
    request.headers.get("authorization"),
    {
      username: process.env.APP_USERNAME || "admin",
      password: process.env.APP_PASSWORD,
    },
    process.env.NODE_ENV === "production"
  );

  if (decision === "ok") return NextResponse.next();

  if (decision === "unconfigured") {
    return new NextResponse(
      "Authentication is not configured. Set APP_PASSWORD.",
      { status: 503 }
    );
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Infra Modeller", charset="UTF-8"',
    },
  });
}

export const config = {
  // Everything except Next's static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
