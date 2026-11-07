// Admin API for SMS: /api/admin/sms/*  (mounted by admin.js AFTER its token check, so every route here is token-protected).
const express = require('express');
const sms = require('./sms');
const notify = require('./notify');
const { setEnv } = require('./envfile');
const { normPhone } = require('./phone');

const router = express.Router();
const fail = (res, e, code = 400) => res.status(code).json({ error: e.message || String(e) });

const overview = () => ({
  configured: sms.configured(), senderConfigured: Boolean(sms.cfg().sender), senderId: sms.cfg().sender,
  settings: notify.settings(), labels: notify.LABELS, kinds: notify.KINDS, placeholders: notify.PLACEHOLDERS, stats: sms.stats()
});

router.get('/status', (_req, res) => res.json(overview()));

router.post('/credentials', (req, res) => {
  const { token, senderId } = req.body || {};
  try {
    if (token != null && token !== '') {
      if (!/^[\x21-\x7E]{10,200}$/.test(token) || /["\\]/.test(token)) throw new Error('That does not look like an API token. Copy it from Olympus > Developers > Reveal token.');
      setEnv('OLYMPUS_SMS_TOKEN', token);
    }
    if (senderId != null && senderId !== '') {
      if (!/^(\+?\d{7,15}|[A-Za-z0-9 ]{1,11})$/.test(senderId)) throw new Error('Sender ID: up to 11 letters/numbers, or a phone number with country code.');
      setEnv('OLYMPUS_SMS_SENDER_ID', senderId.trim());
    }
    res.json(overview());
  } catch (e) { fail(res, e); }
});

router.post('/settings', (req, res) => {
  try { notify.saveSettings(req.body || {}); res.json(overview()); } catch (e) { fail(res, e); }
});

router.post('/preview', (req, res) => {
  const t = String((req.body || {}).template || '');
  res.json(notify.preview(t));
});

router.post('/test-connection', async (_req, res) => res.json(await sms.testConnection()));

router.post('/test-send', async (req, res) => {
  const phone = normPhone((req.body || {}).phone);
  if (!phone) return fail(res, new Error('Enter a valid Kenyan number, e.g. 0712345678.'));
  if (!sms.configured()) return fail(res, new Error('Save your API token and sender ID first.'), 409);
  const text = notify.render('{brand}: test message from your hotspot dashboard. SMS is working.', { brand: require('./config').portal().brand?.name || 'WiFi' });
  // Sent directly (not queued) so the admin sees the real provider answer immediately.
  const r = await sms.rawSend({ recipients: [phone], text });
  if (!r.ok) return fail(res, new Error(r.error), 502);
  res.json({ ok: true });
});

router.get('/log', (req, res) => res.json({ log: sms.list({ limit: Math.min(+req.query.limit || 100, 500), status: req.query.status || undefined }), stats: sms.stats() }));
router.post('/log/:id/retry', (req, res) => sms.retry(req.params.id) ? res.json({ ok: true }) : fail(res, new Error('Only failed or cancelled messages can be retried.'), 409));
router.post('/log/:id/cancel', (req, res) => sms.cancel(req.params.id) ? res.json({ ok: true }) : fail(res, new Error('Only waiting messages can be cancelled.'), 409));

router.post('/audience', async (req, res) => {
  try {
    const b = req.body || {}, a = await notify.audience(b), m = sms.measure(notify.render(String(b.message || ''), { brand: '', support: '' }));
    res.json({ count: a.phones.length, excluded: a.excluded, invalid: a.invalid, ...m, units: m.segments * a.phones.length });
  } catch (e) { fail(res, e); }
});

router.post('/broadcast', async (req, res) => {
  try { res.json({ ok: true, ...(await notify.broadcast(req.body || {})) }); } catch (e) { fail(res, e); }
});

module.exports = router;
