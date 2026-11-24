// End-to-end test (npm test): spawns the server in a scratch dir with fake AT creds (no real SMS), runs scenarios.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const APP = require('path').resolve(__dirname, '..');
const Database = require(APP + '/node_modules/better-sqlite3');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amina-'));
fs.cpSync(APP + '/public', dir + '/public', { recursive: true });
const PORT = 3998, B = `http://localhost:${PORT}`;
const env = { ...process.env, PORT, AT_USERNAME: 'sandbox', AT_API_KEY: 'fake', AMINA_PHONE: '+254700000001', HOST_PIN: '1234',
  DEMO: '1', PAYMENT_MODE: 'simulate', SIM_PAY_DELAY_MS: '300', CARD_PROVIDER: 'simulate', GOODWILL_AIRTIME_KES: '20', REVIEW_DELAY_MIN: '0', REVIEW_QUIET_HOURS: 'off' };
const srv = spawn(process.execPath, [APP + '/server.js'], { cwd: dir, env });
let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const db = () => new Database(dir + '/amina.db');
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  PASS ' : '  FAIL ') + msg); if (!cond) fails++; };
const j = async (p, o = {}) => (await fetch(B + p, { ...o, headers: { 'content-type': 'application/json', ...(o.headers || {}) } })).json();
const form = (p, body) => fetch(B + p, { method: 'POST', body: new URLSearchParams(body), redirect: 'manual' });
const sms = (from, text) => j(`/demo/sms?from=${encodeURIComponent(from)}&text=${encodeURIComponent(text)}`);
const lastOut = phone => db().prepare("SELECT text FROM messages WHERE phone=? AND direction='out' ORDER BY id DESC LIMIT 1").get(phone)?.text || '';
const outs = (phone, n) => db().prepare("SELECT text FROM messages WHERE phone=? AND direction='out' ORDER BY id DESC LIMIT ?").all(phone, n).map(r => r.text).reverse();

async function login(phone) {
  await j('/api/auth/request', { method: 'POST', body: JSON.stringify({ phone }) });
  await sleep(100);
  const code = [...log.matchAll(/Login code for (\+\d+): (\d+)/g)].filter(m => m[1] === phone).pop()[2];
  return (await j('/api/auth/verify', { method: 'POST', body: JSON.stringify({ phone, code }) })).token;
}

(async () => {
  for (let i = 0; i < 40 && !log.includes('running on'); i++) await sleep(100);

  console.log('1. Foreign guest books on the website by card');
  const UK = '+447700900123';
  const tok = await login(UK);
  const auth = { authorization: 'Bearer ' + tok };
  const bad = await j('/api/book', { method: 'POST', headers: auth, body: JSON.stringify({ unitId: 3, checkIn: '2027-03-01', checkOut: '2027-03-04', method: 'mpesa' }) });
  ok(bad.payment && bad.payment.error && /Kenyan/.test(bad.payment.error), 'M-Pesa refused for a +44 number');
  db().prepare("UPDATE bookings SET status='expired' WHERE ref=?").run(bad.ref); // free the unit again
  const r = await j('/api/book', { method: 'POST', headers: auth, body: JSON.stringify({ unitId: 3, checkIn: '2027-03-01', checkOut: '2027-03-04', method: 'card', name: 'Jane Smith' }) });
  ok(r.payment.method === 'card' && /\/pay\/card\/[0-9a-f]{32}$/.test(r.payment.checkoutUrl), 'card checkout URL returned');
  const url = new URL(r.payment.checkoutUrl).pathname;
  const page = await (await fetch(B + url)).text();
  ok(page.includes('Simulated card checkout') && page.includes('22,500') && !/card number/i.test(page), 'checkout page shows amount, no card fields');
  await form(url, { action: 'decline' });
  ok((await j('/api/booking/' + r.ref, { headers: auth })).status === 'held', 'decline keeps the hold');
  ok(/card payment .* didn't go through/.test(lastOut(UK)), 'decline SMS mentions card');
  const resp = await form(url, { action: 'pay' });
  ok(resp.status === 303, 'pay redirects back to status page');
  ok((await j('/api/booking/' + r.ref, { headers: auth })).status === 'confirmed', 'booking confirmed after card pay');
  ok((await (await fetch(B + url)).text()).includes('Paid'), 'status page says paid');
  await form(url, { action: 'pay' });
  ok(db().prepare("SELECT COUNT(*) c FROM payments WHERE booking_ref=? AND status='success'").get(r.ref).c === 1, 'second pay click does not double-charge');

  console.log('2. Foreign guest books by SMS -> card link texted');
  const DE = '+4915112345678';
  await sms(DE, 'anything free tomorrow for 2 people?');
  await sms(DE, '1');
  const m = outs(DE, 2).join(' | ');
  ok(/Pay KES \d+ by card .*\/pay\/card\//.test(m) && /texted you a secure card payment link/.test(m), 'SMS has card link + holding message');

  console.log('3. Kenyan guest by SMS (M-Pesa) -> check-in code + local tips');
  const KE = '+254722000111';
  await sms(KE, 'Hi, anything free tonight in Old Town for 2 people?');
  await sms(KE, '1');
  await sleep(700);
  const ref = db().prepare("SELECT ref FROM bookings WHERE guest_phone=? AND status='confirmed'").get(KE)?.ref;
  ok(!!ref, 'M-Pesa (simulated) booking confirmed');
  await j('/demo/checkin/' + ref);
  const ci = outs(KE, 2).join(' | ');
  ok(/Door code: \d{6}/.test(ci) && /Local tips for Old Town: .*mahamri/.test(ci) && /999 or 112/.test(ci), 'code SMS followed by local tips');

  console.log('4. Checkout -> review request -> low rating alerts Amina');
  await sms(KE, 'CHECKOUT');
  ok(/Thanks for staying/.test(lastOut(KE)), 'checkout thanks comes first');
  await j('/demo/tick');
  ok(/How was your stay\? Reply 1/.test(lastOut(KE)), 'review requested by scheduler afterwards');
  await sms(KE, '2');
  ok(db().prepare('SELECT rating FROM reviews WHERE booking_ref=?').get(ref)?.rating === 2, 'rating stored');
  ok(/Low review \(2\/5\)/.test(lastOut('+254700000001')), 'Amina alerted about low review');

  console.log('5. Returning guest');
  await sms(KE, 'same as last time this weekend');
  ok(/^Welcome back! Yes! 1\) Old Town Loft/.test(lastOut(KE)), 'SMS greets + offers last unit first: ' + lastOut(KE).slice(0, 60));
  const u = await (await form('/ussd', { phoneNumber: KE, text: '' })).text();
  ok(/Karibu tena/.test(u) && /5\. Rebook Old Town Loft/.test(u), 'USSD shows rebook option');
  const u2 = await (await form('/ussd', { phoneNumber: KE, text: '5*3*2' })).text();
  ok(/^END Holding Old Town Loft\. Check your phone for an M-Pesa prompt/.test(u2), 'USSD rebook holds + M-Pesa: ' + u2);
  const v = await (await form('/voice', { sessionId: 'V1', isActive: '1', direction: 'Inbound', callerNumber: KE, dtmfDigits: '' })).text();
  const v2 = await (await form('/voice', { sessionId: 'V1', isActive: '1', direction: 'Inbound', callerNumber: KE, dtmfDigits: '1' })).text();
  ok(/Welcome back/.test(v2), 'voice greets returning guest');

  console.log('6. Auto-checkout when guest forgets');
  const AK = '+254733444555';
  const d = db();
  d.prepare("INSERT INTO bookings (ref,unit_id,guest_phone,check_in,check_out,status,channel,total) VALUES ('AMS-T1',2,?,'2026-01-01','2026-01-03','checked_in','web',12000)").run(AK);
  d.prepare("INSERT INTO access_codes (booking_ref,code,issued_at) VALUES ('AMS-T1','123456',CURRENT_TIMESTAMP)").run();
  await sleep(31000); // scheduler runs every 30s
  ok(db().prepare("SELECT status FROM bookings WHERE ref='AMS-T1'").get().status === 'completed', 'overdue stay auto-completed');
  ok(!!db().prepare("SELECT invalidated_at FROM access_codes WHERE booking_ref='AMS-T1'").get().invalidated_at, 'door code invalidated');
  ok(/How was your stay/.test(lastOut(AK)), 'review requested');

  console.log('7. Host: cancel paid booking -> goodwill airtime attempted; dashboard data');
  const c = await j('/api/host/cancel/' + r.ref, { method: 'POST', headers: { 'x-host-pin': '1234' } });
  ok(c.cancelled === r.ref, 'cancelled');
  ok(/has been cancelled\. Amina will contact you about your refund\.$/.test(lastOut(UK)), 'guest told about refund');
  ok(!/Airtime error/.test(log), 'no airtime attempted for a +44 number');
  const keRef = db().prepare("SELECT ref FROM bookings WHERE guest_phone=? AND channel='ussd' AND status='confirmed'").get(KE).ref;
  await j('/api/host/cancel/' + keRef, { method: 'POST', headers: { 'x-host-pin': '1234' } });
  ok(/Airtime error/.test(log), 'airtime attempted for Kenyan guest (fails with fake key, as expected)');
  ok(/refund\.$/.test(lastOut(KE)), 'no airtime promise in SMS when the send failed');
  const s = await j('/api/host/summary', { headers: { 'x-host-pin': '1234' } });
  ok(s.reviews.n === 1 && s.reviews.avg === 2, 'dashboard reviews: ' + JSON.stringify({ n: s.reviews.n, avg: s.reviews.avg }));
  ok(Array.isArray(s.byMethod), 'dashboard byMethod: ' + JSON.stringify(s.byMethod));

  const errs = log.split('\n').filter(l => /Error|error/.test(l) && !/SMS error|Airtime error|Safety call failed/.test(l));
  ok(errs.length === 0, 'no unexpected server errors' + (errs.length ? ':\n' + errs.join('\n') : ''));
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
})().catch(e => { console.error(e); fails++; }).finally(() => {
  srv.kill(); setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(fails ? 1 : 0); }, 500);
});
