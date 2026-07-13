# Facility master v1

Status: implementado e validado em 13 de julho de 2026. O master ainda não substitui automaticamente o `site-directory.json` nos relatórios existentes; a migração de consumo deve ser deliberada e testada por seção.

## Objetivo

Unificar, sem dados numéricos de pacientes:

- identidade oficial e tipo de estabelecimento do OMOP/CNES;
- descoberta e histórico público de trials do SiteMapTool;
- capacidade de pesquisa declarada pela ABRACRO;
- membership e dados cadastrais declarados pela ACESSE;
- roster nominal restrito de investigadores e coordenadores da ABRACRO.

O Parallel não participa da resolução de identidade. Ele deve enriquecer somente gaps de infraestrutura, PI/KOL e evidência, usando o `facility_id` produzido aqui.

## Roster ClinicalTrials.gov Brasil

O roster público de investigadores é materializado separadamente para não confundir pessoa–trial com pessoa–centro:

```bash
npm run build-ctgov-investigator-roster
```

O build pagina todos os estudos cuja `LocationCountry` é Brasil, preserva todos os `overallOfficials` com NCT, função e afiliação e gera `data/ctgov-investigators-br.json`. A tela considera `PRINCIPAL_INVESTIGATOR` e `STUDY_CHAIR` como perfis de investigador; `STUDY_DIRECTOR` permanece no arquivo para auditoria, mas não é promovido a PI/KOL.

O vínculo CT.gov com um PI ABRACRO só é feito quando nome normalizado e afiliação corroboram o mesmo centro. Nos demais casos, o perfil aparece como `CT.gov investigator`, sem vínculo confirmado com facility.

### Auditoria de deduplicação de investigadores

```bash
npm run audit-ctgov-investigator-dedupe
```

O comando gera `data/ctgov-investigator-dedupe-audit.json` sem alterar o roster original. O modelo usa nome sem títulos/credenciais, similaridade de grafia, compatibilidade de iniciais, sobreposição de afiliação e NCT compartilhado. As decisões são separadas em `auto_merge`, `review` e `quality_exclusion`. Sufixos de identidade (`Jr`/`Junior`) são preservados, e qualificadores institucionais conflitantes — por exemplo, `University of São Paulo` versus `Federal University of São Paulo` — impedem fusão automática sem NCT compartilhado.

## Execução

Requer Node 22+, DuckDB CLI e as fontes locais nos caminhos padrão:

```bash
npm run build-facility-master
```

Os caminhos podem ser sobrescritos com `--abracro`, `--acesse`, `--sitemap`, `--seeds`, `--merges`, `--omop` e `--out`.

O diretório `data/facility-master/` é local e ignorado pelo Git porque o SQLite contém o roster nominal. O build produz:

- `facility-master.v1.sqlite`: banco relacional completo e restrito;
- `facility-report-view.v1.json`: visão sanitizada para o TrialBridge;
- `resolution-review.v1.json`: fila de conflitos e possíveis duplicatas;
- `summary.json`: métricas do build e das decisões de resolução.

O loader server-side da visão sanitizada é `src/lib/facilities/loadMasterView.ts`. O caminho pode ser configurado por `TB_FACILITY_MASTER_VIEW`.

## Resultado do build validado

| Métrica | Resultado |
|---|---:|
| Registros-fonte | 35.271 |
| OMOP/CNES | 25.072 |
| SiteMap BR não-placeholder | 9.675 |
| ABRACRO agrupados | 467 |
| ACESSE | 57 |
| Entidades facility | 34.837 |
| Facilities na visão sanitizada | 9.889 |
| Facilities com CNES confirmado no OMOP | 25.072 |
| Facilities com CNES apenas não confirmado | 229 |
| Facilities com mais de uma fonte | 267 |
| Placeholders SiteMap excluídos | 2.391 |
| Linhas de roster ingeridas | 809 |
| Pessoas deduplicadas na camada restrita | 612 |
| Relações pessoa–facility–função | 682 |

Dos 524 registros agrupados ABRACRO/ACESSE, o crosswalk do seed teve 249 matches aceitos, 122 rejeitados e 153 sem candidato. Rejeição é preferível a uma união de baixa precisão.

## Regras de identidade e acurácia

1. Um CNES da associação só vira chave forte quando possui sete dígitos e aparece no OMOP/CNES carregado. Sete dígitos sem confirmação ficam como `unverified` e não unem entidades.
2. CNPJ passa por validação completa dos dígitos verificadores.
3. O `site_id` do SiteMap aplica `merges.renames`, exclui placeholders e só liga associação quando o match é corroborado por geografia ou por nome exato forte sem contradição.
4. UF ou município oficial divergente bloqueia o seed. O DDD é apenas evidência fraca e nunca sobrescreve a geografia oficial.
5. Uma ligação CNPJ/SiteMap que tentaria unir dois CNES confirmados distintos é bloqueada e registrada como `identifier_conflict`.
6. Nome/cidade/UF iguais sem identificador forte geram `possible_duplicate`, mas não são unidos automaticamente.
7. Valores conflitantes são preservados como observações com fonte; a visão escolhe o valor pela precedência `official > declared > registry > ddd`.

## Qualidade e segurança verificadas

- `PRAGMA foreign_key_check` sem violações;
- visão sanitizada sem e-mail, telefone ou roster nominal;
- 8 testes de normalização e entity resolution passando;
- TypeScript sem erros;
- 43 identificadores estruturalmente inválidos preservados para revisão;
- 6 conflitos geográficos restantes, todos de DDD inferido contra geografia oficial, com o oficial escolhido;
- 124 pares/grupos conservadores em `possible_duplicate` para revisão humana.

O SQLite restrito armazena nomes profissionais, mas não armazena e-mails em claro. E-mails válidos são usados somente como material de hash para deduplicação.

## Próxima integração

1. Migrar o shortlist de sites para `facility-report-view.v1.json` atrás de feature flag.
2. Criar views por necessidade do relatório: experiência em trials, áreas terapêuticas, inspeções e evidence gaps.
3. Passar ao Parallel `facility_id`, nome canônico, CNES confirmado e geografia oficial.
4. Substituir os booleanos obrigatórios do cache Parallel por claims tri-state por campo, cada um com fonte, data, confiança e método de verificação.
5. Rodar uma amostra gold manual para medir precisão por campo antes de promover claims do Parallel ao relatório final.
