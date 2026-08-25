import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 100;

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: MAX_REQUESTS - 1, resetAt: now + WINDOW_MS };
  }
  entry.count++;
  const remaining = Math.max(0, MAX_REQUESTS - entry.count);
  return { allowed: entry.count <= MAX_REQUESTS, remaining, resetAt: entry.windowStart + WINDOW_MS };
}

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    if (pathname.startsWith("/api/") && !pathname.startsWith("/api/auth/") && !pathname.startsWith("/api/health")) {
      if (!token) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const ip = getClientIp(req as unknown as Request);
      const { allowed, remaining, resetAt } = checkRateLimit(ip);
      if (!allowed) {
        return NextResponse.json(
          { error: "Too many requests. Please slow down." },
          {
            status: 429,
            headers: {
              "X-RateLimit-Limit": String(MAX_REQUESTS),
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
              "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)),
            },
          }
        );
      }

      const role = (token.role as string) ?? "viewer";
      const adminOnlyPaths = ["/api/agents/toggle", "/api/trigger", "/api/farm/tasks", "/api/schedule"];
      const isAdminRoute = adminOnlyPaths.some((p) => pathname.startsWith(p));
      if (isAdminRoute && role !== "admin") {
        return NextResponse.json({ error: "Forbidden: admin role required" }, { status: 403 });
      }

      const res = NextResponse.next();
      res.headers.set("X-RateLimit-Limit", String(MAX_REQUESTS));
      res.headers.set("X-RateLimit-Remaining", String(remaining));
      res.headers.set("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
      return res;
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized({ token, req }) {
        const pathname = req.nextUrl.pathname;
        if (
          pathname === "/" ||
          pathname.startsWith("/login") || 
          pathname.startsWith("/api/auth/") ||
          pathname.startsWith("/landing") ||
          pathname.startsWith("/api/stripe") ||
          pathname.startsWith("/api/health")
        ) {
          return true;
        }
        if (process.env.NODE_ENV === "development") {
          return true;
        }
        return !!token;
      },
    },
  }
);

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
