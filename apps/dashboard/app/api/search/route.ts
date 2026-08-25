/**
 * Octragon — Semantic Search API
 *
 * Embeds the query using the SAME model as the Python indexer:
 *   model:  models/gemini-embedding-001
 *   task:   RETRIEVAL_QUERY  (matches RETRIEVAL_DOCUMENT stored vectors)
 *   dims:   768  (MRL-compressed, matching EmbeddingEngine.DIMENSIONS in Python)
 *
 * Performs cosine similarity against all stored content_embeddings BLOBs
 * in SQLite, then enriches results with scraped_content metadata.
 *
 * Falls back to SQLite full-text LIKE search if GEMINI_API_KEY is absent
 * or if the stored embedding dimensions don't match the expected 768-dim.
 *
 * GET /api/search?q=<query>&limit=10
 */

import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import { GoogleGenerativeAI, TaskType, EmbedContentRequest } from "@google/generative-ai";

// The installed SDK version does not expose outputDimensionality in EmbedContentRequest.
// We extend it locally to pass the MRL-compression parameter without runtime casts.
interface EmbedRequestWithDim extends EmbedContentRequest {
  outputDimensionality?: number;
}

const DB_PATH = path.join(
  process.env.OCTRAGON_DB_PATH ||
    path.resolve(process.cwd(), "..", "..", "infra", "db", "farm.db")
);

// Must match EmbeddingEngine.MODEL and .DIMENSIONS in Python
const EMBEDDING_MODEL = "models/gemini-embedding-001";
const EMBEDDING_DIM = 768; // MRL-compressed
const BLOB_BYTE_SIZE = EMBEDDING_DIM * 4; // Float32 = 4 bytes/dim

// ── Vector maths ─────────────────────────────────────────────────────────────

function blobToFloat32Array(blob: Buffer): Float32Array | null {
  if (blob.byteLength !== BLOB_BYTE_SIZE) return null;
  const arr = new Float32Array(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    arr[i] = blob.readFloatLE(i * 4);
  }
  return arr;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Gemini embedding (query-side) ─────────────────────────────────────────────
// Uses the same model + output dimensionality as EmbeddingEngine in Python.
// task_type=RETRIEVAL_QUERY pairs correctly with the stored RETRIEVAL_DOCUMENT vectors.

async function getQueryEmbedding(query: string): Promise<Float32Array | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({ model: EMBEDDING_MODEL });

  try {
    // outputDimensionality: 768 matches Python EmbeddingEngine.DIMENSIONS (MRL-compressed).
    // Without this, Gemini returns 3072 dims and simple truncation is NOT equivalent to
    // MRL projection — cosine scores would be wrong.
    const embedReq: EmbedRequestWithDim = {
      content: { parts: [{ text: query.trim().slice(0, 8000) }], role: "user" },
      taskType: TaskType.RETRIEVAL_QUERY,
      outputDimensionality: EMBEDDING_DIM,
    };
    const result = await model.embedContent(embedReq);
    const values: number[] = result?.embedding?.values ?? [];
    if (values.length === 0) return null;

    // Hard validation: returned dim must match stored dim exactly
    if (values.length !== EMBEDDING_DIM) {
      console.warn(
        `[search] Gemini returned ${values.length} dims, expected ${EMBEDDING_DIM}. Falling back to fulltext.`
      );
      return null;
    }

    const arr = new Float32Array(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) arr[i] = values[i];
    return arr;
  } catch {
    return null;
  }
}

// ── Embedding compatibility check ─────────────────────────────────────────────
// Verify stored embeddings used the same model + blob size before vector search.
// Checks both the model_version column (if present) and raw blob byte length.
// Mismatch → fall back to fulltext to avoid nonsense ranking.

function storedEmbeddingsAreCompatible(db: Database.Database): boolean {
  try {
    // Try checking model_version column if it exists
    const row = db.prepare(
      "SELECT length(embedding) as len, model_version FROM content_embeddings LIMIT 1"
    ).get() as { len: number; model_version: string | null } | undefined;

    if (!row) return true; // No rows yet — empty results either way

    // Blob size must match (768 * 4 = 3072 bytes for Float32 768-dim vectors)
    if (row.len !== BLOB_BYTE_SIZE) return false;

    // If model_version column is present, it must match our query model
    const storedModel = row.model_version;
    if (storedModel && storedModel !== "gemini-embedding-001") return false;

    return true;
  } catch {
    // Fallback: check only blob size if model_version column missing (older schema)
    try {
      const row = db.prepare(
        "SELECT length(embedding) as len FROM content_embeddings LIMIT 1"
      ).get() as { len: number } | undefined;
      return !row || row.len === BLOB_BYTE_SIZE;
    } catch {
      return false;
    }
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q")?.trim();
  const limit = Math.min(20, parseInt(req.nextUrl.searchParams.get("limit") || "10"));

  if (!query) {
    return NextResponse.json({ error: "Missing query parameter ?q=" }, { status: 400 });
  }

  // ── 1. Embed the query using same model as Python indexer ─────────────────
  const queryVec = await getQueryEmbedding(query);
  const fallbackReason: string | null = queryVec === null
    ? (process.env.GEMINI_API_KEY ? "embed_error" : "no_api_key")
    : null;

  // ── 2. Open DB (read-only) ─────────────────────────────────────────────────
  let db: Database.Database;
  try {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma("journal_mode = WAL");
  } catch {
    return NextResponse.json({ results: [], total: 0, mode: "no_db", fallback_reason: "db_unavailable" });
  }

  // ── 3. Vector search or full-text fallback ─────────────────────────────────
  let results: Array<{
    content_id: string;
    score: number;
    source?: string;
  }> = [];

  const embCompat = queryVec !== null ? storedEmbeddingsAreCompatible(db) : false;
  const useVectorSearch = queryVec !== null && embCompat;
  const activeFallbackReason = useVectorSearch ? null
    : fallbackReason ?? (queryVec !== null && !embCompat ? "model_mismatch" : "no_api_key");

  if (useVectorSearch) {
    // Semantic vector search across full corpus — no row cap.
    // brute-force cosine sim is acceptable at dashboard scale (corpus is bounded
    // by actual scraped content count, not a theoretical infinite set).
    type EmbRow = { content_id: string; embedding: Buffer };
    const embRows = db.prepare(
      "SELECT content_id, embedding FROM content_embeddings"
    ).all() as EmbRow[];

    const scored: Array<{ content_id: string; score: number }> = [];
    for (const row of embRows) {
      if (!row.embedding) continue;
      const storedVec = blobToFloat32Array(row.embedding as Buffer);
      if (!storedVec) continue; // skip blobs with unexpected size
      const score = cosineSimilarity(queryVec!, storedVec);
      scored.push({ content_id: row.content_id, score });
    }
    scored.sort((a, b) => b.score - a.score);
    results = scored.slice(0, limit).map((r) => ({ ...r, source: "semantic" }));
  } else {
    // Fallback: full-text LIKE search
    const likeQuery = `%${query.replace(/[%_]/g, "\\$&")}%`;
    type LikeRow = { id: string };
    const rows = db.prepare(`
      SELECT id FROM scraped_content
      WHERE caption LIKE ? ESCAPE '\\'
         OR source_creator LIKE ? ESCAPE '\\'
         OR hashtags LIKE ? ESCAPE '\\'
      LIMIT ?
    `).all(likeQuery, likeQuery, likeQuery, limit) as LikeRow[];
    results = rows.map((r, i) => ({
      content_id: r.id,
      score: 1 - i * 0.01,
      source: "fulltext",
    }));
  }

  // ── 4. Enrich with scraped_content metadata ────────────────────────────────
  type ScContent = {
    id: string;
    source_url: string;
    source_platform: string;
    source_creator: string;
    caption: string;
    hashtags: string;
    engagement_views: number;
    engagement_likes: number;
    engagement_comments: number;
    duration_seconds: number;
    target_niche: string;
    scrape_status: string;
    created_at: string;
  };

  const contentIds = results.map((r) => r.content_id);

  let contentMap: Record<string, ScContent> = {};
  if (contentIds.length > 0) {
    const placeholders = contentIds.map(() => "?").join(",");
    const rows = db.prepare(
      `SELECT id, source_url, source_platform, source_creator, caption, hashtags,
              engagement_views, engagement_likes, engagement_comments,
              duration_seconds, target_niche, scrape_status, created_at
       FROM scraped_content WHERE id IN (${placeholders})`
    ).all(...contentIds) as ScContent[];
    for (const row of rows) {
      contentMap[row.id] = row;
    }
  }

  const enriched = results.map((r) => {
    const sc = contentMap[r.content_id];
    return {
      content_id: r.content_id,
      score: r.score,
      search_mode: r.source,
      source_url: sc?.source_url ?? "",
      source_platform: sc?.source_platform ?? "",
      source_creator: sc?.source_creator ?? "",
      caption: (sc?.caption ?? "").slice(0, 200),
      hashtags: sc?.hashtags ?? "[]",
      engagement_views: sc?.engagement_views ?? 0,
      engagement_likes: sc?.engagement_likes ?? 0,
      engagement_comments: sc?.engagement_comments ?? 0,
      duration_seconds: sc?.duration_seconds ?? 0,
      target_niche: sc?.target_niche ?? "",
      scrape_status: sc?.scrape_status ?? "",
      created_at: sc?.created_at ?? "",
    };
  }).filter((r) => r.source_url);

  db.close();

  return NextResponse.json({
    query,
    total: enriched.length,
    mode: useVectorSearch ? "semantic" : "fulltext",
    embedding_model: useVectorSearch ? EMBEDDING_MODEL : null,
    fallback_reason: activeFallbackReason,
    results: enriched,
  });
}
