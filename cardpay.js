// Simulated hosted card checkout. Stands in for a provider's payment page (e.g. Paystack):
// it never asks for card numbers — the guest just approves or declines a test charge.
const express = require('express');
const { cardPayment, onPaymentSuccess, onPaymentFailed } = require('./payments');

const router = express.Router();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => 'KES ' + Number(n).toLocaleString('en-KE');

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>
  body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#eef1f4;color:#1d2b28;display:grid;place-items:center;min-height:100vh}
  .box{background:#fff;border-radius:14px;box-shadow:0 8px 30px #0002;padding:26px;width:min(400px,92vw)}
  .sim{background:#fef5e7;color:#7e5109;font-size:13px;padding:8px 10px;border-radius:8px;margin-bottom:14px}
  h1{font-size:20px;margin:0 0 4px} .amt{font-size:30px;font-weight:700;margin:12px 0}
  .muted{color:#5f6f6b;font-size:14px} .row{display:flex;gap:10px;margin-top:18px}
  button{flex:1;padding:12px;border-radius:9px;border:0;font:inherit;font-weight:600;cursor:pointer}
  .pay{background:#117a65;color:#fff} .dec{background:#fff;color:#a93226;border:1px solid #a93226}
  a{color:#117a65}
</style></head><body><div class="box">${body}</div></body></html>`;

const result = (title, msg) => page(title, `<h1>${esc(title)}</h1><p>${msg}</p><p><a href="/">Back to Amina-Stays</a></p>`);

router.get('/pay/card/:token', (req, res) => {
  const p = cardPayment(req.params.token);
  if (!p) return res.status(404).send(result('Payment link not found', 'This link is invalid.'));
  if (p.status === 'success') return res.send(result('Paid — thank you!', `Booking <b>${esc(p.booking_ref)}</b> is confirmed. Your confirmation is on its way by SMS.`));
  if (p.booking_status !== 'held' || p.expires_at < Date.now())
    return res.send(result('This hold has expired', 'The apartment was released because payment wasn’t completed in time. Please book again.'));
  const secs = Math.max(0, Math.round((p.expires_at - Date.now()) / 1000));
  res.send(page('Pay by card', `
    <div class="sim">Simulated card checkout — no card details are collected and no money moves.</div>
    <h1>Amina-Stays</h1>
    <div class="muted">${esc(p.unit_name)} · ${esc(p.check_in)} → ${esc(p.check_out)} · Ref ${esc(p.booking_ref)}</div>
    ${req.query.declined ? '<p style="color:#a93226">Payment declined. You can try again.</p>' : ''}
    <div class="amt">${fmt(p.amount)}</div>
    <div class="muted">Held for you for <b id="t"></b></div>
    <form method="post" class="row">
      <button class="dec" name="action" value="decline">Decline</button>
      <button class="pay" name="action" value="pay">Pay ${fmt(p.amount)}</button>
    </form>
    <script>let s=${secs};const t=document.getElementById('t');(function tick(){t.textContent=Math.floor(s/60)+':'+String(s%60).padStart(2,'0');if(s-->0)setTimeout(tick,1000);else location.reload()})()</script>`));
});

router.post('/pay/card/:token', async (req, res) => {
  const p = cardPayment(req.params.token);
  if (!p) return res.status(404).send(result('Payment link not found', 'This link is invalid.'));
  if (['pending', 'failed'].includes(p.status) && p.booking_status === 'held' && p.expires_at > Date.now()) {
    if (req.body.action === 'pay') await onPaymentSuccess(p.booking_ref, 'CARD-SIM-' + Date.now(), 'card');
    else await onPaymentFailed(p.booking_ref, 'card');
  }
  res.redirect(303, '/pay/card/' + req.params.token + (req.body.action === 'decline' ? '?declined=1' : ''));
});

module.exports = router;
