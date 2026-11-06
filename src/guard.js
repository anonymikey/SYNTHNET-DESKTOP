// Fail-closed rule: if the internet gate is not active, the hotspot must not be running (it would hand out free internet).
const required = () => String(process.env.GATE_REQUIRED || 'true').toLowerCase() !== 'false' &&
                       String(process.env.GATE_ENABLED || 'true').toLowerCase() !== 'false';

function start(gate, hotspot) {
  let busy = false;
  setInterval(async () => {
    if (busy || !required() || gate.status().active) return;
    busy = true;
    try {
      const s = await hotspot.run('status');
      if (s.ok && s.state === 'On') { console.error('[guard] internet gate is down -> stopping hotspot'); await hotspot.run('stop'); }
    } finally { busy = false; }
  }, 20000).unref();
}
module.exports = { required, start };
