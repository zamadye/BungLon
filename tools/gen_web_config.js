#!/usr/bin/env node
/* =============================================================================
 * tools/gen_web_config.js — .env  ->  web/config.js  (tanpa dependency npm)
 * -----------------------------------------------------------------------------
 * Kunci platform iklan TIDAK boleh masuk repo. Simpan di `.env` (root project),
 * jalankan script ini tiap berubah, dan web/config.js (yang di-gitignore) akan
 * memuat nilainya ke window.HIDESEEK_CONFIG saat game start.
 *
 *   node tools/gen_web_config.js                 // .env -> web/config.js
 *   node tools/gen_web_config.js --print         // lihat hasil, tidak menulis
 *   node tools/gen_web_config.js --env path/.env --out web/config.js
 *
 * Tanpa .env / tanpa file hasil generate: game tetap jalan dalam MODE SIMULASI
 * (placement kosong => AdsManager pakai delay 1.5 detik).
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const has = name => argv.includes('--' + name);

/** Parser .env minimal: KEY=value, # komentar, kutip satu/DUA, tanpa perlu dotenv. */
function parseEnv(text) {
  const out = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    else val = val.replace(/\s+#.*$/, '');                 // komentar di akhir baris
    out[key] = val;
  }
  return out;
}
const bool = (v, dflt) => (v === undefined || v === '' ? dflt : /^(1|true|yes|on)$/i.test(String(v)));
const num = (v, dflt) => (v === undefined || v === '' || isNaN(Number(v)) ? dflt : Number(v));
/** "extra_life:slotA,bonus_coins:slotB" -> { extra_life:'slotA', bonus_coins:'slotB' } */
function parsePairs(v) {
  const o = {};
  if (!v) return o;
  const s = String(v).trim();
  if (s.startsWith('{')) { try { return JSON.parse(s); } catch (e) { console.warn('⚠️ AD_UNITS_JSON tidak valid, pakai format pair'); } }
  for (const part of s.split(/[,\n;]+/)) {
    const [k, ...rest] = part.split(':');
    const val = rest.join(':').trim();
    if (k && val) o[k.trim()] = val;
  }
  return o;
}

function main() {
  const envPath = path.resolve(ROOT, flag('env', '.env'));
  const outPath = path.resolve(ROOT, flag('out', 'web/config.js'));
  let env = {};
  if (fs.existsSync(envPath)) {
    env = parseEnv(fs.readFileSync(envPath, 'utf8'));
    console.log(`📄 .env terbaca: ${path.relative(ROOT, envPath)} (${Object.keys(env).length} kunci)`);
  } else if (fs.existsSync(path.join(ROOT, '.env.example'))) {
    env = parseEnv(fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8'));
    console.log(`ℹ️  tidak ada .env — pakai template .env.example (ID masih kosong => mode simulasi).`);
    console.log(`   untuk rilis: cp .env.example .env, isi ID-nya, jalankan lagi script ini.`);
  } else {
    console.log(`ℹ️  tidak ada ${path.relative(ROOT, envPath)} — semua nilai default (mode simulasi).`);
  }
  const units = Object.assign(
    parsePairs(env.APPLIXIR_AD_UNITS || env.ADS_AD_UNITS || ''),
    parsePairs(env.AD_UNITS_JSON || '')
  );
  const cfg = {
    ads: {
      platformOrder: (env.ADS_PLATFORM_ORDER || 'applixir,adinplay').split(',').map(s => s.trim()).filter(Boolean),
      appLixirPlacement: env.APPLIXIR_PLACEMENT || env.APP_LIXIR_PLACEMENT || '',
      adinPlayPlacement: env.ADINPLAY_PLACEMENT || '',
      adUnits: Object.assign({ extra_life: '', bonus_coins: '', skip_cooldown: '', frenzy: '' }, units),
      testMode: bool(env.ADS_TEST_MODE, true),
      adCooldownSeconds: num(env.ADS_COOLDOWN_SECONDS, 30),
      simSeconds: num(env.ADS_SIM_SECONDS, 1.5),
      adTimeoutSeconds: num(env.ADS_TIMEOUT_SECONDS, 20),
      cooldownKey: env.ADS_COOLDOWN_KEY || 'lastAdTime',
    },
    referral: {
      gameName: env.GAME_NAME || 'HideSeek Online',
      baseUrl: env.REFERRAL_BASE_URL || '',
      coinsForInvitee: num(env.REFERRAL_COINS_INVITEE, 50),
      hpForInvitee: num(env.REFERRAL_HP_INVITEE, 1),
      coinsForInviter: num(env.REFERRAL_COINS_INVITER, 100),
      codeLength: num(env.REFERRAL_CODE_LENGTH, 7),
      welcomeSeconds: num(env.REFERRAL_WELCOME_SECONDS, 6),
    },
    economy: {
      startCoins: num(env.ECONOMY_START_COINS, 0),
      coinsPerScore: num(env.ECONOMY_COINS_PER_SCORE, 0.5),
      maxHpBonusPrice: num(env.ECONOMY_MAXHP_PRICE, 50),
      maxHpBonusCap: num(env.ECONOMY_MAXHP_CAP, 2),
      extraLifePrice: num(env.ECONOMY_LIFE_PRICE, 25),
    },
  };
  const body =
    `/* GENERATED oleh tools/gen_web_config.js — JANGAN di-commit (berisi ID iklan).\n` +
    `   Sumber: ${path.relative(ROOT, envPath) || '.env'}  ·  dibuat ${new Date().toISOString()}\n` +
    `   Untuk mode rilis: set ADS_TEST_MODE=false di .env lalu generate ulang. */\n` +
    `window.HIDESEEK_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`;

  if (has('print')) { console.log('--- web/config.js (preview) ---\n' + body); return; }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, body);
  console.log(`✅ ditulis ${path.relative(ROOT, outPath)}  (testMode=${cfg.ads.testMode}, ` +
    `AppLixir=${cfg.ads.appLixirPlacement || '(kosong→simulasi)'}, AdinPlay=${cfg.ads.adinPlayPlacement || '(kosong→simulasi)'})`);
}

if (require.main === module) main();
module.exports = { parseEnv, parsePairs };
