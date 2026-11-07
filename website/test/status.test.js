'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const status = require('../api/status');
function responseRecorder() { return { headers: {}, statusCode: 200, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } }; }
test('status endpoint returns safe operational metadata', () => { const res = responseRecorder(); status({}, res); assert.equal(res.statusCode, 200); assert.equal(res.body.status, 'operational'); assert.equal(res.body.checks.website, 'operational'); assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0'); assert.equal(JSON.stringify(res.body).includes('github'), false); assert.equal(JSON.stringify(res.body).includes('token'), false); });
