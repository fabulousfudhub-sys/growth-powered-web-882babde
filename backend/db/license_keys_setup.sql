-- ============================================================================
-- LICENSE KEYS TABLE — run this once on the ONLINE Supabase database to enable
-- the validate-license edge function.
--
-- Apply via Supabase SQL editor (Database → SQL Editor → New query).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.license_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key text UNIQUE NOT NULL,
  customer_name text,
  customer_email text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  issued_at timestamptz NOT NULL DEFAULT now(),
  last_validated_at timestamptz,
  validation_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_license_keys_key ON public.license_keys(license_key);
CREATE INDEX IF NOT EXISTS idx_license_keys_active ON public.license_keys(active) WHERE active = true;

-- Service-role-only access. RLS enabled, no public policies.
ALTER TABLE public.license_keys ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_license_keys_updated_at ON public.license_keys;
CREATE TRIGGER trg_license_keys_updated_at
  BEFORE UPDATE ON public.license_keys
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Sample insert (replace with real key + expiry):
-- INSERT INTO public.license_keys (license_key, customer_name, expires_at)
-- VALUES ('ATAPOLY-2026-XXXX-YYYY', 'ATAPOLY', '2027-01-01T00:00:00Z');
