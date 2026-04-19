const fs = require('fs');
const path = require('path');

const CACHE_PATH = path.join(__dirname, 'cache.json');
const CACHE_DURATION_DAYS = 7;

// Default to the Supabase edge function shipped with this project. Can be
// overridden via env (e.g. for staging or a self-hosted validator).
const DEFAULT_VALIDATE_URL =
  'https://ihgcgmyjvnexaqcluoay.supabase.co/functions/v1/validate-license';
const REMOTE_VALIDATE_URL = process.env.LICENSE_VALIDATE_URL || DEFAULT_VALIDATE_URL;
// Anon/publishable key for the edge function (no JWT verification, but Supabase
// still requires the apikey header on hosted functions).
const REMOTE_ANON_KEY =
  process.env.LICENSE_VALIDATE_ANON_KEY ||
  'sb_publishable_FSDU9eF_N8Jfm34yHLdBnw_5NZ0ea1l';

function readCache() {
  if (!fs.existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

// Read cached license — returns key only if not expired
function getCachedLicense() {
  const data = readCache();
  if (!data) return null;
  const now = new Date();
  const expiresAt = new Date(data.expiresAt);
  if (expiresAt > now) return data.licenseKey;
  return null;
}

// Full status: { active, licenseKey, expiresAt, expired, lastChecked }
function getLicenseStatus() {
  const data = readCache();
  if (!data) return { active: false, licenseKey: null, expiresAt: null, expired: false, lastChecked: null };
  const now = new Date();
  const expiresAt = new Date(data.expiresAt);
  const expired = expiresAt <= now;
  return {
    active: !expired,
    licenseKey: data.licenseKey,
    expiresAt: data.expiresAt,
    expired,
    lastChecked: data.lastChecked || null,
  };
}

// Cache a new license key (extends expiry by CACHE_DURATION_DAYS).
function cacheLicense(key, opts = {}) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (opts.durationDays || CACHE_DURATION_DAYS));
  const data = {
    licenseKey: key,
    expiresAt: opts.expiresAt || expiresAt.toISOString(),
    lastChecked: new Date().toISOString(),
  };
  fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[LICENSE] Cached until ${data.expiresAt}`);
  return data;
}

function clearLicense() {
  if (fs.existsSync(CACHE_PATH)) fs.unlinkSync(CACHE_PATH);
}

// Validate against remote license server (optional). If unreachable, we keep the cache.
// If remote returns valid=false, we clear the cache immediately (revocation).
async function remoteValidate(licenseKey) {
  if (!REMOTE_VALIDATE_URL) return { reachable: false };
  try {
    const res = await fetch(REMOTE_VALIDATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey }),
    });
    if (!res.ok) return { reachable: true, ok: false };
    const json = await res.json().catch(() => ({}));
    return { reachable: true, ok: true, valid: !!json.valid, expiresAt: json.expiresAt || null };
  } catch {
    return { reachable: false };
  }
}

// Periodic background check: refreshes cache when online, and revokes immediately
// when the remote server reports an invalid key. Offline: nothing changes (cache rules).
async function periodicCheck() {
  const data = readCache();
  if (!data) return;
  const result = await remoteValidate(data.licenseKey);
  if (!result.reachable) {
    // Offline — leave cache as-is (it will expire naturally when CACHE_DURATION_DAYS elapses)
    return;
  }
  if (result.ok && result.valid === false) {
    console.warn('[LICENSE] Remote reported invalid key — clearing cache.');
    clearLicense();
    return;
  }
  if (result.ok && result.valid === true) {
    cacheLicense(data.licenseKey, { expiresAt: result.expiresAt || undefined });
  }
}

function startPeriodicCheck(intervalMs = 60 * 60 * 1000) {
  // Run shortly after boot, then every hour
  setTimeout(() => periodicCheck().catch(() => {}), 30_000);
  setInterval(() => periodicCheck().catch(() => {}), intervalMs);
}

module.exports = {
  getCachedLicense,
  getLicenseStatus,
  cacheLicense,
  clearLicense,
  remoteValidate,
  periodicCheck,
  startPeriodicCheck,
};
