// Call Amina — the voice line (Africa's Talking Voice). Also answers the outbound
// safety call placed to Amina. Point the AT voice number's callback URL at POST /voice.
const express = require('express');
const db = require('./db');
const { findAvailable } = require('./availability');
const { createHold } = require('./bookings');
const { startRemotePayment } = require('./payments');
const { sendSMS } = require('./sms');
const { today, addDays, weekendStart } = require('./dates');
const { escalate, guestContext, getAlert, latestOpenAlert, resolveAlert } = require('./safety');

const router = express.Router();
const sessions = new Map(); // sessionId -> { lang, step, ... }  (calls are short; memory is fine)

const T = {
  en: {
    welcome: 'Welcome to Amina Stays. For English, press 1. Kwa Kiswahili, bonyeza 2.',
    main: 'Press 1 to check availability and book. Press 2 to ask Amina a question. Press 3 to hear your booking. Press 9 at any time for urgent help.',
    when: 'When would you like to stay? Press 1 for tonight. Press 2 for this weekend. Press 3 to choose a specific date by text message.',
    nights: 'How many nights? Press a number from 1 to 7.',
    byText: 'We have sent you a text message. Just reply with your dates, for example 2026-12-05 for 2 nights. Goodbye.',
    none: "Sorry, nothing is free for those dates. We will text you if something opens up. Goodbye.",
    option: (i, u) => `Press ${i} for ${u.name} in ${u.area}, ${u.price} shillings a night.`,
    held: (u, total) => `We are holding ${u.name} for you. The total is ${total} shillings. An M-Pesa prompt is coming to this phone now. Your confirmation will arrive by text message. Asante, goodbye.`,
    heldCard: (u, total) => `We are holding ${u.name} for you. The total is ${total} shillings. We have sent a card payment link to this phone by text message. Please pay within 5 minutes. Goodbye.`,
    ask: 'Press 1 to be connected to Amina now. Press 2 to leave her a voice message.',
    connecting: 'Connecting you to Amina. Please hold.',
    record: 'Please leave your message after the beep, then press the hash key.',
    recorded: 'Thank you. Amina will get back to you. Goodbye.',
    noBooking: 'We could not find a booking for this number. Goodbye.',
    booking: b => `Your booking at ${b.unit_name} runs from ${b.check_in} to ${b.check_out}. Reference ${b.ref.split('').join(' ')}. Status: ${b.status.replace('_', ' ')}. Goodbye.`,
    help: 'We are alerting Amina now and connecting you to her. If you are in danger, hang up and call 9 9 9 or 1 1 2.',
    invalid: 'Sorry, that is not a valid choice.',
    noInput: 'We did not receive any input. Goodbye.',
    error: 'Sorry, something went wrong. Please try again later.'
  },
  sw: {
    main: 'Bonyeza 1 kuangalia nafasi na kuweka nafasi. Bonyeza 2 kumuuliza Amina swali. Bonyeza 3 kusikia nafasi yako. Bonyeza 9 wakati wowote kwa msaada wa dharura.',
    when: 'Ungependa kukaa lini? Bonyeza 1 kwa leo usiku. Bonyeza 2 kwa wikendi hii. Bonyeza 3 kuchagua tarehe kwa ujumbe mfupi.',
    nights: 'Usiku ngapi? Bonyeza nambari kati ya 1 na 7.',
    byText: 'Tumekutumia ujumbe mfupi. Jibu na tarehe zako, kwa mfano 2026-12-05 for 2 nights. Kwaheri.',
    none: 'Samahani, hakuna nafasi kwa tarehe hizo. Tutakutumia ujumbe nafasi ikipatikana. Kwaheri.',
    option: (i, u) => `Bonyeza ${i} kwa ${u.name}, ${u.area}, shilingi ${u.price} kwa usiku.`,
    held: (u, total) => `Tumekuwekea ${u.name}. Jumla ni shilingi ${total}. Ombi la M-Pesa linakuja kwenye simu hii sasa. Uthibitisho utakuja kwa ujumbe mfupi. Asante, kwaheri.`,
    heldCard: (u, total) => `Tumekuwekea ${u.name}. Jumla ni shilingi ${total}. Tumekutumia kiungo cha kulipa kwa kadi kwa ujumbe mfupi. Tafadhali lipa ndani ya dakika 5. Kwaheri.`,
    ask: 'Bonyeza 1 kuunganishwa na Amina sasa. Bonyeza 2 kumwachia ujumbe wa sauti.',
    connecting: 'Tunakuunganisha na Amina. Tafadhali subiri.',
    record: 'Tafadhali acha ujumbe wako baada ya mlio, kisha bonyeza alama ya reli.',
    recorded: 'Asante. Amina atakujibu. Kwaheri.',
    noBooking: 'Hatukupata nafasi yoyote kwa nambari hii. Kwaheri.',
    booking: b => `Nafasi yako ni ${b.unit_name} kuanzia ${b.check_in} hadi ${b.check_out}. Nambari ya kumbukumbu ${b.ref.split('').join(' ')}. Kwaheri.`,
    help: 'Tunamjulisha Amina sasa na kukuunganisha naye. Ukiwa hatarini, kata simu na piga 9 9 9 au 1 1 2.',
    invalid: 'Samahani, chaguo hilo si sahihi.',
    noInput: 'Hatukupokea jibu lolote. Kwaheri.',
    error: 'Samahani, kuna tatizo. Tafadhali jaribu tena baadaye.'
  }
};

// ---------- tiny XML helpers ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cb = () => process.env.PUBLIC_URL ? ` callbackUrl="${esc(process.env.PUBLIC_URL.replace(/\/$/, '') + '/voice')}"` : '';
const say = t => `<Say>${esc(t)}</Say>`;
const xml = inner => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
const ask = (prompt, noInput, digits = 1) =>
  xml(`<GetDigits timeout="15" numDigits="${digits}" finishOnKey="#"${cb()}>${say(prompt)}</GetDigits>${say(noInput)}`);
const dial = (prompt, number) => xml(`${say(prompt)}<Dial phoneNumbers="${esc(number)}" record="false" sequential="true"/>`);
const end = t => xml(say(t));

function unitsFor(s) {
  return findAvailable({ checkIn: s.checkIn, checkOut: s.checkOut }).slice(0, 5);
}

// ---------- the inbound menu (one step per callback) ----------
async function inbound(s, phone, digit) {
  const t = T[s.lang || 'en'];

  // 9 at any point after the language choice: straight to Amina
  if (digit === '9' && s.step !== 'lang') {
    const a = await escalate(phone, 'voice', { call: false }); // we bridge this call ourselves
    s.alertId = a.id; s.dialedAmina = true; s.step = 'help';
    return dial(t.help, process.env.AMINA_PHONE);
  }

  switch (s.step) {
    case undefined:
      s.step = 'lang';
      return ask(T.en.welcome, T.en.noInput);

    case 'lang':
      s.lang = digit === '2' ? 'sw' : 'en';
      s.step = 'main';
      {
        const back = db.prepare(`SELECT g.name FROM bookings b LEFT JOIN guests g ON g.phone=b.guest_phone
          WHERE b.guest_phone=? AND b.status IN ('confirmed','checked_in','completed') LIMIT 1`).get(phone);
        const first = back && back.name ? ' ' + back.name.split(' ')[0] : '';
        const hello = back ? (s.lang === 'sw' ? `Karibu tena${first}. ` : `Welcome back${first}. `) : '';
        return ask(hello + T[s.lang].main, T[s.lang].noInput);
      }

    case 'main':
      if (digit === '1') { s.step = 'when'; return ask(t.when, t.noInput); }
      if (digit === '2') { s.step = 'ask'; return ask(t.ask, t.noInput); }
      if (digit === '3') {
        const b = db.prepare(`SELECT b.*, u.name unit_name FROM bookings b JOIN units u ON u.id=b.unit_id
          WHERE guest_phone=? AND status IN ('held','confirmed','checked_in') ORDER BY b.check_in LIMIT 1`).get(phone);
        return end(b ? t.booking(b) : t.noBooking);
      }
      return ask(t.invalid + ' ' + t.main, t.noInput);

    case 'when':
      if (digit === '1') { s.checkIn = today(); s.step = 'nights'; return ask(t.nights, t.noInput); }
      if (digit === '2') { s.checkIn = weekendStart(); s.checkOut = addDays(s.checkIn, 2); return listUnits(s, phone); }
      if (digit === '3') {
        db.prepare(`INSERT INTO conversations (phone,state,data,updated_at) VALUES (?,?,?,?)
          ON CONFLICT(phone) DO UPDATE SET state=excluded.state, data=excluded.data, updated_at=excluded.updated_at`)
          .run(phone, 'collecting', JSON.stringify({ via: 'voice' }), Date.now());
        await sendSMS(phone, "Hi from Amina-Stays! Which dates would you like? Reply e.g. '2026-12-05 for 2 nights' or 'this weekend'.");
        return end(t.byText);
      }
      return ask(t.invalid + ' ' + t.when, t.noInput);

    case 'nights': {
      const n = +digit;
      if (!(n >= 1 && n <= 7)) return ask(t.invalid + ' ' + t.nights, t.noInput);
      s.checkOut = addDays(s.checkIn, n);
      return listUnits(s, phone);
    }

    case 'pick': {
      const opt = s.options[+digit - 1];
      if (!opt) return ask(t.invalid + ' ' + s.prompt, t.noInput);
      const hold = createHold({ unitId: opt.id, guestPhone: phone, checkIn: s.checkIn, checkOut: s.checkOut, channel: 'voice' });
      if (hold.error) return end(hold.error);
      const pay = await startRemotePayment(hold.ref, phone, hold.total); // STK push (or card link by SMS) to the caller
      return end(pay.method === 'card' ? t.heldCard(hold.unit, hold.total) : t.held(hold.unit, hold.total));
    }

    case 'ask':
      if (digit === '1') { s.step = 'live'; s.dialedAmina = true; return dial(t.connecting, process.env.AMINA_PHONE); }
      if (digit === '2') {
        s.step = 'record';
        return xml(`<Record finishOnKey="#" maxLength="90" trimSilence="true" playBeep="true"${cb()}>${say(t.record)}</Record>${say(t.recorded)}`);
      }
      return ask(t.invalid + ' ' + t.ask, t.noInput);

    default:
      return end(t.recorded);
  }
}

function listUnits(s, phone) {
  const t = T[s.lang || 'en'];
  const units = unitsFor(s);
  if (!units.length) {
    db.prepare('INSERT INTO waitlist (phone,check_in,check_out,area) VALUES (?,?,?,?)').run(phone, s.checkIn, s.checkOut, '');
    return end(t.none);
  }
  s.options = units.map(u => ({ id: u.id }));
  s.prompt = units.map((u, i) => t.option(i + 1, u)).join(' ');
  s.step = 'pick';
  return ask(s.prompt, t.noInput);
}

// ---------- the outbound safety call, when Amina picks up ----------
function aminaAlertCall(s, body, digit) {
  const alert = (s.alertId && getAlert(s.alertId)) || latestOpenAlert();
  if (!alert) return end('Amina Stays alert. No open alerts. Goodbye.');
  s.alertId = alert.id;
  if (digit === '1') { resolveAlert(alert.id); return dial('Connecting you to the guest now.', alert.phone); }
  s.step = 'alert';
  const ctx = guestContext(alert.phone);
  const spoken = ctx.who.replace(/\+?\d{6,}/g, n => n.replace('+', '').split('').join(' ')); // read digits one by one
  return ask(`Urgent alert from Amina Stays. Guest ${spoken}, ${ctx.where}, needs help. ` +
    'Press 1 to be connected to the guest now.', 'The guest details have also been sent to you by text. Goodbye.');
}

// ---------- end-of-call notification ----------
async function callEnded(s, body, phone) {
  if (s.dialedAmina && !(+body.dialDurationInSeconds > 0)) {
    // Amina didn't pick up: fall back so the guest is never left hanging
    if (s.step === 'help') {
      await escalate(phone, 'voice-missed'); // now place the outbound call to Amina too
      await sendSMS(phone, "Amina didn't answer yet — we're calling her again. If you are in danger call 999 or 112.");
    } else {
      await sendSMS(process.env.AMINA_PHONE, `Missed call from guest ${phone} wanting to talk. Please call back.`);
      await sendSMS(phone, "Amina couldn't pick up just now. Text your question to this number and she'll reply here.");
    }
  }
}

async function voicemail(s, phone, url) {
  if (s.voicemailSent) return;
  s.voicemailSent = true;
  db.prepare('INSERT INTO messages (phone,text,direction,handled) VALUES (?,?,?,?)').run(phone, `[voicemail] ${url}`, 'in', 'relayed');
  await sendSMS(process.env.AMINA_PHONE, `Voicemail from guest ${phone}: ${url}`);
}

router.post('/voice', async (req, res) => {
  const b = req.body;
  const id = b.sessionId;
  const digit = (b.dtmfDigits || '').trim();
  const outbound = (b.direction || '').toLowerCase() === 'outbound';
  const phone = outbound ? b.destinationNumber : b.callerNumber;
  if (!sessions.has(id)) sessions.set(id, { outbound, startedAt: Date.now() });
  const s = sessions.get(id);
  res.set('Content-Type', 'application/xml');

  try {
    if (b.recordingUrl && s.step === 'record') await voicemail(s, phone, b.recordingUrl);

    if (b.isActive === '0') {
      sessions.delete(id);
      if (!outbound) await callEnded(s, b, phone);
      return res.send(xml(''));
    }

    if (outbound) {
      const m = String(b.clientRequestId || '').match(/^alert-(\d+)$/);
      if (m) s.alertId = +m[1];
      return res.send(aminaAlertCall(s, b, digit));
    }

    db.prepare('INSERT OR IGNORE INTO guests (phone) VALUES (?)').run(phone);
    res.send(await inbound(s, phone, digit));
  } catch (e) {
    console.error('Voice error:', e);
    res.send(end(T[s.lang || 'en'].error));
  }
});

// drop abandoned sessions
setInterval(() => {
  for (const [k, v] of sessions) if (Date.now() - v.startedAt > 30 * 60 * 1000) sessions.delete(k);
}, 10 * 60 * 1000).unref();

module.exports = router;
