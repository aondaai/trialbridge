import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * HTTP Basic Auth gate for the whole app.
 *
 * Credentials come from environment variables — NEVER hardcoded, so the password
 * is never committed to git. Set these on the host (Render → Environment):
 *   BASIC_AUTH_USER      (e.g. angelo)
 *   BASIC_AUTH_PASSWORD  (the secret)
 *
 * If BASIC_AUTH_PASSWORD is unset the gate is disabled and requests pass through,
 * so local dev / CI / the build step are never blocked. Enable it only where the
 * env vars are configured (the Render cloud instance).
 *
 * Runs on the Edge runtime, so it uses atob() (not Buffer) to decode the header.
 */

// Constant-time-ish string compare to avoid trivially leaking length/prefix via
// response timing. Not a hard security boundary — this is a demo access gate.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function continueRequest(req: NextRequest) {
  if (req.nextUrl.pathname === "/") {
    return NextResponse.rewrite(new URL("/landing.html", req.url));
  }
  return NextResponse.next();
}

export function middleware(req: NextRequest) {
  const expectedUser = process.env.BASIC_AUTH_USER ?? "";
  const expectedPass = process.env.BASIC_AUTH_PASSWORD ?? "";

  // Gate disabled unless a password is configured on the host.
  if (!expectedPass) return continueRequest(req);

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const sep = decoded.indexOf(":");
      if (sep !== -1) {
        const user = decoded.slice(0, sep);
        const pass = decoded.slice(sep + 1);
        if (safeEqual(user, expectedUser) && safeEqual(pass, expectedPass)) {
          return continueRequest(req);
        }
      }
    } catch {
      // Invalid base64 is simply invalid authentication, not a server error.
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="TrialBridge", charset="UTF-8"',
    },
  });
}

export const config = {
  // Protect every route (pages, API, public assets) except Next's build output
  // and the favicon. After the initial challenge the browser attaches the
  // credentials to asset requests automatically.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
