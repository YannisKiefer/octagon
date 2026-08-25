import { execSync } from 'child_process';
import { Pool } from 'pg';
import path from 'path';
import fs from 'fs';

// --- CONFIGURATION ---
const DB_URL = process.env.DATABASE_URL || 'postgres://localhost/farm';
const ASSETS_DIR = path.join(process.cwd(), 'assets');
const WATERMARK_PATH = path.join(process.cwd(), 'logo.png'); // Add your Phone Farm logo here

// Ensure directories exist
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

const pool = new Pool({ connectionString: DB_URL });

async function setupDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viral_videos (
      id SERIAL PRIMARY KEY,
      original_url TEXT UNIQUE,
      platform TEXT,
      raw_path TEXT,
      processed_path TEXT,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('[DB] Viral video table ready.');
}

// 1. DOWNLOAD (yt-dlp)
async function downloadVideo(url, platform) {
  console.log(`[DOWNLOAD] Fetching from ${platform}: ${url}`);
  const timestamp = Date.now();
  const rawPath = path.join(ASSETS_DIR, `raw_${timestamp}.mp4`);
  
  try {
    // yt-dlp is the industry standard for scraping TikTok/IG without watermarks
    execSync(`yt-dlp "${url}" -o "${rawPath}" --format mp4`, { stdio: 'inherit' });
    console.log(`[DOWNLOAD] Saved to ${rawPath}`);
    
    // Log to Database
    const res = await pool.query(
      `INSERT INTO viral_videos (original_url, platform, raw_path, status) VALUES ($1, $2, $3, 'downloaded') RETURNING id`,
      [url, platform, rawPath]
    );
    return { id: res.rows[0].id, rawPath };
  } catch (error) {
    console.error('[DOWNLOAD ERROR]', error.message);
    throw error;
  }
}

// 2. PROCESS (FFmpeg: Scrub Metadata, Alter Hash, Add Watermark)
async function processVideo(id, rawPath) {
  console.log(`[PROCESS] Bypassing algorithm for video ID: ${id}`);
  const processedPath = path.join(ASSETS_DIR, `ready_${id}.mp4`);
  
  try {
    // FFmpeg magic to defeat the "Duplicate Video" shadowban:
    // 1. -map_metadata -1 : Strips all original TikTok/IG metadata tracking
    // 2. -metadata creation_time=now : Sets a fresh timestamp
    // 3. -vf eq=brightness=0.01 : Subtly alters the pixels to completely change the MD5 hash
    // 4. overlay : Adds your logo to claim ownership and further alter the visual hash
    
    const filterComplex = fs.existsSync(WATERMARK_PATH) 
      ? `[0:v]eq=brightness=0.01:contrast=1.01[vid]; [1:v]scale=150:-1[logo]; [vid][logo]overlay=W-w-30:H-h-50` 
      : `eq=brightness=0.01:contrast=1.01`;

    const inputArgs = fs.existsSync(WATERMARK_PATH) ? `-i "${rawPath}" -i "${WATERMARK_PATH}"` : `-i "${rawPath}"`;

    const cmd = `ffmpeg -y ${inputArgs} -filter_complex "${filterComplex}" -map_metadata -1 -metadata creation_time=now -metadata title="Phone Farm" -c:v libx264 -crf 23 -preset fast -c:a aac -b:a 128k "${processedPath}"`;
    
    execSync(cmd, { stdio: 'ignore' });
    console.log(`[PROCESS] Success. Saved to ${processedPath}`);

    // Update DB
    await pool.query(
      `UPDATE viral_videos SET processed_path = $1, status = 'ready_for_farm' WHERE id = $2`,
      [processedPath, id]
    );
    return processedPath;
  } catch (error) {
    console.error('[PROCESS ERROR]', error.message);
    await pool.query(`UPDATE viral_videos SET status = 'failed_processing' WHERE id = $1`, [id]);
    throw error;
  }
}

// --- EXECUTION PIPELINE ---
async function runPipeline(url, platform) {
  await setupDB();
  const { id, rawPath } = await downloadVideo(url, platform);
  const finalVideo = await processVideo(id, rawPath);
  console.log(`\n✅ PIPELINE COMPLETE. Video ready for iPhone Farm: ${finalVideo}`);
  process.exit(0);
}

// Example Usage: node video-engine.js "https://www.tiktok.com/@someuser/video/12345" "tiktok"
const targetUrl = process.argv[2];
const targetPlatform = process.argv[3] || 'tiktok';

if (targetUrl) runPipeline(targetUrl, targetPlatform);
