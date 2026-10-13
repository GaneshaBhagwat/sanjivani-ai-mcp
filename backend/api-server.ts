/**
 * Sanjivani Sugar Factory – Backend HTTP API Server
 * Provides:
 *   GET  /api/farmers  – Fetch all farmer records from PostgreSQL
 *   POST /api/ask      – Send a question to OpenAI, grounded in DB data
 *   GET  /api/health   – Health / status check
 *
 * Run with:  npx tsx backend/api-server.ts
 */

import "dotenv/config";
import http from "http";
import pg from "pg";
import OpenAI from "openai";

const { Pool } = pg;

// ── PostgreSQL connection ──────────────────────────────────────────────────────
const db = new Pool({
  host:     process.env.DB_HOST     || "localhost",
  port:     Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME     || "sanjivani_sugar_factory",
  user:     process.env.DB_USER     || "postgres",
  password: process.env.DB_PASSWORD || "",
  connectionTimeoutMillis: 5000,
});

// ── OpenAI client ─────────────────────────────────────────────────────────────
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ── CORS headers helper ────────────────────────────────────────────────────────
function setCors(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:4200");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ── JSON response helpers ─────────────────────────────────────────────────────
function sendJson(
  res: http.ServerResponse,
  status: number,
  data: unknown
): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

// ── Read POST body ────────────────────────────────────────────────────────────
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// ── GET /api/farmers ──────────────────────────────────────────────────────────
async function handleGetFarmers(res: http.ServerResponse): Promise<void> {
  try {
    const result = await db.query<{
      farmer_id: number;
      name: string;
      village: string;
      sugarcane_tons: number;
      payment_pending: number;
      amount_paid: number;
    }>(
      `SELECT farmer_id, name, village,
              sugarcane_tons, payment_pending, amount_paid
       FROM farmers
       ORDER BY farmer_id`
    );

    sendJson(res, 200, result.rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/farmers] DB error:", message);
    sendJson(res, 503, {
      error: "Database unavailable.",
      detail: message,
    });
  }
}

// ── POST /api/ask ─────────────────────────────────────────────────────────────
async function handleAsk(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!openai) {
    sendJson(res, 503, {
      error: "OPENAI_API_KEY is not configured on the server.",
    });
    return;
  }

  let body: { question?: string };
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return;
  }

  const question = (body.question ?? "").trim();
  if (!question) {
    sendJson(res, 400, { error: "Field 'question' is required." });
    return;
  }

  // 1. Fetch farmer data from the database (best-effort)
  let farmerContext = "No database data available – database may be offline.";
  try {
    const result = await db.query(
      `SELECT farmer_id, name, village,
              sugarcane_tons, payment_pending, amount_paid
       FROM farmers ORDER BY farmer_id`
    );
    if (result.rows.length > 0) {
      farmerContext = JSON.stringify(result.rows, null, 2);
    } else {
      farmerContext = "The farmers table is empty.";
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[/api/ask] DB fetch failed:", msg);
    farmerContext = `Database error: ${msg}. Answering without live data.`;
  }

  // 2. Call OpenAI
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant for the Sanjivani Sugar Factory. " +
            "Answer questions about farmer records, sugarcane production, " +
            "and payments using only the data provided. " +
            "Do not invent farmer names or numbers. " +
            "If data is unavailable, say so clearly.",
        },
        {
          role: "user",
          content:
            `Current farmer data from the database:\n\n${farmerContext}\n\n` +
            `User question: ${question}`,
        },
      ],
      max_tokens: 512,
      temperature: 0.3,
    });

    const answer =
      completion.choices[0]?.message?.content?.trim() ??
      "No response received from OpenAI.";

    sendJson(res, 200, { answer });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/ask] OpenAI error:", message);
    sendJson(res, 502, {
      error: `OpenAI API error: ${message}`,
    });
  }
}

// ── GET /api/health ───────────────────────────────────────────────────────────
async function handleHealth(res: http.ServerResponse): Promise<void> {
  let dbStatus = "unknown";
  try {
    await db.query("SELECT 1");
    dbStatus = "connected";
  } catch {
    dbStatus = "unavailable";
  }

  sendJson(res, 200, {
    status: "ok",
    database: dbStatus,
    openai: openai ? "configured" : "missing OPENAI_API_KEY",
    timestamp: new Date().toISOString(),
  });
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const PORT = Number(process.env.API_PORT || 5001);

const server = http.createServer(async (req, res) => {
  setCors(res);

  // Handle CORS pre-flight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url ?? "/";

  try {
    if (req.method === "GET" && url === "/api/farmers") {
      await handleGetFarmers(res);
    } else if (req.method === "POST" && url === "/api/ask") {
      await handleAsk(req, res);
    } else if (req.method === "GET" && url === "/api/health") {
      await handleHealth(res);
    } else {
      sendJson(res, 404, { error: "Not found." });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[server] Unhandled error:", message);
    sendJson(res, 500, { error: "Internal server error." });
  }
});

server.listen(PORT, () => {
  console.log(`✅ Sanjivani API server running at http://localhost:${PORT}`);
  console.log(`   GET  http://localhost:${PORT}/api/health`);
  console.log(`   GET  http://localhost:${PORT}/api/farmers`);
  console.log(`   POST http://localhost:${PORT}/api/ask`);
  console.log(`   OpenAI: ${openai ? "configured ✓" : "⚠ OPENAI_API_KEY missing"}`);
});

