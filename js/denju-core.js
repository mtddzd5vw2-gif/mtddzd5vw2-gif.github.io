/* 電獣 DENJU — the game's DNA code, for the 言霊診断 page (built by tools/make_site.mjs) */
/* ======================================================================
   電獣 DENJU — language: 日本語 or English
   The player's choice in Settings (kept outside the save, so it is known before anything draws),
   else the device language: English whenever the iPhone is not set to Japanese (the app declares
   both, so iOS hands the page the right one). Japanese stays the source text everywhere:
     tl('日本語', 'English')          inline text in the code
     data-en="…"      the element's whole content in English (markup allowed; ids inside are kept by repeating them)
     data-en-t="…"    only its first line of text, for buttons that also hold a badge or a cost
     data-en-aria / data-en-ph / data-en-alt   its label, placeholder, alt text
   Words, codes and nicknames the player writes are never translated.
   ====================================================================== */
const LANG_KEY = 'denju.lang';
const LANG = (() => {
  // the website build (tools/make_site.mjs) sets DENJU_LANG to render each language's pages
  if (typeof DENJU_LANG !== 'undefined' && (DENJU_LANG === 'ja' || DENJU_LANG === 'en')) return DENJU_LANG;
  try { const v = localStorage.getItem(LANG_KEY); if (v === 'ja' || v === 'en') return v; } catch (e) { /* storage blocked */ }
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const n = String((nav.languages && nav.languages[0]) || nav.language || 'ja');
  return /^ja\b/i.test(n) ? 'ja' : 'en';
})();
const EN = LANG === 'en';
const tl = (ja, en) => (EN ? en : ja);
// numbers the way the language writes them (1,000 in both)
const numL = (n) => Number(n).toLocaleString(EN ? 'en-US' : 'ja-JP');
function setLang(v) {
  if (v !== 'ja' && v !== 'en') return;
  try { localStorage.setItem(LANG_KEY, v); } catch (e) { /* storage blocked */ }
  location.reload();
}
// the page's own text: every element that carries its English beside the Japanese
function applyLangDOM(root = typeof document !== 'undefined' ? document : null) {
  if (!root || !root.querySelectorAll || !document.documentElement) return;
  document.documentElement.lang = LANG;
  if (!EN) return;
  document.title = 'DENJU';
  root.querySelectorAll('[data-en]').forEach((el) => { el.innerHTML = el.getAttribute('data-en'); });
  root.querySelectorAll('[data-en-t]').forEach((el) => {
    const t = [...el.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim());
    if (t) t.nodeValue = el.getAttribute('data-en-t'); else el.insertBefore(document.createTextNode(el.getAttribute('data-en-t')), el.firstChild);
  });
  root.querySelectorAll('[data-en-aria]').forEach((el) => el.setAttribute('aria-label', el.getAttribute('data-en-aria')));
  root.querySelectorAll('[data-en-ph]').forEach((el) => el.setAttribute('placeholder', el.getAttribute('data-en-ph')));
  root.querySelectorAll('[data-en-alt]').forEach((el) => el.setAttribute('alt', el.getAttribute('data-en-alt')));
}
applyLangDOM();

;
'use strict';
/* =========================================================
   電獣 DENJU — native bridge
   The app build injects window.DenjuNative (Capacitor: AdMob, StoreKit / Play Billing,
   haptics, share sheet, backup). In a browser every call falls back gracefully.
   ========================================================= */
// AdMob units come from the app build (GitHub variables → window.DenjuNative.adUnits). An app built
// without them shows no ads at all and hides every ad button: a store build never shows test ads.
// Google's sample units are used only when the build asks for them (DENJU_ADS_TEST=1).
const AD_SAMPLE = {
  ios: { rewarded: 'ca-app-pub-3940256099942544/1712485313', inter: 'ca-app-pub-3940256099942544/4411468910' },
  android: { rewarded: 'ca-app-pub-3940256099942544/5224354917', inter: 'ca-app-pub-3940256099942544/1033173712' },
};
const APP_VERSION = '1.1.1';
// the App Store page (share texts carry it). Region-free since 1.1 (English, more stores): it opens each viewer's own store
const APP_STORE_URL = 'https://apps.apple.com/app/id6816935558';
const NB = {
  N: window.DenjuNative || null,
  adsOK: false, adsOn: false, iapOK: false, products: {}, busy: false, bt: 0,
  get native() { return !!this.N; },
  get platform() { return this.N ? this.N.platform : 'web'; },
  async init() {
    const N = this.N; if (!N) return;
    if (S.tut) this.gcStart(); // Game Center as early as possible (Apple counts play time from sign-in)
    const real = N.adUnits && N.adUnits[N.platform], u = real || (N.adsTest ? AD_SAMPLE[N.platform] : null);
    this.adsOn = !!(u && N.ads);
    if (typeof syncAdUI === 'function') syncAdUI();
    try { if (this.adsOn) { await N.ads.init({ ...u, testing: !real }); this.adsOK = true; } } catch (e) { console.warn('ads init', e); }
    try {
      const list = N.iap ? await N.iap.products(SHOP.map((x) => ({ id: x.id, type: x.type }))) : [];
      for (const p of list || []) this.products[p.id] = p;
      this.iapOK = !!(list && list.length);
      if (this.iapOK) {
        await syncEntitlements(false);
        if (N.iap.onLate) N.iap.onLate((tx) => lateGrant(tx));
        if (N.iap.sweep) N.iap.sweep();
      }
    } catch (e) { console.warn('iap init', e); }
    if (typeof shopRefresh === 'function') shopRefresh();
  },
  haptic(p) {
    if (this.N) { try { this.N.haptic(p); } catch (e) { /* ignore */ } return; }
    try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* not allowed */ }
  },
  backup(j) { if (!this.N || !this.N.backup) return; clearTimeout(this.bt); this.bt = setTimeout(() => { try { this.N.backup(j); } catch (e) { /* ignore */ } }, 700); },
  // resolves true when the viewer earned the reward. When no ad can be shown at all (none to serve yet, offline,
  // the ad SDK did not start) the reward is given anyway: a button that does nothing is worse than a free reward,
  // and the daily limits on every ad button still apply.
  async rewarded() {
    if (this.busy) return false;
    this.busy = true; AU.pauseAll(true);
    const free = () => { UI.toast(tl('広告を読み込めなかったので、今回はそのまま受け取れます', 'The ad could not load, so this one is on us'), 2800); return true; };
    try {
      if (this.N && this.adsOK) { const r = await this.N.ads.showRewarded(); return r === 'unavailable' ? free() : r === true || r === 'earned'; }
      if (this.N) return free();
      return await adWaitFallback();
    } catch (e) { console.warn('rewarded', e); return free(); }
    finally { this.busy = false; AU.pauseAll(false); }
  },
  async interstitial() {
    if (!this.N || !this.adsOK || this.busy) return false;
    this.busy = true; AU.pauseAll(true);
    try { return !!(await this.N.ads.showInterstitial()); } catch (e) { return false; }
    finally { this.busy = false; AU.pauseAll(false); }
  },
  get notifyAvail() { return !!(this.N && this.N.notify); },
  async review() { try { return !!(this.N && this.N.review && (await this.N.review())); } catch (e) { return false; } },
  // ads can be watched: always in the browser (a short simulated wait), in the app only when the build has ad units
  get adsAvail() { return !this.N || this.adsOn; },
  async tracking() { try { if (this.adsOn && this.N.ads && this.N.ads.requestTracking) await this.N.ads.requestTracking(); } catch (e) { /* ignore */ } },
  async privacyOptions() { try { return !!(this.N && this.N.ads && this.N.ads.privacyOptions && (await this.N.ads.privacyOptions())); } catch (e) { return false; } },
  price(id) { const p = this.products[id]; return p && p.price ? p.price : null; },
  async buy(item) { if (!this.N || !this.iapOK) return { ok: false, unavailable: true }; return this.N.iap.buy(item.id, item.type); },
  async owned() { if (!this.N || !this.iapOK) return []; return (await this.N.iap.owned()) || []; },
  async restore() { if (!this.N || !this.iapOK) return null; return (await this.N.iap.restore()) || []; },
  async share(canvas, text, filename) {
    if (!this.N || !this.N.share) return false;
    try { return !!(await this.N.share({ dataUrl: canvas.toDataURL('image/png'), text, filename })); } catch (e) { return false; }
  },
  openUrl(u) { if (this.N && this.N.openUrl) { this.N.openUrl(u); return true; } return false; },
  // Game Center (iPhone): the weekly 百鬼夜行 ranking and challenges with friends. Optional — signed in after the
  // first battle (not over the opening summon), then at every launch; Apple shows its own banner or sign-in sheet.
  gc: { on: false, tried: false, together: false, flushing: false, achBusy: false },
  get gcAvail() { return !!(this.N && this.N.gc); },
  async gcStart() {
    const G = this.N && this.N.gc; if (!G || this.gc.tried) return;
    this.gc.tried = true;
    const set = (st) => {
      const was = this.gc.on; this.gc.on = !!(st && st.signedIn); this.gc.together = !!(st && st.playTogether);
      if (this.gc.on && !was) { gcFlush(); gcAch(); }
      if (typeof renderHk === 'function') renderHk();
    };
    G.onChange(set);
    if (G.onActivity) G.onActivity((a) => gcActivity(a && a.id));
    set(await G.signIn());
  },
  async gcBoard(id) {
    if (!this.gc.on) { UI.toast(tl('ランキングは Game Center で見られます。設定アプリの「Game Center」でサインインしてください', 'Rankings are on Game Center. Sign in under Game Center in the Settings app'), 4200); return false; }
    const r = await this.N.gc.leaderboard(id); return !!(r && r.ok);
  },
  async gcTogether() {
    if (!this.gc.on) { UI.toast(tl('設定アプリの「Game Center」でサインインすると、友だちと記録を競えます', 'Sign in under Game Center in the Settings app to compete with friends'), 4200); return false; }
    const r = await this.N.gc.playTogether(); return !!(r && r.ok);
  },
};
// browser stand-in for a rewarded ad: a short wait, clearly labelled
function adWaitFallback() {
  return new Promise((res) => {
    const m = $('#adwait'), n = $('#aw-n'); let left = 3; n.textContent = left; m.hidden = false;
    const tick = setInterval(() => { left--; n.textContent = Math.max(0, left); if (left <= 0) { clearInterval(tick); m.hidden = true; res(true); } }, 1000);
    $('#aw-cancel').onclick = () => { clearInterval(tick); m.hidden = true; res(false); };
  });
}

;
'use strict';
/* =========================================================
   電獣 DENJU — core: utils / data / DNA / save
   ========================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const TAU = Math.PI * 2;
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
}
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rngFrom = (s) => mulberry32(xmur3(s)());
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const smoothstep = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function weighted(r, items) { let s = 0; for (const it of items) s += it[1]; let x = r() * s; for (const it of items) { x -= it[1]; if (x < 0) return it[0]; } return items[items.length - 1][0]; }
const pick = (r, a) => a[Math.floor(r() * a.length)];
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const T = () => performance.now() / 1000;
// calmer effects (no ink impact frames or shockwaves, softer flashes, no screen shake): the system's
// reduce-motion setting or the in-game 「光の点滅：おさえる」
const RM_SYS = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
let RM = RM_SYS;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

/* ---------- data ---------- */
const ELEMENTS = {
  rai: { k: '雷', nm: tl('雷', 'Thunder'), read: 'いかずち', col: '#ffe14a', perk: tl('会心率 +12%', 'Crit rate +12%') },
  en:  { k: '焔', nm: tl('焔', 'Flame'),   read: 'ほむら',   col: '#ff6a2a', perk: tl('与ダメージ +15%', 'Damage +15%') },
  sou: { k: '蒼', nm: tl('蒼', 'Frost'),   read: 'あお',     col: '#2fd4ff', perk: tl('当たった敵を鈍らせる', 'Hits slow the enemy') },
  sui: { k: '翠', nm: tl('翠', 'Jade'),    read: 'みどり',   col: '#4dffa0', perk: tl('技の間隔 -12%', 'Skill cooldown -12%') },
  mei: { k: '冥', nm: tl('冥', 'Nether'),  read: 'めい',     col: '#b862ff', perk: tl('技の範囲 +20%', 'Skill area +20%') },
};
const EL_KEYS = ['rai', 'en', 'sou', 'sui', 'mei'];
const KINDS = {
  fox:    { k: '狐', nm: tl('狐', 'Fox'),     read: tl('きつね', 'Fox'),       wep: 'orbit',  w: 26, hp: 100, pow: 10 },
  wolf:   { k: '狼', nm: tl('狼', 'Wolf'),    read: tl('おおかみ', 'Wolf'),    wep: 'chain', w: 26, hp: 95,  pow: 12 },
  kirin:  { k: '麒', nm: tl('麒', 'Kirin'),   read: tl('きりん', 'Kirin'),     wep: 'beam',   w: 16, hp: 85,  pow: 14 },
  dragon: { k: '龍', nm: tl('龍', 'Dragon'),  read: tl('りゅう', 'Dragon'),    wep: 'nova',   w: 16, hp: 115, pow: 11 },
  bird:   { k: '鳳', nm: tl('鳳', 'Phoenix'), read: tl('おおとり', 'Phoenix'), wep: 'homing', w: 16, hp: 90, pow: 11 },
};
const KIND_KEYS = ['fox', 'wolf', 'kirin', 'dragon', 'bird'];
const WEAPONS = {
  orbit:  { ic: '狐', name: tl('狐火', 'Foxfire'),         desc: tl('霊火が身のまわりを巡り、ふれた敵を焼く', 'Spirit flames circle you and burn whatever they touch') },
  chain:  { ic: '迅', name: tl('迅雷', 'Chain Lightning'), desc: tl('近くの敵に雷を放ち、次々と連鎖させる', 'Lightning strikes a nearby enemy and leaps from one to the next') },
  beam:   { ic: '穿', name: tl('穿光', 'Piercing Light'),  desc: tl('一直線の光で、並んだ敵をまとめて貫く', 'A straight beam of light pierces every enemy in its line') },
  nova:   { ic: '雷', name: tl('雷輪', 'Thunder Ring'),    desc: tl('雷の輪を広げ、囲んできた敵を吹き飛ばす', 'A ring of thunder bursts outward and blasts back those around you') },
  homing: { ic: '追', name: tl('追雷', 'Homing Bolts'),    desc: tl('敵を追いかける雷の矢を撃ち出す', 'Fires bolts of lightning that chase the enemy') },
};
const RARITY = {
  N:  { mult: 1.0,  col: '#cfd8ea', rank: 0, name: tl('並', 'N') },
  R:  { mult: 1.25, col: '#4fc3ff', rank: 1, name: tl('良', 'R') },
  SR: { mult: 1.6,  col: '#ffcf5a', rank: 2, name: tl('稀', 'SR') },
  UR: { mult: 2.1,  col: '#ff4fa0', rank: 3, name: tl('神', 'UR') },
};
const NAME_A = ['ライ', 'シラ', 'カグ', 'ヴォル', 'ホム', 'ミカ', 'ツク', 'アマ', 'クロ', 'ハヤ', 'ギン', 'セツ', 'ヨミ', 'コガ', 'ナギ', 'イズ', 'トバ', 'ゼン', 'オボロ', 'ヒサ', 'ムラ', 'スバ', 'カザ', 'ユラ'];
const NAME_B = ['ゼン', 'ヌイ', 'ツチ', 'ガ', 'ラ', 'マル', 'テ', 'キ', 'ジン', 'カ', 'ヒ', 'ロウ', 'ハ', 'ビ', 'レイ', 'オウ', 'ヅチ', 'ル', 'ナ', 'セ', 'ミ', 'ト'];
// the same names in the Latin alphabet (English): first part + second part, e.g. ライ+ゼン = Raizen
const NAME_ROMA = { ライ: 'Rai', シラ: 'Shira', カグ: 'Kagu', ヴォル: 'Vol', ホム: 'Homu', ミカ: 'Mika', ツク: 'Tsuku', アマ: 'Ama', クロ: 'Kuro', ハヤ: 'Haya', ギン: 'Gin', セツ: 'Setsu',
  ヨミ: 'Yomi', コガ: 'Koga', ナギ: 'Nagi', イズ: 'Izu', トバ: 'Toba', ゼン: 'Zen', オボロ: 'Oboro', ヒサ: 'Hisa', ムラ: 'Mura', スバ: 'Suba', カザ: 'Kaza', ユラ: 'Yura' };
const NAME_ROMA_B = { ゼン: 'zen', ヌイ: 'nui', ツチ: 'tsuchi', ガ: 'ga', ラ: 'ra', マル: 'maru', テ: 'te', キ: 'ki', ジン: 'jin', カ: 'ka', ヒ: 'hi', ロウ: 'ro', ハ: 'ha', ビ: 'bi',
  レイ: 'rei', オウ: 'o', ヅチ: 'zuchi', ル: 'ru', ナ: 'na', セ: 'se', ミ: 'mi', ト: 'to' };
const STAGES = [
  { id: 's1', weak: 'rai', ku: tl('一ノ区', 'Ward 1'), place: tl('駅前アーケード', 'Station Arcade'), boss: tl('停電鬼', 'Blackout Oni'), bk: '停電鬼', bossRead: tl('テイデンキ', ''), mult: 1.0, grid: 0x35f0ff, fog: 0x06091a, sky: ['#05060f', '#0b1233', '#22164a'], sign: '#ff2e88', rec: 20,
    ecol: [0xff2a6e, 0xff7a1e, 0xa63cff, 0xb4ff3c, 0xff3434],
    desc: tl('シャッター街に「ノイズ」があふれ、街灯が一本ずつ消えていく。', 'Noise floods the shuttered arcade, and the streetlights go out one by one.'), clear: tl('停電鬼を祓った。駅前に灯りが戻った。', 'The Blackout Oni is banished. Light returns to the station.') },
  { id: 's2', weak: 'sui', ku: tl('二ノ区', 'Ward 2'), place: tl('高架下', 'Under the Tracks'),        boss: tl('逆雷', 'Reverse Thunder'), bk: '逆雷',   bossRead: tl('サカイカズチ', ''), mult: 1.9, grid: 0xff8a3c, fog: 0x0c0708, sky: ['#070406', '#1e0d12', '#3a1a18'], sign: '#ffcf5a', rec: 45,
    ecol: [0x7fe6ff, 0xffd23a, 0xff4a26, 0x9dff4a, 0xa86bff], foes: { brute: ['赤鬼', 'あかおに', 'Red Oni'] },
    desc: tl('電車の音にまぎれて、地面から空へ走る逆さの雷が見つかった。', 'Hidden in the roar of the trains, a bolt of lightning runs upside down, from the ground into the sky.'), clear: tl('逆雷を祓った。高架下に静けさが戻った。', 'Reverse Thunder is banished. Quiet returns under the tracks.') },
  { id: 's3', weak: 'en', ku: tl('三ノ区', 'Ward 3'), place: tl('湾岸変電所', 'Bayside Substation'),    boss: tl('無明王', 'The Lightless King'), bk: '無明王', bossRead: tl('ムミョウオウ', ''), mult: 3.3, grid: 0xb862ff, fog: 0x08051a, sky: ['#040310', '#140a33', '#2a0f3f'], sign: '#35f0ff', rec: 80,
    ecol: [0xd05bff, 0xff4fa8, 0x4f6bff, 0x4dffb0, 0xff3aa0], foes: { brute: ['青鬼', 'あおおに', 'Blue Oni'] },
    desc: tl('湾岸の変電所に、ノイズを束ねる王が居座り、街の電気を呑みこもうとしている。', 'A king who commands the Noise has taken the bayside substation and is swallowing the city\'s power.'), clear: tl('無明王を祓った。けれど、ノイズはまだ止まない。山の手の坂に、狐火が灯りはじめた。', 'The Lightless King is banished. But the Noise has not stopped. On the hillside slopes, foxfires begin to glow.') },
  { id: 's4', weak: 'sou', ku: tl('四ノ区', 'Ward 4'), place: tl('稲荷坂', 'Inari Slope'),      boss: tl('提灯大入道', 'Lantern Giant'), bk: '提灯大入道', bossRead: tl('チョウチンオオニュウドウ', ''), mult: 5.2, grid: 0xff5a36, fog: 0x0b0508, sky: ['#06040c', '#1c0a1e', '#4a1426'], sign: '#ffc24a', rec: 120,
    ecol: [0x8fdcff, 0xfff0c0, 0xc040ff, 0xffa62a, 0xff3a3a], foes: { mote: ['狐火', 'きつねび', 'Foxfire'] }, theme: 'inari', ground: 1, rain: 0, skyO: { moon: true, clouds: 0.45 },
    mix: { brute: [50, 0.08], caster: [10, 0.18], swift: [25, 0.16] }, wave: { caster: 3 },
    desc: tl('千本鳥居の坂道に、祭りでもないのに提灯が灯りはじめた。狐火が列をなしている。', 'On the slope of a thousand torii gates, lanterns light up though there is no festival. Foxfires march in a line.'), clear: tl('提灯大入道を祓った。鳥居の先、鉄塔の丘で嵐が鳴っている。', 'The Lantern Giant is banished. Past the gates, a storm roars over Pylon Hill.') },
  { id: 's5', weak: 'mei', ku: tl('五ノ区', 'Ward 5'), place: tl('鉄塔の丘', 'Pylon Hill'),    boss: tl('送電大蛇', 'Power Line Orochi'), bk: '送電大蛇', bossRead: tl('ソウデンオロチ', ''), mult: 7.6, grid: 0x2affc8, fog: 0x030a0c, sky: ['#020608', '#06161a', '#0e2e32'], sign: '#8affd8', rec: 170,
    ecol: [0xffe14a, 0xff7a3a, 0x4f7bff, 0xff4f9a, 0xe8f0ff], foes: { mote: ['鬼火', 'おにび', 'Onibi'] }, theme: 'pylon', ground: 3, rain: 1100, fogD: 0.012, skyO: { clouds: 0.95 },
    mix: { brute: [40, 0.1], caster: [15, 0.06], swift: [12, 0.34] }, wave: { swift: 1.5 },
    desc: tl('街へ電気を送る大鉄塔の丘。嵐の夜、送電線そのものが大蛇となって這いまわる。', 'The hill of giant pylons that power the city. On stormy nights, the power lines themselves crawl about as a great serpent.'), clear: tl('送電大蛇を祓った。雷雲の上から、太鼓の音が聞こえる。', 'The Power Line Orochi is banished. Drums echo from above the thunderclouds.') },
  { id: 's6', weak: 'sui', ku: tl('六ノ区', 'Ward 6'), place: tl('雷雲の頂', 'Thundercloud Peak'),    boss: tl('雷神', 'Raijin'), bk: '雷神', bossRead: tl('ライジン', ''), mult: 10.5, grid: 0xffd54a, fog: 0x0a0618, sky: ['#05030c', '#150c30', '#3a2466'], sign: '#c0b0ff', rec: 230,
    ecol: [0xb07aff, 0x6ff0ff, 0xff3a6a, 0x8dff5a, 0xffe8a0], theme: 'cloud', ground: 2, rain: 0, skyO: { moon: true },
    mix: { brute: [35, 0.12], caster: [12, 0.12], swift: [15, 0.24] }, wave: { brute: 1, caster: 2 }, elites: [35, 70, 105, 130],
    desc: tl('雷雲の上。王に雷を与えていた、すべての元凶が太鼓を打ち鳴らしている。', 'Above the thunderclouds. The source of it all, who gave the kings their lightning, is beating the drums.'), clear: tl('雷神をしずめた。街じゅうの電柱に灯りが戻った――けれど、地下鉄の奥から、まだ低いうなりが聞こえる。', 'Raijin is calmed. Every power pole in the city lights up again — and yet, from deep in the subway, a low hum still rises.') },
  // 第二章: each ward adds a hazard of its own (47_ward2.js)
  { id: 's7', ch: 2, weak: 'en', ku: tl('七ノ区', 'Ward 7'), place: tl('終電の駅', 'Last Train Station'), boss: tl('大百足', 'Great Centipede'), bk: '大百足', bossRead: tl('オオムカデ', ''), mult: 13.5, grid: 0xffb030, fog: 0x050508, sky: ['#020203', '#050508', '#0b0a10'], sign: '#ffc83a', rec: 280,
    ecol: [0x9fd8ff, 0xd8ccb8, 0xff4a3a, 0xb4ff5a, 0xffcf4a], foes: { mote: ['迷い火', 'まよいび', 'Lost Flame'], swift: ['鉄鼠', 'てっそ', 'Tesso'], brute: ['黒鬼', 'くろおに', 'Black Oni'] }, theme: 'subway', ground: 4, rain: 0, fogD: 0.016, skyO: { stars: false },
    mix: { brute: [40, 0.1], caster: [20, 0.08], swift: [8, 0.38] }, wave: { swift: 1.8 },
    desc: tl('地下の終着駅。止まったはずの終電が、ノイズを乗せて走りつづけている。', 'An underground terminal. The last train should have stopped, but it keeps running, carrying the Noise.'), clear: tl('大百足を祓った。止まっていた駅の時計が、また動きはじめた。', 'The Great Centipede is banished. The station clock, long stopped, starts ticking again.') },
  { id: 's8', ch: 2, weak: 'mei', ku: tl('八ノ区', 'Ward 8'), place: tl('電波塔', 'Radio Tower'), boss: tl('大天狗', 'Great Tengu'), bk: '大天狗', bossRead: tl('ダイテング', ''), mult: 16.8, grid: 0xff4a4a, fog: 0x0a0508, sky: ['#040206', '#140a12', '#2a1020'], sign: '#ff6a5a', rec: 330,
    ecol: [0xd8e4ff, 0x8a7aff, 0xff5a2a, 0xff3aa0, 0xffd24a], foes: { mote: ['雑音', 'ざつおん', 'Static'], swift: ['烏天狗', 'からすてんぐ', 'Crow Tengu'] }, theme: 'tower', ground: 0, rain: 500, skyO: { clouds: 0.6 },
    mix: { brute: [35, 0.12], caster: [15, 0.14], swift: [15, 0.3] }, wave: { swift: 1.4, caster: 2 },
    desc: tl('街じゅうの電波が集まる塔。砂嵐の中では、電獣の技がとどきにくい。', 'The tower where all the city\'s signals gather. Inside the static, the denju\'s skills struggle to land.'), clear: tl('大天狗を祓った。砂嵐がやみ、塔の灯りが一つずつ戻った。', 'The Great Tengu is banished. The static clears, and the tower lights return one by one.') },
  { id: 's9', ch: 2, weak: 'rai', ku: tl('九ノ区', 'Ward 9'), place: tl('水没区', 'Sunken District'), boss: tl('海坊主', 'Umibozu'), bk: '海坊主', bossRead: tl('ウミボウズ', ''), mult: 20.5, grid: 0x3ab8ff, fog: 0x030a12, sky: ['#02040a', '#061224', '#0c2238'], sign: '#5ad0ff', rec: 390,
    ecol: [0x7affe8, 0xa0c8ff, 0x5a8aff, 0xffb45a, 0xffe8a0], foes: { mote: ['海月火', 'くらげび', 'Jellyfish Flame'], swift: ['舟幽霊', 'ふなゆうれい', 'Funayurei'], brute: ['牛鬼', 'うしおに', 'Ushi-oni'] }, theme: 'flood', ground: 5, rain: 900, fogD: 0.016, skyO: { moon: true, clouds: 0.5 },
    mix: { brute: [30, 0.14], caster: [15, 0.1], swift: [12, 0.28] }, wave: { brute: 1, swift: 1.2 },
    desc: tl('海があふれ、商店街が水に沈んだ。潮が満ちると足が重くなる。電柱のまわりの足場へ。', 'The sea has overflowed and the shopping street lies underwater. When the tide rises, your feet grow heavy. Head for the footing around the poles.'), clear: tl('海坊主を祓った。潮が引いた水の底に、常世へつづく門が見えた。', 'Umibozu is banished. As the tide ebbs, a gate to Tokoyo appears at the bottom of the water.') },
  { id: 's10', ch: 2, weak: 'sou', ku: tl('十ノ区', 'Ward 10'), place: tl('常世', 'Tokoyo'), boss: tl('大禍津日神', 'Omagatsuhi'), bk: '大禍津日神', bossRead: tl('オオマガツヒノカミ', ''), mult: 25, grid: 0xff2e4a, fog: 0x0c0306, sky: ['#060104', '#1a0408', '#3a0a10'], sign: '#ff5a6a', rec: 450,
    ecol: [0xa8d8ff, 0xd8b0ff, 0xffd24a, 0x7affc8, 0xff4a5a], foes: { mote: ['黄泉火', 'よもつび', 'Yomi Flame'], swift: ['黄泉醜女', 'よもつしこめ', 'Yomotsu-shikome'], brute: ['八雷', 'やくさのいかづち', 'Eight Thunders'] }, theme: 'yomi', ground: 6, rain: 0, fogD: 0.017, skyO: { moon: true, moonCol: 0xff5a4a },
    mix: { brute: [30, 0.14], caster: [12, 0.14], swift: [12, 0.26] }, wave: { brute: 2, caster: 2, swift: 1.3 }, elites: [35, 70, 105, 130], final: true,
    desc: tl('ノイズが生まれる場所。ここで倒したノイズは、電柱のそばでなければ一度だけよみがえる。', 'Where the Noise is born. Noise banished here rises once more, unless it falls beside a power pole.'), clear: tl('大禍津日神を祓った。常世の門が閉じ、街に本当の夜明けが来た。', 'Omagatsuhi is banished. The gate of Tokoyo closes, and a true dawn comes to the city.') },
];
const CHAPTERS = [{ at: 0, name: tl('第一章　電線の街', 'Chapter 1 — City of Wires') }, { at: 6, name: tl('第二章　常世の門', 'Chapter 2 — Gate of Tokoyo') }];
const RUN_BOSS_AT = 150; // seconds
const WEAK_MUL = 1.3; // a district's noise takes 30% more from beasts of its weak element

/* ---------- DNA ----------
   every beast is born from a seal code: its "line" (霊符 = talisman summon, 言霊 = word summon,
   or the tutorial pole 駅前線) and its "number". Same code → same beast, for everyone. */
const DNA_CACHE = new Map();
const FU_LINE = '霊符', WORD_LINE = '言霊';
const RAR_W = [['N', 55], ['R', 30], ['SR', 12], ['UR', 3]];
const SHINY_P = 1 / 40; // 色違い: a rare alternate colouring (looks only), fixed per code
const normPart = (s) => String(s || '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
const normNum = (s) => normPart(s).replace(/[‐‑‒–—―ー－−]/g, '-');
const normWord = (s) => [...normPart(s).replace(/[<>&"'`\\|]/g, '')].slice(0, 12).join('');
const normFor = (L, s) => (L === WORD_LINE ? normWord(s) : normNum(s));
// the rarity a code carries: the first draw of its stream (words top out at 稀)
function rarOfCode(line, num) {
  const L = normPart(line), rar = weighted(rngFrom('denju/v1/' + L + '|' + normFor(L, num)), RAR_W);
  return L === WORD_LINE && rar === 'UR' ? 'SR' : rar;
}
function makeDNA(line, num, ov) {
  const L = normPart(line), N = normFor(L, num), key = L + '|' + N;
  if (!ov && DNA_CACHE.has(key)) return DNA_CACHE.get(key);
  const r = rngFrom('denju/v1/' + key);
  let rar = weighted(r, RAR_W);
  if (L === WORD_LINE && rar === 'UR') rar = 'SR';
  let el = pick(r, EL_KEYS);
  let kind = weighted(r, KIND_KEYS.map((k) => [k, KINDS[k].w]));
  if (ov) { if (ov.rar) rar = ov.rar; if (ov.el) el = ov.el; if (ov.kind) kind = ov.kind; }
  const rk = RARITY[rar].rank;
  const na = pick(r, NAME_A), nb = pick(r, NAME_B); // the name's two parts: the same draws as always
  const d = {
    key, line: L, num: N, rar, el, kind,
    species: EN ? ELEMENTS[el].nm + ' ' + KINDS[kind].nm : ELEMENTS[el].k + KINDS[kind].k,
    name: EN ? NAME_ROMA[na] + NAME_ROMA_B[nb] : na + nb,
    ivPow: r(), ivHp: r(), ivSpd: r(),
    hue: (r() * 2 - 1) * 0.05,
    size: 0.92 + r() * 0.14 + rk * 0.05,
    tails: kind === 'fox' ? [1, 2 + (r() < 0.5 ? 1 : 0), 5, 9][rk] : 1,
    ears: pick(r, ['tall', 'mid', 'swept']),
    horn: kind === 'kirin' ? 'single' : weighted(r, [['none', 50], ['twin', 32], ['crown', 18]]),
    spikes: r() < 0.45,
    mane: kind === 'wolf' || r() < 0.18,
    eyes: r() < (rk === 3 ? 0.55 : 0.12) ? 3 : 2,
    legLen: 0.34 + r() * 0.14, bodyLen: 1.0 + r() * 0.35, head: 0.9 + r() * 0.25,
    segN: 16 + Math.floor(r() * 8), fins: r() < 0.65, whisk: r() < 0.75,
    wing: 1 + r() * 0.45 + rk * 0.12, feathers: 3 + Math.floor(r() * 4), crest: 2 + Math.floor(r() * 3),
    halo: rk === 3 || (rk === 2 && r() < 0.45),
    phase: r() * TAU,
    sigN: 3 + Math.floor(r() * 6), sigM: Math.floor(r() * 4),
  };
  // its own stream, so adding it moved no other trait of any existing beast
  d.shiny = ov && ov.shiny != null ? !!ov.shiny : rngFrom('denju/shiny/' + key)() < SHINY_P;
  if (!ov) DNA_CACHE.set(key, d);
  return d;
}
// なかよし (affection, 0–5 hearts from daily petting) adds 2% power per heart
const AFF_MAX = 5, AFF_POW = 0.02;
function beastStats(d, lv, aff = 0) {
  const K = KINDS[d.kind], m = RARITY[d.rar].mult * (1 + (lv - 1) * 0.08);
  return {
    pow: Math.round(K.pow * m * (0.9 + d.ivPow * 0.2) * (1 + clamp(aff || 0, 0, AFF_MAX) * AFF_POW) * 10) / 10,
    hp: Math.round(K.hp * m * (0.9 + d.ivHp * 0.2)),
    spd: Math.round((0.92 + d.ivSpd * 0.16) * 100),
  };
}
const expNeed = (lv) => 40 + lv * 30;
const powerCost = (lv) => 60 + lv * 40;
const MAX_LV = 30;

/* ---------- save ---------- */
const SAVE_KEY = 'denju.save.v1';
const FIRST_PLATE = ['駅前線', '13']; // internal seed of the starter beast only; never shown
const START_FU = 10;
// what a talisman shows: the seal code or the written word. The starter and beasts kept from
// old saves get a name instead, so no pole number is ever displayed.
function sealFace(line, num) {
  if (line === FU_LINE || line === WORD_LINE) return [line, num];
  return [FU_LINE, line === FIRST_PLATE[0] && num === FIRST_PLATE[1] ? tl('はじまり', 'First') : tl('古札', 'Old seal')];
}
let S = null;
// the game day turns over at 04:00 local time
const dayKeyOf = (ms = Date.now()) => { const d = new Date(ms - 4 * 3600e3); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const monthKeyOf = (ms = Date.now()) => dayKeyOf(ms).slice(0, 7);
const freshDay = (key) => ({ key, ads: 0, word: 0, wordAd: 0, runs: 0, kills: 0, boss: 0, pets: 0, got: [], bonus: false, moon: false, double: 0 });
function newSave() {
  return {
    v: 2, reishi: 300, beasts: [], party: [], leader: null, cleared: 0, seen: [], muted: false, summons: 0, tut: false, best: {},
    fu: START_FU, fuP: 0, pity: 0, dp: {}, dsel: {}, day: freshDay(dayKeyOf()), login: { last: '', n: 0 },
    moonUntil: 0, noAds: false, bought: {}, tx: [], age: null, spend: { m: monthKeyOf(), yen: 0 }, runs: 0, lastInter: 0, words: [], hint: {}, awayT: Date.now(), notif: { on: false, asked: 0, next: 0 }, calm: false, dexRew: {}, hk: null, chal: {}, feat: [], stat: {}, yk: {}, fused: [], mt: null, seals: [],
  };
}
function migrate(s) {
  if (!s || !Array.isArray(s.beasts)) return null;
  const base = newSave();
  if (s.v === 1) { s.fu = START_FU; s.v = 2; } // players from the photo-summon era get the new starter talismans too
  for (const k in base) if (s[k] === undefined) s[k] = base[k];
  if (!s.day || !s.day.key) s.day = freshDay(dayKeyOf());
  for (const k in base.day) if (s.day[k] === undefined) s.day[k] = base.day[k];
  return s.v === 2 ? s : null;
}
function loadSave() {
  try { return migrate(JSON.parse(localStorage.getItem(SAVE_KEY) || 'null')); } catch (e) { /* storage blocked */ }
  return null;
}
function persist() {
  S.at = Date.now(); // when this save last changed (the iCloud copy compares it)
  let j = ''; try { j = JSON.stringify(S); localStorage.setItem(SAVE_KEY, j); } catch (e) { /* ignore */ }
  if (j && typeof NB !== 'undefined') { NB.backup(j); if (typeof cloudQueue === 'function') cloudQueue(); }
}
const owned = (k) => S.beasts.find((b) => b.k === k);
// 昇格: a promoted beast keeps its seal, face and temperament, and grows into the next rank's form
const PROMO_CACHE = new Map();
// なかよし at its highest: the same beast with a flower of friendship behind its ear
const BOND_CACHE = new Map();
function dnaOf(b) {
  const d = dnaRank(b);
  if ((b.aff | 0) < AFF_MAX) return d;
  const k = d.key + '#' + d.rar; if (!BOND_CACHE.has(k)) BOND_CACHE.set(k, { ...d, bond: true }); return BOND_CACHE.get(k);
}
function dnaRank(b) {
  const d = makeDNA(b.line, b.num), up = b.promo | 0;
  if (!up) return d;
  const ck = d.key + '#' + up; if (PROMO_CACHE.has(ck)) return PROMO_CACHE.get(ck);
  const r0 = RARITY[d.rar].rank, rk = Math.min(2, r0 + up), g = rk - r0;
  const p = { ...d, rar: ['N', 'R', 'SR', 'UR'][rk], baseRar: d.rar, size: d.size + g * 0.05, wing: d.wing + g * 0.12,
    tails: d.kind === 'fox' ? [1, d.tails > 1 && d.tails < 5 ? d.tails : 2 + (d.phase > Math.PI ? 1 : 0), 5, 9][rk] : d.tails };
  PROMO_CACHE.set(ck, p); return p;
}
// a name the player gave (up to 8 characters), or the one it was born with
const normNick = (s) => [...String(s || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f<>&"'`\\|]/g, '').replace(/\s+/g, ' ').trim()].slice(0, 8).join('');
const nameOf = (e) => (e && e.nick) || dnaOf(e).name;
function addBeast(d) {
  if (owned(d.key)) return false;
  S.beasts.push({ k: d.key, line: d.line, num: d.num, lv: 1, exp: 0, t: Date.now() });
  const sid = d.el + ':' + d.kind; if (!S.seen.includes(sid)) S.seen.push(sid);
  if (S.party.length < 3) S.party.push(d.key);
  if (!S.leader) S.leader = d.key;
  S.summons++; return true;
}
function dayRoll() { const k = dayKeyOf(); if (S.day.key !== k) S.day = freshDay(k); const m = monthKeyOf(); if (S.spend.m !== m) S.spend = { m, yen: 0 }; }
const fuTotal = () => S.fu + S.fuP;
// paid talismans are used first (keeps the unused paid balance small)
function spendFu(n) { if (fuTotal() < n) return false; const p = Math.min(S.fuP, n); S.fuP -= p; S.fu -= n - p; return true; }

;
/* =========================================================
   meta: talisman summon, word summon, daily loop, depths, shop catalog
   ========================================================= */
/* ---------- talisman (霊符) summon ---------- */
const PITY_MAX = 100;           // the 100th pull without 神 is 神
const MULTI_N = 10;             // the 10th pull of a 10-pull is 稀 or better
const GUAR_W = [['SR', 97], ['UR', 3]];
const CODE_KANA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワ';
const newCode = () => CODE_KANA[Math.floor(Math.random() * CODE_KANA.length)] + '-' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
// the code as English players read it (ネ-4444 → NE-4444); the code itself, which calls the beast, never changes
const KANA_ROMA = { ア: 'A', イ: 'I', ウ: 'U', エ: 'E', オ: 'O', カ: 'KA', キ: 'KI', ク: 'KU', ケ: 'KE', コ: 'KO', サ: 'SA', シ: 'SHI', ス: 'SU', セ: 'SE', ソ: 'SO', タ: 'TA', チ: 'CHI', ツ: 'TSU', テ: 'TE', ト: 'TO', ナ: 'NA', ニ: 'NI', ヌ: 'NU', ネ: 'NE', ノ: 'NO', ハ: 'HA', ヒ: 'HI', フ: 'FU', ヘ: 'HE', ホ: 'HO', マ: 'MA', ミ: 'MI', ム: 'MU', メ: 'ME', モ: 'MO', ヤ: 'YA', ユ: 'YU', ヨ: 'YO', ラ: 'RA', リ: 'RI', ル: 'RU', レ: 'RE', ロ: 'RO', ワ: 'WA' };
const codeShow = (n) => (EN ? String(n).replace(/^([ア-ワ])-/, (m, k) => (KANA_ROMA[k] || k) + '-') : String(n));
function rollRarity(guarantee) {
  if (S.pity >= PITY_MAX - 1) return 'UR';
  return weighted(Math.random, guarantee ? GUAR_W : RAR_W);
}
// find a fresh seal code whose beast carries the rolled rarity
function codeFor(rar, taken) {
  for (let i = 0; i < 4000; i++) {
    const c = newCode(), k = FU_LINE + '|' + c;
    if (taken.has(k) || owned(k)) continue;
    if (rarOfCode(FU_LINE, c) === rar) return c;
  }
  return null;
}
function drawTalismans(n) {
  const out = [], taken = new Set();
  for (let i = 0; i < n; i++) {
    const rar = rollRarity(n === MULTI_N && i === n - 1);
    const c = codeFor(rar, taken); if (!c) continue;
    const d = makeDNA(FU_LINE, c); taken.add(d.key);
    S.pity = d.rar === 'UR' ? 0 : S.pity + 1;
    const fresh = !S.seen.includes(d.el + ':' + d.kind);
    addBeast(d); out.push({ d, fresh });
  }
  return out;
}
/* ---------- word (言霊) summon ---------- */
const WORD_FREE = 1, WORD_AD = 1;
const wordLeft = () => Math.max(0, WORD_FREE - S.day.word);
const wordAdLeft = () => (NB.adsAvail ? Math.max(0, WORD_AD - S.day.wordAd) : 0);
/* ---------- 今日の言霊: one word a day, the same for every player (like a daily puzzle everyone talks about).
   Summoning it is free on top of the daily 言霊召喚 and gives 霊子 once a day. Odd days take the season's words. */
const DW_REW = 300;
const DW_FIXED = { '1-1': 'お正月', '2-3': '節分', '2-14': 'チョコレート', '2-22': 'ねこの日', '3-3': 'ひなまつり', '5-5': 'こいのぼり', '7-7': '七夕', '10-31': 'ハロウィン', '11-15': '七五三', '12-24': 'クリスマス', '12-25': 'サンタ', '12-31': '年越しそば' };
const DW_SEASON = [
  'お正月,初夢,鏡もち,おせち,獅子舞,たこあげ,お年玉,七草がゆ,書き初め,初もうで,福袋,だるま,雪うさぎ,こたつ,みかん',
  '節分,鬼,豆まき,恵方巻,チョコレート,梅の花,かまくら,雪だるま,ねこの日,春一番,手ぶくろ,ふきのとう',
  'ひなまつり,桜もち,卒業,つくし,ちょうちょ,いちご,菜の花,ぼたもち,うぐいす,春休み,たんぽぽ,新芽',
  '桜,お花見,入学,新学期,たけのこ,春風,チューリップ,花見だんご,新生活,つばめ,春眠,れんげ',
  'こいのぼり,柏もち,新緑,カーネーション,田植え,五月晴れ,若葉,しょうぶ湯,潮干狩り,ちまき,かぶと,藤の花',
  '梅雨,あじさい,かたつむり,雨がさ,てるてる坊主,ほたる,さくらんぼ,雨音,夏至,長ぐつ,かえる,水たまり',
  '七夕,天の川,短冊,花火,夏祭り,かき氷,風鈴,海水浴,スイカ,ひまわり,うなぎ,ラムネ,入道雲',
  '夏休み,盆踊り,せみ,麦わら帽子,流しそうめん,夕立,肝だめし,金魚すくい,打ち上げ花火,自由研究,線香花火,うちわ',
  '十五夜,お月見,月見だんご,秋分,すず虫,稲穂,彼岸花,梨,台風,さんま,ぶどう,赤とんぼ,夜長',
  '紅葉,どんぐり,ハロウィン,かぼちゃ,栗ごはん,運動会,読書の秋,焼きいも,金木犀,新米,きのこ,コスモス,柿,十三夜,おばけ',
  '七五三,紅葉狩り,銀杏,落ち葉,鍋,みかん,木枯らし,文化祭,焚き火,毛糸,千歳あめ,酉の市,湯たんぽ',
  'クリスマス,サンタ,雪だるま,大そうじ,年越しそば,除夜の鐘,ゆず湯,冬至,イルミネーション,ケーキ,マフラー,トナカイ,こたつ'
];
const DW_ALL = ('ねこ,いぬ,カレー,ラーメン,すし,ハンバーグ,オムライス,たこ焼き,うどん,おにぎり,ぎょうざ,からあげ,プリン,ドーナツ,アイス,メロンパン,コロッケ,ピザ,パンケーキ,たまご焼き,'
  + '電柱,電車,自転車,雷,虹,流れ星,月,太陽,宇宙,海,山,森,川,駅前,商店街,自販機,信号,神社,鳥居,お守り,'
  + 'きつね,たぬき,うさぎ,パンダ,ペンギン,くじら,イルカ,ふくろう,からす,すずめ,金魚,恐竜,ドラゴン,'
  + '忍者,侍,魔法,勇者,宝物,ひみつ,友だち,家族,夢,希望,勇気,笑顔,ありがとう,おはよう,おやすみ,ただいま,'
  + '月曜日,金曜日,日曜日,誕生日,給料日,宿題,図書館,音楽,ギター,ピアノ,えのぐ,えんぴつ,消しゴム,スマホ,イヤホン,目覚まし,まくら,毛布,ねぐせ,早起き,二度寝,散歩,旅行,温泉,キャンプ,星空,夜ふかし,雨上がり,放課後,屋上').split(',');
/* ---------- English players: Kanji Summon ----------
   Instead of typing any word they pair two of thirty kanji, each shown with its meaning and a reading. A pair is an
   ordinary 言霊 (雷龍 calls the same denju for a Japanese player who writes 雷龍): 870 pairs, 132 of them 稀. */
const KANJI = [
  ['雷', 'thunder', 'rai'], ['電', 'lightning', 'den'], ['焔', 'flame', 'en'], ['氷', 'ice', 'hyō'], ['風', 'wind', 'fū'], ['嵐', 'storm', 'ran'],
  ['月', 'moon', 'getsu'], ['星', 'star', 'sei'], ['夜', 'night', 'ya'], ['夢', 'dream', 'mu'], ['光', 'light', 'kō'], ['影', 'shadow', 'ei'],
  ['闇', 'darkness', 'an'], ['霊', 'spirit', 'rei'], ['魂', 'soul', 'kon'], ['神', 'god', 'shin'], ['鬼', 'oni', 'ki'], ['天', 'heaven', 'ten'],
  ['龍', 'dragon', 'ryū'], ['狐', 'fox', 'ko'], ['狼', 'wolf', 'rō'], ['鳳', 'phoenix', 'hō'], ['虎', 'tiger', 'ko'], ['獣', 'beast', 'jū'],
  ['桜', 'sakura', 'ō'], ['刃', 'blade', 'jin'], ['牙', 'fang', 'ga'], ['翼', 'wing', 'yoku'], ['王', 'king', 'ō'], ['紅', 'crimson', 'kō'],
];
const KANJI_OF = Object.fromEntries(KANJI.map((k) => [k[0], k]));
const isKanjiPair = (w) => { const c = [...String(w || '')]; return c.length === 2 && c[0] !== c[1] && c.every((x) => KANJI_OF[x]); };
// pairs that are real words (or read like one) get their own name; the rest read as their two meanings
const KANJI_WORDS = {
  天狼: 'Sirius, the heaven wolf', 夜桜: 'sakura at night', 月光: 'moonlight', 月影: 'moon shadow', 鬼神: 'fierce god', 雷神: 'thunder god',
  風神: 'wind god', 霊獣: 'spirit beast', 電獣: 'lightning beast (DENJU)', 神龍: 'divine dragon', 闇夜: 'dark night', 星霊: 'star spirit', 天雷: "heaven's thunder",
  光翼: 'wings of light', 紅牙: 'crimson fang', 氷刃: 'ice blade', 焔鳳: 'flame phoenix', 影狼: 'shadow wolf', 闇王: 'king of darkness', 夢狐: 'dream fox',
  嵐牙: 'storm fang', 桜刃: 'sakura blade', 魂刃: 'soul blade', 虎王: 'tiger king', 星夜: 'starry night', 雷龍: 'thunder dragon', 月狐: 'moon fox', 天光: 'light from heaven',
};
const kanjiGloss = (w) => KANJI_WORDS[w] || [...String(w)].map((c) => (KANJI_OF[c] || [c, c])[1]).join(' + ');
const kanjiRead = (w) => { const r = [...String(w)].map((c) => (KANJI_OF[c] || [c, '', ''])[2]).join(''); return r.charAt(0).toUpperCase() + r.slice(1); };
// the Kanji of the Day: named pairs on odd days (a new order each month), any pair on even days, a few set dates
const KANJI_FIXED = { '1-1': '天光', '2-3': '鬼影', '4-1': '夢狐', '7-7': '星夜', '8-15': '霊魂', '10-31': '鬼夜', '12-24': '星光', '12-31': '月夜' };
function kanjiOfDay(key) {
  const [y, m, d] = key.split('-').map(Number), fx = KANJI_FIXED[m + '-' + d];
  if (fx) return fx;
  if (d % 2) {
    const r = rngFrom('kanji:' + y + '-' + m), named = Object.keys(KANJI_WORDS);
    for (let i = named.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [named[i], named[j]] = [named[j], named[i]]; }
    return named[(d >> 1) % named.length];
  }
  const r = rngFrom('kanji:' + key), a = Math.floor(r() * KANJI.length); let b = Math.floor(r() * (KANJI.length - 1)); if (b >= a) b++;
  return KANJI[a][0] + KANJI[b][0];
}
function dailyWord(key = dayKeyOf()) {
  if (EN) return kanjiOfDay(key);
  const FIX = DW_FIXED, SEA = DW_SEASON, ALL = DW_ALL;
  const [y, m, d] = key.split('-').map(Number), fx = FIX[m + '-' + d];
  if (fx) return fx;
  const r = rngFrom('dw:' + y + '-' + m), sh = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const taken = new Set(Object.keys(FIX).filter((k) => +k.split('-')[0] === m).map((k) => FIX[k]));
  const sea = sh(SEA[m - 1].split(',').filter((w) => !taken.has(w))), all = sh(ALL.filter((w) => !taken.has(w) && !sea.includes(w)));
  const si = (d - 1) >> 1;
  return d % 2 && si < sea.length ? sea[si] : all[(d - 1) % all.length];
}
const dwOpen = () => !S.day.dw;
// the days today's word was called (a stamp card, honour only) and the run of days in a row
const dwLog = () => (S.dwLog = S.dwLog || {});
function dwStreak() {
  const L = dwLog(); let n = 0, t = Date.now();
  if (!L[dayKeyOf(t)]) t -= 86400e3; // not called yet today: the run up to yesterday still counts
  while (L[dayKeyOf(t)] && n < 400) { n++; t -= 86400e3; }
  return n;
}
/* ---------- 言霊の相性: two words, their beasts' elements and kinds, and a fixed score and line (entertainment, like 名前診断).
   Only the element and kind show (as a tinted shadow); rarity, colour and face stay a surprise for the summon. ---------- */
const AISHO = {
  'rai|rai': [82, tl('ふたりそろえば、街じゅうが明るくなる', 'Together, these two light up the whole city')], 'en|en': [80, tl('燃えあがるふたり。けんかも早いが、仲直りも早い', 'Two flames. Quick to fight, quicker to make up')],
  'sou|sou': [84, tl('言わなくても通じあう、静かなふたり', 'A quiet pair who understand each other without a word')], 'sui|sui': [83, tl('のんびり屋どうし。いっしょにいると時間を忘れる', 'Two easygoing souls. Time slips away when they are together')],
  'mei|mei': [81, tl('秘密を分けあうふたり。夜がいちばん楽しい', 'A pair who share secrets. They have the most fun at night')],
  'en|rai': [88, tl('火花が散るほど気が合う。目立つふたり', 'They click so well that sparks fly. A pair that stands out')], 'rai|sou': [72, tl('雨と雷。ぶつかっても、すぐ晴れる', 'Rain and thunder. They clash, then the sky clears')],
  'rai|sui': [91, tl('嵐を呼ぶふたり。いっしょなら、どこへでも行ける', 'A pair who bring the storm. Together they can go anywhere')], 'mei|rai': [84, tl('夜空に稲妻。おたがいをひきたてあう', 'Lightning in the night sky. Each makes the other shine')],
  'en|sou': [66, tl('水と火。正反対だから、おもしろい', 'Water and fire. Opposites, and that is the fun of it')], 'en|sui': [86, tl('風が火をあおる。勢いがつくと止まらない', 'Wind fans the fire. Once they get going, nothing stops them')],
  'en|mei': [78, tl('暗やみを照らす灯り。たよりにされる', 'A light in the dark. Someone to rely on')], 'sou|sui': [93, tl('水が木を育てる。そばにいるだけで元気になる', 'Water helps the tree grow. Just being near each other lifts them up')],
  'mei|sou': [80, tl('深い海と夜。だまっていても落ちつく', 'Deep sea and night. Calm together, even in silence')], 'mei|sui': [75, tl('森の奥の、ひみつの場所を知っているふたり', 'Two who know a secret place deep in the forest')],
};
function aishoOf(w1, w2) {
  const a = makeDNA(WORD_LINE, w1), b = makeDNA(WORD_LINE, w2);
  if (w1 === w2) return { a, b, score: 100, line: tl('自分とは、いつでも最高の相性', 'With yourself, always a perfect match') };
  const [base, line] = AISHO[[a.el, b.el].sort().join('|')], r = rngFrom('aisho:' + [w1, w2].sort().join('|'));
  return { a, b, score: clamp(Math.round(base + (r() - 0.5) * 18), 51, 99), line };
}

/* ---------- rewards ---------- */
const AD_FU_DAY = 2;            // talismans from watching ads, per day
const LOGIN_TRACK = [{ fu: 1 }, { reishi: 500 }, { fu: 1 }, { reishi: 800 }, { fu: 2 }, { reishi: 1200 }, { fu: 5 }]; // the 7th day is worth the most (a week in a row)
const MISSIONS = [
  { id: 'pet', name: tl('電獣をなでる', 'Pet a denju'), need: 1, key: 'pets', rew: { reishi: 100 } },
  { id: 'run', name: tl('出撃する', 'Go on a sortie'), need: 1, key: 'runs', rew: { reishi: 150 } },
  { id: 'kill', name: tl('ノイズを400体祓う', 'Banish 400 Noise'), need: 400, key: 'kills', rew: { reishi: 300 } },
  { id: 'boss', name: tl('大禍を1体浄化する', 'Purify 1 Calamity'), need: 1, key: 'boss', rew: { fu: 1 } },
];
const MISSION_BONUS = { fu: 1 };
const rewText = (r) => [r.fu ? tl(`召喚符×${r.fu}`, `Talisman ×${r.fu}`) : '', r.reishi ? tl(`霊子${numL(r.reishi)}`, `${numL(r.reishi)} Spirit`) : ''].filter(Boolean).join(tl('・', ' · '));
function grant(r, paid) { if (r.fu) { if (paid) S.fuP += r.fu; else S.fu += r.fu; } if (r.reishi) S.reishi += r.reishi; }
const missionDone = (m) => (S.day[m.key] || 0) >= m.need;
const missionsClaimable = () => MISSIONS.filter((m) => missionDone(m) && !S.day.got.includes(m.id)).length + (MISSIONS.every((m) => S.day.got.includes(m.id)) && !S.day.bonus ? 1 : 0);
const loginPending = () => S.login.last !== S.day.key;
const moonActive = () => S.moonUntil > Date.now();
const moonDaysLeft = () => Math.max(0, Math.ceil((S.moonUntil - Date.now()) / 86400e3));
/* ---------- depth (浄化深度): endless difficulty after a district is cleared ---------- */
const DEPTH_MAX = 30;
const depthBest = (st) => (S.dp[st.id] === undefined ? (STAGES.indexOf(st) < S.cleared ? 0 : -1) : S.dp[st.id]);
const depthCap = (st) => (depthBest(st) < 0 ? 0 : Math.min(DEPTH_MAX, depthBest(st) + 1));
const depthOf = (st) => clamp(S.dsel[st.id] || 0, 0, depthCap(st));
const depthHp = (dp) => 1 + 0.6 * dp, depthDmg = (dp) => 1 + 0.35 * dp;
const depthRec = (st, dp) => Math.round(st.rec * (1 + 0.55 * dp));
const depthFirstFu = (dp) => (dp === 0 ? 5 : dp <= 10 ? 2 : 3);
/* ---------- 図譜の朱印: a red seal on the 電獣帳 for each full element row, each full kind column and all 25.
   Honour only — no talismans, 霊子 or power. Species come from paid summons too, so a prize for a set of them
   would be 「カード合わせ」 under 景品表示法 (消費者庁 Q&A). A seal of honour is not an economic benefit. ---------- */
const DEX_SEALS = () => [...EL_KEYS.map((el) => ({ id: 'el:' + el, ch: ELEMENTS[el].k, label: tl(ELEMENTS[el].k + 'の列', ELEMENTS[el].nm + ' row'), c: ELEMENTS[el].col })),
  ...KIND_KEYS.map((k) => ({ id: 'kind:' + k, ch: KINDS[k].k, label: tl(KINDS[k].k + 'の列', KINDS[k].nm + ' column') })), { id: 'all', ch: '全', label: tl('図譜のすべて', 'The whole codex') }];
function dexRewards() {
  const seen = new Set(S.seen);
  return DEX_SEALS().filter((r) => r.id === 'all' ? seen.size >= EL_KEYS.length * KIND_KEYS.length
    : r.id.startsWith('el:') ? KIND_KEYS.every((k) => seen.has(r.id.slice(3) + ':' + k)) : EL_KEYS.every((el) => seen.has(el + ':' + r.id.slice(5))));
}
const dexClaimable = () => dexRewards().filter((r) => !(S.dexRew || {})[r.id]);
/* ---------- 由来: two or three short lines about where a beast came from and what it is like,
   built from its word (or seal), kind, element and temperament — the same beast always gets the same text ---------- */
const LORE = {
  from: { word: ['「{w}」の言霊から生まれた{sp}。', '「{w}」と書かれた札から目覚めた{sp}。', '「{w}」という言葉にずっと宿っていた{sp}。'],
    fu: ['霊符「{w}」に封じられていた{sp}。', '電線の奥で眠っていた{sp}。霊符「{w}」の力で目覚めた。'], first: ['駅前の電柱に、ずっと前から住んでいた{sp}。'] },
  nature: {
    すなお: ['呼べばすぐに駆けてくる、すなおな子。', '言われたことを、ちゃんと覚えている。'],
    あまえんぼう: ['なでられるのが大好きで、手のひらに頭をすりよせてくる。', 'ひとりで寝るのが苦手。'],
    のんき: ['嵐の夜でも、のんきにあくびをしている。', 'ノイズに囲まれても、あまり気にしていない。'],
    くいしんぼう: ['いい匂いがすると、どこからでも飛んでくる。', 'おやつの時間だけは、ぜったいに忘れない。'],
    わんぱく: ['じっとしているのが苦手で、電線の上を走りまわる。', '雨の日は、水たまりに飛びこむ。'],
    こうきしん: ['見たことのないものに、まっさきに鼻を近づける。', '自動販売機の光を、じっと見つめていることがある。'],
    やさしい: ['けがをした仲間のそばから、離れようとしない。', '迷子の子猫を、家まで送ったことがあるらしい。'],
    さみしがり: ['ひとりにされると、小さな声で鳴く。', '帰りが遅いと、玄関でずっと待っている。'],
    きまぐれ: ['呼んでも来ない日があるが、戦いではいちばん頼りになる。', '気が向いたときだけ、しっぽを振る。'],
    まけずぎらい: ['負けるとくやしくて、夜通し技をみがく。', 'ほかの電獣がほめられると、少しむくれる。'],
    おっとり: ['ゆっくり歩くが、いざという時はだれより速い。', 'ひなたぼっこの場所を、いくつも知っている。'],
    ねぼすけ: ['よく寝る。起こすと、ちょっと不機嫌。', '電柱のてっぺんで、よく昼寝をしている。'],
  },
  el: { rai: ['毛がいつも、ぱちぱちと静電気をおびている。'], en: ['体がいつもぽかぽかしていて、冬はみんなが寄ってくる。'], sou: ['ふれると、ひんやり冷たい。'], sui: ['そばにいると、草木の香りがする。'], mei: ['夜になると、目が少し光る。'] },
  hear: { fox: '尾をふる', wolf: '遠吠えする', kirin: 'ひづめを鳴らす', dragon: 'ひげがぴんと立つ', bird: '羽をふくらませる' },
};
const LORE_EN = {
  from: { word: ['A {sp} born from the word {w}.', 'A {sp} that woke from a talisman reading {w}.', 'A {sp} that had always lived inside the word {w}.'],
    fu: ['A {sp} sealed in the talisman "{w}".', 'A {sp} that slept deep in the power lines, woken by the talisman "{w}".'], first: ['A {sp} that has lived in the power pole by the station for a long, long time.'] },
  nature: {
    すなお: ['A good-natured one that comes running the moment you call.', 'It remembers everything you tell it.'],
    あまえんぼう: ['It loves being petted and nuzzles its head into your palm.', 'It does not like sleeping alone.'],
    のんき: ['Even on stormy nights, it yawns without a care.', 'Surrounded by Noise, it hardly seems to mind.'],
    くいしんぼう: ['At the first good smell, it comes flying from anywhere.', 'It never, ever forgets snack time.'],
    わんぱく: ['It cannot keep still and races along the power lines.', 'On rainy days, it jumps into puddles.'],
    こうきしん: ['It is always the first to sniff anything new.', 'Sometimes it stares at the glow of a vending machine.'],
    やさしい: ['It will not leave the side of a hurt friend.', 'Word is it once walked a lost kitten home.'],
    さみしがり: ['Left alone, it cries in a small voice.', 'When you come home late, it has been waiting at the door the whole time.'],
    きまぐれ: ['Some days it will not come when called, but in a fight it is the one to count on.', 'It wags its tail only when it feels like it.'],
    まけずぎらい: ['After a loss, it practices its skills all night.', 'When other denju get praised, it sulks a little.'],
    おっとり: ['It walks slowly, but when it counts it is faster than anyone.', 'It knows plenty of good spots for sunbathing.'],
    ねぼすけ: ['It sleeps a lot, and gets a little grumpy when woken.', 'It often naps on top of a power pole.'],
  },
  el: { rai: ['Its fur always crackles with static.'], en: ['Its body is always warm, so in winter everyone gathers around it.'], sou: ['It is cool to the touch.'], sui: ['It smells of grass and leaves.'], mei: ['At night, its eyes glow a little.'] },
  hear: { fox: 'wags its tail', wolf: 'howls', kirin: 'stamps its hooves', dragon: 'perks up its whiskers', bird: 'fluffs up its feathers' },
};
function loreOf(d) {
  if (!d) return [];
  const LO = EN ? LORE_EN : LORE;
  const r = rngFrom('lore|' + d.key), pk = (a) => a[Math.floor(r() * a.length)] || '', sp = (d.shiny ? tl('色違いの', 'shiny ') : '') + d.species;
  const word = d.line === WORD_LINE, first = d.line !== WORD_LINE && d.line !== FU_LINE;
  // English: a kanji pair reads with its meaning, any other word in quotes
  const wEn = isKanjiPair(d.num) ? `${d.num} (${kanjiGloss(d.num)})` : `"${d.num}"`;
  const L1 = pk(first ? LO.from.first : word ? LO.from.word : LO.from.fu).replace(/\{w\}/g, word ? (EN ? wEn : d.num) : codeShow(d.num)).replace('{sp}', sp);
  const nat = typeof natureOf === 'function' ? natureOf(d) : 'すなお';
  const L2 = pk(LO.nature[nat] || LO.nature.すなお);
  const L3 = word ? tl(`「${d.num}」と聞くと、${LORE.hear[d.kind] || '耳を立てる'}。`, `When it hears "${isKanjiPair(d.num) ? kanjiRead(d.num) : d.num}", it ${LORE_EN.hear[d.kind] || 'pricks up its ears'}.`) : pk(LO.el[d.el] || LO.el.rai);
  return [L1, L2, L3];
}
/* ---------- 留守番: while you are away the leader gathers 霊子 (up to 12 hours; more as you clear wards and grow close) ---------- */
const AWAY_MAX_H = 12;
const awayRate = () => { const e = leaderEntry(); return (60 + 40 * Math.min(S.cleared, STAGES.length)) * (1 + ((e && e.aff) || 0) * 0.1); };
const awayHours = () => clamp((Date.now() - (S.awayT || Date.now())) / 3600e3, 0, AWAY_MAX_H);
const awayAmount = () => Math.floor(awayHours() * awayRate());
/* ---------- promotion (昇格): a favourite at Lv30 with ♥5 can climb one rank, up to 稀 ---------- */
const PROMO_COST = [5000, 20000]; // 並→良, 良→稀 (霊子)
const promoNext = (e) => { const r = RARITY[dnaOf(e).rar].rank; return r < 2 ? r + 1 : -1; };
const promoReady = (e) => promoNext(e) > 0 && e.lv >= MAX_LV && (e.aff || 0) >= AFF_MAX;
/* ---------- release (送還) ---------- */
const RELEASE_BASE = { N: 40, R: 120, SR: 500, UR: 1800 };
const releaseValue = (e) => RELEASE_BASE[dnaOf(e).rar] + (e.lv - 1) * 30;
/* ---------- shop catalog (JPY; the store's own price label is shown when available) ---------- */
const SHOP = [
  { id: 'denju.starter', type: 'consumable', kind: 'starter', name: tl('はじまりの符', 'Starter Talismans'), yen: 480, give: { fu: 10, reishi: 3000 }, once: true, desc: tl('召喚符×10 と 霊子3,000。1回だけ買えるお得な包み', 'Talisman ×10 and 3,000 Spirit. A one-time bundle') },
  { id: 'denju.moon', type: 'consumable', kind: 'moon', name: tl('月の符', 'Moon Talisman'), yen: 600, give: { fu: 3 }, daily: 1, days: 30, desc: tl('すぐに召喚符×3。さらに30日間、毎日ログインで召喚符×1（最大33枚）', 'Talisman ×3 now, then Talisman ×1 at each daily login for 30 days (up to 33)') },
  { id: 'denju.noads', type: 'nonconsumable', kind: 'noads', name: tl('広告なし', 'No Ads'), yen: 980, desc: tl('戦いのあとの全画面広告が出なくなる。復活と報酬2倍も広告を見ずに使える（無料の召喚符をもらう広告は任意でそのまま）', 'No full-screen ads after battles. Revive and double rewards without ads (the optional ad for a free talisman stays)') },
  { id: 'denju.fu5', type: 'consumable', kind: 'fu', name: tl('召喚符×5', 'Talisman ×5'), yen: 500, give: { fu: 5 } },
  { id: 'denju.fu11', type: 'consumable', kind: 'fu', name: tl('召喚符×11', 'Talisman ×11'), yen: 1000, give: { fu: 11 }, tag: '+1' },
  { id: 'denju.fu34', type: 'consumable', kind: 'fu', name: tl('召喚符×34', 'Talisman ×34'), yen: 3000, give: { fu: 34 }, tag: '+4' },
  { id: 'denju.fu60', type: 'consumable', kind: 'fu', name: tl('召喚符×60', 'Talisman ×60'), yen: 5000, give: { fu: 60 }, tag: '+10' },
  { id: 'denju.fu125', type: 'consumable', kind: 'fu', name: tl('召喚符×125', 'Talisman ×125'), yen: 10000, give: { fu: 125 }, tag: '+25' },
];
// monthly spending limits by age (the industry's voluntary guideline for minors)
const AGE_BANDS = [
  { id: 'u16', label: tl('15歳以下', '15 or under'), limit: 5000 },
  { id: 'u20', label: tl('16〜19歳', '16 to 19'), limit: 10000 },
  { id: 'adult', label: tl('20歳以上', '20 or over'), limit: Infinity },
];
const ageLimit = () => (AGE_BANDS.find((a) => a.id === S.age) || AGE_BANDS[0]).limit;
function applyPurchase(it, txId) {
  if (txId) { if (S.tx.includes(txId)) return false; S.tx = [txId, ...S.tx].slice(0, 80); }
  if (it.give) grant(it.give, true);
  if (it.kind === 'moon') { S.moonUntil = Math.max(Date.now(), S.moonUntil) + it.days * 86400e3; S.day.moon = true; }
  if (it.kind === 'noads') S.noAds = true;
  S.bought[it.id] = (S.bought[it.id] || 0) + 1;
  S.spend.yen += it.yen;
  return true;
}
// a purchase that finished outside the purchase sheet (Ask to Buy approval, an interrupted purchase)
function lateGrant(tx) {
  const it = tx && SHOP.find((x) => x.id === tx.product); if (!it) return;
  if (it.type === 'nonconsumable') { if (it.kind === 'noads' && !S.noAds) { S.noAds = true; persist(); UI.toast(tl('「広告なし」が有効になりました', '"No Ads" is on')); } return; }
  if (!applyPurchase(it, tx.id)) return;
  persist(); reishiRefresh(); if (typeof shopRefresh === 'function') shopRefresh(); UI.toast(tl(`${it.name}を受け取りました`, `Received ${it.name}`), 3200);
}
// non-consumables live in the store account: re-apply what the store says is owned
async function syncEntitlements(loud) {
  const ids = loud ? await NB.restore() : await NB.owned();
  if (ids === null) { if (loud) UI.toast(tl('この環境では購入を復元できません', 'Purchases cannot be restored here')); return; }
  let n = 0;
  for (const id of ids) { if (id === 'denju.noads' && !S.noAds) { S.noAds = true; n++; } }
  persist();
  if (loud) UI.toast(n ? tl('「広告なし」を復元しました', 'Restored "No Ads"') : tl('復元できる購入はありませんでした', 'Nothing to restore'));
}

/* ---------- 異変: run modifiers (the weekly 百鬼夜行 draws one hard and one kind) ---------- */
const MOD_DEF = { rate: 1, eHp: 1, xp: 1, reso: 1, heal: 1, pHp: 1, spd: 1, ult: 1, swiftSpd: 1, brute: 1, swift: 1, caster: 1, eliteEvery: 0 };
const HK_HARD = [
  { id: 'swarm', name: tl('百鬼の宴', 'Demon Feast'), desc: tl('ノイズが1.4倍の数で押し寄せる', 'Noise swarms in at 1.4× the numbers'), fx: { rate: 1.4 } },
  { id: 'oni', name: tl('鬼の行列', 'Oni Procession'), desc: tl('鬼が2倍あらわれる', 'Twice as many oni'), fx: { brute: 2.2 } },
  { id: 'kama', name: tl('かまいたちの夜', 'Night of the Kamaitachi'), desc: tl('鎌鼬が多く、速い', 'More kamaitachi, and faster'), fx: { swift: 1.8, swiftSpd: 1.2 } },
  { id: 'lantern', name: tl('提灯行列', 'Lantern Parade'), desc: tl('提灯お化けが2倍', 'Twice as many lantern ghosts'), fx: { caster: 2.4 } },
  { id: 'musha', name: tl('武者ぞろい', 'Warrior Muster'), desc: tl('精鋭が40秒ごとに来る', 'An elite arrives every 40 seconds'), fx: { eliteEvery: 40 } },
  { id: 'maga', name: tl('禍つ夜', 'Cursed Night'), desc: tl('ノイズの体力が1.3倍', 'Noise has 1.3× health'), fx: { eHp: 1.3 } },
];
const HK_BOON = [
  { id: 'rain', name: tl('霊子の雨', 'Spirit Rain'), desc: tl('霊格の経験が1.4倍', 'Level XP ×1.4'), fx: { xp: 1.4 } },
  { id: 'reso', name: tl('共鳴日和', 'Resonant Day'), desc: tl('共鳴する範囲が1.5倍', 'Resonance range ×1.5'), fx: { reso: 1.5 } },
  { id: 'heal', name: tl('癒しの灯', 'Healing Light'), desc: tl('回復がよく落ちる', 'Healing drops more often'), fx: { heal: 2.5 } },
  { id: 'guard', name: tl('電獣の加護', 'Denju Blessing'), desc: tl('最大HPが1.3倍', 'Max HP ×1.3'), fx: { pHp: 1.3 } },
  { id: 'wind', name: tl('追い風', 'Tailwind'), desc: tl('移動が1.2倍速い', 'Move 1.2× faster'), fx: { spd: 1.2 } },
  { id: 'seal', name: tl('封印のゆるみ', 'Loosened Seal'), desc: tl('封印解放が1.5倍たまりやすい', 'Seal Release charges 1.5× faster'), fx: { ult: 1.5 } },
];
function modsOf(list) { const m = { ...MOD_DEF }; for (const x of list || []) for (const k in x.fx) m[k] = k === 'eliteEvery' ? x.fx[k] : m[k] * x.fx[k]; return m; }

/* ---------- 季節の祭り: a festival each month from Japan's calendar, the same for everyone ----------
   Four goals that count only what happens during the month (出撃・ノイズ・大禍・なでた日), each with a reward; all four
   press the month's 朱印 into the 朱印帳 (honour only). Nothing depends on paid summons or on owning particular
   beasts (景品表示法・カード合わせ). The month turns at 4:00 on the 1st, like the day. */
const MATSURI = [null,
  { name: tl('初詣', 'New Year Visit'), ch: '詣', col: '#ffcf5a', fx: ['fall', '#ffffff', 'dot'], line: tl('新しい年の電線に、最初の灯をともす。', 'Light the first lamp of the year on the power lines.') },
  { name: tl('節分', 'Setsubun'), ch: '鬼', col: '#ff6a4a', fx: ['fall', '#ffb3d1', 'petal'], line: tl('鬼は外、福は内。梅の咲く街で、鬼のノイズを追いはらう。', 'Demons out, fortune in! Chase the oni Noise from the plum-blossom streets.') },
  { name: tl('桃の節句', 'Peach Festival'), ch: '桃', col: '#ff9ad0', fx: ['fall', '#ffc2dc', 'petal'], line: tl('桃の花の下で、電獣たちの無事を祈る。', 'Under the peach blossoms, pray for the denju\'s safety.') },
  { name: tl('花見', 'Hanami'), ch: '桜', col: '#ffb7d5', fx: ['fall', '#ffd6e6', 'petal'], line: tl('夜桜の電線に、花びらと霊火が舞う。', 'Under the night cherries, petals and spirit flames dance along the power lines.') },
  { name: tl('端午', 'Carp Streamers'), ch: '鯉', col: '#5ab8ff', fx: ['fall', '#9dffb0', 'leaf'], line: tl('新緑の風に、鯉のぼりが電線より高く泳ぐ。', 'On the fresh green wind, carp streamers swim higher than the power lines.') },
  { name: tl('蛍狩り', 'Firefly Night'), ch: '蛍', col: '#b8ff5a', fx: ['rise', '#d6ff7a', 'glow'], line: tl('梅雨の夜、紫陽花の路地に蛍がともる。', 'On rainy-season nights, fireflies glow in the hydrangea alleys.') },
  { name: tl('七夕', 'Tanabata'), ch: '星', col: '#8fe8ff', fx: ['twinkle', '#dff8ff', 'dot'], line: tl('天の川の下、短冊に願いを書いて電線につるす。', 'Beneath the Milky Way, write a wish on a paper strip and hang it on the power lines.') },
  { name: tl('盆の灯', 'Obon Lights'), ch: '灯', col: '#ffb45a', fx: ['rise', '#ffc070', 'glow'], line: tl('迎え火と送り火。灯籠の光が、帰り道を照らす。', 'Welcoming fires and farewell fires. Lantern light shows the way home.') },
  { name: tl('月見', 'Moon Viewing'), ch: '月', col: '#ffe9a8', fx: ['drift', '#fff1c2', 'dot'], line: tl('満月の夜、すすきの向こうで電獣が耳をすます。', 'On the night of the full moon, the denju listen beyond the silver grass.') },
  { name: tl('化け祭り', 'Yokai Masquerade'), ch: '化', col: '#ff7a1e', fx: ['rise', '#bfe6ff', 'glow'], line: tl('十月の終わり、妖も人も化けて歩く百鬼の祭り。', 'At the end of October, yokai and people alike walk in disguise: a festival of a hundred demons.') },
  { name: tl('紅葉狩り', 'Autumn Leaves'), ch: '紅', col: '#ff4a26', fx: ['fall', '#ff6a3a', 'leaf'], line: tl('色づいた山から、紅葉が街まで降りてくる。', 'Red leaves drift down from the mountains into the city.') },
  { name: tl('年越し', 'Year\'s End'), ch: '鐘', col: '#cfe0ff', fx: ['fall', '#ffffff', 'dot'], line: tl('除夜の鐘が百八つ。電線の雪を払って、新しい年へ。', 'The temple bell rings 108 times. Brush the snow off the power lines and step into the new year.') },
];
const MT_GOALS = [
  { k: 'runs', name: tl('出撃を20回', 'Go on 20 sorties'), need: 20, rew: { fu: 1 } },
  { k: 'kills', name: tl('ノイズを6,000体祓う', 'Banish 6,000 Noise'), need: 6000, rew: { reishi: 3000 } },
  { k: 'bosses', name: tl('大禍を10体祓う', 'Banish 10 Calamities'), need: 10, rew: { fu: 1 } },
  { k: 'pets', name: tl('電獣をなでる（7日）', 'Pet a denju (7 days)'), need: 7, rew: { reishi: 2000 } },
];
const MT_BONUS = { fu: 2 };
function mtNow(ms = Date.now()) {
  const key = monthKeyOf(ms), y = +key.slice(0, 4), m = +key.slice(5, 7);
  return { key, m, ...MATSURI[m], end: new Date(y, m, 1, 4).getTime() }; // 4:00 on the 1st of the next month
}
function mtState() { const k = monthKeyOf(); if (!S.mt || S.mt.key !== k) S.mt = { key: k, c: {}, got: [], seal: false }; return S.mt; }
function mtAdd(k, n = 1) { const M = mtState(); M.c[k] = (M.c[k] || 0) + n; }
const mtDone = (g) => (mtState().c[g.k] || 0) >= g.need;
const mtClaimable = () => { const M = mtState(); return MT_GOALS.filter((g, i) => !M.got.includes(i) && mtDone(g)).length + (M.got.length === MT_GOALS.length && !M.seal ? 1 : 0); };

/* ---------- 封印の加護: a gentler ward for a player who keeps losing ----------
   The first ward is gentler until it is purified (a new player's first battles), and a ward that has beaten you
   in a row grows a little gentler each time (noise strength and hits −8%, up to 3 times), on its normal depth only.
   The count resets with the first win there. Depths, 異変 and 百鬼夜行 never change: those are the measured ones. */
const KAGO_MAX = 3;
function kagoOf(st, dp, o = {}) {
  if (o.endless || o.chal || o.demo || dp > 0) return null;
  const n = Math.min(KAGO_MAX, (S.fails && S.fails[st.id]) || 0), first = st === STAGES[0] && S.cleared === 0;
  if (!n && !first) return null;
  return { n, first, hp: (1 - 0.08 * n) * (first ? 0.8 : 1), dmg: (1 - 0.08 * n) * (first ? 0.75 : 1) };
}

/* ---------- 百鬼夜行: the weekly endless night ----------
   Everyone gets the same ward and the same two 異変 each week (Monday 4:00 to Monday 4:00), and the same
   difficulty curve whatever their party, so "how long did you last" can be compared and shared.
   Opens after 三ノ区. The first time a week's run lasts 3 / 5 / 7 / 10 minutes, a reward. */
const HK_OPEN = 3;
// the week turns at the same moment everywhere — Monday 4:00 in Japan (UTC+9), with the Game Center weekly board —
// so players in every country share one week's ward and 異変 (for Japan this is the local Monday 4:00, as before)
const weekKeyOf = (ms = Date.now()) => { const d = new Date(ms + 5 * 3600e3); d.setUTCHours(12, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };
const weekRange = (wk) => { const d = new Date(wk + 'T12:00:00'), e = new Date(d); e.setDate(d.getDate() + 6); if (EN) { const f = (x) => x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); return f(d) + ' – ' + f(e); } return `${d.getMonth() + 1}/${d.getDate()}〜${e.getMonth() + 1}/${e.getDate()}`; };
function hkWeek(wk = weekKeyOf()) {
  const r = rngFrom('hyakki/v1/' + wk), si = Math.floor(r() * STAGES.length);
  const order = STAGES.map((s, i) => i).sort(() => r() - 0.5); // the 大禍 that follow, in this week's order
  return { wk, si, mods: [HK_HARD[Math.floor(r() * HK_HARD.length)], HK_BOON[Math.floor(r() * HK_BOON.length)]], order: [si, ...order.filter((i) => i !== si)] };
}
const HK_MILES = [[180, { reishi: 1500 }], [300, { fu: 1 }], [420, { fu: 2 }], [600, { fu: 3 }]];
function hkState() { const wk = weekKeyOf(); if (!S.hk || S.hk.wk !== wk) S.hk = { wk, best: 0, kills: 0, got: [], all: (S.hk && S.hk.all) || 0, runs: 0 }; return S.hk; }
const hkOpen = () => S.cleared >= HK_OPEN;
/* Game Center (iOS): 百鬼夜行 ranks everyone by the time survived, on a weekly board that resets with the
   in-game week (Monday 4:00 JST) and an all-time board. Scores go up once per finished run, in centiseconds.
   A run that ends while signed out (or offline) waits in S.gcq and goes up at the next sign-in. */
const GC_LB = { week: 'denju.hyakki.weekly', best: 'denju.hyakki.best' };
// the weekly board's first week begins Monday 2026-10-05 4:00 JST (a recurring board cannot start in the past);
// before that the ranking button shows the all-time board and 「友だちと競う」 (built on the weekly board) stays hidden
const GC_WEEK_START = Date.UTC(2026, 9, 4, 19, 0, 0);
const gcWeekLive = () => Date.now() >= GC_WEEK_START;
const gcSend = (ids, cs) => (NB.gc.on ? NB.N.gc.score(ids, cs).then((r) => !!(r && r.ok)) : Promise.resolve(false));
async function gcHk(sec, wk) {
  if (!NB.gcAvail) return false;
  const cs = Math.round(sec * 100), thisWeek = wk === weekKeyOf() && gcWeekLive();
  if (await gcSend(thisWeek ? [GC_LB.week, GC_LB.best] : [GC_LB.best], cs)) return true;
  const q = (S.gcq = S.gcq || {});
  if (thisWeek && (!q.week || q.week.wk !== wk || q.week.cs < cs)) q.week = { wk, cs };
  q.best = Math.max(q.best || 0, cs); persist();
  return false;
}
// a Game Center activity (iOS 26: a friend's challenge, the Games app) asks for 百鬼夜行: go there when free
const GC_ACT = { hk: 'denju.activity.hyakki' };
function gcActivity(id) {
  if (id !== GC_ACT.hk) return;
  const go2 = () => {
    if (BTL && !BTL.over) { UI.toast(tl('戦いが終わったら、百鬼夜行へ', 'Finish this battle first, then the Night Parade'), 2600); return; }
    if (!hkOpen()) { UI.toast(tl(`百鬼夜行は${STAGES[HK_OPEN - 1].ku}を浄化すると開きます`, `The Night Parade opens once you purify ${STAGES[HK_OPEN - 1].ku}`), 3200); return; }
    // to this week's 百鬼夜行 card, one tap from the night (never straight into a battle the player did not start)
    document.querySelectorAll('.modal').forEach((m) => { if (m.id !== 'cloud') m.hidden = true; });
    AU.init(); go('sortie'); const c = $('#hk-card'); if (c) { c.scrollIntoView({ block: 'start' }); c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); }
    UI.toast(tl('今週の百鬼夜行へ', "To this week's Night Parade"), 2000);
  };
  if (UI.view === 'title' || UI.view === 'cine' || !S.beasts.length) { setTimeout(() => { if (S.beasts.length) go2(); }, 1500); return; }
  go2();
}
async function gcFlush() {
  const q = S.gcq; if (!q || !NB.gc.on || NB.gc.flushing) return;
  NB.gc.flushing = true;
  try {
    if (q.week && (q.week.wk !== weekKeyOf() || !gcWeekLive() || (await gcSend([GC_LB.week], q.week.cs)))) delete q.week; // a closed week is dropped
    if (q.best && (await gcSend([GC_LB.best], q.best))) delete q.best;
    if (!q.week && !q.best) delete S.gcq;
    persist();
  } finally { NB.gc.flushing = false; }
}
// the night thickens the same way for everyone: noise strength by elapsed seconds
// (after 2:00 it compounds 60% a minute, so a stronger party lasts minutes longer, not forever)
const hkMult = (t) => (t < 120 ? 1 + t / 40 : 4 * Math.pow(1.6, (t - 120) / 60));
// hits grow slowly (linear): a party that keeps up with the noise's toughness keeps living
const hkDmg = (t) => (1 + t / 50) * (t > 420 ? Math.pow(2, (t - 420) / 60) : 1); // …until 7:00, then it doubles every minute
const hkSpd = (t) => 1 + Math.max(0, t - 180) / 600; // and from 3:00 the noise gets quicker
const fmtMS = (sec) => tl(`${Math.floor(sec / 60)}分${String(Math.floor(sec % 60)).padStart(2, '0')}秒`, `${Math.floor(sec / 60)}m ${String(Math.floor(sec % 60)).padStart(2, '0')}s`);

/* ---------- 異変に挑む: two challenges per cleared ward (Megabonk-style), 召喚符×2 the first time each ---------- */
const BINDS = {
  solo: { id: 'solo', name: tl('一騎当千', 'Lone Warrior'), desc: tl('先頭の1体だけで出撃', 'Only your lead denju goes out'), solo: true, fx: {} },
  noreso: { id: 'noreso', name: tl('共鳴封じ', 'No Resonance'), desc: tl('電柱のそばでも共鳴しない', 'Power poles give no resonance'), fx: { reso: 0 } },
  noheal: { id: 'noheal', name: tl('癒し断ち', 'No Healing'), desc: tl('鬼が回復を落とさない', 'Oni drop no healing'), fx: { heal: 0 } },
};
const CHAL = { s1: ['swarm', 'solo'], s2: ['oni', 'noreso'], s3: ['kama', 'noheal'], s4: ['lantern', 'solo'], s5: ['musha', 'noreso'], s6: ['maga', 'noheal'], s7: ['swarm', 'solo'], s8: ['kama', 'noheal'], s9: ['oni', 'noreso'], s10: ['musha', 'solo'] };
const CHAL_REW = { fu: 2 };
const chalDef = (k) => BINDS[k] || HK_HARD.find((m) => m.id === k);
const chalDone = (stId, k) => !!(S.chal && S.chal[stId] && S.chal[stId].includes(k));

/* ---------- 偉業: long goals. Rewards follow play only — never a set of particular beasts (カード合わせ),
   never the number of paid summons ---------- */
const FEATS = [
  { id: 'k1', name: tl('ノイズを1,000体祓う', 'Banish 1,000 Noise'), stat: 'kills', need: 1000, rew: { reishi: 1000 } },
  { id: 'k2', name: tl('ノイズを1万体祓う', 'Banish 10,000 Noise'), stat: 'kills', need: 10000, rew: { fu: 2 } },
  { id: 'k3', name: tl('ノイズを5万体祓う', 'Banish 50,000 Noise'), stat: 'kills', need: 50000, rew: { fu: 3 } },
  { id: 'k4', name: tl('ノイズを20万体祓う', 'Banish 200,000 Noise'), stat: 'kills', need: 200000, rew: { fu: 5 } },
  { id: 'b1', name: tl('大禍を5体祓う', 'Banish 5 Calamities'), stat: 'bosses', need: 5, rew: { reishi: 1500 } },
  { id: 'b2', name: tl('大禍を30体祓う', 'Banish 30 Calamities'), stat: 'bosses', need: 30, rew: { fu: 2 } },
  { id: 'b3', name: tl('大禍を100体祓う', 'Banish 100 Calamities'), stat: 'bosses', need: 100, rew: { fu: 4 } },
  { id: 'c1', name: tl('三ノ区まで浄化する', 'Purify up to Ward 3'), stat: 'cleared', need: 3, rew: { fu: 2 } },
  { id: 'c2', name: tl('第一章を浄化する', 'Purify Chapter 1'), stat: 'cleared', need: 6, rew: { fu: 3 } },
  { id: 'c3', name: tl('第二章を浄化する', 'Purify Chapter 2'), stat: 'cleared', need: 10, rew: { fu: 5 } },
  { id: 'd1', name: tl('どこかの区を深度5で浄化', 'Purify any ward at Depth 5'), stat: 'depth', need: 5, rew: { fu: 2 } },
  { id: 'd2', name: tl('どこかの区を深度10で浄化', 'Purify any ward at Depth 10'), stat: 'depth', need: 10, rew: { fu: 3 } },
  { id: 'd3', name: tl('どこかの区を深度20で浄化', 'Purify any ward at Depth 20'), stat: 'depth', need: 20, rew: { fu: 5 } },
  { id: 'h1', name: tl('百鬼夜行で5分生きのびる', 'Survive 5 minutes in the Night Parade'), stat: 'hk', need: 300, rew: { fu: 1 }, time: true },
  { id: 'h2', name: tl('百鬼夜行で7分生きのびる', 'Survive 7 minutes in the Night Parade'), stat: 'hk', need: 420, rew: { fu: 2 }, time: true },
  { id: 'h3', name: tl('百鬼夜行で10分生きのびる', 'Survive 10 minutes in the Night Parade'), stat: 'hk', need: 600, rew: { fu: 4 }, time: true },
  { id: 'a1', name: tl('異変を3つ乗りこえる', 'Overcome 3 Anomalies'), stat: 'chal', need: 3, rew: { fu: 2 } },
  { id: 'a2', name: tl('異変を10乗りこえる', 'Overcome 10 Anomalies'), stat: 'chal', need: 10, rew: { fu: 4 } },
  { id: 'w1', name: tl('言霊召喚で10体と契約', 'Contract 10 denju by Kanji Summon'), stat: 'words', need: 10, rew: { reishi: 1000 } },
  { id: 'w2', name: tl('言霊召喚で50体と契約', 'Contract 50 denju by Kanji Summon'), stat: 'words', need: 50, rew: { fu: 2 } },
  { id: 'p1', name: tl('電獣を昇格させる', 'Ascend a denju'), stat: 'promo', need: 1, rew: { reishi: 2000 } },
  { id: 'n1', name: tl('なかよし♥5の電獣が3体', 'Have 3 denju at Bond ♥5'), stat: 'bond', need: 3, rew: { fu: 2 } },
  { id: 'u1', name: tl('封印解放を30回', 'Use Seal Release 30 times'), stat: 'ult', need: 30, rew: { reishi: 2000 } },
  { id: 'x1', name: tl('覚醒を20回', 'Awaken 20 times'), stat: 'awake', need: 20, rew: { fu: 1 } },
  { id: 'f1', name: tl('合体技を3種類見つける', 'Discover 3 Fusions'), stat: 'fused', need: 3, rew: { fu: 2 } },
  { id: 'f2', name: tl('合体技を10種類すべて見つける', 'Discover all 10 Fusions'), stat: 'fused', need: 10, rew: { fu: 5 } },
  { id: 'y1', name: tl('妖怪録を15種うめる', 'Fill 15 entries of the Yokai Log'), stat: 'yk', need: 15, rew: { fu: 2 } },
  { id: 'y2', name: tl('妖怪録を30種すべてうめる', 'Fill all 30 entries of the Yokai Log'), stat: 'yk', need: 30, rew: { fu: 5 } },
];
function featStat(k) {
  const st = S.stat || {};
  switch (k) {
    case 'cleared': return S.cleared;
    case 'depth': return Math.max(0, ...Object.values(S.dp || {}));
    case 'hk': return (S.hk && S.hk.all) || 0;
    case 'chal': return Object.values(S.chal || {}).reduce((a, x) => a + x.length, 0);
    case 'words': return S.beasts.filter((b) => b.line === WORD_LINE).length;
    case 'promo': return S.beasts.filter((b) => (b.promo | 0) > 0).length;
    case 'bond': return S.beasts.filter((b) => (b.aff | 0) >= AFF_MAX).length;
    case 'fused': return (S.fused || []).length;
    case 'yk': return typeof YOKAI === 'undefined' ? 0 : YOKAI.filter((y) => ykSeen(y.k)).length;
    default: return st[k] || 0;
  }
}
const featsClaimable = () => FEATS.filter((f) => !(S.feat || []).includes(f.id) && featStat(f.stat) >= f.need).length;
function statAdd(k, n = 1) { S.stat = S.stat || {}; S.stat[k] = (S.stat[k] || 0) + n; }
// Game Center achievements mirror 偉業 (ids denju.feat.<id>): each goes up once its condition is met, whether or not
// the reward was taken yet. Reported when signed in: at sign-in, after every run, when the home screen comes back.
async function gcAch() {
  if (!NB.gc.on || NB.gc.achBusy) return;
  const sent = (S.gca = S.gca || []), due = FEATS.filter((f) => !sent.includes(f.id) && featStat(f.stat) >= f.need);
  if (!due.length) return;
  NB.gc.achBusy = true;
  try {
    const r = await NB.N.gc.achieve(due.map((f) => 'denju.feat.' + f.id));
    if (r && r.ok) { for (const f of due) sent.push(f.id); persist(); }
  } finally { NB.gc.achBusy = false; }
}

/* ---------- 妖怪録: every yokai shape the noise has taken, and every 大禍 — filled in by meeting them ----------
   The lines mix what the old tales say with what the noise is in this world. Only the fact of having
   fought them counts (no reward tied to any beast). */
const YOKAI = [
  { k: '人魂', n: tl('人魂', 'Hitodama'), r: tl('ひとだま', 'soul flame'), t: 'mote', where: 's1', lore: tl('夜にふわりと浮かぶ青白い火の玉。人の魂が抜け出したものと言われる。ノイズがいちばんよく写す姿。', 'A pale blue fireball that floats through the night, said to be a soul that has slipped out of a body. The shape the Noise copies most often.') },
  { k: '狐火', n: tl('狐火', 'Kitsunebi'), r: tl('きつねび', 'foxfire'), t: 'mote', where: 's4', lore: tl('狐がともすという怪しい火。王子稲荷の大晦日の狐火が名高い。稲荷坂では列をなして坂をのぼる。', 'Eerie flames said to be lit by foxes. The foxfires of Oji Inari on New Year\'s Eve are famous. On the Inari Slope they climb in a line.') },
  { k: '鬼火', n: tl('鬼火', 'Onibi'), r: tl('おにび', 'demon fire'), t: 'mote', where: 's5', lore: tl('湿った夜の野に浮かぶ青い火。雨の晩に現れやすいという。嵐の丘の草むらに灯る。', 'Blue flames that float over damp fields at night, said to appear most on rainy evenings. They glow in the grass on the stormy hill.') },
  { k: '迷い火', n: tl('迷い火', 'Mayoibi'), r: tl('まよいび', 'lost flame'), t: 'mote', where: 's7', lore: tl('終電を逃した人の心細さを写したノイズ。止まった駅の灯りのまわりをさまよう。', 'Noise that copies the loneliness of someone who missed the last train. It wanders around the lights of the stopped station.') },
  { k: '雑音', n: tl('雑音', 'Zatsuon'), r: tl('ざつおん', 'static'), t: 'mote', where: 's8', lore: tl('電波のすき間から生まれたノイズ。ザーッという音とともに、画面の粒のように湧いて出る。', 'Noise born in the gaps between radio waves. It swarms out with a hiss, like the grain on a screen.') },
  { k: '海月火', n: tl('海月火', 'Kuragebi'), r: tl('くらげび', 'jellyfish flame'), t: 'mote', where: 's9', lore: tl('水の上をただよう、くらげのような青い火。沈んだ街の灯りを数えるように揺れる。', 'A blue flame like a jellyfish, drifting on the water. It sways as if counting the lights of the sunken city.') },
  { k: '黄泉火', n: tl('黄泉火', 'Yomotsubi'), r: tl('よもつび', 'Yomi flame'), t: 'mote', where: 's10', lore: tl('常世の野に灯る火。倒しても、電柱の光が届かないところでは、ふたたび灯ることがある。', 'Fires that burn in the fields of Tokoyo. Even when put out, they can flicker back where the light of a power pole does not reach.') },
  { k: '鎌鼬', n: tl('鎌鼬', 'Kamaitachi'), r: tl('かまいたち', 'sickle weasel'), t: 'swift', where: 's1', lore: tl('つむじ風に乗って人を切りつける妖怪。三匹組で、一匹が倒し、一匹が切り、一匹が薬を塗るとも言われる。', 'A yokai that rides the whirlwind and slashes people. Some say they come in threes: one knocks you down, one cuts, and one applies medicine.') },
  { k: '鉄鼠', n: tl('鉄鼠', 'Tesso'), r: tl('てっそ', 'iron rat'), t: 'swift', where: 's7', lore: tl('平安の僧・頼豪の怨念が八万四千の鼠となり、比叡山の経典をかじったという。地下の線路を群れで走る。', 'The grudge of the Heian-era monk Raigo became 84,000 rats that gnawed the sutras of Mount Hiei. They run in packs along the underground tracks.') },
  { k: '烏天狗', n: tl('烏天狗', 'Karasu Tengu'), r: tl('からすてんぐ', 'crow tengu'), t: 'swift', where: 's8', lore: tl('烏のくちばしと翼をもつ天狗。大天狗に仕え、群れで空から舞い降りる。', 'A tengu with a crow\'s beak and wings. Servants of the Great Tengu, they swoop down from the sky in flocks.') },
  { k: '舟幽霊', n: tl('舟幽霊', 'Funayurei'), r: tl('ふなゆうれい', 'ship ghost'), t: 'swift', where: 's9', lore: tl('海で亡くなった者の霊。「柄杓を貸せ」と舟に水を入れるので、底を抜いた柄杓を渡すとよいという。', 'Spirits of those lost at sea. They beg for a ladle and fill boats with water, so it is said you should hand them one with no bottom.') },
  { k: '黄泉醜女', n: tl('黄泉醜女', 'Yomotsu-shikome'), r: tl('よもつしこめ', 'hags of Yomi'), t: 'swift', where: 's10', lore: tl('黄泉の国の鬼女。逃げるイザナギを追ったが、投げられた葡萄や筍を食べているうちに逃げられたという。', 'Demon women of the land of the dead. They chased the fleeing Izanagi, but he escaped while they ate the grapes and bamboo shoots he threw behind him.') },
  { k: '鬼', n: tl('鬼', 'Oni'), r: tl('おに', 'ogre'), t: 'brute', where: 's1', lore: tl('角と牙をもち、金棒をふるう。節分には豆をまかれて逃げていく。倒すと回復の霊子を落とすことがある。', 'Horned and fanged, it swings an iron club. At Setsubun, people throw beans to drive it away. It sometimes drops healing spirit when banished.') },
  { k: '赤鬼', n: tl('赤鬼', 'Aka-oni'), r: tl('あかおに', 'red oni'), t: 'brute', where: 's2', lore: tl('赤い肌の鬼。高架下の暗がりで、電車の音にまぎれて近づいてくる。', 'A red-skinned oni. In the dark under the tracks, it creeps closer, hidden by the roar of the trains.') },
  { k: '青鬼', n: tl('青鬼', 'Ao-oni'), r: tl('あおおに', 'blue oni'), t: 'brute', where: 's3', lore: tl('青い肌の鬼。変電所の冷たい光を好む。昔話では赤鬼と組んで出てくることが多い。', 'A blue-skinned oni that likes the cold light of the substation. In folktales it often appears alongside the red oni.') },
  { k: '黒鬼', n: tl('黒鬼', 'Kuro-oni'), r: tl('くろおに', 'black oni'), t: 'brute', where: 's7', lore: tl('地下の闇に慣れた鬼。終電の音がすると、線路から身を引く。', 'An oni used to the darkness underground. At the sound of the last train, it steps back from the tracks.') },
  { k: '牛鬼', n: tl('牛鬼', 'Ushi-oni'), r: tl('うしおに', 'ox demon'), t: 'brute', where: 's9', lore: tl('牛の頭と、鬼や蜘蛛の体をもつと伝わる、西日本の海辺の妖怪。濡れ女と組んで人を襲う話もある。', 'A seaside yokai of western Japan, said to have the head of an ox and the body of an oni or a spider. Some tales pair it with the nure-onna.') },
  { k: '八雷', n: tl('八雷', 'Yakusa no Ikazuchi'), r: tl('やくさのいかづち', 'eight thunders'), t: 'brute', where: 's10', lore: tl('黄泉の国でイザナミの体に生じた八柱の雷の神。黄泉の軍勢を率いてイザナギを追ったという。', 'Eight thunder gods born from Izanami\'s body in the land of the dead. They led the armies of Yomi in pursuit of Izanagi.') },
  { k: '提灯お化け', n: tl('提灯お化け', 'Chochin-obake'), r: tl('ちょうちんおばけ', 'lantern ghost'), t: 'caster', where: 's1', lore: tl('古い提灯が化けたつくも神。破れ目が口になり、長い舌を出して笑う。離れたところから火の玉を撃つ。', 'An old paper lantern turned tsukumogami. Its torn slit becomes a mouth that laughs with a long tongue. It shoots fireballs from afar.') },
  { k: '鎧武者', n: tl('鎧武者', 'Yoroi Musha'), r: tl('よろいむしゃ', 'armored warrior'), t: 'elite', where: 's1', lore: tl('古い鎧に宿ったノイズの精鋭。金の三日月の前立てと、背中の旗が目印。倒すと霊箱を落とす。', 'An elite of the Noise dwelling in an old suit of armor. Look for the gold crescent crest and the banner on its back. It drops a spirit chest when banished.') },
  { k: '停電鬼', n: tl('停電鬼', 'Blackout Oni'), r: tl('テイデンキ', 'teidenki'), boss: 's1', lore: tl('電線の髪をもつ巨大な鬼の顔。街の灯りを食べ、あたりを停電させる。', 'A giant oni face with hair of power lines. It eats the city\'s lights and plunges the streets into a blackout.') },
  { k: '逆雷', n: tl('逆雷', 'Reverse Thunder'), r: tl('サカイカズチ', 'sakaikazuchi'), boss: 's2', lore: tl('地面から空へ走る、逆さの雷。一つ目で狙いを定め、雷を落とす場所を予告する。', 'Lightning that runs upside down, from the ground into the sky. It takes aim with its single eye and marks where the bolt will fall.') },
  { k: '無明王', n: tl('無明王', 'The Lightless King'), r: tl('ムミョウオウ', 'mumyo-o'), boss: 's3', lore: tl('ノイズを束ねる七つ目の王。炎の光背を背負い、渦を巻く弾と分身を放つ。', 'The seven-eyed king who commands the Noise. With a halo of flame at his back, he fires spiraling shots and sends out copies of himself.') },
  { k: '提灯大入道', n: tl('提灯大入道', 'Lantern Giant'), r: tl('チョウチンオオニュウドウ', 'chochin o-nyudo'), boss: 's4', lore: tl('祭りの提灯を集めて大きくなった入道。大入道は、見上げるほど背が伸びる坊主の妖怪として各地に伝わる。', 'A giant monk grown huge from festival lanterns. O-nyudo, monks who grow taller the more you look up, are told of all over Japan.') },
  { k: '送電大蛇', n: tl('送電大蛇', 'Power Line Orochi'), r: tl('ソウデンオロチ', 'soden orochi'), boss: 's5', lore: tl('送電線そのものが大蛇となったもの。這った跡に雷が落ちる。', 'The power lines themselves, turned into a great serpent. Lightning strikes wherever it has crawled.') },
  { k: '雷神', n: tl('雷神', 'Raijin'), r: tl('ライジン', 'god of thunder'), boss: 's6', lore: tl('太鼓を背負い、雷を鳴らす神。俵屋宗達の「風神雷神図屏風」でも知られる。ここでは王たちに雷を与えていた。', 'The god who beats the drums on his back to make thunder, famous from Tawaraya Sotatsu\'s Wind God and Thunder God screens. Here, he gave the kings their lightning.') },
  { k: '大百足', n: tl('大百足', 'Great Centipede'), r: tl('オオムカデ', 'omukade'), boss: 's7', lore: tl('近江の三上山を七巻き半するほどの大百足を、俵藤太が矢で退治したという伝説がある。終電に取り憑き、地の下を這う。', 'Legend tells of a centipede long enough to wrap seven and a half times around Mount Mikami, slain by Tawara Toda\'s arrow. It haunts the last train and crawls underground.') },
  { k: '大天狗', n: tl('大天狗', 'Great Tengu'), r: tl('ダイテング', 'daitengu'), boss: 's8', lore: tl('鞍馬山の大天狗は、牛若丸に剣を教えたと伝えられる。電波塔の天辺から羽団扇で風を起こす。', 'The Great Tengu of Mount Kurama is said to have taught swordsmanship to the young Ushiwakamaru. From the top of the radio tower, it raises winds with its feather fan.') },
  { k: '海坊主', n: tl('海坊主', 'Umibozu'), r: tl('ウミボウズ', 'sea monk'), boss: 's9', lore: tl('海に現れる、黒く大きな坊主頭の妖怪。舟を沈めるという。水に沈んだ街で、波を起こす。', 'A huge black yokai with a shaven head that rises from the sea and sinks ships. In the sunken city, it stirs up the waves.') },
  { k: '大禍津日神', n: tl('大禍津日神', 'Omagatsuhi'), r: tl('オオマガツヒノカミ', 'god of calamity'), boss: 's10', lore: tl('古事記で、黄泉から戻ったイザナギが禊をしたとき、黄泉の穢れから生まれた災いの神。すべての大禍の源。', 'In the Kojiki, the god of disaster born from the impurity of Yomi when Izanagi purified himself after returning from the land of the dead. The source of every Calamity.') },
];
function ykSeen(n) { return (S.yk && S.yk[n]) || 0; }
// the log is keyed by the Japanese name, so it reads the same in either language
function ykAdd(n, k = 1) { if (!n) return; S.yk = S.yk || {}; S.yk[n] = (S.yk[n] || 0) + k; }
