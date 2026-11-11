import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// quem pode criar / administrar quem
const PODE_CRIAR: Record<string, string[]> = {
  dono: ["admin", "gerente", "vendedor"],
  admin: ["gerente", "vendedor"],
  gerente: ["vendedor"],
};

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

  if (b.acao === "criar") {
    const email = String(b.email ?? "").trim().toLowerCase();
    const senha = String(b.senha ?? "");
    const nome = String(b.nome ?? "").trim();
    const papel = String(b.papel ?? "");
    let loja_id: string | null = b.loja_id ?? null;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ erro: "E-mail inválido." }, 400);
    if (senha.length < 8) return json({ erro: "A senha precisa ter ao menos 8 caracteres." }, 400);
    if (!nome) return json({ erro: "Informe o nome." }, 400);
    if (!permitidos.includes(papel)) return json({ erro: "Seu perfil não pode criar esse tipo de usuário." }, 403);
    if (eu.papel === "gerente") loja_id = eu.loja_id; // gerente só cria na própria loja
    if (papel !== "admin" && !loja_id) return json({ erro: "Escolha a loja." }, 400);
    if (papel === "admin") loja_id = null;

    const { data: novo, error } = await admin.auth.admin.createUser({
      email, password: senha, email_confirm: true, user_metadata: { nome },
    });
    if (error || !novo?.user) return json({ erro: error?.message ?? "Não consegui criar o usuário." }, 400);

    const { error: e2 } = await admin.from("profiles").upsert({
      id: novo.user.id, email, nome, papel, loja_id,
      vendedor_nome: b.vendedor_nome ? String(b.vendedor_nome).trim() : null,
      criado_por: eu.id, ativo: true,
    });
    if (e2) { await admin.auth.admin.deleteUser(novo.user.id); return json({ erro: e2.message }, 400); }
    return json({ ok: true, id: novo.user.id });
  }

  if (b.acao === "redefinir_senha") {
    const senha = String(b.senha ?? "");
    if (senha.length < 8) return json({ erro: "A senha precisa ter ao menos 8 caracteres." }, 400);
    const { data: alvo } = await admin.from("profiles").select("*").eq("id", b.id).maybeSingle();
    if (!alvo) return json({ erro: "Usuário não encontrado." }, 404);
    if (!permitidos.includes(alvo.papel)) return json({ erro: "Sem permissão sobre esse usuário." }, 403);
    if (eu.papel === "gerente" && alvo.loja_id !== eu.loja_id) return json({ erro: "Sem permissão sobre esse usuário." }, 403);
    const { error } = await admin.auth.admin.updateUserById(alvo.id, { password: senha });
    if (error) return json({ erro: error.message }, 400);
    return json({ ok: true });
  }

  return json({ erro: "Ação desconhecida." }, 400);
});
