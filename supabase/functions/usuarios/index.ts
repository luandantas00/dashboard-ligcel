import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// quem pode criar quem (papel "admin" = Empresário na tela)
const PODE_CRIAR: Record<string, string[]> = {
  dono: ["admin", "gerente", "vendedor"],
  admin: ["gerente", "vendedor"],
  gerente: ["vendedor"],
};
const SITE_PADRAO = "https://luandantas00.github.io/dashboard-ligcel/";
const emailOk = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const auth = req.headers.get("Authorization") ?? "";
  const quem = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: u } = await quem.auth.getUser();
  if (!u?.user) return json({ erro: "Sessão inválida." }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: eu } = await admin.from("profiles").select("*").eq("id", u.user.id).maybeSingle();
  if (!eu || !eu.ativo) return json({ erro: "Seu acesso está inativo." }, 403);
  const permitidos = PODE_CRIAR[eu.papel] ?? [];
  if (!permitidos.length) return json({ erro: "Seu perfil não cadastra usuários." }, 403);

  let b: any;
  try { b = await req.json(); } catch { return json({ erro: "Dados inválidos." }, 400); }

  const site = typeof b.site === "string" && /^https:\/\/luandantas00\.github\.io\//.test(b.site) ? b.site : SITE_PADRAO;
  const linkDe = (hashed: string, tipo: string) => `${site.split("?")[0].split("#")[0]}?token=${encodeURIComponent(hashed)}&tipo=${tipo}`;

  // empresa em que a ação acontece: o dono escolhe, os demais ficam na própria
  const empresaId: string | null = eu.papel === "dono" ? (b.empresa_id ?? null) : eu.empresa_id;
  const noEscopo = (alvo: any) =>
    eu.papel === "dono" ||
    (alvo.empresa_id === eu.empresa_id && (eu.papel !== "gerente" || alvo.loja_id === eu.loja_id));

  async function validarNovo(papel: string, lojaIdIn: string | null) {
    if (!empresaId) return { erro: "Escolha a empresa." };
    if (!permitidos.includes(papel)) return { erro: "Seu perfil não pode criar esse tipo de usuário." };
    let loja_id: string | null = lojaIdIn;
    if (eu.papel === "gerente") loja_id = eu.loja_id;
    if (papel === "admin") loja_id = null;
    else {
      if (!loja_id) return { erro: "Escolha a loja." };
      const { data: l } = await admin.from("lojas").select("id").eq("id", loja_id).eq("empresa_id", empresaId).maybeSingle();
      if (!l) return { erro: "Loja não pertence a esta empresa." };
    }
    return { loja_id };
  }

  if (b.acao === "nova_empresa") {
    if (eu.papel !== "dono") return json({ erro: "Só o dono cria empresas." }, 403);
    const nomeEmp = String(b.empresa_nome ?? "").trim();
    const nome = String(b.nome ?? "").trim();
    const email = String(b.email ?? "").trim().toLowerCase();
    if (!nomeEmp) return json({ erro: "Informe o nome da empresa." }, 400);
    if (!nome) return json({ erro: "Informe o nome do empresário." }, 400);
    if (!emailOk(email)) return json({ erro: "E-mail inválido." }, 400);
    const { data: emp, error: e0 } = await admin.from("empresas").insert({ nome: nomeEmp }).select("id").single();
    if (e0 || !emp) return json({ erro: e0?.message ?? "Não consegui criar a empresa." }, 400);
    const { data: lk, error: e1 } = await admin.auth.admin.generateLink({ type: "invite", email, options: { data: { nome } } });
    if (e1 || !lk?.user) { await admin.from("empresas").delete().eq("id", emp.id); return json({ erro: e1?.message ?? "Não consegui gerar o convite." }, 400); }
    const { error: e2 } = await admin.from("profiles").upsert({
      id: lk.user.id, email, nome, papel: "admin", loja_id: null, empresa_id: emp.id, criado_por: eu.id, ativo: true,
    });
    if (e2) { await admin.auth.admin.deleteUser(lk.user.id); await admin.from("empresas").delete().eq("id", emp.id); return json({ erro: e2.message }, 400); }
    return json({ ok: true, empresa_id: emp.id, id: lk.user.id, link: linkDe(lk.properties.hashed_token, "invite") });
  }

  if (b.acao === "criar" || b.acao === "convidar") {
    const email = String(b.email ?? "").trim().toLowerCase();
    const nome = String(b.nome ?? "").trim();
    const papel = String(b.papel ?? "");
    if (!emailOk(email)) return json({ erro: "E-mail inválido." }, 400);
    if (!nome) return json({ erro: "Informe o nome." }, 400);
    const v = await validarNovo(papel, b.loja_id ?? null);
    if ("erro" in v) return json({ erro: v.erro }, 400);

    let id: string; let link: string | null = null;
    if (b.acao === "criar") {
      const senha = String(b.senha ?? "");
      if (senha.length < 8) return json({ erro: "A senha precisa ter ao menos 8 caracteres." }, 400);
      const { data: novo, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome } });
      if (error || !novo?.user) return json({ erro: error?.message ?? "Não consegui criar o usuário." }, 400);
      id = novo.user.id;
    } else {
      const { data: lk, error } = await admin.auth.admin.generateLink({ type: "invite", email, options: { data: { nome } } });
      if (error || !lk?.user) return json({ erro: error?.message ?? "Não consegui gerar o convite." }, 400);
      id = lk.user.id; link = linkDe(lk.properties.hashed_token, "invite");
    }
    const { error: e2 } = await admin.from("profiles").upsert({
      id, email, nome, papel, loja_id: v.loja_id, empresa_id: empresaId,
      vendedor_nome: b.vendedor_nome ? String(b.vendedor_nome).trim() : null, criado_por: eu.id, ativo: true,
    });
    if (e2) { await admin.auth.admin.deleteUser(id); return json({ erro: e2.message }, 400); }
    return json({ ok: true, id, link });
  }

  if (b.acao === "gerar_link" || b.acao === "redefinir_senha") {
    const { data: alvo } = await admin.from("profiles").select("*").eq("id", b.id).maybeSingle();
    if (!alvo) return json({ erro: "Usuário não encontrado." }, 404);
    if (!permitidos.includes(alvo.papel) || !noEscopo(alvo)) return json({ erro: "Sem permissão sobre esse usuário." }, 403);
    if (b.acao === "gerar_link") {
      const { data: lk, error } = await admin.auth.admin.generateLink({ type: "recovery", email: alvo.email });
      if (error || !lk?.properties) return json({ erro: error?.message ?? "Não consegui gerar o link." }, 400);
      return json({ ok: true, link: linkDe(lk.properties.hashed_token, "recovery") });
    }
    const senha = String(b.senha ?? "");
    if (senha.length < 8) return json({ erro: "A senha precisa ter ao menos 8 caracteres." }, 400);
    const { error } = await admin.auth.admin.updateUserById(alvo.id, { password: senha });
    if (error) return json({ erro: error.message }, 400);
    return json({ ok: true });
  }

  return json({ erro: "Ação desconhecida." }, 400);
});
