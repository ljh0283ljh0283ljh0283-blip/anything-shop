// 구글 시트에 있는 SEKI POmall 자료를 회사 서버로 옮깁니다.
//
//   node import.js --url <Apps Script 주소> --key <관리자 열쇠>
//       지금 쓰는 Apps Script에서 바로 받아 옵니다. Apps Script에 최신 pomall-script.gs(내보내기 기능 포함)가 배포되어 있어야 합니다.
//   node import.js --file export.json
//       미리 받아 둔 파일에서 옮깁니다.
//   --save export.json 을 붙이면 받아 온 내용을 파일로도 남깁니다(백업).
//   --force 를 붙이면 회사 서버에 이미 있는 발주·거래처·상태 기록을 지우고 새로 옮깁니다.
//
// 비밀번호는 암호화된 그대로 옮기므로 거래처는 쓰던 비밀번호로 로그인합니다.
// 발주서 첨부 파일은 구글 드라이브 링크를 그대로 둡니다(드라이브에 파일이 남아 있는 동안 열립니다).

'use strict';
const fs = require('node:fs');
const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--force') opt.force = true;
  else if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
}

(async () => {
  let data;
  if (opt.file) data = JSON.parse(fs.readFileSync(opt.file, 'utf8'));
  else if (opt.url && opt.key) {
    const r = await fetch(opt.url, { method: 'POST', body: JSON.stringify({ action: 'export', key: opt.key }) });
    data = await r.json();
  } else {
    console.log('사용법: node import.js --url <Apps Script 주소> --key <관리자 열쇠>   또는   node import.js --file export.json');
    process.exit(1);
  }
  if (!data || !data.ok) { console.error('받아 오지 못했어요: ' + ((data && data.error) || '알 수 없는 오류') + '\nApps Script에 최신 pomall-script.gs를 붙여 넣고 새 버전으로 배포했는지 확인해 주세요.'); process.exit(1); }
  if (opt.save) { fs.writeFileSync(opt.save, JSON.stringify(data, null, 1)); console.log('받아 온 내용을 ' + opt.save + ' 에 저장했어요.'); }

  const { db } = require('./server.js');
  const count = t => db.prepare('SELECT COUNT(*) AS n FROM ' + t).get().n;
  if ((count('orders') || count('customers')) && !opt.force) {
    console.error('회사 서버에 이미 자료가 있어요. 지우고 새로 옮기려면 --force 를 붙여 주세요.');
    process.exit(1);
  }
  // 시트에서 수식으로 읽히지 않게 앞에 붙였던 ' 표시를 뗀다
  const txt = v => { v = v == null ? '' : String(v); return v.startsWith("'") ? v.slice(1) : v; };
  const num = v => Number(v) || 0;

  db.exec('BEGIN');
  try {
    if (opt.force) db.exec('DELETE FROM orders; DELETE FROM customers; DELETE FROM status_log;');
    const lineOf = {};
    const ins = db.prepare(`INSERT OR REPLACE INTO orders (no, line, created_at, code, company, contact, phone, customer_po, address, memo, requested_date, eta,
      spec_code, model, len, temp, qty, unit, amount, item_memo, total, status, updated_at, ship_date, attachment, len2, finish, strip, strip2, pin, speed, terminal)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    data.orders.forEach(r => {
      const no = txt(r['발주번호']); if (!no) return;
      const line = num(r['줄']) || (lineOf[no] = (lineOf[no] || 0) + 1);
      ins.run(no, line, txt(r['접수 시각']), txt(r['거래처 코드']).toUpperCase(), txt(r['거래처']), txt(r['담당자']), txt(r['연락처']), txt(r['거래처 PO']),
        txt(r['납품 주소']), txt(r['요청 사항']), txt(r['희망 출하일']), txt(r['최단 출하일']), txt(r['사양 코드']), txt(r['모델']), num(r['와이어(mm)']),
        num(r['온도(°C)']), num(r['수량']), num(r['단가']), num(r['금액']), txt(r['품목 메모']), num(r['발주 합계(VAT 포함)']), txt(r['상태']) || '접수 대기',
        txt(r['바뀐 시각']), txt(r['확정 출하일']), txt(r['발주서']), num(r['와이어2(mm)']), txt(r['마감']), num(r['탈피(mm)']), num(r['탈피2(mm)']), num(r['핀 길이(mm)']), txt(r['전류감응속도']), txt(r['터미널방향']));
    });
    const insC = db.prepare('INSERT OR REPLACE INTO customers (code, no, name, contact, phone, address, hash, active, discount, prices, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    data.customers.forEach(c => insC.run(String(c.code).toUpperCase(), num(c.no), txt(c.name), txt(c.contact), txt(c.phone), txt(c.address), String(c.hash || ''),
      c.active ? 1 : 0, num(c.discount), JSON.stringify(c.prices || {}), new Date().toISOString()));
    const insL = db.prepare('INSERT INTO status_log (at, no, company, from_status, to_status, by, role, reason) VALUES (?,?,?,?,?,?,?,?)');
    (data.log || []).forEach(l => insL.run(l.at, l.no, txt(l.company), l.from, l.to, txt(l.by), l.role, txt(l.reason)));
    const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    if (data.lead) set.run('LEAD', JSON.stringify(data.lead));
    if (data.custSeq) set.run('CUST_SEQ', String(data.custSeq));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  const orders = db.prepare('SELECT COUNT(DISTINCT no) AS n FROM orders').get().n;
  console.log('옮기기 끝: 발주 ' + orders + '건(' + count('orders') + '줄), 거래처 ' + count('customers') + '곳, 상태 기록 ' + count('status_log') + '줄');
})().catch(e => { console.error('옮기지 못했어요:', e.message); process.exit(1); });
