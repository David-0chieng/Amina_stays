require('dotenv').config();
const AfricasTalking = require('africastalking');
const db = require('./db');

const at = AfricasTalking({ username: process.env.AT_USERNAME, apiKey: process.env.AT_API_KEY });

// Every outbound SMS is logged, including failures, so nothing silently disappears.
async function sendSMS(to, message) {
  if (!to) { console.error('SMS skipped (no recipient):', message); return; }
  const log = handled => db.prepare('INSERT INTO messages (phone,text,direction,handled) VALUES (?,?,?,?)')
    .run(to, message, 'out', handled);
  try {
    const opts = { to: [to], message };
    if (process.env.AT_SENDER_ID) opts.from = process.env.AT_SENDER_ID;
    const res = await at.SMS.send(opts);
    console.log(`SMS -> ${to}: ${message}\n  result:`, JSON.stringify(res.SMSMessageData));
    const r = res.SMSMessageData && res.SMSMessageData.Recipients && res.SMSMessageData.Recipients[0];
    log(r && r.status !== 'Success' ? 'failed' : 'auto');
    return res;
  } catch (e) {
    console.error(`SMS error -> ${to}: ${e.message} | ${message}`);
    log('failed');
  }
}

module.exports = { at, sendSMS };
