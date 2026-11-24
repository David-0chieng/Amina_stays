// Normalise Kenyan numbers to +2547XXXXXXXX / +2541XXXXXXXX (what Africa's Talking expects).
// Foreign numbers already in +E.164 form are passed through.
function normalizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).replace(/[\s\-()]/g, '');
  if (/^0[17]\d{8}$/.test(p)) p = '+254' + p.slice(1);
  else if (/^254[17]\d{8}$/.test(p)) p = '+' + p;
  else if (/^[17]\d{8}$/.test(p)) p = '+254' + p;
  return /^\+\d{9,15}$/.test(p) ? p : null;
}

module.exports = { normalizePhone };
