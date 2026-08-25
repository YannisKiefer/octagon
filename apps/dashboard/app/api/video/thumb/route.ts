import { NextResponse, type NextRequest } from "next/server";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const DATA_ROOT = path.resolve(process.cwd(), "..", "data");
const THUMB_CACHE = path.join(DATA_ROOT, "assets", "thumbs");

export const dynamic = "force-dynamic";

/**
 * GET /api/video/thumb?path=relative/path/to/video.mp4
 *
 * Generates (and caches) a thumbnail for a variation video using ffmpeg.
 * Returns the thumbnail image as JPEG.
 */
export async function GET(req: NextRequest) {
  const videoRel = req.nextUrl.searchParams.get("path");
  if (!videoRel) {
    return NextResponse.json({ error: "missing path" }, { status: 400 });
  }

  // Security: only allow paths within data/videos
  const videoAbs = path.resolve(DATA_ROOT, "videos", videoRel);
  if (!videoAbs.startsWith(path.resolve(DATA_ROOT, "videos"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!fs.existsSync(videoAbs)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Generate a cache key from the video path
  const hash = crypto.createHash("md5").update(videoAbs).digest("hex");
  const thumbPath = path.join(THUMB_CACHE, `${hash}.jpg`);

  // If thumb is cached, serve it
  if (!fs.existsSync(thumbPath)) {
    // Ensure cache dir exists
    fs.mkdirSync(THUMB_CACHE, { recursive: true });

    try {
      // Extract thumbnail at 1-second mark
      execSync(
        `ffmpeg -y -i "${videoAbs}" -ss 00:00:01 -vframes 1 -vf "scale=280:-2" -q:v 4 "${thumbPath}"`,
        { timeout: 10_000, stdio: "pipe" }
      );
    } catch {
      // Fallback: try first frame
      try {
        execSync(
          `ffmpeg -y -i "${videoAbs}" -vframes 1 -vf "scale=280:-2" -q:v 4 "${thumbPath}"`,
          { timeout: 10_000, stdio: "pipe" }
        );
      } catch {
        return NextResponse.json({ error: "ffmpeg_failed" }, { status: 500 });
      }
    }
  }

  const thumbData = fs.readFileSync(thumbPath);
  return new NextResponse(thumbData, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
