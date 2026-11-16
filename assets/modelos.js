/* Modelos de aparelho: chave única entre vendas, estoque e ofertas + leitura do estoque físico e do Mapa de Ofertas.
   Roda no navegador (window.ModeloUtil) e no Node (module.exports) — a mesma regra gera os dados e lê as cargas. */
(function (root) {
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const DROP = new Set(['AP', 'CEL', 'CEL.', '5G', '4G', '3G', 'SSG', 'GAL', 'GALAXY', 'SAMSUNG', 'MOTOROLA', 'MOTO', 'APPLE', 'JOVI', 'DS', 'DUAL', 'SIM', 'GB', 'ESIM']);
  const ARM = /^(\d+)\s*(GB|G|TB|T)?$/;

  function marcaDe(s) {
    if (/IPHONE/.test(s)) return 'APPLE';
    if (/\b(SSG|SAMSUNG|GALAXY)\b/.test(s)) return 'SAMSUNG';
    if (/\bJOVI\b/.test(s)) return 'JOVI';
    if (/\b(MOTOROLA|MOTO)\b|\bXT\d{3,4}/.test(s)) return 'MOTOROLA';
    return 'OUTROS';
  }
  /* "AP 5G MOTOROLA XT2433 G35 128GB GFTE DS" e "MOTO G35 5G 128GB" -> MOTOROLA G35 128GB */
  function chaveModelo(desc) {
    let s = norm(desc); if (!s) return null;
    const marca = marcaDe(s);
    s = s.replace(/\b(EDGE|IPHONE|FLIP|FOLD|RAZR|SIGNATURE)(\d)/g, '$1 $2')                // EDGE70 -> EDGE 70, IPHONE17 -> IPHONE 17
         .replace(/(\d)(PROMAX|PRO|FUSION|FUS|FU|MAX|ULTRA|PLUS)\b/g, '$1 $2')
         .replace(/\bPROMAX\b/g, 'PRO MAX').replace(/\bFUS\b|\bFU\b/g, 'FUSION').replace(/\bUL\b/g, 'ULTRA');
    const tok = s.split(/[\s\/]+/).filter(Boolean);
    const nome = [];
    let arm = null, vistoNum = false;
    for (let i = 0; i < tok.length; i++) {
      const t = tok[i];
      if (DROP.has(t)) continue;
      if (/^XT\d{3,4}$/.test(t) || /^[A-Z]\d{3}[A-Z]{1,2}$/.test(t) || /^SM-/.test(t)) continue;           // códigos de fábrica
      const m = t.match(ARM);
      if (m && ((m[2] && /^(GB|G|TB|T)$/.test(m[2])) || ['64', '128', '256', '512', '1024'].includes(m[1])) && (vistoNum || nome.length >= 1)) {
        // armazenamento: número seguido de GB/TB, ou 64/128/256/512 depois do nome
        if (/TB|T$/.test(m[2] || '')) arm = m[1] + 'TB'; else arm = m[1] + 'GB';
        // "256 GB" separado
        break;
      }
      if (/^(GB|TB)$/.test(t)) continue;
      if (/\d/.test(t)) vistoNum = true;
      nome.push(t);
    }
    if (!nome.length) return null;
    // aparelho com o armazenamento no meio do nome ("IPHONE 15 256" sem GB) já cai no teste acima
    const k = marca + ' ' + nome.join(' ') + (arm ? ' ' + arm : '');
    return { k, marca, nome: bonito(marca, nome, arm) };
  }
  function bonito(marca, nome, arm) {
    const cap = t => /^(5G|FE|GT|PRO|MAX|ULTRA|PLUS|AIR|SE)$/.test(t) ? (t === 'FE' || t === '5G' || t === 'GT' || t === 'SE' ? t : t[0] + t.slice(1).toLowerCase()) : (/^[A-Z]\d+[A-Z]?$/.test(t) || /^\d/.test(t) ? t : t[0] + t.slice(1).toLowerCase());
    let n = nome.map(cap).join(' ');
    if (marca === 'APPLE') n = n.replace(/^Iphone/, 'iPhone');
    else if (marca === 'SAMSUNG') n = 'Galaxy ' + n;
    else if (marca === 'MOTOROLA') n = 'Moto ' + n;
    else if (marca === 'JOVI') n = 'Jovi ' + n;
    return n + (arm ? ' ' + arm : '');
  }

  /* ---------- loja a partir do local do estoque ("ESTOQUE SR DOS PASSOS", "ALAGOINHAS (CTAV)") ---------- */
  const nomeBase = v => norm(String(v || '').replace(/\s*\(.*\)\s*/, ''));
  function lojaDoLocal(local, mapa, lojas) {
    let n = nomeBase(local); if (!n) return null;
    if (mapa.has(n)) return mapa.get(n);
    n = n.replace(/^ESTOQUE\s+/, '').replace(/\bSR\b/, 'SENHOR');
    if (mapa.has(n)) return mapa.get(n);
    for (const l of lojas) { const b = nomeBase(l); if (b.startsWith(n) || n.startsWith(b)) return l; }
    return null;
  }

  /* ---------- estoque físico: uma linha por aparelho (IMEI); soma por loja e modelo ---------- */
  function lerEstoque(linhas, mapa, lojas) {
    const itens = new Map(), semLoja = {}, semModelo = {};
    let total = 0, defeito = 0;
    for (const r of linhas) {
      const desc = r['Descrição'] || r['Descricao'] || r.desc; if (!desc) continue;
      const qtd = Number(r['Estoque'] != null ? r['Estoque'] : r.qtd); if (!(qtd > 0)) continue;
      if (/^S/i.test(String(r['Defeito'] || ''))) { defeito += qtd; continue; }
      const mod = chaveModelo(desc); if (!mod) { semModelo[desc] = 1; continue; }
      let loja = lojaDoLocal(r['Local'] || r.local, mapa, lojas);
      if (!loja) { const nm = nomeBase(r['Local'] || r.local) || 'SEM LOCAL'; semLoja[nm] = (semLoja[nm] || 0) + qtd; loja = nm.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()); }   // local fora do cadastro: entra como local separado
      const kk = loja + '|' + mod.k; let o = itens.get(kk);
      if (!o) { o = { loja, k: mod.k, nome: mod.nome, marca: mod.marca, qtd: 0, custo: 0, dias: 0 }; itens.set(kk, o); }
      const dias = Number(r['Dias']) || 0, custo = Number(r['Custo Unitário'] != null ? r['Custo Unitário'] : r.custo) || 0;
      o.dias = (o.dias * o.qtd + dias * qtd) / (o.qtd + qtd); o.custo += custo * qtd; o.qtd += qtd; total += qtd;
    }
    return { itens: [...itens.values()].map(o => ({ ...o, dias: Math.round(o.dias), custo: Math.round(o.custo) })), total, defeito, semLoja, semModelo: Object.keys(semModelo) };
  }

  /* ---------- Mapa de Ofertas: abas "Ofertas Regulares" e "Boost Claro Troca" ---------- */
  function isoDe(v) {
    if (v instanceof Date) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
    if (typeof v === 'number' && v > 40000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : null;
  }
  const num = v => { const n = typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace(/[R$\s.]/g, '').replace(',', '.')); return isFinite(n) && n > 0 ? Math.round(n) : null; };
  const txt = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

  function lerMapa(XLSX, wb) {
    const nomeAba = n => wb.SheetNames.find(x => norm(x) === norm(n));
    const grade = n => { const a = nomeAba(n); return a ? XLSX.utils.sheet_to_json(wb.Sheets[a], { header: 1, raw: true, defval: null }) : null; };
    const porKey = new Map(); let avisos = [];
    const pega = (desc, fab) => {
      const m = chaveModelo((fab && /APPLE|JOVI|SAMSUNG|MOTOROLA/i.test(fab) && !/IPHONE|SSG|MOTO|JOVI|GAL/i.test(desc) ? fab + ' ' : '') + desc);
      if (!m) return null;
      let o = porKey.get(m.k); if (!o) { o = { k: m.k, nome: m.nome, marca: m.marca, tier: null, ofertas: [], boost: null }; porKey.set(m.k, o); }
      return o;
    };
    // --- ofertas regulares
    const reg = grade('Ofertas Regulares');
    if (reg) {
      const hi = reg.findIndex(r => r && r.some(c => norm(c) === 'DESCRICAO')); if (hi < 0) avisos.push('Ofertas Regulares: cabeçalho não encontrado');
      else {
        const h = reg[hi].map(norm), col = (p, de) => { const i = h.findIndex((x, j) => j >= (de || 0) && x.startsWith(p)); return i; };
        const cF = col('FABRICANTE'), cT = col('TIER'), cD = col('DESCRICAO'), cC = col('CANAL'), cO = col('OBSERVACAO'), cI = col('PERIODO - INICIO'), cE = col('PERIODO - TERMINO'),
          cPS = col('PLANO FOCO SINGLE'), cOS = col('OFERTA FOCO SINGLE'), cPM = col('PLANO FOCO MULTI'), cOM = col('OFERTA FOCO COMBO MULTI');
        for (const r of reg.slice(hi + 1)) {
          if (!r || !r[cD]) continue;
          const o = pega(txt(r[cD]), txt(r[cF])); if (!o) continue;
          const single = num(r[cOS]), multi = num(r[cOM]); if (!single && !multi) continue;
          o.tier = o.tier || txt(r[cT]) || null;
          const of = { plano: txt(r[cPS]) || txt(r[cPM]) || '', single, multi, obs: txt(r[cO]), canal: txt(r[cC]), ini: isoDe(r[cI]), fim: isoDe(r[cE]) };
          if (!o.ofertas.some(x => x.plano === of.plano && x.single === of.single && x.multi === of.multi && x.obs === of.obs)) o.ofertas.push(of);
        }
      }
    } else avisos.push('Aba "Ofertas Regulares" não encontrada');
    // --- boost claro troca (vários blocos na mesma aba)
    const bo = grade('Boost Claro Troca');
    if (bo) {
      let c = null;
      for (const r of bo) {
        if (!r) continue;
        const h = r.map(norm);
        if (h.some(x => x === 'FABRICANTE') && h.some(x => x.startsWith('BOOST'))) {
          c = { F: h.indexOf('FABRICANTE'), D: h.findIndex(x => x.startsWith('DESCRICAO')), I: h.findIndex(x => x.startsWith('PERIODO') && x.includes('INICIO')), E: h.findIndex(x => x.startsWith('PERIODO') && x.includes('TERMINO')), B: h.findIndex(x => x.startsWith('BOOST')) }; continue;
        }
        if (!c || !r[c.D] || !r[c.F]) continue;
        const v = num(r[c.B]); if (!v) continue;
        const o = pega(txt(r[c.D]), txt(r[c.F])); if (!o) continue;
        const b = { v, ini: isoDe(r[c.I]), fim: isoDe(r[c.E]) };
        if (!o.boost || v > o.boost.v) o.boost = b;
      }
    } else avisos.push('Aba "Boost Claro Troca" não encontrada');
    return { itens: [...porKey.values()], avisos };
  }

  /* ---------- tabela nacional: aba "Aparelhos Consumo", preço do Pré-Pago à vista = preço cheio ---------- */
  function lerTabela(XLSX, wb) {
    const a = wb.SheetNames.find(x => norm(x) === 'APARELHOS CONSUMO'); if (!a) return {};
    const g = XLSX.utils.sheet_to_json(wb.Sheets[a], { header: 1, raw: true, defval: null }), out = {};
    const hi = g.findIndex(r => r && r.some(c => norm(c) === 'MODELO')); if (hi < 0) return out;
    const h = g[hi].map(norm), cM = h.indexOf('MODELO'), cP = h.findIndex(x => x.startsWith('PRE-PAGO')), cF = h.indexOf('FABRICANTE');
    for (const r of g.slice(hi + 1)) {
      if (!r || !r[cM]) continue;
      const m = chaveModelo((cF >= 0 && /APPLE|JOVI/i.test(txt(r[cF])) ? txt(r[cF]) + ' ' : '') + txt(r[cM])), p = num(r[cP]);
      if (m && p && !out[m.k]) out[m.k] = p;
    }
    return out;
  }

  const api = { norm, chaveModelo, lojaDoLocal, lerEstoque, lerMapa, lerTabela, isoDe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ModeloUtil = api;
})(typeof window !== 'undefined' ? window : globalThis);
