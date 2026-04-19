// Remote license validator. Backends call this to confirm a license key is still
// active and to fetch the latest expiry date. Designed to be polled hourly so
// revocations propagate quickly while staying offline-tolerant.
//
// Request:  POST { licenseKey: string }
// Response: 200 { valid: boolean, expiresAt: string | null, reason?: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json({ valid: false, reason: "server_misconfigured" }, 500);
    }

    let body: { licenseKey?: string } = {};
    try {
      body = await req.json();
    } catch {
      return json({ valid: false, reason: "invalid_body" }, 400);
    }

    const key = (body.licenseKey || "").trim();
    if (!key || key.length < 4) {
      return json({ valid: false, reason: "missing_key" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data, error } = await supabase
      .from("license_keys")
      .select(
        "id, license_key, active, expires_at, customer_name, validation_count",
      )
      .eq("license_key", key)
      .maybeSingle();

    if (error) {
      console.error("[validate-license] DB error:", error);
      return json({ valid: false, reason: "db_error" }, 500);
    }

    if (!data) {
      return json({ valid: false, reason: "not_found", expiresAt: null });
    }

    if (!data.active) {
      return json({ valid: false, reason: "revoked", expiresAt: data.expires_at });
    }

    const now = Date.now();
    const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : null;
    if (expiresAt !== null && expiresAt <= now) {
      return json({ valid: false, reason: "expired", expiresAt: data.expires_at });
    }

    // Record the validation (best-effort, never blocks response)
    supabase
      .from("license_keys")
      .update({
        last_validated_at: new Date().toISOString(),
        validation_count: (data.validation_count || 0) + 1,
      })
      .eq("id", data.id)
      .then(() => {})
      .catch(() => {});

    return json({
      valid: true,
      expiresAt: data.expires_at,
      customerName: data.customer_name,
    });
  } catch (err) {
    console.error("[validate-license] fatal:", err);
    return json({ valid: false, reason: "internal_error" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
