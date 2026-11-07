'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('provider credential templates contain no real secrets', () => {
  const env = read('config/env.template');
  assert.match(env, /COURTNEYTECH_API_KEY=$/m);
  assert.match(env, /COURTNEYTECH_API_SECRET=$/m);
  assert.match(env, /OLYMPUS_SMS_TOKEN=$/m);
  assert.match(env, /OLYMPUS_SMS_SENDER_ID=$/m);
  assert.doesNotMatch(env, /Bearer\s+[A-Za-z0-9|_-]{10,}/);
});

test('public website source contains no provider credential fields or secrets', () => {
  const files = fs.readdirSync(path.join(root, 'website', 'src')).filter((name) => /\.(html|js|css)$/.test(name));
  const publicText = files.map((name) => read(path.join('website', 'src', name))).join('\n');
  assert.doesNotMatch(publicText, /COURTNEYTECH_API_(?:KEY|SECRET)\s*=\s*[^\s<]+/i);
  assert.doesNotMatch(publicText, /OLYMPUS_SMS_TOKEN\s*=\s*[^\s<]+/i);
  assert.doesNotMatch(publicText, /Bearer\s+[A-Za-z0-9|_-]{10,}/i);
});

test('website security policy tells operators not to share credentials publicly', () => {
  const policy = read('website/src/policy.html');
  assert.match(policy, /payment API keys/i);
  assert.match(policy, /SMS tokens/i);
  assert.match(policy, /courtneytech\.xyz/i);
  assert.match(policy, /sms\.ots\.co\.ke/i);
});
