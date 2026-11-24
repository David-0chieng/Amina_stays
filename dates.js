const iso = d => d.toISOString().slice(0, 10);

function today() { return iso(new Date(Date.now() + 3 * 3600 * 1000)); } // Kenya time (UTC+3)

function addDays(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

// Friday check-in for "this weekend" (if it's already Sat/Sun, start today)
function weekendStart() {
  const t = today();
  const dow = new Date(t + 'T00:00:00Z').getUTCDay(); // 0=Sun
  if (dow === 6 || dow === 0) return t;
  return addDays(t, (5 - dow + 7) % 7);
}

module.exports = { today, addDays, weekendStart };