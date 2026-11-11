# Painel Unificado LIGCEL — documento de passagem

Dono do projeto: Luan Sadraque Dantas (luandantas00@gmail.com), gerente de filial na Claro, DDD 75 (Bahia). Fala português. Prefere respostas diretas, sem jargão, e passos "clique aqui" quando precisa agir.

## O que é

Um site único que reúne três painéis que antes eram artefatos separados do Claude:

1. **Ritmo Comercial** e **Minha Meta** (`apps/ritmo.html`)
2. **Aparelhos e Chip** (`apps/aparelhos.html`)
3. **Comissão e Meta** (`apps/comissao.html`)

Hospedagem: GitHub Pages (repositório `dashboard-ligcel`, conta `luandantas00`), site em https://luandantas00.github.io/dashboard-ligcel/.
Banco e login: Supabase, projeto `dmdtnrafghrelpnvwoxa` (nome `painel-unificado-ligcel`, região sa-east-1).

## Arquitetura

- Site estático, JavaScript puro, sem build. Biblioteca `supabase-js 2.45.4` (jsDelivr) e `xlsx 0.18.5` (cdnjs) carregadas por CDN.
- `index.html` + `assets/shell.js` + `assets/shell.css`: login, abas por perfil, título editável, cadastros, importação de dados.
- `config.js`: URL do Supabase, chave `anon` (pública por desenho) e `versao`, usada para furar cache ao buscar os HTML dos apps. **Aumente `versao` a cada alteração em `apps/*.html`.**
- Cada painel (`apps/*.html`) roda dentro de um `iframe srcdoc`. O shell injeta uma ponte `window.__painel` e um prelúdio que imita o ambiente original de cada app:
  - Ritmo: simula `google.script.run.lerBase/salvarBase` e `google.script.url.getLocation` (`p = 'vendedor'` para Minha Meta, `'ritmo'` para o painel completo).
  - Aparelhos: simula `window.claude.use('artifact').publish`, injeta `window.__SEED` e `window.__EXCL`.
  - Comissão: o app chama `parent.__painel.comissaoInit()`, `comissaoSalvarVw()` e `comissaoPublicarCfg()`.
- `assets/comissao-nucleo.js`: funções puras do cálculo da Comissão (`aggregateRows`, `mergeData`, `subsetByLoja`, `defaultCfg`, `mergeCfg`), usadas pelo shell para importar. Foi extraído do app original; **o mesmo núcleo está embutido em `apps/comissao.html`**. Se mudar um, mude o outro. (`mergeData` agora carrega `MN`, o primeiro dia de venda de cada mês; a cópia dentro de `apps/comissao.html` no GitHub ainda pode estar sem essa linha, sem impacto prático.)

## Perfis e permissões

| Perfil | Cria | Vê |
|---|---|---|
| dono | admin, gerente, vendedor | tudo, todas as lojas |
| admin | gerente, vendedor | igual ao dono, mas não altera o dono nem outros admins (**suposição minha, ainda não confirmada pelo Luan**) |
| gerente | vendedor (só da própria loja) | Ritmo Comercial, Minha Meta e Comissão e Meta, só da própria loja. Na Comissão: abas Painel e Metas da loja (sem Aparelho nem Simulador) |
| vendedor | ninguém | só Minha Meta, da própria loja |

Usuários só são criados pela Edge Function `usuarios` (cadastro público desligado no Supabase). Senha mínima de 8 caracteres. O trigger em `auth.users` cria o perfil de dono apenas para `luandantas00@gmail.com`.

## Banco (Supabase)

Tabelas: `lojas`, `profiles`, `app_config`, `datasets`. Tabelas antigas vazias: `profiles_antigo`, `app_config_antigo`, `datasets_antigo` (podem ser removidas quando houver certeza).
Funções: `meu_papel()`, `minha_loja()` (security definer, execução só para `authenticated`), trigger `handle_new_user()`.
Todas as tabelas têm RLS. Políticas conhecidas em `datasets`: `dados_escrever` (dono/admin), `dados_ler_gestao`, `dados_ler_gerente` (chaves `ritmo%` e `comissao%` da própria loja), `dados_ler_vendedor` (`ritmo%` da própria loja), `dados_gerente_vw` (gerente grava `comissao-vw:<loja_id>` da própria loja).

Chaves de `datasets` (campo `chave`):

- `ritmo` (base completa, só gestão) e `ritmo:<loja_id>` (recorte por loja)
- `aparelhos` (`{seed, excl, page}`; carga nova entra em `page.upd`, base cheia em `seed`)
- `comissao` (`{data, cfg, cfgAt}`, só gestão) e `comissao:<loja_id>` (`{data` recortado, `cfg, cfgAt}`)
- `ritmo-cfg` (`{metas, hc, dias, regras}` do Ritmo: metas por mês|loja|indicador, HC manual, dias úteis, regras de loja por vendedor; só gestão grava) e `ritmo-cfg:<loja_id>` (recorte da loja, lido por gerente e vendedor). Tudo que a gestão digita no Ritmo (⚙ Metas) é salvo aqui automaticamente.
- `comissao-vw:<loja_id>` (`{vw}`: divisão da meta entre vendedores, gravada pelo gerente)

Os dados do Excel nunca são guardados como arquivo, só como números agregados.

**Primeira tarefa sugerida:** exportar o SQL real da estrutura (tabelas, políticas, funções, trigger) para `supabase/schema.sql` e o código da Edge Function para `supabase/functions/usuarios/index.ts`. Hoje ambos existem só dentro do Supabase. O código da função foi lido do Supabase em 10/11/2026 e dá para recuperar a qualquer momento com a ferramenta de leitura de funções.

**Regra do Luan:** nada que alguém digite pode ficar salvo só no navegador. Metas/HC/dias/regras do Ritmo, metas do Aparelhos e configuração da Comissão salvam sozinhos no banco (autosave). Só tema/filtros ficam locais.

## Regras de negócio decididas

- **Aparelho = Valor Venda acima de R$ 60**, nos três painéis. **Chip = de R$ 10 a R$ 60.** Seguro Proteção Móvel fora da conta. (Antes: Ritmo usava 63, Aparelhos usava 50, Comissão usava 70.)
- **Lojas:** Ipirá e Serrinha usam o mesmo código de loja do Shopping Avenida (9MVY). O Ritmo separa pelas `regrasLoja` por vendedor (Ipirá desde 2026-07-01, Serrinha desde 2026-09-01). A importação aplica a mesma regra no Aparelhos, que agora tem 7 lojas. Se o Excel já vier com a coluna "Loja (Venda)" corrigida, o resultado é o mesmo.
- **Comissão:** vendedor conta na loja onde mais vendeu no mês (`lot` em `aggregateRows`). A configuração (escala, metas, divisão) começou do padrão (`defaultCfg`), por decisão do Luan; o material antigo tinha metas e escalas que não foram migradas. **Não apagar o artefato antigo de Comissão e Meta.**
- **Importação única (Importar dados, dono e admin):** o Luan sobe o Excel do Controle Celular, de preferência o acumulado do ano. O período do arquivo substitui o que já existia nele nos três painéis. Modo "Substituir tudo" refaz do zero. Comissão só é atualizada se o arquivo cobre desde o primeiro dia de venda já carregado do mês.
- **Papéis na tela:** vendedor e gerente não veem botões de configuração nem de atualizar base nos apps.

## Estado atual (10/11/2026)

- Versão em `config.js`: `2026-11-10-9` (etapa 3 + metas no banco; a publicada no GitHub pode ainda ser a `2026-11-06-7`).
- Base carregada em 06/11/2026, a partir de `HISTORICO ANO CC LIG SET.xlsx` (20.646 linhas, 02/01 a 06/11, 7 lojas). Ritmo com 10.264 registros; Aparelhos com 1.800 aparelhos e 8.323 chips; Comissão de jan a nov.
- **O projeto Supabase apareceu como `INACTIVE` e o banco não respondeu a consultas.** Verificar no painel do Supabase se está pausado e restaurar. Confirmar o plano da organização (o Luan disse que o plano dele não é gratuito).
- Fluxo de publicação hoje: o Luan baixa um zip e arrasta arquivos no GitHub pela web. É a principal fonte de erro (arquivo caindo na raiz, cache). Ir para o Claude Code com push direto resolve isso.

## O que falta fazer

**Etapa 3 — Ritmo LIGCEL (`apps/ritmo.html`) — FEITA em 10/11/2026 (versão 2026-11-10-8, aguardando publicação e conferência do Luan). Decisão: projeção sem amostra mínima (projeta sobre o real; se for 0, projeta 0).**
Feito: ranking por loja escondido, portabilidade removida da tela, seção Aparelho (qtd/receita/ticket) + Claro Troca + Seguro agrupadas, limite de R$ 60 no texto, ajustes de celular (1ª coluna fixa). Itens abaixo ficam como histórico.
1. Remover o segundo quadrante, "ranking por loja" (o que tem o totalizador).
2. Modernizar o detalhamento por indicador.
3. Adaptar todas as visões para celular, com visual moderno, simples e resumido.
4. Remover a visão de portabilidade e, no lugar, incluir a visão de aparelho: troca, Claro Troca e seguro, com quantidade por loja, variação e o quadrante de conversão sobre aparelho (como o que já existe em Claro Troca).
5. Manter "Minha Meta"; modernizar só se for fácil.
6. Combinado em 06/11: **projeções só aparecem com amostra mínima** (sugestão: 5 vendas na loja; abaixo disso, "poucos dados" e variações em cinza). Também vale nas tabelas de comparativo do Aparelhos. O corte de 5 ainda não foi confirmado pelo Luan.

**Etapa 4 — Comissão e Meta**
- Já ligada à entrada única e à hierarquia. Ajustes "pontuados" pelo Luan conforme for usando.

**Outros**
- Confirmar a suposição sobre o perfil admin.
- Teste real de login de gerente e de vendedor com usuários verdadeiros (testado só com simulação).
- Na tela do Ritmo para gerente/vendedor, o seletor de loja ainda mostra "Todas as lojas" além da loja dele.
- Pacote de segurança: schema SQL e função no repositório, rotina de backup dos dados que só existem no banco (usuários, lojas, metas, escalas, divisões).

## Como testar sem o ambiente real

Nos testes usei Playwright com o site servido localmente e respostas simuladas do Supabase (Auth, REST e a função), mais a biblioteca `supabase-js` e `xlsx` empacotadas localmente. Os testes cobriram: login por perfil, importação do Excel com prévia e gravação, abertura de cada painel por perfil e captura de tela em desktop e celular. Esses scripts não estão no repositório; vale recriá-los.

## Cuidados

- A chave `anon` no `config.js` é pública por desenho. **Nunca** colocar a chave `service_role` no código; ela só existe dentro da Edge Function.
- Não alterar `apps/*.html` sem aumentar `versao` em `config.js`.
- O Excel original contém CPF e dados de clientes. O painel só guarda números agregados e nomes de vendedores. Não mudar isso.
