# Orientações para montagem das consultas — DuckDB

Este documento descreve como construir consultas clínicas seguras, reproduzíveis e alinhadas à base proprietária atual em Parquet, consultada com DuckDB.

Ele substitui as orientações anteriores de Elasticsearch. A lógica clínica permanece válida, mas conceitos como `bool query`, `match`, `nested`, `match_phrase`, `term` e `range` devem ser expressos por um plano de funil e por predicados SQL controlados.

## 1. Modelo real da base proprietária

A fonte é document-level: cada linha representa um documento clínico, não um paciente.

Campos disponíveis no Parquet consolidado:

| Campo | Tipo | Uso |
|---|---|---|
| `unique_patient_id` | VARCHAR | identificador pseudonimizado do paciente |
| `unique_case_id` | VARCHAR | identificador do caso |
| `doc_id` | VARCHAR | identificador do documento |
| `hospital` | VARCHAR | código proprietário do hospital |
| `gender` | VARCHAR | `FEMALE`, `MALE` ou `UNKNOWN` |
| `birth_year` | INTEGER | ano de nascimento |
| `primary_icd` | VARCHAR | CID principal associado ao documento |
| `created_ts` | TIMESTAMP | data de criação do documento |
| `ingested_ts` | TIMESTAMP | data de ingestão |
| `convenio` | VARCHAR | convênio/pagador documentado |
| `texto` | VARCHAR | texto clínico completo |
| `texto_len` | BIGINT | tamanho do texto |
| `n_entidades` | BIGINT | quantidade de entidades extraídas |
| `n_exames` | BIGINT | quantidade de exames extraídos |
| `n_sinais_vitais` | BIGINT | quantidade de sinais vitais extraídos |
| `n_biomarcadores` | BIGINT | quantidade de biomarcadores extraídos |
| `n_relacoes` | BIGINT | quantidade de relações extraídas |

### Limitação importante

Os objetos Elasticsearch `preds.clinical_entities`, `preds.lab_tests`, `preds.biomarkers`, `preds.vital_signs` e `preds.entities_relations` **não estão presentes como estruturas nested neste Parquet**.

Os contadores `n_entidades`, `n_exames`, `n_biomarcadores` etc. indicam que uma extração ocorreu, mas não carregam o conteúdo das entidades. Portanto:

- diagnóstico, idade, sexo, hospital e período podem ser consultados diretamente;
- conceitos clínicos podem ser buscados em `texto` como proxy textual;
- valores numéricos de exames não devem ser consultados como dados estruturados enquanto uma tabela normalizada de resultados não estiver materializada;
- `assertion` não deve ser simulada apenas pela presença de uma palavra no texto;
- resultados textuais devem ser rotulados como `text_proxy`, não como structured/depth confirmado.

## 2. Formato esperado do plano de consulta

Não aceite SQL arbitrário gerado pelo usuário ou pelo modelo. O formato de entrada recomendado é um `SearchSpec` estruturado:

```json
{
  "nct": "NCT00000000",
  "dx": {
    "concepts": ["cancer_mama"],
    "cid_prefixes": ["C50"],
    "snomed": []
  },
  "stages": [
    {
      "kind": "INCLUSAO",
      "query": {
        "must": [],
        "filter": [],
        "should": [],
        "minimum_should_match": 1
      }
    }
  ]
}
```

O backend valida esse contrato e compila os elementos permitidos para SQL DuckDB parametrizado/controlado.

Não exponha ao usuário:

- caminho físico dos Parquets;
- comandos `COPY`, `EXPORT`, `ATTACH`, `INSTALL` ou `LOAD`;
- acesso direto a linhas de pacientes;
- SQL livre;
- colunas identificadoras na resposta.

## 3. Semântica do funil

O grão do funil é sempre o paciente.

Uma etapa clínica pode encontrar qualquer documento do paciente:

```sql
SELECT DISTINCT unique_patient_id
FROM proprietary_docs
WHERE <predicado_da_etapa>
```

As etapas são encadeadas assim:

- `INCLUSAO`: `INTERSECT` com o conjunto corrente;
- `EXCLUSAO`: `EXCEPT` sobre o conjunto corrente;
- a primeira etapa deve ser `INCLUSAO` e definir a população-base.

Exemplo conceitual:

```sql
WITH base AS (
  SELECT DISTINCT unique_patient_id
  FROM proprietary_docs
  WHERE primary_icd LIKE 'C50%'
),
adultas AS (
  SELECT DISTINCT unique_patient_id
  FROM proprietary_docs
  WHERE gender = 'FEMALE'
    AND birth_year <= 2007
),
gestantes AS (
  SELECT DISTINCT unique_patient_id
  FROM proprietary_docs
  WHERE lower(strip_accents(texto)) LIKE '%gestante%'
)
SELECT unique_patient_id FROM base
INTERSECT
SELECT unique_patient_id FROM adultas
EXCEPT
SELECT unique_patient_id FROM gestantes;
```

O resultado externo deve ser uma contagem agregada, nunca a lista de IDs.

## 4. Operadores equivalentes

| Elasticsearch anterior | DuckDB atual |
|---|---|
| `bool.must` | predicados combinados com `AND` |
| `bool.should` | alternativas com `OR` ou soma de booleanos |
| `minimum_should_match` | soma de `CAST((predicado) AS INTEGER) >= N` |
| `filter` | `WHERE` com predicados estruturados |
| `term` / `terms` | `=` / `IN (...)` |
| `range` | `>=`, `>`, `<=`, `<` ou `BETWEEN` |
| `match` | termos normalizados com `LIKE`, busca full-text controlada ou tabela de termos |
| `match_phrase` | substring normalizada ou mecanismo de proximidade explicitamente implementado |
| `regexp` | `regexp_matches`, somente quando necessário |
| `nested` | `EXISTS`, `JOIN` ou `UNNEST` somente se existir uma tabela/lista normalizada |
| estágio de exclusão | `EXCEPT`, não `NOT LIKE` global |

## 5. Normalização textual

Para reproduzir `lowercase` e `asciifolding`, normalize texto e termos:

```sql
lower(strip_accents(texto))
```

Exemplo:

```sql
lower(strip_accents(texto)) LIKE '%insuficiencia cardiaca%'
```

Boas práticas:

- normalize os termos antes de construir o predicado;
- escape literais ou use parâmetros preparados;
- não gere variações de maiúsculas/minúsculas;
- não gere duplicações apenas por acentuação;
- expanda sinônimos, siglas e abreviações clinicamente válidas;
- mantenha `c`/`ç` apenas quando a normalização disponível não cobrir corretamente a fonte.

## 6. Busca textual: AND, OR e frases

### Sinônimos e variações: OR

Diabetes:

```sql
(
  normalized_text LIKE '%diabetes%'
  OR normalized_text LIKE '%diabetes mellitus%'
  OR normalized_text LIKE '%diabetes melito%'
  OR normalized_text LIKE '%dm2%'
  OR normalized_text LIKE '%dmii%'
)
```

### Expressão composta: AND controlado

Quando todas as partes precisam aparecer no mesmo documento:

```sql
normalized_text LIKE '%insuficiencia%'
AND normalized_text LIKE '%cardiaca%'
```

Quando a ordem importa e a expressão é estável, prefira a frase:

```sql
normalized_text LIKE '%insuficiencia cardiaca%'
```

### Expressão ou sigla

```sql
(
  normalized_text LIKE '%insuficiencia cardiaca%'
  OR regexp_matches(normalized_text, '(^|[^a-z0-9])icc([^a-z0-9]|$)')
)
```

Use regex com limites de token para siglas curtas. `LIKE '%icc%'` também encontraria palavras maiores e produziria falsos positivos.

### Proximidade (`slop`)

DuckDB não oferece um equivalente direto ao `match_phrase.slop` do Elasticsearch no SQL básico. Não prometa proximidade sem implementá-la.

Alternativas:

1. frase contígua com `LIKE`;
2. termos no mesmo documento com `AND`;
3. regex de proximidade controlada;
4. extensão/tabela full-text validada;
5. extração NLP materializada.

Qualquer aproximação deve ser registrada na proveniência.

## 7. Diagnóstico por CID

Use `primary_icd` para formar a população diagnóstica quando houver um mapeamento CID validado.

Exemplo para câncer de mama:

```sql
primary_icd LIKE 'C50%'
```

Para múltiplos prefixos:

```sql
primary_icd LIKE 'C33%'
OR primary_icd LIKE 'C34%'
```

Regras:

- valide o formato dos prefixos antes de interpolar;
- mantenha um registro versionado de conceito → prefixos CID;
- não derive códigos apenas por semelhança textual;
- apresente ao revisor a definição diagnóstica usada;
- não trate ausência de `primary_icd` como ausência da doença.

## 8. Idade

A base consolidada possui `birth_year`, não `birthdate` completa.

Com ano de referência 2025:

```sql
-- 55 anos ou mais
birth_year <= 1970

-- entre 18 e 69 anos
birth_year BETWEEN 1956 AND 2007
```

O ano de referência deve ser explícito e persistido na proveniência. Não use `now()` silenciosamente em um relatório reproduzível.

Quando a idade exata no dia for clinicamente relevante, `birth_year` é insuficiente. Marque o critério como parcial ou dependente de confirmação.

## 9. Sexo

Use filtro exato:

```sql
gender = 'FEMALE'
```

Valores aceitos atualmente:

- `FEMALE`
- `MALE`
- `UNKNOWN`

`UNKNOWN` deve ser mantido como missingness, não convertido automaticamente.

## 10. Período do documento

Use datas absolutas calculadas antes da execução:

```sql
created_ts >= TIMESTAMP '2025-01-01 00:00:00'
AND created_ts < TIMESTAMP '2026-01-01 00:00:00'
```

Para “último ano”, o compilador pode calcular a data de corte a partir de um `as_of` persistido.

Evite usar `current_date` ou `now()` diretamente no SQL final quando a consulta precisar ser reproduzível.

## 11. Entidades clínicas, assertion e negação

Na versão Elasticsearch, uma entidade nested preservava a associação entre:

- entidade;
- label;
- assertion;
- resultado numérico.

Essa estrutura não existe no Parquet consolidado atual. Portanto, uma busca em `texto` não pode afirmar com segurança que:

- a doença está presente;
- a menção é histórica;
- o termo está negado;
- o conceito pertence ao paciente e não a um familiar;
- dois atributos pertencem à mesma entidade.

Classifique buscas desse tipo como:

```text
method: text_proxy
confidence: proxy
```

Para recuperar a precisão anterior, materialize tabelas normalizadas, por exemplo:

```text
clinical_entities(doc_id, unique_patient_id, entity, label, assertion)
lab_tests(doc_id, unique_patient_id, entity, numeric_value, unit)
biomarkers(doc_id, unique_patient_id, entity, value, unit)
vital_signs(doc_id, unique_patient_id, entity, numeric_value, unit)
```

Então use `EXISTS` ou `JOIN` por `doc_id`/`unique_patient_id`, preservando o vínculo correto.

## 12. Exames, biomarcadores e sinais vitais

Não traduza automaticamente este Elasticsearch antigo:

```json
{
  "match": {"preds.lab_tests.entity": "LDL"},
  "range": {"preds.lab_tests.result.numeric_value": {"gte": 130}}
}
```

para regex sobre `texto` como se o resultado fosse estruturado.

Até existir uma tabela normalizada, há duas opções honestas:

1. busca textual exploratória, rotulada como proxy;
2. critério marcado como `site_confirmation`/`not_answerable` para cálculo quantitativo.

Com uma futura tabela `lab_tests`, o padrão correto será:

```sql
EXISTS (
  SELECT 1
  FROM lab_tests l
  WHERE l.unique_patient_id = d.unique_patient_id
    AND lower(strip_accents(l.entity)) IN ('ldl', 'colesterol ldl')
    AND l.numeric_value >= 130
    AND l.unit = 'mg/dL'
)
```

## 13. Inclusão e exclusão

Não implemente exclusão clínica colocando `NOT LIKE` em toda a consulta. Isso pode excluir pacientes que possuem documentos conflitantes ou produzir semântica errada no grão de documento.

O pipeline deve construir o conjunto de pacientes que bate na condição de exclusão e subtraí-lo:

```sql
SELECT unique_patient_id FROM previous_stage
EXCEPT
SELECT DISTINCT unique_patient_id
FROM proprietary_docs
WHERE <condição_de_exclusão>
```

Isso preserva a regra:

> pacientes do estágio anterior menos pacientes com pelo menos um documento que corresponda ao critério de exclusão.

## 14. Contagem, hospital e privacidade

A consulta interna pode trabalhar com `unique_patient_id`, mas a resposta externa deve conter apenas agregados.

Total:

```sql
SELECT count(*)
FROM matched_patients;
```

Por hospital, atribuindo cada paciente a um único hospital de forma determinística:

```sql
WITH per_hospital AS (
  SELECT unique_patient_id, hospital, count(*) AS n_docs
  FROM matched_docs
  GROUP BY unique_patient_id, hospital
),
ranked AS (
  SELECT *, row_number() OVER (
    PARTITION BY unique_patient_id
    ORDER BY n_docs DESC, hospital ASC
  ) AS rn
  FROM per_hospital
)
SELECT hospital, count(*) AS n
FROM ranked
WHERE rn = 1
GROUP BY hospital;
```

Regras obrigatórias:

- `COUNT(DISTINCT unique_patient_id)` no grão de documentos;
- nunca retornar IDs ou textos ao sponsor;
- suprimir células abaixo do mínimo definido, atualmente 5;
- manter apenas códigos hospitalares na saída;
- registrar fonte, `as_of`, versão do compilador e definição dos critérios.

## 15. Performance em DuckDB

Boas práticas para a base de dezenas de gigabytes:

- selecione somente as colunas necessárias;
- filtre `primary_icd`, datas e hospital antes da busca textual quando possível;
- materialize coortes diagnósticas reutilizadas;
- evite `lower(strip_accents(texto))` repetido em vários estágios; considere uma coluna normalizada materializada;
- evite regex genérica sobre todos os documentos;
- use `PRAGMA threads` de forma controlada;
- não leia a base completa múltiplas vezes para o mesmo job;
- crie tabelas temporárias para conjuntos intermediários reutilizados;
- registre tempo, linhas/documentos lidos e versão dos Parquets;
- prefira agregados materializados para consultas frequentes.

## 16. Validação clínica do funil

1. Comece pela população diagnóstica.
2. Confira volume e distribuição por hospital.
3. Adicione idade, sexo e período.
4. Adicione um critério textual por vez.
5. Meça a queda entre estágios.
6. Revise amostras somente em ambiente autorizado, nunca na interface do sponsor.
7. Classifique falsos positivos, negação, histórico e contexto familiar.
8. Documente intenção, termos, limitações e decisão do revisor.

Ausência de menção não significa ausência clínica. Missingness deve permanecer explícito.

## 17. Prompt recomendado para gerar o plano

```text
Você é um especialista em construção de funis clínicos para DuckDB sobre uma base
document-level em Parquet.

Sua tarefa é transformar o pedido do usuário em um SearchSpec validável. Não gere
SQL arbitrário.

Campos estruturados permitidos:
- unique_patient_id (uso interno; nunca retornar)
- hospital
- gender
- birth_year
- primary_icd
- created_ts
- convenio
- n_entidades
- n_exames
- n_sinais_vitais
- n_biomarcadores
- n_relacoes

Campo textual permitido:
- texto

Tipos de cláusula:
- text: terms[], operator "and"|"or", phrase, tier, label
- age: min_age, max_age
- sex: FEMALE|MALE
- period: within

Regras:
1. A primeira etapa deve ser INCLUSAO.
2. Inclusões posteriores usam INTERSECT; exclusões usam EXCEPT.
3. Sempre expandir termos com sinônimos, siglas e abreviações relevantes.
4. Não criar variações apenas de case ou acentuação.
5. Usar CID validado para a população diagnóstica.
6. Busca em texto é text_proxy; não afirmar assertion, valor laboratorial ou entidade
   estruturada sem uma tabela materializada que os contenha.
7. Não gerar SQL, caminhos de arquivo, IDs de pacientes ou textos clínicos na resposta.
8. Não usar campos inexistentes.
9. Critérios sem suporte devem ser site_confirmation ou not_answerable.
10. A saída deve ser JSON válido no contrato SearchSpec.

Para cada etapa, inclua uma justificativa curta, a proveniência esperada e a limitação.
```

## 18. Exemplo completo

Pedido: mulheres com 55 anos ou mais, com câncer de mama e menção a insuficiência cardíaca; excluir menção a gestação no último ano.

```json
{
  "nct": "consulta-exemplo",
  "dx": {
    "concepts": ["breast_cancer"],
    "cid_prefixes": ["C50"],
    "snomed": []
  },
  "stages": [
    {
      "kind": "INCLUSAO",
      "query": {
        "must": [
          {
            "type": "text",
            "terms": ["insuficiencia cardiaca", "icc"],
            "operator": "or",
            "phrase": false,
            "tier": 2,
            "label": "insuficiência cardíaca — proxy textual"
          }
        ],
        "filter": [
          {"type": "sex", "value": "FEMALE"},
          {"type": "age", "min_age": 55, "max_age": null}
        ],
        "should": [],
        "minimum_should_match": 1
      }
    },
    {
      "kind": "EXCLUSAO",
      "query": {
        "must": [
          {
            "type": "text",
            "terms": ["gestante", "gravidez"],
            "operator": "or",
            "phrase": false,
            "tier": 2,
            "label": "gestação — proxy textual"
          }
        ],
        "filter": [
          {"type": "period", "within": "1y"}
        ],
        "should": [],
        "minimum_should_match": 1
      }
    }
  ]
}
```

Observação: `dx.cid_prefixes` deve ser aplicado pelo compilador à população-base via `primary_icd`. O critério de insuficiência cardíaca continua sendo proxy textual enquanto não houver tabela normalizada com entidade, label e assertion.

## 19. Regra de ouro

```text
Encontrar pacientes observados na base proprietária
!=
estimar a população nacional com DataSUS
```

DuckDB consulta a base proprietária para finding agregado. A expansão DataSUS usa padronização estatística em outro estágio. As duas saídas devem manter proveniência e significado separados.
