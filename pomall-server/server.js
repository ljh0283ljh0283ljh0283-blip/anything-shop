// SEKI POmall 회사 서버
// 구글 Apps Script(pomall/pomall-script.gs)가 하던 일을 회사 서버에서 그대로 합니다.
// 사이트(pomall/app.js)는 바뀌지 않습니다. settings.json의 orderUrl만 이 서버의 /api 로 바꾸면 됩니다.
// 이 서버가 사이트 화면도 함께 보여 줄 수 있습니다(config.json의 siteDir). 그때는 주소창에 서버 주소만 치면 됩니다.
//
// 자료는 dataDir 폴더 하나에 모입니다.
//   pomall.db   발주, 거래처, 상태 기록, 설정 (SQLite 파일 하나. 백업은 이 폴더를 복사하면 됩니다)
//   files/      거래처가 첨부한 발주서 파일
//
// 실행: node server.js   (Node.js 22.13 이상, 따로 설치할 패키지 없음)

'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// ----- 설정 -----
const CONFIG_FILE = process.env.POMALL_CONFIG || path.join(__dirname, 'config.json');
const cfg = Object.assign({
  port: 8080,
  dataDir: './data',
  productsFile: '../pomall/products.json',
  siteDir: '../pomall',
  publicUrl: '',          // 예: https://pomall.seki.co.kr  (발주서 링크에 쓰임. 비우면 요청 주소로 만든다)
  allowOrigin: '*',       // 사이트를 다른 주소(GitHub Pages)에 두면 그 주소, 예: https://ljh0283ljh0283ljh0283-blip.github.io
  backupDir: './backup',  // 매일 자동 백업할 폴더. 다른 디스크나 OneDrive 폴더로 바꾸면 더 안전하다. 비우면 백업 안 함
  backupDays: 30,         // 데이터베이스 백업을 며칠치 남길지
  adminKey: '', salesKey: '', viewKey: ''
}, fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : {});
// 열쇠는 환경 변수로도 줄 수 있다 (config.json에 적지 않으려면)
cfg.adminKey = process.env.ADMIN_KEY || cfg.adminKey;
cfg.salesKey = process.env.SALES_KEY || cfg.salesKey;
cfg.viewKey = process.env.VIEW_KEY || cfg.viewKey;
if (process.env.PORT) cfg.port = Number(process.env.PORT);
const here = p => path.resolve(path.dirname(CONFIG_FILE), p);
const DATA_DIR = here(cfg.dataDir), FILES_DIR = path.join(DATA_DIR, 'files');
const PRODUCTS_FILE = here(cfg.productsFile), SITE_DIR = cfg.siteDir ? here(cfg.siteDir) : '';

const STATUSES = ['접수 대기', '생산 지시', '생산 중', '입고 완료', '출하', '취소'];
const OLD_STATUS = { '생산 확정': '생산 지시', '출하 완료': '출하' };
const ROLES = { admin: '관리자', sales: '영업팀', view: '조회 전용' };
const ATTACH_TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  hwp: 'application/x-hwp', hwpx: 'application/hwp+zip' };
const ATTACH_MAX = 10 * 1024 * 1024;
const BODY_MAX = 16 * 1024 * 1024;   // 발주서 10MB를 글자로 바꾸면 약 14MB

// ----- 데이터베이스 -----
fs.mkdirSync(FILES_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'pomall.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS orders (           -- 구글 시트 '발주' 탭: 품목 하나가 한 줄
    no TEXT NOT NULL, line INTEGER NOT NULL, created_at TEXT NOT NULL,
    code TEXT, company TEXT, contact TEXT, phone TEXT, customer_po TEXT, address TEXT, memo TEXT,
    requested_date TEXT, eta TEXT, spec_code TEXT, model TEXT, len REAL, temp REAL, qty REAL, unit REAL, amount REAL,
    item_memo TEXT, total REAL, status TEXT, updated_at TEXT, ship_date TEXT, attachment TEXT,
    len2 REAL, finish TEXT, strip REAL, strip2 REAL,
    PRIMARY KEY (no, line));
  CREATE TABLE IF NOT EXISTS customers (        -- '거래처' 탭. prices는 {"ST-12": 200, ...}
    code TEXT PRIMARY KEY, no INTEGER, name TEXT, contact TEXT, phone TEXT, address TEXT,
    hash TEXT, active INTEGER, discount REAL, prices TEXT, updated_at TEXT);
  CREATE TABLE IF NOT EXISTS status_log (       -- '상태 기록' 탭
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, no TEXT, company TEXT, from_status TEXT, to_status TEXT, by TEXT, role TEXT, reason TEXT);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);  -- LEAD(생산 소요일), CUST_SEQ(마지막 거래처 번호)
`);
// 나중에 생긴 칸은 예전 자료에도 붙인다
for (const [c, t] of [['pin', 'REAL'], ['speed', 'TEXT'], ['terminal', 'TEXT']])
  if (!db.prepare('PRAGMA table_info(orders)').all().some(x => x.name === c)) db.exec('ALTER TABLE orders ADD COLUMN ' + c + ' ' + t);
const q = sql => db.prepare(sql);
function getSetting(k) { const r = q('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; }
function setSetting(k, v) { q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v)); }
function tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } }

// ----- 작은 도우미 -----
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const digits = v => String(v || '').replace(/\D/g, '');
const kst = (d = new Date()) => new Date(d.getTime() + 9 * 3600000).toISOString();   // 한국 시간 "2026-10-16T09:30:00.000Z" 꼴
const statusOf = v => { v = String(v || STATUSES[0]); return OLD_STATUS[v] || v; };
function catalog() { return JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8')); }
function findProduct(C, id) { return C.products.find(p => p.id === id) || null; }
function specCode(model, len, temp, len2, finish) {
  const p3 = n => String(n).padStart(3, '0');
  return model + (len ? '-L' + p3(len) : '') + (len2 ? '-L' + p3(len2) : '') + '-T' + p3(temp) + (finish ? '-' + finish : '');
}
const okStrip = (v, len) => v === 0 || (v > 0 && v < len && Math.abs(Math.round(v * 10) - v * 10) < 1e-9);
const okLen = (C, v) => v >= C.length.min && v <= C.length.max && v % C.length.step === 0;
const unitPrice = (base, discount) => Math.round(base * (1 - (discount || 0) / 100) * 10) / 10;
function addBizDays(n) {
  const d = new Date(kst().slice(0, 10) + 'T00:00:00Z'); let k = 0;
  while (k < n) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6) k++; }
  return d.toISOString().slice(0, 10);
}
function hash(code, pw) { return crypto.createHash('sha256').update('pomall:' + code + ':' + pw, 'utf8').digest('hex'); }   // Apps Script와 같은 방식이라 옮긴 비밀번호가 그대로 맞는다
function same(a, b) { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); }

// ----- 열쇠와 권한 -----
function roleOf(key) {
  key = String(key || '');
  if (!key) return null;
  if (cfg.adminKey && same(key, cfg.adminKey)) return 'admin';
  if (cfg.salesKey && same(key, cfg.salesKey)) return 'sales';
  if (cfg.viewKey && same(key, cfg.viewKey)) return 'view';
  return null;
}
function staff(key, allowed, fn) {
  const role = roleOf(key);
  if (!role) return { ok: false, error: '열쇠가 맞지 않아요.' };
  if (!allowed.includes(role)) return { ok: false, error: ROLES[role] + ' 열쇠로는 할 수 없어요. ' + (allowed[0] === 'admin' && allowed.length === 1 ? '관리자' : '영업팀') + ' 권한이 필요해요.' };
  return fn(role);
}

// ----- 거래처 -----
function rowToCustomer(r) {
  return { no: r.no || 0, code: r.code, name: r.name || '', contact: r.contact || '', phone: r.phone || '', address: r.address || '',
    hash: r.hash || '', active: !!r.active, discount: r.discount || 0, prices: JSON.parse(r.prices || '{}') };
}
function customers() { return q('SELECT * FROM customers').all().map(rowToCustomer); }
function findCustomer(code) { const r = q('SELECT * FROM customers WHERE code = ?').get(code); return r ? rowToCustomer(r) : null; }
function publicCustomer(c) {
  return { no: c.no, code: c.code, name: c.name, contact: c.contact, phone: c.phone, address: c.address, active: c.active, prices: c.prices, discount: c.discount, hasPassword: !!c.hash };
}
function authCustomer(code, pw) {
  code = clip(code, 20).toUpperCase();
  if (!code || !pw) return null;
  const c = findCustomer(code);
  return c && c.hash && same(c.hash, hash(code, pw)) ? c : null;
}
// 고유번호: 등록 순서대로 1, 2, 3… 지운 번호는 다시 쓰지 않는다
function custSeq() {
  const max = (q('SELECT MAX(no) AS m FROM customers').get().m) || 0;
  return Math.max(max, Number(getSetting('CUST_SEQ')) || 0);
}
function login(code, pw) {
  const c = authCustomer(code, pw);
  if (!c) return { ok: false, error: '거래처 코드나 비밀번호가 맞지 않아요.' };
  if (!c.active) return { ok: false, error: '사용 중지된 거래처예요. 담당 영업에 문의해 주세요.' };
  return { ok: true, customer: publicCustomer(c), prices: c.prices, discount: c.discount };
}
function customerList() { return customers().sort((a, b) => a.no - b.no).map(publicCustomer); }
function saveCustomer(c) {
  const code = clip(c.code, 20).toUpperCase(), oldCode = clip(c.oldCode, 20).toUpperCase();
  if (!/^[A-Z0-9_-]{2,20}$/.test(code)) return { ok: false, error: '거래처 코드는 영문 대문자, 숫자, -, _ 로 2~20자예요.' };
  const name = clip(c.name, 40);
  if (!name) return { ok: false, error: '거래처명이 필요해요.' };
  const pw = String(c.pw || '');
  const ex = findCustomer(oldCode || code), renamed = !!(oldCode && oldCode !== code);
  if (oldCode && !ex) return { ok: false, error: '고치려는 거래처가 없어요. 새로고침해 주세요.' };
  if (renamed && findCustomer(code)) return { ok: false, error: '이미 있는 거래처 코드예요.' };
  if (renamed && pw.length < 4) return { ok: false, error: '거래처 코드를 바꾸면 비밀번호도 새로 정해야 해요 (4자 이상).' };
  if (!ex && pw.length < 4) return { ok: false, error: '새 거래처는 비밀번호를 4자 이상 정해 주세요.' };
  if (pw && pw.length < 4) return { ok: false, error: '비밀번호는 4자 이상이에요.' };
  const discount = Number(c.discount) || 0;
  if (discount < 0 || discount >= 100) return { ok: false, error: '할인율은 0 이상 100 미만이에요.' };
  const models = catalog().products.map(p => p.id), prices = {};
  models.forEach(m => { const v = Number((c.prices || {})[m]); if (v > 0) prices[m] = Math.round(v * 10) / 10; });
  return tx(() => {
    const no = ex ? ex.no : custSeq() + 1;
    if (!ex) setSetting('CUST_SEQ', no);
    const row = [code, no, name, clip(c.contact, 20), clip(c.phone, 20), clip(c.address, 120), pw ? hash(code, pw) : ex.hash,
      c.active === false ? 0 : 1, discount ? Math.round(discount * 10) / 10 : 0, JSON.stringify(prices), new Date().toISOString()];
    if (ex) q('DELETE FROM customers WHERE code = ?').run(ex.code);
    q('INSERT INTO customers (code, no, name, contact, phone, address, hash, active, discount, prices, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(...row);
    // 코드를 바꾸면 지난 발주도 새 코드로 옮긴다
    if (renamed) q('UPDATE orders SET code = ? WHERE code = ?').run(code, oldCode);
    return { ok: true, code, no };
  });
}
function deleteCustomer(code) {
  const c = findCustomer(clip(code, 20).toUpperCase());
  if (!c) return { ok: false, error: '없는 거래처예요.' };
  q('DELETE FROM customers WHERE code = ?').run(c.code);
  return { ok: true };
}

// ----- 생산 소요일 -----
function lead(C) {
  const v = getSetting('LEAD');
  if (v) { try { return JSON.parse(v); } catch (e) { /* 아래 기본값 */ } }
  return (C || catalog()).lead;
}
function saveLead(d, role) {
  const L = { days: Math.floor(Number(d.days)), bigQty: Math.floor(Number(d.bigQty)), bigDays: Math.floor(Number(d.bigDays)) };
  if (!(L.days >= 1 && L.days <= 120 && L.bigDays >= 1 && L.bigDays <= 120)) return { ok: false, error: '영업일은 1~120 사이로 적어 주세요.' };
  if (!(L.bigQty >= 1)) return { ok: false, error: '대량 기준 수량을 적어 주세요.' };
  const by = clip(d.by, 20); if (!by) return { ok: false, error: '바꾸는 사람 이름이 필요해요.' };
  const old = lead(), say = x => '생산 소요 ' + x.days + '영업일, ' + x.bigQty + 'EA 이상 ' + x.bigDays + '영업일';
  tx(() => { setSetting('LEAD', JSON.stringify(L)); addLog('설정', '', say(old), say(L), by, role, ''); });
  return { ok: true, lead: L };
}
function addLog(no, company, from, to, by, role, reason) {
  q('INSERT INTO status_log (at, no, company, from_status, to_status, by, role, reason) VALUES (?,?,?,?,?,?,?,?)')
    .run(new Date().toISOString(), String(no), company || '', from, to, by, ROLES[role] || role, reason || '');
}

// ----- 발주 -----
// 발주번호: PO-날짜-거래처번호-그날 회사 전체 몇 번째 (예: PO-261015-1-002). 예전 번호 형식도 함께 센다.
function nextOrderNo(custNo) {
  const prefix = 'PO-' + kst().slice(2, 10).replace(/-/g, '') + '-';
  let max = 0;
  q('SELECT DISTINCT no FROM orders WHERE no LIKE ?').all(prefix + '%').forEach(r => {
    const m = r.no.match(/^PO-\d{6}-(?:\d+-)?(\d{3,})$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return prefix + (custNo ? custNo + '-' : '') + String(max + 1).padStart(3, '0');
}
function saveAttachment(a, no, company, base) {
  if (!a || !a.data) return {};
  const name = String(a.name || '').trim().slice(-80).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_'), ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1];
  if (!ext || !ATTACH_TYPES[ext.toLowerCase()]) return { ok: false, error: '발주서는 PDF, 사진, 엑셀, 워드, 한글 파일만 첨부할 수 있어요.' };
  const bytes = Buffer.from(String(a.data), 'base64');
  if (bytes.length > ATTACH_MAX) return { ok: false, error: '발주서 파일은 10MB까지 첨부할 수 있어요.' };
  // 주소를 아는 사람만 열 수 있도록 맞히기 어려운 폴더 이름을 쓴다 (구글 드라이브 "링크가 있는 사용자"와 같은 방식)
  const token = crypto.randomBytes(16).toString('hex'), file = (no + ' ' + company + ' ' + name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
  fs.mkdirSync(path.join(FILES_DIR, token));
  fs.writeFileSync(path.join(FILES_DIR, token, file), bytes);
  return { url: base + '/files/' + token + '/' + encodeURIComponent(file) };
}
function placeOrder(d, base) {
  const cust = authCustomer(d.code, d.pw);
  if (!cust || !cust.active) return { ok: false, error: '다시 로그인해 주세요.' };
  const o = d.order || {};
  const contact = clip(o.contact, 20), phone = clip(o.phone, 20), address = clip(o.address, 120);
  if (!contact || !address || digits(phone).length < 8) return { ok: false, error: '담당자, 연락처, 납품 주소가 필요해요.' };
  const items = (o.items || []).slice(0, 50);
  if (!items.length) return { ok: false, error: '담긴 품목이 없어요.' };

  const C = catalog(), lines = [];
  for (const it of items) {
    const p = findProduct(C, it.model);
    // 와이어가 없는 모델(products.json의 wires: 0)은 와이어 길이와 탈피가 없다
    const len = p && p.wires === 0 ? 0 : Math.floor(Number(it.len)), temp = Math.floor(Number(it.temp)), qty = Math.floor(Number(it.qty));
    if (!p) return { ok: false, error: '없는 모델이에요: ' + clip(it.model, 20) };
    if (!(cust.prices[p.id] > 0)) return { ok: false, error: p.id + '는 단가가 정해지지 않아 주문할 수 없어요.' };
    if (p.wires !== 0 && !okLen(C, len)) return { ok: false, error: p.id + ' 와이어 길이가 범위를 벗어났어요.' };
    const len2 = p.wires === 2 ? Math.floor(Number(it.len2)) : 0;
    if (p.wires === 2 && !okLen(C, len2)) return { ok: false, error: p.id + ' 와이어 길이 2가 범위를 벗어났어요.' };
    const finish = p.noFinish ? '' : String(it.finish || '');
    if (finish && !(C.finishes || []).some(f => f.code === finish)) return { ok: false, error: p.id + ' 마감을 다시 골라 주세요.' };
    const strip = p.wires === 0 ? 0 : Number(it.strip) || 0, strip2 = p.wires === 2 ? Number(it.strip2) || 0 : 0;
    if (!okStrip(strip, len) || !okStrip(strip2, len2)) return { ok: false, error: p.id + ' 탈피 길이는 와이어 길이보다 짧게 0.1mm 단위로 적어 주세요.' };
    // 핀 모델(products.json의 pinLength: true)은 핀 길이(0.1mm 단위)가 필요하다
    const PN = C.pin || { min: 0.1, max: 1000 }, pin = p.pinLength ? Number(it.pin) || 0 : 0;
    if (p.pinLength && !(pin >= PN.min && pin <= PN.max && Math.abs(Math.round(pin * 10) - pin * 10) < 1e-9)) return { ok: false, error: p.id + ' 핀 길이는 ' + PN.min + '~' + PN.max + 'mm 사이 0.1mm 단위로 적어 주세요.' };
    // 체크박스 항목(products.json의 choices): 모델에 적힌 항목은 고를 값 중 하나가 꼭 있어야 한다
    const ch = {};
    for (const g of C.choices || []) {
      if (!(p.choices || []).includes(g.key) || !(g.options || []).length) continue;
      const v = String(it[g.key] || '');
      if (!g.options.includes(v)) return { ok: false, error: p.id + ' ' + g.name + ' 항목을 골라 주세요.' };
      ch[g.key] = v;
    }
    if (!(temp >= p.temp[0] && temp <= p.temp[1] && temp % C.tempStep === 0)) return { ok: false, error: p.id + ' 동작온도가 범위를 벗어났어요.' };
    if (!(qty >= C.qty.min && qty % C.qty.step === 0)) return { ok: false, error: '수량은 ' + C.qty.min + 'EA 이상 ' + C.qty.step + 'EA 단위예요.' };
    const unit = unitPrice(cust.prices[p.id], cust.discount);
    lines.push({ code: specCode(p.id, len, temp, len2, finish), model: p.id, len, len2, strip, strip2, pin, speed: ch.speed || '', terminal: ch.terminal || '', finish, temp, qty, unit, amount: unit * qty, memo: clip(it.memo, 100) });
  }
  const net = lines.reduce((s, l) => s + l.amount, 0);
  const total = Math.round(net * (1 + C.price.vat));
  const L = lead(C), big = lines.some(l => l.qty >= L.bigQty);
  const eta = addBizDays(big ? L.bigDays : L.days);
  const wanted = /^\d{4}-\d{2}-\d{2}$/.test(o.requestedDate || '') && o.requestedDate >= eta ? o.requestedDate : eta;

  const no = nextOrderNo(cust.no);
  const file = saveAttachment(o.attachment, no, cust.name, base);
  if (file.error) return file;
  const now = new Date().toISOString();
  tx(() => {
    const ins = q(`INSERT INTO orders (no, line, created_at, code, company, contact, phone, customer_po, address, memo, requested_date, eta,
      spec_code, model, len, temp, qty, unit, amount, item_memo, total, status, updated_at, ship_date, attachment, len2, finish, strip, strip2, pin, speed, terminal)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    lines.forEach((l, k) => ins.run(no, k + 1, now, cust.code, cust.name, contact, phone, clip(o.customerPo, 40), address, clip(o.memo, 200),
      wanted, eta, l.code, l.model, l.len, l.temp, l.qty, l.unit, l.amount, l.memo, total, STATUSES[0], now, '', file.url || '', l.len2 || 0, l.finish, l.strip || 0, l.strip2 || 0, l.pin || 0, l.speed, l.terminal));
  });
  return { ok: true, order: { no, total, eta, requestedDate: wanted, attachment: file.url || '' } };
}

// 발주 줄을 발주번호별로 묶어 최신 발주가 먼저 오게 돌려준다 (Apps Script orders()와 같은 모양)
function orders(where, args, withLog) {
  const rows = q('SELECT * FROM orders ' + (where || '') + ' ORDER BY created_at, no, line').all(...(args || []));
  const log = {};
  if (withLog) q('SELECT * FROM status_log ORDER BY id').all().forEach(r => {
    (log[r.no] = log[r.no] || []).push({ at: r.at, from: r.from_status, to: r.to_status, by: r.by, role: r.role, reason: r.reason });
  });
  const map = new Map();
  rows.forEach(r => {
    if (!map.has(r.no)) map.set(r.no, {
      no: r.no, createdAt: r.created_at, code: r.code, company: r.company, contact: r.contact, phone: r.phone,
      customerPo: r.customer_po || '', address: r.address, memo: r.memo || '', requestedDate: r.requested_date || '', eta: r.eta || '',
      total: r.total || 0, shipDate: r.ship_date || '', attachment: r.attachment || '', status: statusOf(r.status), items: [], log: log[r.no] || []
    });
    map.get(r.no).items.push({ code: r.spec_code, model: r.model, len: r.len, len2: r.len2 || 0, finish: r.finish || '', strip: r.strip || 0, strip2: r.strip2 || 0, pin: r.pin || 0, speed: r.speed || '', terminal: r.terminal || '',
      temp: r.temp, qty: r.qty, unit: r.unit, memo: r.item_memo || '' });
  });
  return [...map.values()].reverse();
}
function mine(d) {
  const cust = authCustomer(d.code, d.pw);
  if (!cust) return { ok: false, error: '다시 로그인해 주세요.' };
  return { ok: true, orders: orders('WHERE code = ?', [cust.code]) };
}

// 상태 규칙 (pomall/app.js의 canMove, needsReason과 같다)
function canMove(role, from, to) {
  if (role === 'admin') return true;
  if (role !== 'sales' || from === '출하' || from === '취소') return false;
  return to === '취소' || STATUSES.indexOf(to) > STATUSES.indexOf(from);
}
const needsReason = (from, to) => to === '취소' || from === '취소' || STATUSES.indexOf(to) < STATUSES.indexOf(from);
function setStatus(d, role) {
  const to = String(d.status || ''), by = clip(d.by, 20), reason = clip(d.reason, 200);
  if (!STATUSES.includes(to)) return { ok: false, error: '알 수 없는 상태예요.' };
  if (!by) return { ok: false, error: '바꾸는 사람 이름이 필요해요.' };
  const first = q('SELECT * FROM orders WHERE no = ? ORDER BY line LIMIT 1').get(String(d.no));
  if (!first) return { ok: false, error: '없는 발주예요.' };
  const from = statusOf(first.status);
  if (from === to) return { ok: false, error: '이미 ' + to + ' 상태예요. 새로고침해 주세요.' };
  if (!canMove(role, from, to)) return { ok: false, error: from + '에서 ' + to + '(으)로는 관리자만 바꿀 수 있어요.' };
  if (needsReason(from, to) && reason.length < 2) return { ok: false, error: '사유를 적어 주세요.' };
  tx(() => {
    q('UPDATE orders SET status = ?, updated_at = ? WHERE no = ?').run(to, new Date().toISOString(), first.no);
    addLog(first.no, first.company, from, to, by, role, reason);
  });
  return { ok: true, status: to };
}
function setShipDate(d, role) {
  const date = String(d.date || ''), by = clip(d.by, 20);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: '날짜 형식이 맞지 않아요.' };
  if (!by) return { ok: false, error: '바꾸는 사람 이름이 필요해요.' };
  const first = q('SELECT * FROM orders WHERE no = ? ORDER BY line LIMIT 1').get(String(d.no));
  if (!first) return { ok: false, error: '없는 발주예요.' };
  const before = first.ship_date || '';
  if (before === date) return { ok: true, date };
  tx(() => {
    q('UPDATE orders SET ship_date = ? WHERE no = ?').run(date, first.no);
    addLog(first.no, first.company, '출하일 ' + (before || '미정'), '출하일 ' + (date || '미정'), by, role, clip(d.reason, 200));
  });
  return { ok: true, date };
}

// ----- 요청 처리 -----
// 거래처 비밀번호를 계속 틀리는 곳은 잠시 막는다 (1분에 10번)
const fails = new Map();
function tooMany(ip) { const f = fails.get(ip); return f && f.n >= 10 && Date.now() - f.t < 60000; }
function failed(ip) { const f = fails.get(ip); if (!f || Date.now() - f.t > 60000) fails.set(ip, { n: 1, t: Date.now() }); else f.n++; }

function handle(d, ctx) {
  const auth = ['login', 'order', 'mine'].includes(d.action);
  if (auth && tooMany(ctx.ip)) return { ok: false, error: '비밀번호를 여러 번 틀렸어요. 1분 뒤에 다시 해 주세요.' };
  let r;
  switch (d.action) {
    case 'login': r = login(d.code, d.pw); break;
    case 'order': r = placeOrder(d, ctx.base); break;
    case 'mine': r = mine(d); break;
    case 'config': return { ok: true, lead: lead() };
    case 'saveLead': return staff(d.key, ['admin', 'sales'], role => saveLead(d, role));
    case 'shipDate': return staff(d.key, ['admin', 'sales'], role => setShipDate(d, role));
    case 'staff': return staff(d.key, ['admin', 'sales', 'view'], role => ({ ok: true, role }));
    case 'list': return staff(d.key, ['admin', 'sales', 'view'], () => ({ ok: true, orders: orders('', [], true) }));
    case 'status': return staff(d.key, ['admin', 'sales'], role => setStatus(d, role));
    case 'customers': return staff(d.key, ['admin', 'sales'], () => ({ ok: true, customers: customerList() }));
    case 'saveCustomer': return staff(d.key, ['admin', 'sales'], () => saveCustomer(d.customer || {}));
    case 'deleteCustomer': return staff(d.key, ['admin', 'sales'], () => deleteCustomer(d.code));
    default: return { ok: false, error: '알 수 없는 요청이에요.' };
  }
  if (auth && !r.ok && /맞지 않아요|다시 로그인/.test(r.error || '')) failed(ctx.ip);
  return r;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function send(res, code, body, type, extra) {
  res.writeHead(code, Object.assign({ 'Content-Type': type || 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': cfg.allowOrigin }, extra || {}));
  res.end(body);
}
function serveFile(res, file, type, extra) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, '없는 파일이에요.', 'text/plain; charset=utf-8');
    res.writeHead(200, Object.assign({ 'Content-Type': type, 'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff' }, extra || {}));
    fs.createReadStream(file).pipe(res);
  });
}
// 폴더 밖으로 나가는 주소(../)는 막는다
function inside(dir, rel) { const f = path.resolve(dir, '.' + path.sep + rel); return f.startsWith(dir + path.sep) ? f : null; }

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'), ip = req.socket.remoteAddress || '';
  const base = (cfg.publicUrl || ((req.headers['x-forwarded-proto'] || 'http') + '://' + req.headers.host)).replace(/\/$/, '');

  if (url.pathname === '/api' && req.method === 'OPTIONS') return send(res, 204, '', 'text/plain', { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' });
  if (url.pathname === '/api' && req.method === 'GET') return send(res, 200, JSON.stringify({ ok: true }));
  if (url.pathname === '/api' && req.method === 'POST') {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > BODY_MAX) { send(res, 413, JSON.stringify({ ok: false, error: '보낸 내용이 너무 커요.' })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (res.writableEnded) return;
      let out;
      try { out = handle(JSON.parse(Buffer.concat(chunks).toString('utf8')), { ip, base }); }
      catch (e) { console.error(new Date().toISOString(), e); out = { ok: false, error: '요청을 처리하지 못했어요.' }; }
      send(res, 200, JSON.stringify(out));
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '', 'text/plain');

  // 첨부한 발주서
  const fm = url.pathname.match(/^\/files\/([0-9a-f]{32})\/([^/]+)$/);
  if (fm) {
    const name = decodeURIComponent(fm[2]), f = inside(FILES_DIR, path.join(fm[1], name));
    if (!f) return send(res, 404, '', 'text/plain');
    const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1] || '';
    return serveFile(res, f, ATTACH_TYPES[ext.toLowerCase()] || 'application/octet-stream',
      { 'Content-Disposition': "inline; filename*=UTF-8''" + encodeURIComponent(name), 'Cache-Control': 'private, max-age=3600' });
  }

  // 사이트 화면 (siteDir). settings.json은 이 서버의 /api를 쓰도록 바꿔서 준다.
  if (!SITE_DIR) return send(res, 404, '', 'text/plain');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  if (rel === '/settings.json') {
    let s = {};
    try { s = JSON.parse(fs.readFileSync(path.join(SITE_DIR, 'settings.json'), 'utf8')); } catch (e) { /* 기본값 */ }
    return send(res, 200, JSON.stringify(Object.assign(s, { storage: 'sheet', orderUrl: base + '/api' })), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
  }
  if (/\.(gs|md)$/.test(rel)) return send(res, 404, '', 'text/plain');
  const f = inside(SITE_DIR, rel);
  if (!f) return send(res, 404, '', 'text/plain');
  serveFile(res, f, MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', { 'Cache-Control': 'no-cache' });
});

// ----- 매일 자동 백업 -----
// 하루 한 번 데이터베이스를 backupDir/pomall-YYYYMMDD.db 로 복사하고, 새 발주서 파일도 backupDir/files 로 복사한다.
function backup() {
  if (!cfg.backupDir) return;
  const dir = here(cfg.backupDir);
  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  const file = path.join(dir, 'pomall-' + day + '.db');
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(file)) {
      db.exec("VACUUM INTO '" + file.replace(/'/g, "''") + "'");
      fs.cpSync(FILES_DIR, path.join(dir, 'files'), { recursive: true, force: false, errorOnExist: false });
      const keep = Number(cfg.backupDays) || 30;
      fs.readdirSync(dir).filter(n => /^pomall-\d{8}\.db$/.test(n)).sort().slice(0, -keep)
        .forEach(n => fs.unlinkSync(path.join(dir, n)));
      console.log('백업했어요: ' + file);
    }
  } catch (e) { console.error('백업하지 못했어요: ' + e.message); }
}

if (require.main === module) {
  if (!cfg.adminKey || cfg.adminKey.length < 8) {
    console.error('관리자 열쇠(adminKey)를 8자 이상으로 config.json에 적어 주세요. config.example.json을 보고 만들면 됩니다.');
    process.exit(1);
  }
  server.listen(cfg.port, () => console.log('SEKI POmall 서버가 켜졌어요: http://localhost:' + cfg.port + '  (자료 폴더: ' + DATA_DIR + ')'));
  backup();
  setInterval(backup, 3600e3);
}
module.exports = { server, db, handle, cfg, hash, backup };
