const { Router } = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const {
  getCachedLicense,
  getLicenseStatus,
  cacheLicense,
  clearLicense,
  remoteValidate,
} = require('../license/license');

const router = Router();

// PUBLIC status — used by frontend License Activation page (no auth) so users can see
// the current license state on a locked system before logging in.
router.get('/public-status', (_req, res) => {
  const status = getLicenseStatus();
  res.json({
    active: status.active,
    expired: status.expired,
    expiresAt: status.expiresAt,
    licenseKey: status.licenseKey
      ? `${status.licenseKey.slice(0, 4)}****${status.licenseKey.slice(-4)}`
      : null,
  });
});

// PUBLIC activation — anyone with a valid license key can unlock the system.
// Required because before activation there are no users to authenticate as.
router.post('/public-activate', async (req, res) => {
  try {
    const { licenseKey } = req.body || {};
    if (!licenseKey || typeof licenseKey !== 'string' || licenseKey.trim().length < 4) {
      return res.status(400).json({ error: 'Invalid license key' });
    }
    const key = licenseKey.trim();

    // If a remote validator is configured, require it to confirm the key.
    const validation = await remoteValidate(key);
    if (validation.reachable && validation.ok && validation.valid === false) {
      return res.status(400).json({ error: 'License key rejected by license server' });
    }

    cacheLicense(key, validation.expiresAt ? { expiresAt: validation.expiresAt } : {});
    res.json({ success: true, message: 'License activated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to activate license' });
  }
});

// AUTHENTICATED status (super_admin only) — same payload as public but kept for
// the admin License page so existing UI does not break.
router.get('/status', authenticate, requireRole('super_admin'), (_req, res) => {
  const status = getLicenseStatus();
  res.json({
    active: status.active,
    licenseKey: status.licenseKey
      ? `${status.licenseKey.slice(0, 4)}****${status.licenseKey.slice(-4)}`
      : null,
    expiresAt: status.expiresAt,
    expired: status.expired,
    lastChecked: status.lastChecked,
  });
});

router.post('/activate', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const { licenseKey } = req.body || {};
    if (!licenseKey || typeof licenseKey !== 'string' || licenseKey.trim().length < 4) {
      return res.status(400).json({ error: 'Invalid license key' });
    }
    const key = licenseKey.trim();
    const validation = await remoteValidate(key);
    if (validation.reachable && validation.ok && validation.valid === false) {
      return res.status(400).json({ error: 'License key rejected by license server' });
    }
    cacheLicense(key, validation.expiresAt ? { expiresAt: validation.expiresAt } : {});
    res.json({ success: true, message: 'License activated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to activate license' });
  }
});

router.post('/deactivate', authenticate, requireRole('super_admin'), (_req, res) => {
  try {
    clearLicense();
    res.json({ success: true, message: 'License deactivated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deactivate license' });
  }
});

module.exports = router;
