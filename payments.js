const crypto = require('crypto');
const db = require('./db');
const { sendSMS } = require('./sms');
const { confirmBooking, getBooking } = require('./bookings');
const { findAvailable } = require('./availability');

const PRODUCT_NAME = process.env.AT_PAYMENT_PRODUCT || 'AminaStays';
// live     = call Africa's Talking mobile checkout (STK push)
// simulate = no real money; payment auto-succeeds after SIM_PAY_DELAY_MS (for demos / no payments product)
const MODE = () => (process.env.PAYMENT_MODE || 'live').toLowerCase();

// africastalking@0.8.x dropped the PAYMENTS module, so we call the REST endpoint directly.
function checkoutUrl() {
  const sandbox = (process.env.AT_USERNAME || '').toLowerCase() === 'sandbox';
  return `https://payments.${sandbox ? 'sandbox.' : ''}africastalking.com/mobile/checkout/request`;
}

// Send M-Pesa STK push. Never throws.
async function requestMpesa(ref, phone, amount) {
  db.prepare('INSERT INTO payments (booking_ref,amount,method,status,created_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)')
    .run(ref, amount, 'mpesa', 'pending');

  if (MODE() === 'simulate') {
    const delay = +process.env.SIM_PAY_DELAY_MS || 8000;
    console.log(`[simulate] STK push to ${phone} for KES ${amount} (${ref}) — auto-paying in ${delay}ms`);
    setTimeout(() => onPaymentSuccess(ref, 'SIM-' + Date.now(), 'mpesa').catch(console.error), delay);
    return { status: 'PendingConfirmation', simulated: true };
  }

  try {
    const r = await fetch(checkoutUrl(), {
      method: 'POST',
      headers: { apiKey: process.env.AT_API_KEY, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: process.env.AT_USERNAME,
        productName: PRODUCT_NAME,
        phoneNumber: phone,
        currencyCode: 'KES',
        amount,
        metadata: { ref }
      })
    });
    const body = await r.json().catch(() => ({ status: 'HTTP ' + r.status }));
    console.log('STK push:', body);
    if (!r.ok || (body.status && body.status !== 'PendingConfirmation')) {
      db.prepare("UPDATE payments SET status='failed' WHERE booking_ref=? AND status='pending'").run(ref);
      return { error: body.description || body.errorMessage || body.status || 'STK push failed' };
    }
    if (body.transactionId)
      db.prepare('UPDATE payments SET transaction_id=? WHERE booking_ref=? AND status=?').run(body.transactionId, ref, 'pending');
    return body;
  } catch (e) {
    console.error('STK error:', e.message);
    db.prepare("UPDATE payments SET status='failed' WHERE booking_ref=? AND status='pending'").run(ref);
    return { error: e.message };
  }
}

// Shared "payment succeeded" logic (real callback, simulator and demo route all use this).
// Idempotent: a duplicate callback does nothing.
async function onPaymentSuccess(ref, transactionId, method) {
  let b = getBooking(ref);
  if (!b) return null;
  if (['confirmed', 'checked_in', 'completed'].includes(b.status)) return b; // already handled

  // mark the one payment attempt that succeeded (a guest may have tried M-Pesa, then card)
  const p = db.prepare(`SELECT id FROM payments WHERE booking_ref=? AND status IN ('pending','expired','failed')
    AND (? IS NULL OR method=?) ORDER BY (status='pending') DESC, id DESC LIMIT 1`).get(ref, method || null, method || null);
  if (p) db.prepare("UPDATE payments SET status='success', transaction_id=? WHERE id=?").run(transactionId || 'SIM', p.id);
  else db.prepare('INSERT INTO payments (booking_ref,amount,method,status,transaction_id,created_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)')
    .run(ref, b.total, method || 'unknown', 'success', transactionId || 'SIM');

  // Paid after the 5-minute hold lapsed (or was cancelled): keep it only if the unit is still free.
  if (b.status !== 'held') {
    const stillFree = findAvailable({ checkIn: b.check_in, checkOut: b.check_out }).some(u => u.id === b.unit_id);
    if (!stillFree) {
      db.prepare("UPDATE bookings SET status='refund_due' WHERE ref=?").run(ref);
      await sendSMS(b.guest_phone, `We received KES ${b.total} for ${ref}, but ${b.unit_name} was taken after your hold expired. ` +
        `Amina will refund you shortly. Sorry!`);
      await sendSMS(process.env.AMINA_PHONE, `REFUND DUE: ${ref}, KES ${b.total} to ${b.guest_phone} (paid after hold expired).`);
      return getBooking(ref);
    }
    db.prepare("UPDATE bookings SET status='held' WHERE ref=?").run(ref);
  }

  b = confirmBooking(ref);
  await sendSMS(b.guest_phone,
    `Booked! Ref ${b.ref}. ${b.unit_name}, ${b.check_in} to ${b.check_out}. Total KES ${b.total}. ` +
    `Check-in details arrive the morning of ${b.check_in}.`);
  return b;
}

async function onPaymentFailed(ref, method) {
  db.prepare("UPDATE payments SET status='failed' WHERE booking_ref=? AND status='pending' AND (? IS NULL OR method=?)").run(ref, method || null, method || null);
  const b = getBooking(ref);
  if (b && b.status === 'held')
    await sendSMS(b.guest_phone, `Your ${method === 'card' ? 'card' : 'M-Pesa'} payment for ${ref} didn't go through. Your hold lasts a few more minutes — try booking again.`);
}

// ---------- Card checkout (foreign guests) ----------
// Provider interface: create({ ref, amount, phone, token }) -> { checkoutUrl } | { error }.
// Guests are always sent to a hosted page, so card numbers never touch this server.
// Only 'simulate' exists today; a real provider (e.g. Paystack hosted checkout) slots in here,
// with its webhook calling onPaymentSuccess(ref, txId, 'card').
const publicBase = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const CARD_PROVIDERS = {
  simulate: { async create({ token }) { return { checkoutUrl: `${publicBase()}/pay/card/${token}` }; } }
};

async function requestCard(ref, phone, amount) {
  const name = (process.env.CARD_PROVIDER || 'simulate').toLowerCase();
  const provider = CARD_PROVIDERS[name];
  if (!provider) return { error: `Card provider "${name}" is not set up` };
  const token = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO payments (booking_ref,amount,method,status,checkout_token,created_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)')
    .run(ref, amount, 'card', 'pending', token);
  try { return await provider.create({ ref, amount, phone, token }); }
  catch (e) { console.error('Card checkout error:', e.message); return { error: e.message }; }
}

const isKenyan = phone => /^\+254/.test(phone || '');

// One entry point for every channel. method: 'mpesa' | 'card' | undefined (auto: Kenyan number -> M-Pesa, else card)
async function collectPayment(ref, phone, amount, method) {
  const m = method === 'card' || method === 'mpesa' ? method : (isKenyan(phone) ? 'mpesa' : 'card');
  if (m === 'mpesa' && !isKenyan(phone)) return { method: m, error: 'M-Pesa needs a Kenyan (+254) number — please pay by card.' };
  return { method: m, ...(m === 'mpesa' ? await requestMpesa(ref, phone, amount) : await requestCard(ref, phone, amount)) };
}

// For SMS / USSD / voice: start payment and return wording for the guest.
// Card links go out by SMS (a USSD screen or a phone call can't show a link).
async function startRemotePayment(ref, phone, amount) {
  const r = await collectPayment(ref, phone, amount);
  if (r.error) return { ...r, text: `We couldn't start payment (${r.error}). Your hold lasts 5 minutes — please try again.` };
  if (r.method === 'card') {
    await sendSMS(phone, `Pay KES ${amount} by card for booking ${ref} here (valid 5 minutes): ${r.checkoutUrl}`);
    return { ...r, text: `We've texted you a secure card payment link for KES ${amount}.` };
  }
  return { ...r, text: `Check your phone for an M-Pesa prompt for KES ${amount}.` };
}

function cardPayment(token) {
  return db.prepare(`SELECT p.*, b.status booking_status, b.expires_at, b.check_in, b.check_out, b.guest_phone, u.name unit_name
    FROM payments p JOIN bookings b ON b.ref=p.booking_ref JOIN units u ON u.id=b.unit_id
    WHERE p.checkout_token=? AND p.method='card'`).get(token);
}

module.exports = { requestMpesa, requestCard, collectPayment, startRemotePayment, cardPayment, isKenyan, onPaymentSuccess, onPaymentFailed };
