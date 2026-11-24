const db = require('./db');
const { findAvailable } = require('./availability');
const { createHold } = require('./bookings');
const { startRemotePayment } = require('./payments');
const { sendSMS } = require('./sms');
const { today, addDays, weekendStart } = require('./dates');
const { checkout } = require('./lifecycle');
const { escalate } = require('./safety');

const samePhone = (a, b) => a && b && a.replace(/\D/g, '').slice(-9) === b.replace(/\D/g, '').slice(-9);
const threadId = phone => {
  db.prepare('INSERT OR IGNORE INTO guests (phone) VALUES (?)').run(phone);
  return db.prepare('SELECT rowid id FROM guests WHERE phone=?').get(phone).id;
};

// Amina replies from her own phone. "#12 text" goes to thread 12; plain text goes to
// whoever was last relayed to her. One thread per guest, no channel juggling.
async function handleAminaReply(text) {
  let to, body = text;
  const m = text.match(/^#(\d+)\s+([\s\S]+)/);
  if (m) {
    const g = db.prepare('SELECT phone FROM guests WHERE rowid=?').get(+m[1]);
    if (!g) return sendSMS(process.env.AMINA_PHONE, `No guest thread #${m[1]}.`);
    to = g.phone; body = m[2];
  } else {
    const last = db.prepare("SELECT phone FROM messages WHERE direction='in' AND handled='relayed' ORDER BY id DESC LIMIT 1").get();
    if (!last) return sendSMS(process.env.AMINA_PHONE, 'No guest question to reply to. Start with #<thread> to pick a guest.');
    to = last.phone;
  }
  db.prepare("UPDATE messages SET handled='answered' WHERE phone=? AND direction='in' AND handled='relayed'").run(to);
  return sendSMS(to, `Amina: ${body}`);
}

const AREAS = ['nyali', 'diani', 'old town', 'mtwapa', 'bamburi'];

function getConvo(phone) {
  const r = db.prepare('SELECT * FROM conversations WHERE phone=?').get(phone);
  return r ? { state: r.state, data: JSON.parse(r.data) } : { state: 'idle', data: {} };
}
function setConvo(phone, state, data) {
  db.prepare(`INSERT INTO conversations (phone,state,data,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(phone) DO UPDATE SET state=excluded.state, data=excluded.data, updated_at=excluded.updated_at`)
    .run(phone, state, JSON.stringify(data), Date.now());
}

// Simple keyword/pattern extraction
function parseRequest(text) {
  const t = text.toLowerCase(), out = {};
  const area = AREAS.find(a => t.includes(a));
  if (area) out.area = area;
  const g = t.match(/(\d+)\s*(people|persons|guests|pax|adults)|for\s+(\d+)/);
  if (g) out.guests = +(g[1] || g[3]);
  const n = t.match(/(\d+)\s*night/);
  const isoDate = t.match(/\d{4}-\d{2}-\d{2}/);
  if (isoDate) { out.checkIn = isoDate[0]; out.checkOut = addDays(isoDate[0], n ? +n[1] : 1); }
  else if (t.includes('tonight')) { out.checkIn = today(); out.checkOut = addDays(today(), n ? +n[1] : 1); }
  else if (t.includes('tomorrow')) { const s = addDays(today(), 1); out.checkIn = s; out.checkOut = addDays(s, n ? +n[1] : 1); }
  else if (t.includes('weekend')) { const s = weekendStart(); out.checkIn = s; out.checkOut = addDays(s, 2); }
  return out;
}

// A guest who has stayed (or booked) before, with what we remember about them
function returningGuest(phone) {
  const prev = db.prepare(`SELECT unit_id FROM bookings WHERE guest_phone=? AND status IN ('confirmed','checked_in','completed')
    ORDER BY id DESC LIMIT 1`).get(phone);
  if (!prev) return null;
  const g = db.prepare('SELECT name, last_area, last_guests FROM guests WHERE phone=?').get(phone) || {};
  return { ...g, last_unit: prev.unit_id };
}

const looksLikeBooking = t => /\b(free|available|availability|vacan|book|stay|room|apartment|same as last time|the usual)\b/i.test(t);

function autoAnswer(from, text) {
    const b = db.prepare(`SELECT b.*, u.name unit_name, u.wifi, u.directions FROM bookings b
      JOIN units u ON u.id=b.unit_id WHERE b.guest_phone=? AND b.status IN ('confirmed','checked_in')
      ORDER BY b.check_in LIMIT 1`).get(from);
    if (!b) return null;
    const t = text.toLowerCase();
    if (/wifi|wi-fi|internet|password/.test(t)) return `Wifi at ${b.unit_name}: ${b.wifi}`;
    if (/direction|where|address|location/.test(t)) return `${b.unit_name}: ${b.directions}`;
    if (/check.?out|leave|leaving/.test(t)) return `Checkout is by ${+process.env.CHECKOUT_HOUR || 11}am on ${b.check_out}. Reply CHECKOUT when you leave.`;
    if (/check.?in|arriv|when can i/.test(t)) return `Check-in is from 2pm on ${b.check_in}. Your door code arrives by SMS that morning.`;
    return null;
  }

async function handleSms(from, raw) {
  const text = raw.trim();

  // Messages from Amina herself are replies to guests, not guest requests
  if (samePhone(from, process.env.AMINA_PHONE)) return handleAminaReply(text);

  // Safety word: skips every queue and places an immediate voice call to Amina
  if (/^(help|msaada|sos)\b/i.test(text)) {
    db.prepare("UPDATE messages SET handled='escalated' WHERE phone=? AND direction='in' AND handled='pending'").run(from);
    const a = await escalate(from, 'sms');
    return sendSMS(from, (a.callStatus === 'Queued' ? 'We are calling Amina right now.' : 'Amina has been alerted urgently.') +
      ' She will contact you immediately. ' +
      'If you are in danger call 999 or 112 (police/ambulance).');
  }

  if (/^check\s?out$/i.test(text)) return sendSMS(from, await checkout(from));

  const convo = getConvo(from);

  // Post-stay review: "How was your stay? Reply 1–5"
  if (convo.state === 'review') {
    setConvo(from, 'idle', {});
    if (/^[1-5]$/.test(text)) {
      const rating = +text;
      db.prepare('INSERT OR IGNORE INTO reviews (booking_ref,phone,rating) VALUES (?,?,?)').run(convo.data.ref, from, rating);
      db.prepare("UPDATE messages SET handled='auto' WHERE phone=? AND direction='in' AND handled='pending'").run(from);
      if (rating <= 2) {
        await sendSMS(process.env.AMINA_PHONE, `Low review (${rating}/5) from ${from} for ${convo.data.ref}. Worth a call.`);
        return sendSMS(from, "We're sorry it wasn't great. Amina has been told and may reach out — reply here with anything we should fix.");
      }
      return sendSMS(from, `Asante sana for the ${rating}/5! We'd love to host you again — just text us next time.`);
    }
    // anything else: carry on as a normal message
  }

    // Waitlist offer: guest replies BOOK (first to hold wins)
    if (convo.state === 'offer' && /^book$/i.test(text)) {
        const { unitId, checkIn, checkOut } = convo.data;
        const hold = createHold({ unitId, guestPhone: from, checkIn, checkOut, channel: 'sms' });
        if (hold.error) {
          setConvo(from, 'idle', {});
          return sendSMS(from, 'Sorry, someone just grabbed it. We will keep you posted.');
        }
        setConvo(from, 'awaiting_payment', { ref: hold.ref });
        const pay = await startRemotePayment(hold.ref, from, hold.total);
        return sendSMS(from, `Holding ${hold.unit.name} for ${checkIn} to ${checkOut}. ${pay.text}`);
      }
    
      // Common questions answered from the guest's booking record
      if (!['showing', 'collecting'].includes(convo.state)) {
        const auto = autoAnswer(from, text);
        if (auto) {
          db.prepare('UPDATE messages SET handled=? WHERE phone=? AND direction=? AND handled=?')
            .run('auto', from, 'in', 'pending');
          return sendSMS(from, auto);
        }
      }

  // 1) Guest picked an option from a list we showed
  if (convo.state === 'showing' && /^\d$/.test(text)) {
    const opt = convo.data.options[+text - 1];
    if (opt) {
      const hold = createHold({ unitId: opt.id, guestPhone: from, checkIn: convo.data.checkIn,
                                checkOut: convo.data.checkOut, channel: 'sms' });
      if (hold.error) { setConvo(from, 'idle', {}); return sendSMS(from, hold.error); }
      setConvo(from, 'awaiting_payment', { ref: hold.ref });
      const pay = await startRemotePayment(hold.ref, from, hold.total);
      return sendSMS(from, `Holding ${opt.name} for ${convo.data.checkIn} to ${convo.data.checkOut}. ${pay.text}`);
    }
  }

  // 2) Booking attempt (new, or continuing to collect details)
  if (convo.state === 'collecting' || looksLikeBooking(text)) {
    const found = parseRequest(text);
    const data = { ...(convo.state === 'collecting' ? convo.data : {}), ...found };

    // Returning guests: greet them, and "same as last time" reuses their area / group size
    const g = returningGuest(from);
    if (g && /\b(same|usual|again|last time)\b/i.test(text)) {
      if (!data.area && g.last_area) data.area = g.last_area.toLowerCase();
      if (!data.guests && g.last_guests) data.guests = g.last_guests;
      found.returning = true;
    }
    if (found.guests) db.prepare('UPDATE guests SET last_guests=? WHERE phone=?').run(found.guests, from);
    const hello = g ? `Welcome back${g.name ? ', ' + g.name.split(' ')[0] : ''}! ` : '';

    if (convo.state === 'collecting' && Object.keys(found).length === 0) {
      setConvo(from, 'idle', {}); // reply didn't fit, fall through to question relay below
    } else if (!data.checkIn) {
      setConvo(from, 'collecting', data);
      return sendSMS(from, `${hello || 'Happy to help! '}Which dates? e.g. 'this weekend', 'tonight' or 2026-12-05 for 2 nights.`);
    } else {
      const units = findAvailable({ checkIn: data.checkIn, checkOut: data.checkOut,
                                    area: data.area, guests: data.guests })
        .sort((a, b) => (g && b.id === g.last_unit) - (g && a.id === g.last_unit)) // their old favourite first
        .slice(0, 3);
      if (units.length === 0) {
        db.prepare('INSERT INTO waitlist (phone,check_in,check_out,area) VALUES (?,?,?,?)')
          .run(from, data.checkIn, data.checkOut, data.area || '');
        setConvo(from, 'idle', {});
        return sendSMS(from, "Sorry, nothing is free for those dates. We'll text you if something opens up.");
      }
      setConvo(from, 'showing', { ...data, options: units.map(u => ({ id: u.id, name: u.name })) });
      const list = units.map((u, i) => `${i + 1}) ${u.name} - KES ${u.price}/night`).join(' ');
      return sendSMS(from, `${hello}Yes! ${list}. Reply ${units.map((_, i) => i + 1).join(', ')} to hold it.`);
    }
  }

  // 3) Everything else is a question: forward to Amina
  setConvo(from, 'idle', {});
  await sendSMS(process.env.AMINA_PHONE, `#${threadId(from)} Q from ${from}: ${text} (reply to answer)`);
  db.prepare('UPDATE messages SET handled=? WHERE phone=? AND direction=? AND handled=?')
    .run('relayed', from, 'in', 'pending');
  return sendSMS(from, 'Thanks! Amina will reply to you shortly.');
}

module.exports = { handleSms };