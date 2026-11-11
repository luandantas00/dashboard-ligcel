begin;

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);
alter table public.empresas enable row level security;
insert into public.empresas(id, nome) values ('00000000-0000-4000-8000-000000000001', 'LIGCEL');

alter table public.lojas add column empresa_id uuid references public.empresas(id);
alter table public.profiles add column empresa_id uuid references public.empresas(id);
alter table public.datasets add column empresa_id uuid references public.empresas(id);
alter table public.app_config add column empresa_id uuid references public.empresas(id);

update public.lojas set empresa_id='00000000-0000-4000-8000-000000000001';
update public.datasets set empresa_id='00000000-0000-4000-8000-000000000001';
update public.app_config set empresa_id='00000000-0000-4000-8000-000000000001';
update public.profiles set empresa_id='00000000-0000-4000-8000-000000000001' where papel<>'dono';

alter table public.lojas alter column empresa_id set not null;
alter table public.datasets alter column empresa_id set not null;
alter table public.app_config alter column empresa_id set not null;

alter table public.lojas drop constraint lojas_nome_key;
alter table public.lojas add constraint lojas_empresa_nome_key unique (empresa_id, nome);
alter table public.datasets drop constraint datasets_pkey1;
alter table public.datasets add primary key (empresa_id, chave);
alter table public.app_config drop constraint app_config_pkey1;
alter table public.app_config add primary key (empresa_id, chave);
create index on public.profiles(empresa_id);
create index on public.lojas(empresa_id);

create or replace function public.minha_empresa() returns uuid
language sql stable security definer set search_path to 'public'
as $$ select empresa_id from public.profiles where id = auth.uid() and ativo $$;
revoke all on function public.minha_empresa() from public, anon;
grant execute on function public.minha_empresa() to authenticated;

drop policy config_escrever on public.app_config;
drop policy config_ler on public.app_config;
drop policy dados_escrever on public.datasets;
drop policy dados_gerente_vw on public.datasets;
drop policy dados_ler_gerente on public.datasets;
drop policy dados_ler_gestao on public.datasets;
drop policy dados_ler_vendedor on public.datasets;
drop policy lojas_escrever on public.lojas;
drop policy lojas_ler on public.lojas;
drop policy perfis_admin_edita on public.profiles;
drop policy perfis_dono_edita on public.profiles;
drop policy perfis_gerente_edita on public.profiles;
drop policy perfis_ler on public.profiles;

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

commit;
