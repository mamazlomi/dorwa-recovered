// Dorva catalog sync (Supabase Edge Function).
// Pulls the catalog layer from the pharma-catalog API. The database decides what to run
// (public.catalog_sync_begin): a full load, an incremental update or one product, and hands
// over the API key from Supabase Vault. The key is never logged or returned.
//
// Called by pg_cron through public.catalog_sync_tick() (only when a run is due) and by the
// admin "run now" buttons. The request body is ignored: the job always comes from the database.

import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const PAGE = 200;
const BUDGET_MS = 110_000; // stay well inside the function's wall-clock limit; a full load resumes on the next call

type Job = { mode?: "full" | "incremental" | "one"; run?: number; key?: string; base?: string; since?: string | null;
  cursor?: string | null; server_time?: string | null; id?: string | null; busy?: boolean; idle?: boolean; no_key?: boolean };
type Page = { items?: unknown[]; next_cursor?: string | null; server_time?: string };

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

async function get(url: string, key: string): Promise<Response> {
  let last: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "x-api-key": key, Accept: "application/json" }, signal: AbortSignal.timeout(45_000) });
      if (res.status >= 500 || res.status === 429) { last = new HttpError(res.status, `HTTP ${res.status}`); }
      else return res;
    } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function fail(res: Response): Promise<never> {
  let code = "";
  try { const j = await res.json() as { error?: string }; code = j?.error ?? ""; } catch { /* not json */ }
  throw new HttpError(res.status, `HTTP ${res.status}${code ? " " + code : ""}`);
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

async function run(): Promise<Record<string, unknown>> {
  const job = (await rpc("catalog_sync_begin", {})) as Job;
  if (!job?.mode || !job.run || !job.key || !job.base) return { skipped: job?.busy ? "busy" : job?.no_key ? "no_key" : "idle" };
  const { mode, run: runId, key } = job;
  const base = job.base.replace(/\/+$/, "");
  if (!/^https:\/\//.test(base)) {
    await rpc("catalog_sync_finish", { p_run: runId, p_ok: false, p_done: false, p_server_time: null, p_error: "catalog.api_base must start with https://" });
    return { error: "base" };
  }
  const started = Date.now();
  try {
    if (mode === "one") {
      const res = await get(`${base}/products/${encodeURIComponent(job.id ?? "")}`, key);
      if (res.status === 404) await rpc("catalog_sync_gone", { p_run: runId, p_id: job.id });
      else if (!res.ok) await fail(res);
      else await rpc("catalog_sync_ingest", { p_run: runId, p_items: [await res.json()], p_cursor: null, p_server_time: null });
      await rpc("catalog_sync_finish", { p_run: runId, p_ok: true, p_done: true, p_server_time: null });
      return { mode, run: runId };
    }

    let cursor = job.cursor ?? null;
    let serverTime = job.server_time ?? null;
    let pages = 0;
    for (;;) {
      const q = new URLSearchParams({ limit: String(PAGE) });
      if (mode === "incremental" && job.since) q.set("updated_since", new Date(job.since).toISOString());
      if (cursor) q.set("cursor", cursor);
      const res = await get(`${base}/products?${q}`, key);
      if (!res.ok) await fail(res);
      const page = await res.json() as Page;
      // the time to continue from is the server time of the FIRST page: anything changed during the load is picked up next run
      serverTime = serverTime ?? page.server_time ?? null;
      cursor = page.next_cursor ?? null;
      await rpc("catalog_sync_ingest", { p_run: runId, p_items: page.items ?? [], p_cursor: cursor, p_server_time: serverTime });
      pages++;
      if (!cursor) break;
      if (Date.now() - started > BUDGET_MS) {
        // a full load continues from the saved cursor; an incremental run simply repeats from the same time
        await rpc("catalog_sync_finish", { p_run: runId, p_ok: true, p_done: false, p_server_time: null });
        return { mode, run: runId, pages, continues: true };
      }
    }
    const fin = await rpc("catalog_sync_finish", { p_run: runId, p_ok: true, p_done: true, p_server_time: serverTime });
    return { mode, run: runId, pages, ...(fin as Record<string, unknown>) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("catalog sync failed", mode, runId, msg.replaceAll(key, "***"));
    await rpc("catalog_sync_finish", { p_run: runId, p_ok: false, p_done: false, p_server_time: null, p_error: msg.replaceAll(key, "***") }).catch(() => null);
    return { mode, run: runId, error: "failed" };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  try {
    return Response.json(await run());
  } catch (e) {
    console.error("catalog sync error", String(e));
    return Response.json({ error: "sync failed" }, { status: 500 });
  }
});
