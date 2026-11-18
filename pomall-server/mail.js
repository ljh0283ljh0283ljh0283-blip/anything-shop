// 메일 보내기 (비밀번호 찾기 인증번호용). 따로 설치할 패키지 없이 SMTP로 보낸다.
// config.json 의 mail 칸:
//   host  메일 서버 주소 (예: smtp.gmail.com, 회사 메일이면 메일 관리자에게 SMTP 주소를 물어본다)
//   port  465(SSL) 또는 587(STARTTLS). 비우면 465
//   user  로그인 아이디 (보통 메일 주소)
//   pass  비밀번호 (Gmail은 "앱 비밀번호")
//   from  보내는 사람 메일 주소 (비우면 user)
//   name  보내는 사람 이름 (비우면 SEKI POmall)

'use strict';
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');

const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');
const word = s => /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + b64(s) + '?=';
const addr = s => String(s || '').replace(/[\r\n<>]/g, '').trim();

function mailReady(m) { return !!(m && m.host && (m.from || m.user)); }

function sendMail(m, { to, subject, text }) {
  return new Promise((resolve, reject) => {
    const port = Number(m.port) || 465, secure = m.secure != null ? !!m.secure : port === 465;
    const tlsOpt = { servername: m.host, rejectUnauthorized: m.rejectUnauthorized !== false };
    const from = addr(m.from || m.user), rcpt = addr(to);
    let sock, buf = '', done = false;
    const replies = [], waiters = [];
    const timer = setTimeout(() => finish(new Error('메일 서버가 30초 동안 대답하지 않아요.')), 30000);
    function finish(err) {
      if (done) return; done = true; clearTimeout(timer);
      try { sock && sock.end(); } catch (e) { /* 무시 */ }
      err ? reject(err) : resolve();
    }
    function onData(d) {
      buf += d.toString('utf8');
      let x;
      while ((x = buf.match(/^((?:\d{3}-[^\r\n]*\r?\n)*)(\d{3})(?: [^\r\n]*)?\r?\n/))) {
        buf = buf.slice(x[0].length);
        const r = { code: Number(x[2]), text: x[0].trim() };
        waiters.length ? waiters.shift()(r) : replies.push(r);
      }
    }
    function attach(s) { sock = s; s.on('data', onData); s.on('error', finish); }
    const next = () => new Promise(r => replies.length ? r(replies.shift()) : waiters.push(r));
    async function say(line, ok) {
      if (line != null) sock.write(line + '\r\n');
      const r = await next();
      if (!ok.includes(r.code)) throw new Error('메일 서버가 거절했어요: ' + r.text.replace(/\s+/g, ' ').slice(0, 200));
      return r;
    }
    (async () => {
      attach(secure ? tls.connect(port, m.host, tlsOpt) : net.connect(port, m.host));
      await say(null, [220]);
      let ehlo = await say('EHLO pomall', [250]);
      if (!secure && /STARTTLS/i.test(ehlo.text)) {
        await say('STARTTLS', [220]);
        sock.removeAllListeners('data'); sock.removeAllListeners('error');
        const plain = sock;
        await new Promise((ok, no) => { const t = tls.connect(Object.assign({ socket: plain }, tlsOpt), ok); t.on('error', no); attach(t); });
        ehlo = await say('EHLO pomall', [250]);
      }
      if (m.user) {
        await say('AUTH LOGIN', [334]);
        await say(b64(m.user), [334]);
        await say(b64(m.pass || ''), [235]);
      }
      await say('MAIL FROM:<' + from + '>', [250]);
      await say('RCPT TO:<' + rcpt + '>', [250, 251]);
      await say('DATA', [354]);
      const body = b64(text).replace(/.{1,76}/g, '$&\r\n');
      const msg = [
        'From: ' + word(m.name || 'SEKI POmall') + ' <' + from + '>',
        'To: <' + rcpt + '>',
        'Subject: ' + word(subject),
        'Date: ' + new Date().toUTCString().replace('GMT', '+0000'),
        'Message-ID: <' + crypto.randomUUID() + '@' + (from.split('@')[1] || 'pomall') + '>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '', body + '.'
      ].join('\r\n');
      await say(msg, [250]);
      sock.write('QUIT\r\n');
      finish();
    })().catch(finish);
  });
}

module.exports = { sendMail, mailReady };
