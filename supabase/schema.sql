-- Estrutura do banco do Painel Unificado (Supabase, projeto dmdtnrafghrelpnvwoxa)
-- Exportada em 11/11/2026. Só estrutura e regras de acesso, sem dados.
-- A Edge Function "usuarios" está em supabase/functions/usuarios/index.ts.
-- O gatilho on_auth_user_created (em auth.users) chama handle_new_user().

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.lojas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativa boolean not null default true,
  criado_em timestamptz not null default now(),
  apelidos text[] not null default '{}',
  empresa_id uuid not null references public.empresas(id),
  unique (empresa_id, nome)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nome text,
  papel text not null default 'vendedor' check (papel in ('dono','admin','gerente','vendedor')), -- admin = Empresário
  loja_id uuid references public.lojas(id),
  vendedor_nome text,
  criado_por uuid references auth.users(id),
  ativo boolean not null default false,
  criado_em timestamptz not null default now(),
  empresa_id uuid references public.empresas(id), -- nulo só para o dono da plataforma
  check (papel in ('dono','admin') or loja_id is not null)
);

create table public.app_config (
  empresa_id uuid not null references public.empresas(id),
  chave text not null,
  valor jsonb not null,
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, chave)
);

create table public.datasets (
  empresa_id uuid not null references public.empresas(id),
  chave text not null,
  loja_id uuid references public.lojas(id),
  payload jsonb not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id),
  primary key (empresa_id, chave)
);

create index on public.profiles(empresa_id);
create index on public.lojas(empresa_id);

alter table public.empresas enable row level security;
alter table public.lojas enable row level security;
alter table public.profiles enable row level security;
alter table public.app_config enable row level security;
alter table public.datasets enable row level security;

-- funções de apoio (security definer, só para usuários logados)
create or replace function public.meu_papel() returns text language sql stable security definer set search_path to 'public'
as $$ select papel from public.profiles where id = auth.uid() and ativo $$;
create or replace function public.minha_loja() returns uuid language sql stable security definer set search_path to 'public'
as $$ select loja_id from public.profiles where id = auth.uid() and ativo $$;
create or replace function public.minha_empresa() returns uuid language sql stable security definer set search_path to 'public'
as $$ select empresa_id from public.profiles where id = auth.uid() and ativo $$;
revoke all on function public.minha_empresa() from public, anon;
grant execute on function public.minha_empresa() to authenticated;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path to 'public'
as $$ begin
  if lower(new.email) = 'luandantas00@gmail.com' then
    insert into public.profiles(id, email, nome, papel, ativo) values (new.id, new.email, 'Luan Sadraque Dantas', 'dono', true);
  end if;
  return new;
end $$;
-- create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- regras de acesso
create policy empresas_ler on public.empresas for select using (meu_papel()='dono' or id=minha_empresa());
create policy empresas_dono on public.empresas for all using (meu_papel()='dono') with check (meu_papel()='dono');

create policy config_ler on public.app_config for select using (meu_papel()='dono' or empresa_id=minha_empresa());
create policy config_escrever on public.app_config for all
  using (meu_papel()='dono' or (meu_papel()='admin' and empresa_id=minha_empresa()))
  with check (meu_papel()='dono' or (meu_papel()='admin' and empresa_id=minha_empresa()));

create policy lojas_ler on public.lojas for select using (
  meu_papel()='dono' or (meu_papel()='admin' and empresa_id=minha_empresa()) or id=minha_loja());
create policy lojas_escrever on public.lojas for all
  using (meu_papel()='dono' or (meu_papel()='admin' and empresa_id=minha_empresa()))
  with check (meu_papel()='dono' or (meu_papel()='admin' and empresa_id=minha_empresa()));

create policy dados_ler_gestao on public.datasets for select using (
  meu_papel()='dono' or (meu_papel()='admin' and empresa_id=minha_empresa()));
create policy dados_escrever on public.datasets for all
  using (meu_papel()='dono' or (meu_papel()='admin' and empresa_id=minha_empresa()))
  with check (meu_papel()='dono' or (meu_papel()='admin' and empresa_id=minha_empresa()));
create policy dados_ler_gerente on public.datasets for select using (
  meu_papel()='gerente' and empresa_id=minha_empresa() and loja_id=minha_loja() and (chave like 'ritmo%' or chave like 'comissao%'));
create policy dados_ler_vendedor on public.datasets for select using (
  meu_papel()='vendedor' and empresa_id=minha_empresa() and loja_id=minha_loja() and chave like 'ritmo%');
create policy dados_gerente_vw on public.datasets for all
  using (meu_papel()='gerente' and empresa_id=minha_empresa() and loja_id=minha_loja() and chave=('comissao-vw:'||loja_id::text))
  with check (meu_papel()='gerente' and empresa_id=minha_empresa() and loja_id=minha_loja() and chave=('comissao-vw:'||loja_id::text));

create policy perfis_ler on public.profiles for select using (
  id=auth.uid() or meu_papel()='dono'
  or (meu_papel()='admin' and empresa_id=minha_empresa())
  or (meu_papel()='gerente' and empresa_id=minha_empresa() and loja_id=minha_loja()));
create policy perfis_dono_edita on public.profiles for update using (meu_papel()='dono') with check (meu_papel()='dono');
create policy perfis_admin_edita on public.profiles for update
  using (meu_papel()='admin' and empresa_id=minha_empresa() and papel in ('gerente','vendedor'))
  with check (meu_papel()='admin' and empresa_id=minha_empresa() and papel in ('gerente','vendedor'));
create policy perfis_gerente_edita on public.profiles for update
  using (meu_papel()='gerente' and empresa_id=minha_empresa() and papel='vendedor' and loja_id=minha_loja())
  with check (meu_papel()='gerente' and empresa_id=minha_empresa() and papel='vendedor' and loja_id=minha_loja());
