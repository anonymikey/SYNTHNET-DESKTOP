'use strict';

const RESEND_API = 'https://api.resend.com';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return null; }
}

async function resend(path, payload, apiKey) {
  const response = await fetch(`${RESEND_API}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body = {};
  try { body = await response.json(); } catch { /* preserve a safe generic error */ }
  return { response, body };
}

module.exports = async function waitlistRoute(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'method_not_allowed' });
  }
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.RESEND_FROM_EMAIL || '').trim();
  if (!apiKey || !from) return json(res, 503, { error: 'not_configured' });

  const body = await readBody(req);
  if (!body || body.website) return json(res, 400, { error: 'invalid_request' });
  const email = String(body.email || '').trim().toLowerCase();
  if (email.length > 320 || !EMAIL_PATTERN.test(email)) return json(res, 400, { error: 'invalid_email' });

  const segmentId = String(process.env.RESEND_SEGMENT_ID || '').trim();
  const contactPayload = { email, unsubscribed: false };
  if (segmentId) contactPayload.segments = [{ id: segmentId }];

  const contactResult = await resend('/contacts', contactPayload, apiKey);
  const contactError = contactResult.body && (contactResult.body.name || contactResult.body.error);
  const duplicate = contactResult.response.status === 409 || contactError === 'already_exists' || /already exists|already been added/i.test(String(contactError || ''));
  if (!contactResult.response.ok && !duplicate) return json(res, 502, { error: 'provider_unavailable' });

  const emailResult = await resend('/emails', {
    from,
    to: [email],
    subject: 'You are on the SYNTHNET ISP early-access list',
    html: '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#17212b;max-width:620px"><p style="color:#087f96;font-weight:700;letter-spacing:.12em;font-size:12px">SYNTHNET ISP NETWORK</p><h1 style="font-size:30px;line-height:1.15">Congratulations — you are on the list.</h1><p>Thank you for joining the SYNTHNET ISP Network early-access list. We are building a separate control plane for hotspot billing, MikroTik, TP-Link Omada, vouchers, payments, sessions, and reporting.</p><p>When the platform is ready, we will send you an early-access invitation with the next steps. No account or payment is required at this stage.</p><p style="color:#5b6872;font-size:13px">You received this message because you requested ISP Network early access from synthnet.anonymiketech.space.</p></div>',
    text: 'Congratulations — you are on the SYNTHNET ISP Network early-access list. Thank you for your interest. When the platform is ready, we will send you an early-access invitation with the next steps. No account or payment is required at this stage.',
  }, apiKey);
  if (!emailResult.response.ok) return json(res, 502, { error: 'provider_unavailable' });
  return json(res, 200, { ok: true, already_registered: duplicate });
};

module.exports._readBody = readBody;
