// Masks secrets before anything is stored or displayed.
const SECRET_KEY = /(pass(word)?|secret|token|api[_-]?key|auth(orization)?|cookie|private[_-]?key|credential)/i;
const SECRET_VALUE = [
  /sk-[A-Za-z0-9_-]{16,}/g,               // OpenAI/Anthropic-style keys
  /gh[pousr]_[A-Za-z0-9]{20,}/g,          // GitHub tokens
  /AKIA[0-9A-Z]{16}/g,                    // AWS access key
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,        // Slack
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /((?:^|\n)\s*[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|KEY)[A-Z0-9_]*\s*=\s*)[^\n]+/g, // .env lines
];

const MAX_STRING = 2000;

function redactString(s) {
  let out = s;
  for (const re of SECRET_VALUE) {
    out = out.replace(re, (m, envPrefix) => (typeof envPrefix === 'string' ? envPrefix + '•••' : '•••'));
  }
  if (out.length > MAX_STRING) out = out.slice(0, MAX_STRING) + ` …(+${out.length - MAX_STRING})`;
  return out;
}

export function redact(value, depth = 0) {
  if (depth > 6) return '…';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      // A secret is a string; a number under a key like "input_tokens" is a count, not a credential.
      out[k] = SECRET_KEY.test(k) && typeof v === 'string' ? '•••' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}
