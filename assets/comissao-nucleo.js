(function(){
// ===== Núcleo (puro; testado em node) =====
const IND = [
  { k: 'controle', n: 'Controle' }, { k: 'pos', n: 'Pós' }, { k: 'bl', n: 'BL' }, { k: 'tv', n: 'TV' }, { k: 'servico', n: 'Serviços' }
];
const FRK = ['controle', 'pos', 'bl', 'tv']; // comissão sobre a franquia total (coluna BT)
const INDN = Object.fromEntries(IND.map(i => [i.k, i.n]));
// Tabela DE-PARA enviada pelo Luan
const DEPARA = {
  'Ativação Controle': 'controle', 'Ativação Dependente': 'pos', 'Ativação Dependente Base': 'nc', 'Ativação Dependente Grátis': 'pos',
  'Ativação Internet': 'pos', 'Ativação Pós': 'pos', 'Ativação Pré': 'servico', 'Comissões Adicionais': 'servico', 'Downgrade de Plano': 'servico',
  'Fone Fixo': 'servico', 'Instalação Fone': 'servico', 'Instalação TV': 'tv', 'Instalação Vírtua': 'bl', 'Migração Pré - Controle': 'controle',
  'Migração Pré - Pós': 'controle', 'Serviços Gerais': 'servico', 'Substituição de Aparelho': 'nc', 'Troca de Aparelho': 'servico', 'Upgrade de Plano': 'servico'
};
const AP_MIN = 60; // só produtos acima de R$ 70 entram no faturamento de aparelho (coluna N)

function defaultCfg() {
  const gat = [0.8, 0.9, 1.0];
  return {
    metas: {},
    esc: {
      fr: { gat: gat.slice(), v: [0.10, 0.20, 0.25], g: [0.05, 0.10, 0.15], vm: [0.12, 0.24, 0.30], gm: [0.06, 0.12, 0.18] },
      sv: { gat: gat.slice(), v: [0.05, 0.10, 0.15], g: [0.02, 0.04, 0.06] },
      ap: { gat: gat.slice(), v: [0.005, 0.01, 0.015], g: [0.0025, 0.005, 0.0075], modo: 'fat', q: { v: [5, 10, 15], g: [2, 4, 6] } }
    },
    svp: { v: 0.10, g: 0.04 },
    trava: { min: 0.8, parcial: 0.5, pleno: 1.0 },
    bonus: [{ a: 1.2, valor: 100 }, { a: 1.5, valor: 250 }],
    ref: { v: 0.30, g: 0.05 },
    classe: 'Select',
    cres: 0.05,
    lib: {}
  };
}
function mergeCfg(base, over) {
  const out = JSON.parse(JSON.stringify(base)); if (!over) return out;
  for (const k of Object.keys(over)) {
    const o = over[k], b = out[k];
    if (o && typeof o === 'object' && !Array.isArray(o) && b && typeof b === 'object' && !Array.isArray(b)) {
      for (const k2 of Object.keys(o)) {
        if (o[k2] && typeof o[k2] === 'object' && !Array.isArray(o[k2]) && b[k2] && typeof b[k2] === 'object' && !Array.isArray(b[k2])) b[k2] = Object.assign({}, b[k2], o[k2]);
        else b[k2] = o[k2];
      }
    } else out[k] = o;
  }
  return out;
}
function metaOf(cfg, mk) {
  if (cfg.metas[mk]) return cfg.metas[mk];
  const prev = Object.keys(cfg.metas).filter(k => k < mk).sort().pop() || Object.keys(cfg.metas).sort().pop();
  return prev ? JSON.parse(JSON.stringify(cfg.metas[prev])) : { total: 0, mix: { controle: 40, pos: 20, bl: 20, tv: 10, servico: 10 }, ap: 0, lojaPct: {} };
}
function monthDays(mk) { const [y, m] = mk.split('-').map(Number); return new Date(y, m, 0).getDate(); }

// ---------- agregação da planilha (build) ----------
function titleLoja(s) {
  const t = String(s ?? 'SEM LOJA').replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase()
    .replace(/(^|\s)(\S+)/g, (m, p, w) => p + ((p && /^(de|da|do|das|dos)$/.test(w)) ? w : w[0].toUpperCase() + w.slice(1)));
  return /^jj seabra$/i.test(t) ? 'JJ Seabra' : t;
}
function aggregateRows(json) {
  const num = x => { const n = typeof x === 'number' ? x : parseFloat(String(x ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
  const rows = []; const unmapped = {};
  for (const r of json) {
    let d = r['Data'];
    if (d instanceof Date) d = new Date(d.getTime() + 12 * 3600e3);
    else if (typeof d === 'string') { const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) continue; d = new Date(+m[1], +m[2] - 1, +m[3], 12); }
    else continue;
    const mk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const tipo = String(r['Tipo de Ativação'] ?? '').trim();
    let ind = DEPARA[tipo]; if (!ind) { ind = 'nc'; unmapped[tipo] = (unmapped[tipo] || 0) + 1; }
    if (ind === 'nc') continue;
    const combo = String(r['Combo'] ?? '').trim();
    const vv = num(r['Valor Venda']);
    rows.push({ mk, day: d.getDate(), loja: titleLoja(r['Loja (Venda)']), vend: String(r['Vendedor'] ?? '').trim() || 'SEM VENDEDOR', ind, tipo,
      mu: /claro/i.test(combo) ? 2 : combo ? 1 : 0, f: num(r['Franquia Total']), r: num(r['Comissão']) + num(r['Comissão Res']),
      fat: vv > AP_MIN ? vv : 0, plano: String(r['Plano/Serviço'] ?? '').trim() });
  }
  // loja de lotação: onde o vendedor mais vendeu no mês
  const cnt = {};
  for (const x of rows) if (x.vend !== 'SEM VENDEDOR') { const k = x.mk + '|' + x.vend; (cnt[k] = cnt[k] || {})[x.loja] = (cnt[k][x.loja] || 0) + 1; }
  const lot = {}; for (const k in cnt) lot[k] = Object.entries(cnt[k]).sort((a, b) => b[1] - a[1])[0][0];
  const L = [], V = [], T = []; const ix = (arr, v) => { let i = arr.indexOf(v); if (i < 0) { i = arr.length; arr.push(v); } return i; };
  const R = new Map(), A = new Map(), P = new Map(), days = {}, mn = {};
  for (const x of rows) {
    if (x.vend !== 'SEM VENDEDOR') x.loja = lot[x.mk + '|' + x.vend];
    days[x.mk] = Math.max(days[x.mk] || 0, x.day); mn[x.mk] = Math.min(mn[x.mk] || 99, x.day);
    const li = ix(L, x.loja), vi = ix(V, x.vend), ti = ix(T, x.tipo);
    const key = [x.mk, li, vi, x.ind, ti, x.mu].join('|');
    const a = R.get(key) || [x.mk, li, vi, x.ind, ti, x.mu, 0, 0, 0]; a[6]++; a[7] += x.f; a[8] += x.r; R.set(key, a);
    if (x.fat > 0) { const k2 = [x.mk, li, vi].join('|'); const b = A.get(k2) || [x.mk, li, vi, 0, 0]; b[3]++; b[4] += x.fat; A.set(k2, b); }
    const pn = x.ind === 'servico' ? (x.tipo || x.plano) : x.plano;
    if (pn && x.ind !== 'nc') { const k3 = [x.mk, x.ind, pn, x.mu, li, vi].join('|'); const c = P.get(k3) || [x.mk, x.ind, pn, x.mu, 0, 0, 0, li, vi]; c[4]++; c[5] += x.r; c[6] += x.f; P.set(k3, c); }
  }
  const rd = a => a.map(v => typeof v === 'number' ? Math.round(v * 100) / 100 : v);
  return { M: Object.keys(days).sort(), L, V, T, R: [...R.values()].map(rd), A: [...A.values()].map(rd), P: [...P.values()].map(rd), D: days, MN: mn, unmapped };
}
function subsetByLoja(data, li) {
  // visão de uma loja: só os vendedores e linhas dela (nomes das outras lojas e vendedores não vão no pacote)
  const R0 = data.R.filter(r => r[1] === li), A0 = data.A.filter(a => a[1] === li);
  const P0 = (data.P || []).filter(p => p[7] === li);
  const vs = [...new Set([...R0.map(r => r[2]), ...A0.map(a => a[2]), ...P0.map(p => p[8])])];
  const vm = new Map(vs.map((v, i) => [v, i]));
  return { M: data.M, L: [data.L[li]], V: vs.map(v => data.V[v]), T: data.T, only: 0, D: data.D, P: P0.map(p => [p[0], p[1], p[2], p[3], p[4], p[5], p[6], 0, vm.get(p[8])]),
    R: R0.map(r => [r[0], 0, vm.get(r[2]), r[3], r[4], r[5], r[6], r[7], r[8]]), A: A0.map(a => [a[0], 0, vm.get(a[2]), a[3], a[4]]) };
}


// incorpora uma exportação nova: os meses presentes nela substituem os meses antigos
function mergeData(old, nw) {
  const L = old.L.slice(), V = old.V.slice(), T = old.T.slice();
  const ix = (arr, v) => { let i = arr.indexOf(v); if (i < 0) { i = arr.length; arr.push(v); } return i; };
  const mon = new Set(nw.M);
  const keepR = old.R.filter(r => !mon.has(r[0])), keepA = old.A.filter(a => !mon.has(a[0])), keepP = (old.P || []).filter(p => !mon.has(p[0]));
  const mapL = nw.L.map(l => ix(L, l)), mapV = nw.V.map(v => ix(V, v)), mapT = nw.T.map(t => ix(T, t));
  const R = keepR.concat(nw.R.map(r => [r[0], mapL[r[1]], mapV[r[2]], r[3], mapT[r[4]], r[5], r[6], r[7], r[8]]));
  const A = keepA.concat(nw.A.map(a => [a[0], mapL[a[1]], mapV[a[2]], a[3], a[4]]));
  const P = keepP.concat(nw.P.map(p => [p[0], p[1], p[2], p[3], p[4], p[5], p[6], mapL[p[7]], mapV[p[8]]]));
  const D = Object.assign({}, old.D, nw.D);
  const MN = Object.assign({}, old.MN || {}, nw.MN || {});
  return { M: Object.keys(D).sort(), L, V, T, R, A, P, D, MN };
}

// ---------- regras ----------
function faixaPct(ating, gat, pcts) { if (ating == null) return 0; let p = 0; for (let i = 0; i < gat.length; i++) if (ating + 1e-9 >= gat[i]) p = pcts[i]; return p; }
function faixaIdx(ating, gat) { if (ating == null) return -1; let x = -1; for (let i = 0; i < gat.length; i++) if (ating + 1e-9 >= gat[i]) x = i; return x; }
function liberacao(blAting, blMeta, cfg) {
  if (!(blMeta > 0)) return 1;
  return blAting + 1e-9 >= cfg.trava.pleno ? 1 : (blAting + 1e-9 >= cfg.trava.min ? cfg.trava.parcial : 0);
}
// real: {ind:{f,r,q}}, ap: {fat,q}, meta: {ind:R$}, kind: 'v'|'g'
function calcScope(real, ap, meta, metaAp, cfg, kind, servLib) {
  const o = { ind: {}, comFr: 0, comSv: 0, comAp: 0, comMulti: 0, comExtra: 0, rTot: 0, mTot: 0, fTot: 0 };
  for (const { k } of IND) {
    const rr = (real && real[k]) || { f: 0, r: 0, q: 0 };
    if (k === 'servico') {
      // serviços não têm meta nem faixa: percentual fixo sobre a receita (comissão + comissão residencial)
      const pctS = (cfg.svp || {})[kind] || 0, com = rr.r * pctS;
      o.ind[k] = { meta: 0, r: rr.r, f: 0, q: rr.q || 0, fm: 0, qm: 0, ating: null, pct: pctS, pctM: pctS, base: rr.r, com, comExtra: 0, idx: -1 };
      o.comSv += com; continue;
    }
    const m = meta[k] || 0, ating = m > 0 ? rr.r / m : null, sc = cfg.esc.fr;
    const pct = faixaPct(ating, sc.gat, sc[kind]), pctM = faixaPct(ating, sc.gat, sc[kind + 'm'] || sc[kind]);
    const fm = Math.min(rr.fm || 0, rr.f), fs = rr.f - fm, com = fs * pct + fm * pctM;
    o.ind[k] = { meta: m, r: rr.r, f: rr.f, q: rr.q || 0, fm, qm: rr.qm || 0, ating, pct, pctM, base: rr.f, com, comExtra: fm * (pctM - pct), idx: faixaIdx(ating, sc.gat) };
    o.rTot += rr.r; o.mTot += m; o.fTot += rr.f; o.comFr += com; o.comMulti += fm * pctM; o.comExtra += fm * (pctM - pct);
  }
  const a = ap || { fat: 0, q: 0 }, aAting = metaAp > 0 ? a.fat / metaAp : null, apQ = cfg.esc.ap.modo === 'qtd', aPct = faixaPct(aAting, cfg.esc.ap.gat, apQ ? (cfg.esc.ap.q || { v: [], g: [] })[kind] : cfg.esc.ap[kind]);
  o.ap = { meta: metaAp || 0, fat: a.fat, q: a.q || 0, ating: aAting, pct: aPct, modo: apQ ? 'qtd' : 'fat', com: apQ ? (a.q || 0) * aPct : a.fat * aPct, idx: faixaIdx(aAting, cfg.esc.ap.gat) };
  o.comAp = o.ap.com;
  o.atTotal = o.mTot > 0 ? o.rTot / o.mTot : null;
  o.lib = liberacao(o.ind.bl.ating, o.ind.bl.meta, cfg);
  let bonus = 0;
  if (kind === 'v' && o.atTotal != null) for (const b of cfg.bonus) if (o.atTotal + 1e-9 >= b.a) bonus = b.valor;
  o.bonusBruto = bonus; o.bonus = bonus * o.lib;
  o.servLib = !!servLib;
  o.comLib = (o.comFr + o.comAp + (servLib ? o.comSv : 0)) * o.lib;
  o.servPend = servLib ? 0 : o.comSv * o.lib; // serviços calculados, aguardando liberação do dono
  o.total = o.comLib + o.bonus;
  return o;
}

// vw: pesos de divisão entre vendedores por loja { loja: { vendedor: peso } } (ajustados pelo gerente)
function buildModel(data, cfg, mk, k, vw) {
  vw = vw || {};
  const dm = monthDays(mk), dd = Math.min(data.D[mk] || dm, dm);
  const recs = data.R.filter(r => r[0] === mk), aps = data.A.filter(a => a[0] === mk);
  const realV = {}, realL = {}, apV = {}, apL = {}, vLoja = {};
  const add = (o, key, ind, q, f, r, mu) => { const x = ((o[key] = o[key] || {})[ind] = (o[key][ind] || { f: 0, r: 0, q: 0, fm: 0, qm: 0 })); x.f += f * k; x.r += r * k; x.q += q; if (mu > 0 && ind !== 'servico') { x.fm += f * k; x.qm += q; } };
  for (const [, li, vi, ind, , mu, q, f, r] of recs) {
    add(realL, li, ind, q, f, r, mu);
    if (data.V[vi] !== 'SEM VENDEDOR') { add(realV, vi, ind, q, f, r, mu); vLoja[vi] = li; }
  }
  for (const [, li, vi, q, fat] of aps) {
    (apL[li] = apL[li] || { fat: 0, q: 0 }); apL[li].fat += fat * k; apL[li].q += q * k;
    if (data.V[vi] !== 'SEM VENDEDOR') { (apV[vi] = apV[vi] || { fat: 0, q: 0 }); apV[vi].fat += fat * k; apV[vi].q += q * k; vLoja[vi] = vLoja[vi] ?? li; }
  }
  const M = metaOf(cfg, mk), mixSum = FRK.reduce((s, k) => s + (+M.mix[k] || 0), 0) || 1;
  const metaEmp = {}; for (const { k: ik } of IND) metaEmp[ik] = ik === 'servico' ? 0 : (+M.total || 0) * ((+M.mix[ik] || 0) / mixSum);
  const metaAp = +M.ap || 0;
  const pctRaw = Object.values(M.lojaPct || {}).reduce((s, x) => s + (+x || 0), 0), pctSum = pctRaw || 1;
  const hcL = {}; for (const vi of Object.keys(vLoja)) hcL[vLoja[vi]] = (hcL[vLoja[vi]] || 0) + 1; const hcT = Object.values(hcL).reduce((x, y) => x + y, 0) || 1;
  const lojas = [], vends = [];
  const lis = (data.only != null ? [data.only] : data.L.map((_, i) => i)).sort((a, b) => data.L[a].localeCompare(data.L[b]));
  for (const li of lis) {
    const nome = data.L[li], share = pctRaw ? (+(M.lojaPct || {})[nome] || 0) / pctSum : (hcL[li] || 0) / hcT;
    const vis = Object.keys(vLoja).map(Number).filter(v => vLoja[v] === li);
    const w = {}; let sw = 0;
    for (const vi of vis) {
      const ativo = FRK.some(ik => realV[vi] && realV[vi][ik]);
      const wv = vw[nome] && vw[nome][data.V[vi]] != null ? +vw[nome][data.V[vi]] : (ativo ? 1 : 0);
      w[vi] = wv; sw += wv;
    }
    const metaL = {}; for (const { k: ik } of IND) metaL[ik] = metaEmp[ik] * share; const metaApL = metaAp * share;
    const vl = vis.map(vi => {
      const meta = {}; for (const { k: ik } of IND) meta[ik] = sw > 0 ? metaL[ik] * w[vi] / sw : 0;
      const mAp = sw > 0 ? metaApL * w[vi] / sw : 0;
      return { nome: data.V[vi], loja: nome, w: w[vi], pctMeta: sw > 0 ? w[vi] / sw : 0, meta, metaAp: mAp, real: realV[vi] || {}, ap: apV[vi],
        res: calcScope(realV[vi] || {}, apV[vi], meta, mAp, cfg, 'v', cfg.lib[mk] && cfg.lib[mk].servicos) };
    }).sort((a, b) => b.res.total - a.res.total);
    vends.push(...vl);
    lojas.push({ nome, li, share, hc: vl.filter(v => v.w > 0).length, meta: metaL, metaAp: metaApL, real: realL[li] || {}, ap: apL[li], vends: vl,
      res: calcScope(realL[li] || {}, apL[li], metaL, metaApL, cfg, 'g', cfg.lib[mk] && cfg.lib[mk].servicos) });
  }
  const tot = {}; for (const { k: ik } of IND) { tot[ik] = { f: 0, r: 0, q: 0, fm: 0, qm: 0 }; for (const l of lojas) { const x = l.real[ik]; if (x) { tot[ik].f += x.f; tot[ik].r += x.r; tot[ik].q += x.q; tot[ik].fm += x.fm || 0; tot[ik].qm += x.qm || 0; } } }
  const totAp = { fat: lojas.reduce((s, l) => s + (l.ap ? l.ap.fat : 0), 0), q: lojas.reduce((s, l) => s + (l.ap ? l.ap.q : 0), 0) };
  const metaTodas = {}; for (const { k: ik } of IND) metaTodas[ik] = lojas.reduce((s, l) => s + l.meta[ik], 0);
  const metaApTodas = lojas.reduce((s, l) => s + l.metaAp, 0);
  const empresa = calcScope(tot, totAp, metaTodas, metaApTodas, cfg, 'v', cfg.lib[mk] && cfg.lib[mk].servicos);
  return { mk, k, dm, dd, M, mixSum, metaEmp, metaAp, lojas, vends, tot, totAp, empresa,
    comV: vends.reduce((s, v) => s + v.res.total, 0), comG: lojas.reduce((s, l) => s + l.res.total, 0),
    servPend: vends.reduce((s, v) => s + v.res.servPend, 0) + lojas.reduce((s, l) => s + l.res.servPend, 0) };
}

// custo de comissão se todos os indicadores chegarem a s% da meta
function custoCenario(B, cfg, s) {
  let v = 0, g = 0, rec = 0, nv = 0, fr = 0;
  const rho = {}; for (const ik of FRK) rho[ik] = B.tot[ik].r > 0 ? B.tot[ik].f / B.tot[ik].r : 0;
  const lib = liberacao(s, 1, cfg);
  const bonus = cfg.bonus.reduce((b, x) => s + 1e-9 >= x.a ? x.valor : b, 0);
  const svRatio = (() => { const fr = FRK.reduce((a, k) => a + B.tot[k].r, 0); return fr > 0 ? (B.tot.servico ? B.tot.servico.r : 0) / fr : 0; })();
  let recServ = 0;
  for (const l of B.lojas) {
    let recL = 0;
    for (const k of FRK) {
      const r = l.meta[k] * s; rec += r; recL += r;
      const base = r * rho[k]; fr += base; const ms = B.tot[k].f > 0 ? Math.min(1, (B.tot[k].fm || 0) / B.tot[k].f) : 0, sc = cfg.esc.fr;
      const pv = faixaPct(s, sc.gat, sc.v), pvm = faixaPct(s, sc.gat, sc.vm || sc.v), pg = faixaPct(s, sc.gat, sc.g), pgm = faixaPct(s, sc.gat, sc.gm || sc.g);
      v += base * ((1 - ms) * pv + ms * pvm); g += base * ((1 - ms) * pg + ms * pgm);
    }
    const sr = recL * svRatio; recServ += sr; v += sr * ((cfg.svp || {}).v || 0); g += sr * ((cfg.svp || {}).g || 0);
    const fa = l.metaAp * s;
    if (cfg.esc.ap.modo === 'qtd') { const un = B.totAp.q > 0 ? fa / (B.totAp.fat / B.totAp.q) : 0, qq = cfg.esc.ap.q || { v: [], g: [] }; v += un * faixaPct(s, cfg.esc.ap.gat, qq.v); g += un * faixaPct(s, cfg.esc.ap.gat, qq.g); }
    else { v += fa * faixaPct(s, cfg.esc.ap.gat, cfg.esc.ap.v); g += fa * faixaPct(s, cfg.esc.ap.gat, cfg.esc.ap.g); }
    nv += l.vends.filter(x => x.w > 0).length;
  }
  v = v * lib; g = g * lib; const b = bonus * nv * lib;
  return { s, v, g, bonus: b, total: v + g + b, rec, fr, recServ, pct: rec > 0 ? (v + g + b) / rec : 0, pctFr: fr > 0 ? (v + g + b) / fr : 0, lib };
}

// ---------- simulador de venda (Anexo I do manual) ----------
const CLASSES = ['Elite', 'Prime', 'Select', 'Starter'];
const FATOR = {
  Elite: { s: 2.8, mm: 4.4, mr: 4.5, up: 3.8, tr: 0.90, pt: 0.26 }, Prime: { s: 2.7, mm: 4.1, mr: 4.2, up: 3.8, tr: 0.70, pt: 0.25 },
  Select: { s: 2.4, mm: 3.6, mr: 3.7, up: 3.5, tr: 0.60, pt: 0.20 }, Starter: { s: 1.9, mm: 3.0, mr: 3.1, up: 3.3, tr: 0.50, pt: 0.15 }
};
const MIN_UP = 20, MIN_PORT = 15, FRANQ_TROCA = 0.423;
const EVENTOS = {
  controle: { n: 'Ativação de Controle', ind: 'controle', seg: 'movel', preco: 59.9, port: true, lp: 'Preço do plano (R$)' },
  pos: { n: 'Ativação de Pós (Conta)', ind: 'pos', seg: 'movel', preco: 119.9, port: true, lp: 'Preço do plano (R$)' },
  bl: { n: 'Instalação de Banda larga fixa', ind: 'bl', seg: 'res', preco: 104.9, port: false, lp: 'Preço do plano (R$)' },
  tv: { n: 'Instalação de TV', ind: 'tv', seg: 'res', preco: 109.9, port: false, lp: 'Preço do plano (R$)' },
  upgrade: { n: 'Upgrade de plano', ind: 'servico', kind: 'up', preco: 30, port: false, lp: 'Aumento de receita do plano (R$)' },
  troca: { n: 'Troca de aparelho com fidelização', ind: 'servico', kind: 'tr', preco: 69.9, port: false, lp: 'Preço do plano fidelizado (R$)' }
};
function simulate(sim, classe, cfg) {
  const e = EVENTOS[sim.ev], F = FATOR[classe], qtd = Math.max(1, +sim.qtd || 1), preco = +sim.preco || 0; let fator, rec, franq;
  if (e.kind === 'up') { fator = F.up; rec = preco > 0 ? Math.max(F.up * preco, MIN_UP) : 0; franq = preco; }
  else if (e.kind === 'tr') { fator = F.tr; rec = F.tr * preco; franq = preco * FRANQ_TROCA; }
  else { fator = sim.multi ? (e.seg === 'movel' ? F.mm : F.mr) : F.s; rec = fator * preco; franq = preco; }
  const port = (sim.port && e.port && preco > 0) ? Math.max(F.pt * preco, MIN_PORT) : 0;
  const receita = (rec + port) * qtd, franquia = franq * qtd;
  const sv = e.ind === 'servico', base = sv ? receita : franquia, sc = cfg.esc.fr, svp = cfg.svp || { v: 0, g: 0 }, mu = !sv && sim.multi;
  const pv = sv ? sc.gat.map(() => svp.v) : (mu ? (sc.vm || sc.v) : sc.v), pg = sv ? sc.gat.map(() => svp.g) : (mu ? (sc.gm || sc.g) : sc.g);
  return { fator, rec: rec * qtd, port: port * qtd, receita, franquia, base, baseTipo: sv ? 'receita' : 'franquia', vend: pv.map(p => base * p), ger: pg.map(p => base * p), gat: sc.gat, ind: e.ind, flat: sv, multi: mu };
}


window.ComissaoNucleo={aggregateRows,mergeData,subsetByLoja,defaultCfg,mergeCfg,titleLoja};
})();
