(function () {
'use strict';

const CFG = window.PAINEL_CONFIG;
const sb = window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

const ROTULO = { dono: 'Dono', admin: 'Administrador', gerente: 'Gerente', vendedor: 'Vendedor' };
const ABAS = [
  { id: 'ritmo',     nome: 'Ritmo Comercial', papeis: ['dono', 'admin', 'gerente'] },
  { id: 'meta',      nome: 'Minha Meta',      papeis: ['dono', 'admin', 'gerente', 'vendedor'] },
  { id: 'aparelhos', nome: 'Aparelhos e Chip', papeis: ['dono', 'admin'] },
  { id: 'comissao',  nome: 'Comissão e Meta', papeis: ['dono', 'admin', 'gerente'] },
  { id: 'cadastros', nome: 'Cadastros',       papeis: ['dono', 'admin', 'gerente'] },
  { id: 'dados',     nome: 'Importar dados',  papeis: ['dono', 'admin'] }
];
const PODE_CRIAR = { dono: ['admin', 'gerente', 'vendedor'], admin: ['gerente', 'vendedor'], gerente: ['vendedor'] };

const S = { me: null, lojas: [], titulo: 'Painel Comercial', aba: null, aparelhos: null, ritmoTxt: null };
const gestao = () => S.me && (S.me.papel === 'dono' || S.me.papel === 'admin');

/* ====================== mensagens de erro ====================== */
function msgErro(e) {
  const m = String((e && (e.message || e.error_description)) || e || '');
  if (/invalid login/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(m)) return 'E-mail ainda não confirmado.';
  if (/rate limit|too many/i.test(m)) return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Sem conexão com o servidor. Verifique a internet.';
  if (/row-level security|violates row/i.test(m)) return 'Seu perfil não tem permissão para essa ação.';
  return m || 'Algo deu errado.';
}

/* ====================== login / sessão ====================== */
function mostrar(tela) {
  $('#telaLogin').hidden = tela !== 'login';
  $('#telaApp').hidden = tela !== 'app';
}

async function iniciar() {
  const { data } = await sb.auth.getSession();
  if (data.session) await entrarNoApp(); else { await carregarTituloPublico(); mostrar('login'); }
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { limparEstado(); mostrar('login'); } });
}
async function carregarTituloPublico() { document.title = S.titulo; $('#loginTitulo').textContent = S.titulo; }

$('#formLogin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const b = $('#btnEntrar'), m = $('#lgMsg'); m.textContent = ''; m.className = 'msg';
  b.disabled = true; b.textContent = 'Entrando…';
  const { error } = await sb.auth.signInWithPassword({ email: $('#lgEmail').value.trim(), password: $('#lgSenha').value });
  b.disabled = false; b.textContent = 'Entrar';
  if (error) { m.textContent = msgErro(error); return; }
  $('#lgSenha').value = '';
  await entrarNoApp();
});

function limparEstado() { S.me = null; S.lojas = []; S.aparelhos = null; S.ritmoTxt = null; $('#palco').innerHTML = ''; }

async function entrarNoApp() {
  const { data: u } = await sb.auth.getUser();
  if (!u || !u.user) { mostrar('login'); return; }
  const { data: perfil, error } = await sb.from('profiles').select('*').eq('id', u.user.id).maybeSingle();
  if (error || !perfil || !perfil.ativo) {
    mostrar('app');
    $('#abas').innerHTML = ''; $('#uNome').textContent = u.user.email; $('#uPapel').textContent = 'sem acesso';
    $('#btnEditarTitulo').hidden = true;
    $('#palco').innerHTML = '<div class="aviso"><h2>Acesso não liberado</h2><p>Seu login existe, mas ainda não foi liberado (ou foi desativado). Fale com quem cadastrou o seu acesso.</p></div>';
    return;
  }
  S.me = perfil;
  const [lj, cf] = await Promise.all([
    sb.from('lojas').select('*').order('nome'),
    sb.from('app_config').select('valor').eq('chave', 'titulo').maybeSingle()
  ]);
  S.lojas = lj.data || [];
  S.me.loja = S.lojas.find(l => l.id === perfil.loja_id) || null;
  if (cf.data && cf.data.valor && cf.data.valor.texto) S.titulo = cf.data.valor.texto;
  pintarTopo();
  mostrar('app');
  const abas = abasVisiveis();
  const alvo = (location.hash || '').replace('#/', '');
  irPara(abas.some(a => a.id === alvo) ? alvo : abas[0].id);
}

function abasVisiveis() { return ABAS.filter(a => a.papeis.includes(S.me.papel)); }

function pintarTopo() {
  $('#tituloTxt').textContent = S.titulo; document.title = S.titulo;
  $('#btnEditarTitulo').hidden = !gestao();
  $('#uNome').textContent = S.me.nome || S.me.email;
  $('#uPapel').textContent = ROTULO[S.me.papel] + (S.me.loja ? ' · ' + S.me.loja.nome : '');
  $('#abas').innerHTML = abasVisiveis().map(a => `<button class="aba" data-aba="${a.id}">${esc(a.nome)}</button>`).join('');
}
$('#abas').addEventListener('click', e => { const b = e.target.closest('.aba'); if (b) irPara(b.dataset.aba); });
window.addEventListener('hashchange', () => { const id = location.hash.replace('#/', ''); if (S.me && id !== S.aba && abasVisiveis().some(a => a.id === id)) irPara(id); });
$('#btnSair').addEventListener('click', async () => { await sb.auth.signOut(); });

/* ====================== título ====================== */
$('#btnEditarTitulo').addEventListener('click', () => {
  $('#tituloTxt').hidden = true; $('#btnEditarTitulo').hidden = true; $('#formTitulo').hidden = false;
  $('#inpTitulo').value = S.titulo; $('#inpTitulo').focus(); $('#inpTitulo').select();
});
function fecharTitulo() { $('#formTitulo').hidden = true; $('#tituloTxt').hidden = false; $('#btnEditarTitulo').hidden = !gestao(); }
$('#btnCancTitulo').addEventListener('click', fecharTitulo);
$('#formTitulo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = $('#inpTitulo').value.trim(); if (!t) return;
  const { error } = await sb.from('app_config').upsert({ chave: 'titulo', valor: { texto: t }, atualizado_em: new Date().toISOString() });
  if (error) { alert('Não consegui salvar o título: ' + msgErro(error)); return; }
  S.titulo = t; $('#tituloTxt').textContent = t; document.title = t; fecharTitulo();
});

/* ====================== minha conta ====================== */
$('#btnConta').addEventListener('click', () => {
  $('#contaInfo').textContent = (S.me.email || '') + ' — ' + ROTULO[S.me.papel] + (S.me.loja ? ' · ' + S.me.loja.nome : '');
  $('#contaMsg').textContent = ''; $('#novaSenha').value = ''; $('#dlgConta').showModal();
});
$('#btnFecharConta').addEventListener('click', () => $('#dlgConta').close());
$('#formConta').addEventListener('submit', async (e) => {
  e.preventDefault();
  const m = $('#contaMsg'), s = $('#novaSenha').value;
  if (s.length < 8) { m.className = 'msg'; m.textContent = 'A senha precisa ter ao menos 8 caracteres.'; return; }
  const { error } = await sb.auth.updateUser({ password: s });
  if (error) { m.className = 'msg'; m.textContent = msgErro(error); return; }
  m.className = 'msg ok'; m.textContent = 'Senha alterada.'; $('#novaSenha').value = '';
});

/* ====================== navegação ====================== */
function irPara(id) {
  S.aba = id; location.hash = '#/' + id;
  document.querySelectorAll('.aba').forEach(b => b.toggleAttribute('aria-current', b.dataset.aba === id));
  document.querySelectorAll('.aba').forEach(b => { if (b.dataset.aba === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  const p = $('#palco'); p.innerHTML = '';
  if (id === 'ritmo' || id === 'meta') return abrirRitmo(id);
  if (id === 'aparelhos') return abrirAparelhos();
  if (id === 'comissao') return abrirComissao();
  if (id === 'cadastros') return abrirCadastros();
  if (id === 'dados') return abrirDados();
}
function aviso(titulo, texto) { $('#palco').innerHTML = `<div class="aviso"><h2>${esc(titulo)}</h2><p>${texto}</p></div>`; }
function carregando() { $('#palco').innerHTML = '<div class="aviso"><p>Carregando…</p></div>'; }

/* ====================== apps (iframe) ====================== */
async function lerDataset(chave) {
  const { data, error } = await sb.from('datasets').select('payload').eq('chave', chave).maybeSingle();
  if (error) throw error;
  return data ? data.payload : null;
}
async function texto(url) {
  const r = await fetch(url + '?v=' + encodeURIComponent(CFG.versao)); if (!r.ok) throw new Error('Não encontrei ' + url);
  return r.text();
}
const jsonSeguro = o => JSON.stringify(o).replace(/<\//g, '<\\/');

function montarDoc(html, prelude, css) {
  const corpo = html.replace(/<\/body>\s*<\/html>\s*$/i, '');
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<style>' + css + '</style><script>' + prelude + '<\/script></head><body>' + corpo + '</body></html>';
}
function colocarIframe(doc) {
  const f = document.createElement('iframe');
  f.setAttribute('title', 'Painel'); f.srcdoc = doc;
  $('#palco').innerHTML = ''; $('#palco').appendChild(f);
}

async function abrirRitmo(visao) {
  carregando();
  try {
    const chave = gestao() ? 'ritmo' : 'ritmo:' + S.me.loja_id;
    const payload = await lerDataset(chave);
    if (!payload || !payload.recs || !payload.recs.length) {
      return aviso('Ainda sem dados', gestao()
        ? 'Nenhuma base do Ritmo Comercial foi carregada. Vá em <b>Importar dados</b> para carregar.'
        : 'A gestão ainda não publicou os dados da sua loja.');
    }
    S.ritmoTxt = JSON.stringify(payload);
    S.ritmoCfg = (await lerDataset(gestao() ? 'ritmo-cfg' : 'ritmo-cfg:' + S.me.loja_id)) || {};
    const p = visao === 'meta' ? 'vendedor' : 'ritmo';
    const prelude = `(function(){
      function run(){var ok,er;var o={withSuccessHandler:function(f){ok=f;return o;},withFailureHandler:function(f){er=f;return o;}};
        ['lerBase','salvarBase'].forEach(function(n){o[n]=function(){var a=[].slice.call(arguments);
          Promise.resolve().then(function(){return parent.__painel[n].apply(null,a);}).then(function(v){if(ok)ok(v);},function(e){if(er)er(e);});};});return o;}
      window.google={script:{run:{withSuccessHandler:function(f){return run().withSuccessHandler(f);},withFailureHandler:function(f){return run().withFailureHandler(f);}},
        url:{getLocation:function(cb){cb({parameter:{p:${JSON.stringify(p)}}});}}}};
    })();`;
    let css = '.trocar{display:none!important}#btnBase{display:none!important}';
    if (!gestao()) css += '#btnCfg,#btnBase,#vCfg,#cfg{display:none!important}';
    const html = await texto('apps/ritmo.html');
    colocarIframe(montarDoc(html.replace('Publicado.</b> A planilha foi gravada no Drive — quem abrir o link já vê a base nova.', 'Publicado.</b> Todos os acessos já veem a base nova.'), prelude, css));
  } catch (e) { aviso('Não consegui abrir', esc(msgErro(e))); }
}

async function abrirAparelhos() {
  carregando();
  try {
    const payload = await lerDataset('aparelhos');
    if (!payload || !payload.seed) {
      return aviso('Ainda sem dados', 'Nenhuma base de Aparelhos e Chip foi carregada. Vá em <b>Importar dados</b> para carregar.');
    }
    S.aparelhos = payload;
    const prelude = `window.__SEED=parent.__painel.aparelhosSeed(); window.__EXCL=parent.__painel.aparelhosExcl();
      window.claude={use:function(){return Promise.resolve({publish:function(doc){return parent.__painel.aparelhosSalvar(doc);}});}};`;
    let html = await texto('apps/aparelhos.html');
    html = html.replace('<script id="pagedata" type="application/json">{}</script>', '<script id="pagedata" type="application/json">' + jsonSeguro(payload.page || {}) + '</script>');
    colocarIframe(montarDoc(html, prelude, '#btnUp{display:none!important}'));
  } catch (e) { aviso('Não consegui abrir', esc(msgErro(e))); }
}

async function abrirComissao() {
  carregando();
  try {
    const chave = gestao() ? 'comissao' : 'comissao:' + S.me.loja_id;
    const payload = await lerDataset(chave);
    if (!payload || !payload.data || !payload.data.M || !payload.data.M.length) {
      return aviso('Ainda sem dados', gestao()
        ? 'A base do Comissão e Meta ainda não foi carregada. Vá em <b>Importar dados</b> e envie o Excel do Controle Celular.'
        : 'A gestão ainda não publicou os dados da sua loja.');
    }
    S.comissao = payload;
    colocarIframe(montarDoc(await texto('apps/comissao.html'), '', ''));
  } catch (e) { aviso('Não consegui abrir', esc(msgErro(e))); }
}
function indiceLoja(D, l) {
  const alvo = new Set([l.nome].concat(l.apelidos || []).map(nomeBase));
  return D.L.findIndex(n => alvo.has(nomeBase(n)));
}
async function salvarComissao(data, cfg, cfgAt) {
  const linhas = [{ chave: 'comissao', loja_id: null, payload: { data, cfg, cfgAt } }];
  for (const l of S.lojas.filter(x => x.ativa)) {
    const li = indiceLoja(data, l); if (li < 0) continue;
    linhas.push({ chave: 'comissao:' + l.id, loja_id: l.id, payload: { data: ComissaoNucleo.subsetByLoja(data, li), cfg, cfgAt } });
  }
  await gravar(linhas);
  return linhas.length - 1;
}

/* ====================== ponte com os apps ====================== */
window.__painel = {
  lerBase: async () => S.ritmoTxt || '',
  salvarBase: async (txt) => { await salvarRitmo(JSON.parse(txt)); return true; },
  ritmoCfg: () => S.ritmoCfg || {},
  ritmoSalvarCfg: async (cfg) => {
    if (!gestao()) throw new Error('Só dono e administrador alteram metas e parâmetros.');
    await salvarCfgRitmo(cfg); S.ritmoCfg = cfg; return true;
  },
  comissaoInit: async () => {
    const p = S.comissao; if (!p) throw new Error('Sem dados do Comissão e Meta.');
    const vw = {};
    if (gestao()) {
      const { data: rs, error } = await sb.from('datasets').select('loja_id,payload').like('chave', 'comissao-vw:%'); if (error) throw error;
      (rs || []).forEach(r => { const l = S.lojas.find(x => x.id === r.loja_id); if (!l) return; const li = indiceLoja(p.data, l); if (li >= 0 && r.payload && r.payload.vw) vw[p.data.L[li]] = r.payload.vw; });
      return { role: 'dono', data: p.data, cfg: p.cfg, cfgAt: p.cfgAt || 0, vw };
    }
    const v = await lerDataset('comissao-vw:' + S.me.loja_id); if (v && v.vw) vw[p.data.L[0]] = v.vw;
    return { role: 'gerente', data: p.data, cfg: p.cfg, cfgAt: p.cfgAt || 0, vw };
  },
  comissaoSalvarVw: async (nome, json) => {
    let id = S.me.loja_id;
    if (gestao()) { const l = S.lojas.find(x => nomeBase(nome) === nomeBase(x.nome) || (x.apelidos || []).some(a => nomeBase(a) === nomeBase(nome))); if (!l) throw new Error('Loja não encontrada.'); id = l.id; }
    await gravar([{ chave: 'comissao-vw:' + id, loja_id: id, payload: { vw: JSON.parse(json) } }]);
    return true;
  },
  comissaoPublicarCfg: async (cfg) => {
    if (!gestao()) throw new Error('Só dono e administrador publicam.');
    const p = await lerDataset('comissao'); if (!p || !p.data) throw new Error('Não há base do Comissão carregada.');
    const at = Date.now(); await salvarComissao(p.data, cfg, at); S.comissao = Object.assign({}, p, { cfg, cfgAt: at }); return true;
  },
  aparelhosSeed: () => (S.aparelhos && S.aparelhos.seed) || { stores: [], vends: [], brands: [], rows: [] },
  aparelhosExcl: () => (S.aparelhos && S.aparelhos.excl) || [],
  aparelhosSalvar: async (doc) => {
    const m = /<script id="pagedata"[^>]*>([\s\S]*?)<\/script>/.exec(doc);
    if (!m) throw new Error('Não localizei os dados da página.');
    const page = JSON.parse(m[1].replace(/<\\\//g, '</'));
    await gravar([{ chave: 'aparelhos', loja_id: null, payload: { seed: S.aparelhos.seed, excl: S.aparelhos.excl || [], page } }]);
    S.aparelhos.page = page;
    return true;
  }
};

async function gravar(linhas) {
  const agora = new Date().toISOString();
  for (const l of linhas) {
    const { error } = await sb.from('datasets').upsert({ ...l, atualizado_em: agora, atualizado_por: S.me.id });
    if (error) throw error;
  }
}

/* ====================== recorte do Ritmo por loja ====================== */
function fatiaRitmo(raw, apelidos) {
  const alvo = new Set(apelidos.map(norm));
  const L = raw.lojas || [], V = raw.vendedores || [];
  const regras = (raw.regrasLoja || []).map(r => ({ loja: r.loja, desde: r.desde || '0000-00-00', vends: (r.vendedores || []).map(v => String(v).toUpperCase()) }));
  const lojaDe = (vend, ds, loja) => { const v = String(vend).toUpperCase(); for (const r of regras) { if (r.vends.indexOf(v) >= 0 && ds >= r.desde) return r.loja; } return loja; };
  const mapL = new Map(), mapV = new Map(), lojasN = [], vendN = [], recs = [];
  for (const r of raw.recs || []) {
    if (!alvo.has(norm(lojaDe(V[r[2]], r[0], L[r[1]])))) continue;
    let li = mapL.get(r[1]); if (li === undefined) { li = lojasN.length; mapL.set(r[1], li); lojasN.push(L[r[1]]); }
    let vi = mapV.get(r[2]); if (vi === undefined) { vi = vendN.length; mapV.set(r[2], vi); vendN.push(V[r[2]]); }
    recs.push([r[0], li, vi, r[3], r[4], r[5], r[6], r[7]]);
  }
  const out = Object.assign({}, raw);
  out.lojas = lojasN; out.vendedores = vendN; out.recs = recs;
  out.volume = {}; Object.keys(raw.volume || {}).forEach(k => { if (alvo.has(norm(k.slice(11)))) out.volume[k] = raw.volume[k]; });
  out.hc = {}; Object.keys(raw.hc || {}).forEach(k => { if (alvo.has(norm(k))) out.hc[k] = raw.hc[k]; });
  const nomes = new Set(vendN.map(v => String(v).toUpperCase()));
  out.foraQuadro = (raw.foraQuadro || []).filter(v => nomes.has(String(v).toUpperCase()));
  out.regrasLoja = (raw.regrasLoja || []).filter(r => alvo.has(norm(r.loja)));
  out.metasIniciais = {}; Object.keys(raw.metasIniciais || {}).forEach(k => { if (alvo.has(norm(k.split('|')[1]))) out.metasIniciais[k] = raw.metasIniciais[k]; });
  out.hcIniciais = {}; Object.keys(raw.hcIniciais || {}).forEach(k => { if (alvo.has(norm(k))) out.hcIniciais[k] = raw.hcIniciais[k]; });
  return out;
}
async function salvarRitmo(raw) {
  const linhas = [{ chave: 'ritmo', loja_id: null, payload: raw }];
  for (const l of S.lojas.filter(x => x.ativa)) {
    linhas.push({ chave: 'ritmo:' + l.id, loja_id: l.id, payload: fatiaRitmo(raw, [l.nome].concat(l.apelidos || [])) });
  }
  await gravar(linhas);
  return linhas.length - 1;
}

async function salvarCfgRitmo(cfg) {
  const linhas = [{ chave: 'ritmo-cfg', loja_id: null, payload: cfg }];
  for (const l of S.lojas.filter(x => x.ativa)) {
    const alvo = new Set([l.nome].concat(l.apelidos || []).map(norm)), f = {};
    f.metas = {}; Object.keys(cfg.metas || {}).forEach(k => { if (alvo.has(norm(k.split('|')[1]))) f.metas[k] = cfg.metas[k]; });
    f.hc = {}; Object.keys(cfg.hc || {}).forEach(k => { if (alvo.has(norm(k))) f.hc[k] = cfg.hc[k]; });
    f.dias = cfg.dias || {};
    f.regras = Array.isArray(cfg.regras) ? cfg.regras.filter(r => alvo.has(norm(r.loja))) : null;
    linhas.push({ chave: 'ritmo-cfg:' + l.id, loja_id: l.id, payload: f });
  }
  await gravar(linhas);
}

/* ====================== entrada única: Excel do Controle Celular ====================== */
const LIM_APARELHO = 60;   // aparelho = Valor Venda acima de R$ 60; chip = de R$ 10 a R$ 60
function carregarXLSX() {
  return window.XLSX ? Promise.resolve() : new Promise((ok, no) => {
    const t = document.createElement('script'); t.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    t.onload = ok; t.onerror = () => no(new Error('Não consegui carregar o leitor de Excel. Verifique a conexão e tente de novo.')); document.head.appendChild(t);
  });
}
const nomeBase = v => norm(String(v || '').replace(/\s*\(.*\)\s*/, ''));   // "IPIRA (9MVY)" -> "IPIRA"
function isoDe(v) {
  if (v instanceof Date) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const t = String(v || '').trim(); let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : null;
}
function numBR(v) {
  if (typeof v === 'number') return v;
  const t = String(v || '').replace(/[R$\s]/g, ''); if (!t) return 0;
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t) || 0;
}
const tcase = v => String(v).trim().split(/\s+/).map(w => ['de', 'da', 'do', 'dos', 'das', 'e'].includes(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
function marcaDe(desc) { const t = norm(desc); for (const k of ['SAMSUNG', 'MOTOROLA', 'APPLE']) if (t.includes(k)) return k; return t.includes('IPHONE') ? 'APPLE' : 'DEMAIS'; }

/* lê o Excel uma única vez e devolve as linhas já limpas */
function lerLinhas(wb, raw) {
  const C = raw.colunas || {};
  const alvo = {}; ['data', 'atend', 'tipo', 'plano', 'valor', 'motivo', 'oper', 'vend', 'loja'].forEach(k => alvo[k] = norm(C[k] || k));
  alvo.desc = 'DESCRICAO DO PRODUTO';
  let best = null;
  wb.SheetNames.forEach(nm => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, raw: true, blankrows: false });
    for (let i = 0; i < Math.min(8, rows.length); i++) {
      const hd = (rows[i] || []).map(norm), ix = {};
      Object.keys(alvo).forEach(k => { ix[k] = hd.indexOf(alvo[k]); });
      if (ix.data >= 0 && ix.vend >= 0 && ix.loja >= 0 && ix.tipo >= 0 && ix.valor >= 0) {
        const sc = Object.keys(ix).filter(k => ix[k] >= 0).length;
        if (!best || sc > best.sc) best = { sc, rows: rows.slice(i + 1), ix };
      }
    }
  });
  if (!best) throw new Error('Não encontrei as colunas da base (Data, Tipo de Ativação, Valor Venda, Vendedor, Loja (Venda)). Envie a planilha do Controle Celular no formato de sempre.');
  const g = (r, k) => best.ix[k] >= 0 ? r[best.ix[k]] : '';
  const out = [];
  best.rows.forEach(r => {
    if (!r || !r.length) return;
    const ds = isoDe(g(r, 'data')); if (!ds) return;
    const loja = String(g(r, 'loja') || '').trim(); if (!loja) return;
    out.push({
      ds, loja, vend: String(g(r, 'vend') || '').trim().toUpperCase(), tipo: String(g(r, 'tipo') || '').trim(),
      plano: String(g(r, 'plano') || '').trim(), motivo: String(g(r, 'motivo') || '').trim(), valor: numBR(g(r, 'valor')),
      oper: String(g(r, 'oper') || '').trim().toUpperCase(), atend: String(g(r, 'atend') || '').trim(), desc: String(g(r, 'desc') || '')
    });
  });
  if (!out.length) throw new Error('A planilha não trouxe nenhuma linha com data válida.');
  return out;
}

/* --- Ritmo Comercial: mesma regra do painel, com aparelho acima de R$ 60 --- */
function montarRitmo(linhas, raw, modo) {
  const L0 = raw.lojas || [], V0 = raw.vendedores || [];
  const porNome = new Map(L0.map(l => [nomeBase(l), l]));
  const canon = l => porNome.get(nomeBase(l)) || l;
  const regras = (raw.regrasLoja || []).map(r => ({ loja: r.loja, desde: r.desde || '0000-00-00', vends: (r.vendedores || []).map(v => String(v).toUpperCase()) }));
  const lojaDe = (vend, ds, loja) => { for (const r of regras) if (r.vends.indexOf(vend) >= 0 && ds >= r.desde) return r.loja; return loja; };
  const MK = raw.marcadores || {}, DP = raw.depara || {}, KPIS = raw.kpis, OPERS = raw.opers || ['TIM', 'VIVO', 'OUTROS'];
  const vol = {}, kpiAt = {};
  linhas.forEach(x => {
    x.loja = canon(x.loja);
    const k = x.ds + '|' + lojaDe(x.vend, x.ds, x.loja), b = vol[k] || (vol[k] = { at: new Set(), n: 0 });
    b.n++; if (x.atend) b.at.add(x.atend);
    const kp = DP[x.tipo]; if (kp && kp !== 'NAO CONSIDERAR' && x.atend) (kpiAt[x.atend] = kpiAt[x.atend] || new Set()).add(kp);
  });
  const volume = {}; Object.keys(vol).forEach(k => { volume[k] = [vol[k].at.size || vol[k].n, vol[k].n]; });
  const classeDe = at => { const t = kpiAt[at]; if (!t) return 2; if (t.has('CONTROLE')) return 0; if (t.has('POS')) return 1; return 2; };
  const oOK = o => OPERS.indexOf(o) >= 0 && o !== 'OUTROS' ? o : 'OUTROS';
  const novos = [];
  linhas.forEach(x => {
    const kp = DP[x.tipo], ki = (kp && kp !== 'NAO CONSIDERAR') ? KPIS.indexOf(kp) : -1;
    const ap = x.valor > LIM_APARELHO, seg = x.plano === MK.seg, port = x.plano === MK.port, troca = x.motivo === MK.troca;
    if (ki < 0 && !ap && !seg && !port && !troca) return;
    let op = -1, cl = -1; if (port) { op = OPERS.indexOf(oOK(x.oper)); cl = classeDe(x.atend); }
    novos.push({ ds: x.ds, loja: x.loja, vend: x.vend, ki, f: (ap ? 1 : 0) | (seg ? 2 : 0) | (port ? 4 : 0) | (troca ? 8 : 0), valor: ap ? Math.round(x.valor * 100) / 100 : 0, op, cl });
  });
  const ini = linhas.reduce((a, x) => x.ds < a ? x.ds : a, '9999-99-99'), fim = linhas.reduce((a, x) => x.ds > a ? x.ds : a, '0000-00-00');
  let objs = novos.slice(), vols = Object.assign({}, volume), trocados = 0;
  const antes = (raw.recs || []).length;
  if (modo !== 'tudo') {
    const antigos = (raw.recs || []).map(r => ({ ds: r[0], loja: L0[r[1]], vend: V0[r[2]], ki: r[3], f: r[4], valor: r[5] || 0, op: r[6], cl: r[7] }));
    const fora = antigos.filter(o => o.ds < ini || o.ds > fim);
    trocados = antigos.length - fora.length; objs = fora.concat(objs);
    vols = {}; Object.keys(raw.volume || {}).forEach(k => { const d = k.slice(0, 10); if (d < ini || d > fim) vols[k] = raw.volume[k]; });
    Object.keys(volume).forEach(k => vols[k] = volume[k]);
  }
  const lojas = [...new Set(objs.map(o => o.loja))].sort(), vends = [...new Set(objs.map(o => o.vend))].sort();
  const li = {}, vi = {}; lojas.forEach((l, i) => li[l] = i); vends.forEach((v, i) => vi[v] = i);
  objs.sort((a, b) => a.ds < b.ds ? -1 : a.ds > b.ds ? 1 : 0);
  const novo = Object.assign({}, raw, { lojas, vendedores: vends, volume: vols, limiteAparelho: LIM_APARELHO, recs: objs.map(o => [o.ds, li[o.loja], vi[o.vend], o.ki, o.f, o.valor, o.op, o.cl]) });
  return { raw: novo, antes, depois: novo.recs.length, trocados, consideradas: novos.length };
}

/* --- Aparelhos e Chip: aparelho acima de R$ 60, chip de R$ 10 a R$ 60, seguro fora --- */
function montarAparelhos(linhas, pay, modo, raw) {
  const seed = pay.seed, lojasSeed = (seed.stores || []).slice();
  const porNome = new Map(); S.lojas.filter(l => l.ativa).forEach(l => [l.nome].concat(l.apelidos || []).forEach(n => porNome.set(nomeBase(n), l.nome)));
  lojasSeed.forEach(l => { if (!porNome.has(nomeBase(l))) porNome.set(nomeBase(l), l); });
  const regras = ((raw && raw.regrasLoja) || []).map(r => ({ loja: r.loja, desde: r.desde || '0000-00-00', vends: (r.vendedores || []).map(v => String(v).toUpperCase()) }));
  const dias = new Map(); let ap = 0, ch = 0, seg = 0, fora = 0, ign = 0;
  linhas.forEach(x => {
    let loja = null;
    for (const r of regras) if (r.vends.indexOf(x.vend) >= 0 && x.ds >= r.desde) { loja = porNome.get(nomeBase(r.loja)); break; }
    if (!loja) loja = porNome.get(nomeBase(x.loja));
    if (!loja) { fora++; return; }
    if (lojasSeed.indexOf(loja) < 0) lojasSeed.push(loja);
    if (norm(x.plano) === 'SEGURO PROTECAO MOVEL') { seg++; return; }
    const v = x.valor; let ty; if (v > LIM_APARELHO) ty = 0; else if (v >= 10) ty = 1; else { ign++; return; }
    ty ? ch++ : ap++;
    const k = Number(x.ds.replace(/-/g, '')), vend = x.vend ? tcase(x.vend) : 'Sem vendedor', br = ty ? '-' : marcaDe(x.desc);
    if (!dias.has(k)) dias.set(k, new Map());
    const m = dias.get(k), kk = loja + '|' + vend + '|' + ty + '|' + br, o = m.get(kk) || [loja, vend, ty, br, 0, 0];
    o[4]++; o[5] = Math.round((o[5] + v) * 100) / 100; m.set(kk, o);
  });
  const ks = [...dias.keys()].sort((a, b) => a - b);
  const novo = JSON.parse(JSON.stringify(pay)); novo.page = novo.page || {}; novo.page.upd = novo.page.upd || {}; novo.seed.stores = lojasSeed;
  if (modo === 'tudo') {
    const vends = [], vIdx = new Map(), brands = ['SAMSUNG', 'MOTOROLA', 'APPLE', 'DEMAIS', '-'], rows = [];
    ks.forEach(k => dias.get(k).forEach(o => {
      let vi = vIdx.get(o[1]); if (vi === undefined) { vi = vends.length; vIdx.set(o[1], vi); vends.push(o[1]); }
      rows.push([k, lojasSeed.indexOf(o[0]), vi, o[2], brands.indexOf(o[3]), o[4], o[5]]);
    }));
    novo.seed = { stores: lojasSeed, vends, brands, rows }; novo.page.upd = {};
  } else {
    // o período do arquivo substitui tudo o que já havia nele: dias antigos dentro do intervalo que não vieram no arquivo também saem
    const k0 = ks[0], k1 = ks[ks.length - 1];
    novo.seed.rows = (novo.seed.rows || []).filter(r => r[0] < k0 || r[0] > k1);
    Object.keys(novo.page.upd).forEach(k => { if (+k >= k0 && +k <= k1) delete novo.page.upd[k]; });
    ks.forEach(k => { novo.page.upd[String(k)] = [...dias.get(k).values()]; });
  }
  novo.page.log = [{ em: new Date().toISOString(), arquivo: pay.__arquivo || 'Excel', de: ks[0], ate: ks[ks.length - 1], dias: ks.length, aparelhos: ap, chips: ch }].concat(novo.page.log || []).slice(0, 60);
  delete novo.__arquivo;
  return { pay: novo, ap, ch, seg, fora, ign, dias: ks.length };
}

function montarComissao(wb, antigo, modo) {
  const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const nw = ComissaoNucleo.aggregateRows(json);
  if (!nw.M.length) return { erro: 'Não achei vendas com data válida para a comissão.' };
  const velho = antigo && antigo.data;
  if (modo === 'tudo' || !velho) return { data: nw, nw, linhas: json.length };
  // mês só é substituído se o arquivo cobre desde o primeiro dia de venda já carregado (o dia 1 pode ser feriado ou domingo)
  const mnVelho = velho.MN || {};
  const ruim = nw.M.filter(m => velho.M.includes(m) && (nw.MN[m] || 1) > (mnVelho[m] != null ? mnVelho[m] : 3));
  if (ruim.length) return { pulou: ruim, nw, linhas: json.length };
  return { data: ComissaoNucleo.mergeData(velho, nw), nw, linhas: json.length };
}
const mesRot = mk => { const [y, m] = mk.split('-'); return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+m - 1] + '/' + y; };
let PREVIA = null;
const brData = iso => iso.split('-').reverse().join('/');
async function lerExcelUnico(file) {
  const m = $('#xlMsg'), pv = $('#xlPrev');
  m.className = 'msg'; m.textContent = 'Lendo ' + file.name + '…'; pv.innerHTML = ''; PREVIA = null;
  try {
    await carregarXLSX();
    const raw = await lerDataset('ritmo');
    if (!raw || !raw.recs) throw new Error('Antes da primeira entrada pelo Excel, carregue o ritmo.json (cartão abaixo): ele traz as regras de leitura do Ritmo.');
    const apar = await lerDataset('aparelhos');
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
    const linhas = lerLinhas(wb, raw);
    const comis = await lerDataset('comissao');
    const ini = linhas.reduce((a, x) => x.ds < a ? x.ds : a, '9999'), fim = linhas.reduce((a, x) => x.ds > a ? x.ds : a, '0000');
    PREVIA = { file: file.name, linhas, raw, apar, comis, wb, ini, fim };
    const modo = ($('input[name="xlModo"]:checked') || {}).value || 'periodo';
    const r = montarRitmo(linhas.map(x => ({ ...x })), raw, modo);
    let ha = '';
    if (apar && apar.seed) { const a = montarAparelhos(linhas, Object.assign({ __arquivo: file.name }, apar), modo, raw); ha = `<li><b>Aparelhos e Chip:</b> ${a.ap} aparelhos e ${a.ch} chips em ${a.dias} dia(s)${a.seg ? ` · ${a.seg} seguro(s) fora da conta` : ''}${a.fora ? ` · ${a.fora} linha(s) de loja não cadastrada` : ''}</li>`; }
    else ha = '<li>Aparelhos e Chip ainda não tem base carregada: só o Ritmo será atualizado.</li>';
    const c = montarComissao(wb, comis, modo);
    const hc = c.erro ? `<li><b>Comissão e Meta:</b> ${c.erro}</li>` : c.pulou
      ? `<li><b>Comissão e Meta não será atualizado:</b> o arquivo começa depois do primeiro dia já carregado em ${c.pulou.map(mesRot).join(", ")}. Para a comissão, envie o acumulado do mês (dia 1 até hoje), ou o ano inteiro.</li>`
      : `<li><b>Comissão e Meta:</b> ${c.nw.M.map(k => mesRot(k) + ' até o dia ' + c.nw.D[k]).join(' · ')}${modo === 'tudo' ? ' (substituição total)' : ''}${Object.keys(c.nw.unmapped || {}).length ? ' · tipos sem regra: ' + Object.keys(c.nw.unmapped).join(', ') : ''}</li>`;
    ha += hc;
    m.className = 'msg ok'; m.textContent = 'Arquivo lido. Confira e confirme abaixo.';
    pv.innerHTML = `<div class="destaque"><ul>
      <li><b>${linhas.length}</b> linhas lidas · período <b>${brData(ini)} a ${brData(fim)}</b></li>
      <li><b>Ritmo Comercial:</b> ${r.consideradas} registros considerados · a base passa de ${r.antes} para <b>${r.depois}</b>${modo === 'tudo' ? ' (substituição total)' : ` (${r.trocados} registros desse período foram trocados)`}</li>${ha}
      <li>Regra de aparelho: Valor Venda acima de <b>R$ ${LIM_APARELHO}</b> nos dois painéis.</li></ul>
      <button class="btn pri" id="xlOk">Incluir nos painéis</button> <button class="btn" id="xlCancel">Cancelar</button></div>`;
    $('#xlOk').addEventListener('click', confirmarExcel); $('#xlCancel').addEventListener('click', () => { PREVIA = null; pv.innerHTML = ''; m.textContent = ''; $('#arqXl').value = ''; });
  } catch (err) { m.className = 'msg'; m.textContent = 'Não deu certo: ' + msgErro(err); }
}
async function confirmarExcel() {
  const P = PREVIA; if (!P) return; const m = $('#xlMsg'); $('#xlOk').disabled = true; m.className = 'msg'; m.textContent = 'Gravando nos dois painéis e refazendo os recortes por loja…';
  try {
    const modo = ($('input[name="xlModo"]:checked') || {}).value || 'periodo';
    const r = montarRitmo(P.linhas.map(x => ({ ...x })), P.raw, modo);
    const n = await salvarRitmo(r.raw);
    if (P.apar && P.apar.seed) { const a = montarAparelhos(P.linhas, Object.assign({ __arquivo: P.file }, P.apar), modo, P.raw); await gravar([{ chave: 'aparelhos', loja_id: null, payload: a.pay }]); }
    const c = montarComissao(P.wb, P.comis, modo); let txtC = '';
    if (c.data) { await salvarComissao(c.data, (P.comis && P.comis.cfg) || ComissaoNucleo.defaultCfg(), (P.comis && P.comis.cfgAt) || 0); txtC = ' e Comissão e Meta'; }
    m.className = 'msg ok'; m.textContent = `Pronto. Ritmo (${r.depois} registros, ${n} recortes de loja)${P.apar && P.apar.seed ? ', Aparelhos e Chip' : ''}${txtC} atualizados. Base agora até ${brData(P.fim)}.${c.pulou ? ' A comissão ficou como estava (arquivo não começa no dia 1).' : ''}`;
    $('#xlPrev').innerHTML = ''; PREVIA = null; $('#arqXl').value = '';
  } catch (err) { m.className = 'msg'; m.textContent = 'Não deu certo: ' + msgErro(err); $('#xlOk') && ($('#xlOk').disabled = false); }
}

/* ====================== importar dados ====================== */
function abrirDados() {
  $('#palco').innerHTML = `<div class="pagina">
    <div class="cartao"><header><h2>Atualizar pelo Excel do Controle Celular</h2><span>Uma entrada só alimenta Ritmo Comercial, Aparelhos e Chip e Comissão e Meta</span></header>
    <div class="corpo">
      <div class="solta"><b>Escolha a planilha (.xlsx)</b><br><span class="nota">Ideal: o acumulado do ano (ou do mês, do dia 1 até hoje). Alimenta Ritmo, Aparelhos e Chip e Comissão e Meta. Aparelho = Valor Venda acima de R$ 60.</span><br>
      <input type="file" id="arqXl" accept=".xlsx,.xlsm,.xls"></div>
      <div class="nota" style="margin:8px 0"><label><input type="radio" name="xlModo" value="periodo" checked> Atualizar só os dias do arquivo (o resto do ano fica como está)</label><br>
      <label><input type="radio" name="xlModo" value="tudo"> Substituir tudo (use só com a base do ano inteiro: apaga o que não estiver no arquivo)</label></div>
      <p class="msg" id="xlMsg" role="status"></p><div id="xlPrev"></div>
    </div></div>
    <div class="cartao"><header><h2>Importar dados</h2><span>Carrega os arquivos de dados no servidor (somente dono e administrador)</span></header>
    <div class="corpo">
      <div class="solta"><b>Escolha o arquivo de dados</b><br><span class="nota">Aceita o arquivo do Ritmo Comercial (<code>ritmo.json</code>) ou de Aparelhos e Chip (<code>aparelhos.json</code>).</span><br>
      <input type="file" id="arqDados" accept=".json,application/json"></div>
      <p class="msg" id="dadosMsg" role="status"></p>
      <p class="nota">Este cartão serve só para a primeira carga. As atualizações do dia a dia entram pelo Excel, no cartão acima.</p>
    </div></div>
    <div class="cartao"><header><h2>Refazer os recortes por loja</h2><span>Use depois de cadastrar uma loja nova ou mudar os nomes (apelidos) de uma loja</span></header>
    <div class="corpo"><button class="btn" id="btnRefazer">Refazer recortes do Ritmo Comercial</button><p class="msg" id="refMsg" role="status"></p></div></div>
  </div>`;
  $('#arqXl').addEventListener('change', e => { const f = e.target.files[0]; if (f) lerExcelUnico(f); });
  document.querySelectorAll('input[name="xlModo"]').forEach(r => r.addEventListener('change', () => { const f = $('#arqXl').files[0]; if (f) lerExcelUnico(f); }));
  $('#arqDados').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return; const m = $('#dadosMsg'); m.className = 'msg'; m.textContent = 'Lendo o arquivo…';
    try {
      const d = JSON.parse(await f.text());
      if (d && d.recs && d.lojas && d.vendedores) {
        m.textContent = 'Enviando o Ritmo Comercial e gerando os recortes por loja…';
        const n = await salvarRitmo(d);
        m.className = 'msg ok'; m.textContent = `Ritmo Comercial carregado (${d.recs.length} registros) e ${n} recortes de loja gerados.`;
      } else if (d && d.seed && d.page) {
        m.textContent = 'Enviando Aparelhos e Chip…';
        await gravar([{ chave: 'aparelhos', loja_id: null, payload: d }]);
        m.className = 'msg ok'; m.textContent = `Aparelhos e Chip carregado (${d.seed.rows.length} linhas da base).`;
      } else throw new Error('Arquivo não reconhecido.');
    } catch (err) { m.className = 'msg'; m.textContent = 'Não deu certo: ' + msgErro(err); }
    e.target.value = '';
  });
  $('#btnRefazer').addEventListener('click', async () => {
    const m = $('#refMsg'); m.className = 'msg'; m.textContent = 'Refazendo…';
    try {
      const raw = await lerDataset('ritmo'); if (!raw) throw new Error('Não há base do Ritmo carregada.');
      const n = await salvarRitmo(raw); m.className = 'msg ok'; m.textContent = `${n} recortes de loja refeitos.`;
    } catch (err) { m.textContent = msgErro(err); }
  });
}

/* ====================== cadastros ====================== */
async function chamarUsuarios(corpo) {
  const { data, error } = await sb.functions.invoke('usuarios', { body: corpo });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j && j.erro) msg = j.erro; } catch (e) { /* mantém */ }
    throw new Error(msg);
  }
  if (data && data.erro) throw new Error(data.erro);
  return data;
}
const senhaAleatoria = () => { const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const u = crypto.getRandomValues(new Uint32Array(10)); return Array.from(u, x => a[x % a.length]).join(''); };

async function abrirCadastros() {
  carregando();
  try {
    const { data: lj } = await sb.from('lojas').select('*').order('nome'); S.lojas = lj || [];
    const { data: us, error } = await sb.from('profiles').select('*').order('papel').order('nome'); if (error) throw error;
    const lojaNome = id => (S.lojas.find(l => l.id === id) || {}).nome || '—';
    const meusPapeis = PODE_CRIAR[S.me.papel] || [];
    const podeVer = us.filter(u => u.id !== S.me.id || true);

    const blocoLojas = gestao() ? `
      <div class="cartao"><header><h2>Lojas</h2><span>Cada loja tem os seus gerentes e vendedores. Os “apelidos” são os nomes da loja como aparecem nas bases.</span></header>
      <div class="tabela-w"><table class="t"><thead><tr><th>Loja</th><th>Apelidos (separe por ;)</th><th>Status</th><th></th></tr></thead><tbody>
      ${S.lojas.map(l => `<tr data-loja="${l.id}"><td><b>${esc(l.nome)}</b></td>
        <td><input class="ap" value="${esc((l.apelidos || []).join('; '))}" aria-label="Apelidos de ${esc(l.nome)}"></td>
        <td><span class="pilula ${l.ativa ? 'ok' : 'off'}">${l.ativa ? 'Ativa' : 'Inativa'}</span></td>
        <td><div class="acoes"><button class="btn mini" data-a="salvar-loja">Salvar apelidos</button><button class="btn mini" data-a="alt-loja">${l.ativa ? 'Desativar' : 'Ativar'}</button></div></td></tr>`).join('')}
      </tbody></table></div>
      <div class="corpo"><form id="formLoja" class="grade"><div><label for="lojaNome">Nova loja</label><input id="lojaNome" required maxlength="60" placeholder="Ex.: Feira de Santana"></div>
        <div class="col2"><label for="lojaAp">Apelidos nas bases (opcional, separe por ;)</label><input id="lojaAp" placeholder="Ex.: FEIRA DE SANTANA (ABCD)"></div>
        <div><button class="btn principal" type="submit">Adicionar loja</button></div></form><p class="msg" id="lojaMsg" role="status"></p></div></div>` : '';

    const opPapel = meusPapeis.map(p => `<option value="${p}">${ROTULO[p]}</option>`).join('');
    const opLoja = S.lojas.filter(l => l.ativa).map(l => `<option value="${l.id}">${esc(l.nome)}</option>`).join('');
    const blocoNovo = meusPapeis.length ? `
      <div class="cartao"><header><h2>Novo usuário</h2><span>${S.me.papel === 'dono' ? 'Você cadastra administradores, gerentes e vendedores.' : S.me.papel === 'admin' ? 'Você cadastra gerentes e vendedores.' : 'Você cadastra os vendedores da sua loja.'}</span></header>
      <div class="corpo"><form id="formUser" class="grade">
        <div><label for="uNomeN">Nome</label><input id="uNomeN" required maxlength="80"></div>
        <div><label for="uEmailN">E-mail (será o login)</label><input id="uEmailN" type="email" required></div>
        <div><label for="uPapelN">Perfil</label><select id="uPapelN">${opPapel}</select></div>
        <div id="boxLoja"${S.me.papel === 'gerente' ? ' hidden' : ''}><label for="uLojaN">Loja</label><select id="uLojaN">${opLoja}</select></div>
        <div><label for="uSenhaN">Senha inicial (mín. 8)</label><input id="uSenhaN" required minlength="8" value="${senhaAleatoria()}"></div>
        <div class="col2"><label for="uVendN">Nome na base de vendas (opcional)</label><input id="uVendN" placeholder="Como o vendedor aparece nas planilhas"></div>
        <div><button class="btn principal" type="submit">Cadastrar</button></div></form>
        <p class="msg" id="userMsg" role="status"></p><div id="userOk"></div></div></div>` : '';

    const linhas = podeVer.map(u => {
      const eu = u.id === S.me.id;
      const gerivel = !eu && (PODE_CRIAR[S.me.papel] || []).includes(u.papel) && (S.me.papel !== 'gerente' || u.loja_id === S.me.loja_id);
      return `<tr data-id="${u.id}"><td><b>${esc(u.nome || '—')}</b><br><small style="color:var(--muted)">${esc(u.email || '')}</small></td>
        <td>${ROTULO[u.papel]}</td><td>${esc(u.loja_id ? lojaNome(u.loja_id) : 'Todas')}</td>
        <td><span class="pilula ${u.ativo ? 'ok' : 'off'}">${u.ativo ? 'Ativo' : 'Inativo'}</span></td>
        <td>${gerivel ? `<div class="acoes"><button class="btn mini" data-a="alt-user">${u.ativo ? 'Desativar' : 'Ativar'}</button><button class="btn mini" data-a="senha-user">Redefinir senha</button></div>` : ''}</td></tr>`;
    }).join('');
    const blocoLista = `<div class="cartao"><header><h2>Usuários</h2><span>${S.me.papel === 'gerente' ? 'Equipe da sua loja' : 'Quem você enxerga'}</span></header>
      <div class="tabela-w"><table class="t"><thead><tr><th>Nome</th><th>Perfil</th><th>Loja</th><th>Status</th><th></th></tr></thead><tbody>${linhas || '<tr><td colspan="5">Nenhum usuário ainda.</td></tr>'}</tbody></table></div></div>`;

    $('#palco').innerHTML = `<div class="pagina">${blocoLojas}${blocoNovo}${blocoLista}</div>`;
    ligarCadastros();
  } catch (e) { aviso('Não consegui abrir os cadastros', esc(msgErro(e))); }
}

function ligarCadastros() {
  const sync = () => { const p = $('#uPapelN'); if (p) { const vend = p.value === 'vendedor'; $('#uVendN').closest('div').hidden = !vend; if ($('#boxLoja') && S.me.papel !== 'gerente') $('#boxLoja').hidden = p.value === 'admin'; } };
  if ($('#uPapelN')) { $('#uPapelN').addEventListener('change', sync); sync(); }

  const fl = $('#formLoja');
  if (fl) fl.addEventListener('submit', async (e) => {
    e.preventDefault(); const m = $('#lojaMsg'); m.className = 'msg'; m.textContent = '';
    const nome = $('#lojaNome').value.trim();
    const ap = $('#lojaAp').value.split(';').map(s => s.trim()).filter(Boolean);
    const { error } = await sb.from('lojas').insert({ nome, apelidos: ap.includes(nome) ? ap : [nome].concat(ap) });
    if (error) { m.textContent = /duplicate/i.test(error.message) ? 'Já existe uma loja com esse nome.' : msgErro(error); return; }
    abrirCadastros();
  });

  const fu = $('#formUser');
  if (fu) fu.addEventListener('submit', async (e) => {
    e.preventDefault(); const m = $('#userMsg'); m.className = 'msg'; m.textContent = 'Cadastrando…'; $('#userOk').innerHTML = '';
    const corpo = { acao: 'criar', nome: $('#uNomeN').value.trim(), email: $('#uEmailN').value.trim(), senha: $('#uSenhaN').value,
      papel: $('#uPapelN').value, loja_id: S.me.papel === 'gerente' ? S.me.loja_id : ($('#uLojaN').value || null), vendedor_nome: $('#uVendN').value.trim() || null };
    try {
      await chamarUsuarios(corpo);
      m.textContent = '';
      $('#userOk').innerHTML = `<div class="destaque">Usuário cadastrado. Envie estes dados para ele: login <code>${esc(corpo.email)}</code> · senha inicial <code>${esc(corpo.senha)}</code></div>`;
      const ok = $('#userOk').innerHTML;
      await abrirCadastros(); $('#userOk').innerHTML = ok;
    } catch (err) { m.textContent = msgErro(err); }
  });

  $('#palco').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const tr = b.closest('tr'), a = b.dataset.a;
    try {
      if (a === 'salvar-loja') {
        const ap = tr.querySelector('.ap').value.split(';').map(s => s.trim()).filter(Boolean);
        const { error } = await sb.from('lojas').update({ apelidos: ap }).eq('id', tr.dataset.loja); if (error) throw error;
        b.textContent = 'Salvo ✓'; setTimeout(() => b.textContent = 'Salvar apelidos', 1500);
      } else if (a === 'alt-loja') {
        const l = S.lojas.find(x => x.id === tr.dataset.loja);
        const { error } = await sb.from('lojas').update({ ativa: !l.ativa }).eq('id', l.id); if (error) throw error; abrirCadastros();
      } else if (a === 'alt-user') {
        const { data: u } = await sb.from('profiles').select('ativo').eq('id', tr.dataset.id).maybeSingle();
        const { error } = await sb.from('profiles').update({ ativo: !u.ativo }).eq('id', tr.dataset.id); if (error) throw error; abrirCadastros();
      } else if (a === 'senha-user') {
        const nova = prompt('Nova senha para este usuário (mínimo 8 caracteres):', senhaAleatoria());
        if (!nova) return;
        await chamarUsuarios({ acao: 'redefinir_senha', id: tr.dataset.id, senha: nova });
        alert('Senha redefinida. Informe a nova senha ao usuário:\n\n' + nova);
      }
    } catch (err) { alert(msgErro(err)); }
  });
}

iniciar();
})();
