import { NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "./rate-limit";

export function withRateLimit(
  handler: (req: Request, ...args: unknown[]) => Promise<Response>,
  limitPerMinute = 100
) {
  return async function (req: Request, ...args: unknown[]): Promise<Response> {
    const ip = getClientIp(req);
    const { allowed, remaining, resetAt } = checkRateLimit(ip, limitPerMinute);

    if (!allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(limitPerMinute),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
            "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)),
          },
        }
      );
    }

    const res = await handler(req, ...args);
    if (res instanceof NextResponse) {
      res.headers.set("X-RateLimit-Limit", String(limitPerMinute));
      res.headers.set("X-RateLimit-Remaining", String(remaining));
      res.headers.set("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
    }
    return res;
  };
}
