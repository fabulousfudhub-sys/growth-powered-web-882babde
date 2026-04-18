// Global license enforcement: blocks ALL API routes except license-management
// endpoints when the cached license is missing or expired. This guarantees the
// system stays locked even when offline.
const { getCachedLicense } = require('../license/license');

// Paths that remain reachable while the system is unlicensed.
const ALLOWED_WHEN_LOCKED = [
  '/api/license/public-status',
  '/api/license/public-activate',
  '/api/license/status',
  '/api/license/activate',
  '/api/license/deactivate',
  '/api/health',
];

function enforceLicense(req, res, next) {
  // Allow license & health endpoints unconditionally
  if (ALLOWED_WHEN_LOCKED.includes(req.path)) return next();

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
