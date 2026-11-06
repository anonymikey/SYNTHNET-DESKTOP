// Saves KEY=value pairs into the same .env the running app loaded, and updates process.env so no restart is needed.
const fs = require('fs'), path = require('path');
const { DATA_DIR } = require('./config');

const envPath = () => process.env.SYNTHNET_DATA ? path.join(DATA_DIR, '.env') : path.resolve(process.cwd(), '.env');

function setEnv(key, value) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error('Bad setting name.');
  if (/["\\\r\n]/.test(value)) throw new Error('Value contains characters that cannot be saved.');
  const file = envPath();
  const contents = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const line = `${key}="${value}"`;
  const re = new RegExp(`^[ \\t]*${key}[ \\t]*=.*$`, 'm');
  const updated = re.test(contents) ? contents.replace(re, () => line) : `${contents}${contents && !contents.endsWith('\n') ? '\n' : ''}${line}\n`;
  fs.writeFileSync(file, updated);
  process.env[key] = value;
}
module.exports = { setEnv, envPath };
