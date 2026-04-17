import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Shared secret token — backend must send X-Sync-Token matching this value.
// If unset, auth is skipped (for dev). In prod, ALWAYS set this secret.
const SYNC_TOKEN = Deno.env.get("SYNC_TOKEN") || "";

const ALLOWED_TABLES = new Set([
  "answers", "exam_attempts", "exams", "questions", "exam_questions",
  "users", "courses", "departments", "schools", "exam_pins", "site_settings",
]);

const IMMUTABLE_COLUMNS = new Set(["id", "created_at"]);

const TABLES_WITH_SYNCED_COLUMN = new Set([
  "answers", "exam_attempts", "exams", "questions", "users", "courses", "departments", "schools",
]);

const COMPOSITE_PK_TABLES: Record<string, string[]> = {
  exam_questions: ["exam_id", "question_id"],
};

const TABLE_TS_COLUMN: Record<string, string> = {
  answers: "saved_at",
  exam_attempts: "created_at",
  exam_pins: "used_at",
  site_settings: "updated_at",
};
function getTsColumn(table: string): string {
  return TABLE_TS_COLUMN[table] ?? "updated_at";
}

const HAS_UPDATED_AT = new Set([
  "exams", "questions", "users", "courses", "departments", "schools", "site_settings",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sync-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400): Response { return json({ error: message }, status); }

function checkAuth(req: Request): Response | null {
  if (!SYNC_TOKEN) return null; // no token configured = open (dev only)
  const provided = req.headers.get("x-sync-token") || "";
  if (provided !== SYNC_TOKEN) return err("Unauthorized: invalid sync token", 401);
  return null;
}

function parseTimestamp(raw: string | null): string | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

// ── Route: POST /api/sync/receive ─────────────────────────────────────────────
async function handleReceive(req: Request): Promise<Response> {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  let body: { table?: string; records?: Record<string, unknown>[] };
  try { body = await req.json(); } catch { return err("Invalid JSON body"); }

  const { table, records } = body;
  if (!table || typeof table !== "string") return err("Missing or invalid 'table' field");
  if (!ALLOWED_TABLES.has(table)) return err(`Table '${table}' is not allowed for sync`, 403);
  if (!Array.isArray(records) || records.length === 0) return json({ received: 0, upserted: 0, skipped: 0 });

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const hasUpdatedAt = HAS_UPDATED_AT.has(table);
  const compositePK = COMPOSITE_PK_TABLES[table];

  let upserted = 0;
  let skipped = 0;
  const errors: { id: unknown; error: string }[] = [];

  for (const remote of records) {
    if (compositePK) {
      const hasAllKeys = compositePK.every(k => remote[k]);
      if (!hasAllKeys) { skipped++; continue; }
    } else if (!remote.id) {
      skipped++; continue;
    }

    try {
      if (hasUpdatedAt && !compositePK) {
        const { data: existing } = await db
          .from(table).select("updated_at").eq("id", remote.id).maybeSingle();
        if (existing?.updated_at && remote.updated_at) {
          const localTs = new Date(existing.updated_at as string).getTime();
          const remoteTs = new Date(remote.updated_at as string).getTime();
          if (localTs > remoteTs) { skipped++; continue; }
        }
      }

      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(remote)) {
        if (!compositePK && IMMUTABLE_COLUMNS.has(k)) continue;
        payload[k] = v;
      }
      if (!compositePK) payload.id = remote.id;
      if (TABLES_WITH_SYNCED_COLUMN.has(table)) payload.synced = true;

      const onConflict = compositePK ? compositePK.join(",") : "id";
      const { error } = await db.from(table).upsert(payload, { onConflict });

      if (error) {
        errors.push({ id: compositePK ? `${remote[compositePK[0]]}/${remote[compositePK[1]]}` : remote.id, error: error.message });
        skipped++;
      } else {
        upserted++;
      }
    } catch (e) {
      errors.push({ id: remote.id, error: (e as Error).message });
      skipped++;
    }
  }

  return json({
    received: records.length, upserted, skipped,
    ...(errors.length > 0 ? { errors } : {}),
  });
}

// ── Route: GET /api/sync/pull (paginated) ─────────────────────────────────────
async function handlePull(req: Request): Promise<Response> {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const url = new URL(req.url);
  const table = url.searchParams.get("table");
  const sinceRaw = url.searchParams.get("since");
  const cursorRaw = url.searchParams.get("cursor");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "500"), 1000);

  if (!table) return err("Missing 'table' query param");
  if (!ALLOWED_TABLES.has(table)) return err(`Table '${table}' is not allowed for sync`, 403);

  const since = parseTimestamp(sinceRaw);
  const tsCol = getTsColumn(table);
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const compositePK = COMPOSITE_PK_TABLES[table];

  let query = db.from(table).select("*");

  if (table === "exam_pins") {
    query = query.order("id", { ascending: true });
    if (cursorRaw) query = query.gt("id", cursorRaw);
  } else if (compositePK) {
    query = query.order(compositePK[0], { ascending: true });
    if (cursorRaw) query = query.gt(compositePK[0], cursorRaw);
  } else {
    query = query.order(tsCol, { ascending: true });
    if (since) query = query.gt(tsCol, since);
    if (cursorRaw) query = query.gt(tsCol, cursorRaw);
  }

  query = query.limit(limit);
  const { data, error } = await query;

  if (error) {
    console.error(`[PULL] ${table} error:`, error.message);
    return err(`Failed to pull ${table}: ${error.message}`, 500);
  }

  // Compute next cursor (only if a full page was returned)
  let nextCursor: string | null = null;
  if (data && data.length === limit) {
    const last = data[data.length - 1] as Record<string, unknown>;
    if (table === "exam_pins") nextCursor = String(last.id ?? "");
    else if (compositePK) nextCursor = String(last[compositePK[0]] ?? "");
    else nextCursor = String(last[tsCol] ?? "");
  }

  return json({
    table, records: data ?? [], count: data?.length ?? 0,
    nextCursor,
    pulledAt: new Date().toISOString(),
  });
}

// ── Route: POST /api/sync/tombstones ──────────────────────────────────────────
async function handleTombstones(req: Request): Promise<Response> {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  let body: { tombstones?: { table: string; id: string }[] };
  try { body = await req.json(); } catch { return err("Invalid JSON body"); }

  const tombstones = body.tombstones || [];
  if (!Array.isArray(tombstones) || tombstones.length === 0) {
    return json({ deleted: 0 });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let deleted = 0;
  const errors: { id: string; error: string }[] = [];

  for (const t of tombstones) {
    if (!t?.table || !t?.id) continue;
    if (!ALLOWED_TABLES.has(t.table)) continue;
    try {
      const { error } = await db.from(t.table).delete().eq("id", t.id);
      if (error) errors.push({ id: t.id, error: error.message });
      else deleted++;
    } catch (e) {
      errors.push({ id: t.id, error: (e as Error).message });
    }
  }

  return json({ received: tombstones.length, deleted, ...(errors.length ? { errors } : {}) });
}

// ── Main Handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/$/, "");

  if (req.method === "GET" && path.endsWith("/api/health")) {
    return json({ status: "ok", ts: new Date().toISOString(), authRequired: !!SYNC_TOKEN });
  }
  if (req.method === "POST" && path.endsWith("/api/sync/receive")) {
    return handleReceive(req);
  }
  if (req.method === "GET" && path.endsWith("/api/sync/pull")) {
    return handlePull(req);
  }
  if (req.method === "POST" && path.endsWith("/api/sync/tombstones")) {
    return handleTombstones(req);
  }

  return err(`No route matched: ${req.method} ${path}`, 404);
});
