// Global license enforcement: blocks ALL API routes except license-management
// endpoints when the cached license is missing or expired. This guarantees the
// system stays locked even when offline.
const { getCachedLicense } = require('../license/license');

// Paths that remain reachable while the system is unlicensed.
const ALLOWED_WHEN_LOCKED = new Set([
  '/license/public-status',
  '/license/public-activate',
  '/license/status',
  '/license/activate',
  '/license/deactivate',
  '/health',
]);

function enforceLicense(req, res, next) {
  // Mounted at /api, so req.path here does not include the /api prefix.
  if (ALLOWED_WHEN_LOCKED.has(req.path)) return next();

  // Allow CORS preflight
  if (req.method === 'OPTIONS') return next();

  const key = getCachedLicense();
  if (key) return next();

  return res.status(402).json({
    error: 'License required',
    code: 'LICENSE_REQUIRED',
    message: 'This system is locked. Activate a valid license key to continue.',
  });
}

module.exports = { enforceLicense, ALLOWED_WHEN_LOCKED };
