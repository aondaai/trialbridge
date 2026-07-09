# GOAL_SPEC — Religar o TrialBridge à nova arquitetura

> Spec completa do `/goal`. Leia este arquivo no início de CADA turno (session-start ritual)
> antes de codar. A condição do `/goal` é a fonte da verdade sobre "done"; este arquivo é o
> detalhe operacional. Em conflito, a condição do `/goal` vence.

## Objetivo em uma linha
O app TrialBridge roda ponta-a-ponta na nova arquitetura: seleção de papel → jornada →
persistência em banco real (Prisma) → feasibility vinda da API Python do estimador → parse via
Claude real → telas no tema CLARO da landing. App inicia 100% vazio.

## Contexto
- **Projeto:** TrialBridge (hackathon Life Sciences) — marketplace de feasibility de ensaios
  clínicos, dois papéis (patrocinador / site).
- **Working dir raiz:** `/Users/angeloorru/Documents/Claude/Projects/Built with Claude: Life Sciences Remote`
- **App (front+back):** `trialbridge/` — Next.js 15 (App Router) + React 19 + TypeScript. Repo git
  próprio. ATENÇÃO: o caminho contém `:`, então os scripts npm chamam binários por caminho
  relativo (`./node_modules/.bin/…`) — mantenha esse padrão; não confie em PATH do npm.
- **Estimador:** `outputs/trialbridge_estimator/` — FastAPI (`api:app`) + DuckDB sobre parquet
  OMOP. venv fora do repo em `~/.venvs/trialbridge_estimator`. Sobe com uvicorn na porta 8421
  (ver `.claude/launch.json` da raiz, config `estimator-api`, e `run_api.sh`).
  - **Dados:** prefira `outputs/trialbridge_estimator/data/omop_sample/` (213MB, presente) via
    `TB_DATASUS_DIR`. Se `omop_full/` (163GB) não estiver local, use `omop_sample` OU as fontes
    sintéticas do estimador — e **documente** qual foi usada. NUNCA invente números.
- **Estado atual (a mudar):** `src/lib/store.ts` persiste em `data/consultations.json`,
  `data/responses.json`, `data/site-*.json` (555 pacientes sintéticos). `prisma/schema.prisma`
  existe (SQLite `file:./dev.db`) mas NÃO é usado em runtime e não há `dev.db`.
- **Design system alvo:** `landing/assets/claude.css` + `tokens.json` (tema claro Claude:
  terracota `#D97757`, paper `#FAF9F5`). O app já importa `claude.css` escopado em `.cl-root`;
  as páginas `/sponsor` e `/site` é que estão em tema escuro navy e precisam migrar para claro.
- **Segredo:** `ANTHROPIC_API_KEY` em `trialbridge/.env.local` (gitignored). NÃO hardcode, NÃO
  commite, NÃO logue. A chave enviada no chat deve ser rotacionada pelo usuário; trate qualquer
  chave como sensível.
- **Consumidor:** o próprio usuário, para demo do hackathon.

## Success criteria (TODOS devem ser verdadeiros, cada um com prova colada no transcript)
1. **Tela de seleção de papel:** rota inicial onde o usuário escolhe Patrocinador ou Site e é
   roteado para a jornada certa (substitui o toggle canto-superior como único caminho).
   *Prova:* colar o componente/rota + um teste Vitest que afirma o roteamento/render.
2. **Persistência migrada:** Prisma vira o store de runtime; leituras/escritas de `store.ts`
   contra JSON são substituídas por queries Prisma; `prisma migrate dev`/`db push` roda com
   sucesso; o seed insere ZERO linhas.
   *Prova:* saída da migração + query mostrando count=0 em consultations/responses/sites/patients.
3. **Mock zerado:** nenhum dataset sintético carregado em runtime; `data/site-*.json` e os JSON
   semeados saem do caminho de runtime (removidos/esvaziados).
   *Prova:* grep mostrando nenhum import em runtime desses arquivos.
4. **Estimador conectado:** a jornada do patrocinador chama a FastAPI (`/feasibility/estimate`) e
   renderiza um número real; fallback de dados documentado se `omop_full` ausente.
   *Prova:* saída de `curl` ao endpoint retornando JSON + o trecho do código Next que consome.
5. **Design claro:** `/sponsor` e `/site` usam tokens `--cl-`/classes do `claude.css`
   (terracota/paper), sem backgrounds navy hardcoded.
   *Prova:* grep dos tokens usados + `npm run build` exit 0.
6. **Parse Claude real:** `src/lib/parse.ts` usa `ANTHROPIC_API_KEY` de `process.env`;
   `.env.local` gitignored.
   *Prova:* grep do env-read + confirmar que `.gitignore` cobre `.env.local`.
7. **Gates verdes:** `npm run build` exit 0, `npm run typecheck` 0 erros, `npm test` todos passam.
   *Prova:* colar as três saídas.

## Operating rules
1. **PLAN FIRST.** Antes de codar, emita uma lista JSON de features com tudo `passes:false`; ela é
   a fonte da verdade: `[{"id":"F001","description":"...","file":"...","passes":false}]`.
2. **UMA FEATURE POR TURNO.** Implemente uma, teste ponta-a-ponta (build + suite completa, não só o
   unit), `git commit`, atualize o JSON.
3. **SELF-VERIFY END-TO-END.** Após cada feature, rode `npm run build` e `npm test` inteiros e
   confirme que o app ainda sobe do entry point.
4. **DEBUG YOURSELF.** Em falha: diagnostique a causa-raiz, corrija, re-rode. Nunca marque passing
   sem verde real.
5. **NO STUBS.** Sem TODO, sem placeholder, sem função vazia. Implemente antes de marcar passing.
6. **ONE CLARIFICATION BURST.** Se algo estiver ambíguo (ex.: SQLite vs Postgres, forma exata da
   tela de papel), pergunte tudo de uma vez no início; depois siga sem novas perguntas salvo
   bloqueio real. Default sugerido: **SQLite** para a demo (é o provider já no schema).
7. **SELETIVIDADE / SEM FABRICAÇÃO.** Se um número de feasibility não puder vir do estimador real,
   marque "não verificável" e mostre a fonte de dados usada — nunca chute.
8. **PROGRESS LOG.** Ao fim de cada turno, anexe a `trialbridge/progress.md`:
   `[YYYY-MM-DDTHH:MM] [DONE|IN-PROGRESS|BLOCKED] [Fxxx] — detalhe`.
9. **IF BLOCKED.** Bloqueado = a mesma etapa falhou 3× com abordagens materialmente diferentes.
   Registre o que tentou, siga o que for paralelizável; se o bloqueio impede o deliverable central,
   pare e escreva o handover.
10. **CHECK BEFORE STOPPING.** Antes de declarar sucesso, releia cada critério e cole a saída
    específica que o prova (build/test/curl/grep). Asserção sem evidência não conta.

## Domain guardrails
- Segredos só via `.env.local` — nunca hardcode, nunca em git, nunca em log. Confirme `.env.local`
  no `.gitignore`.
- Dados de paciente: apenas sintéticos/agregados. O DataSUS/OMOP é agregado; não introduza dados
  reais identificáveis. A supressão de célula `<5` já existente deve permanecer.
- Ambiente dev/local apenas. NÃO faça push para nenhum remoto. NÃO escreva fora do working dir
  (`trialbridge/` e `outputs/trialbridge_estimator/`).
- NÃO toque nos ~163GB de `data/omop_full` nem re-sincronize do GCS; use `omop_sample`/synthetic.
- Migração de banco: rode migrations apenas contra o banco local de dev; não aponte para produção.

## Final deliverable
- ✅ Feature-JSON com tudo passing, cada critério com evidência citada.
- 📄 Arquivos criados/modificados + comandos exatos para rodar do zero (Next + estimador).
- 📊 Prova: saídas de build, typecheck, test, `curl` ao estimador e greps.
- 📝 Decisões (SQLite vs Postgres, forma da tela de papel, fonte de dados do estimador) e trade-offs.
- ⚠ Limitações, gaps de dado e próximos passos.
- Se atingir o limite de turnos, escreva `trialbridge/HANDOVER.md` com estado atual, o que falta e
  como retomar.
