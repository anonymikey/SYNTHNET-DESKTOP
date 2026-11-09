'use strict';

const ALLOWED_HOSTS = new Set([
  'synthnetdesktop.anonymiketech.space',
  'courtneytech.xyz',
  'www.courtneytech.xyz',
  'sms.ots.co.ke',
  'whatsapp.com',
  'chat.whatsapp.com',
  't.me'
]);
const ALLOWED_MAIL = 'anonymiketech@gmail.com';

function isAllowedExternalUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { return false; }
  if (url.protocol === 'mailto:') return url.pathname.toLowerCase() === ALLOWED_MAIL;
  if (url.protocol !== 'https:') return false;
  return ALLOWED_HOSTS.has(url.hostname.toLowerCase());
}

module.exports = { ALLOWED_HOSTS, isAllowedExternalUrl };
