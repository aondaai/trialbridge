# TrialBridge — modelo quantitativo em três visões

**Status:** contrato metodológico adotado
**Princípio:** não existe linkage individual entre DataSUS e a base proprietária.

## As três visões oficiais

### 1. DataSUS Observado

População-alvo e denominador público observado. Contém somente variáveis efetivamente disponíveis no DataSUS/OMOP: diagnóstico, demografia, geografia, período, procedimentos e utilização coberta.

Responde: **quantas pessoas observamos no universo DataSUS segundo critérios amplos e reproduzíveis?**

### 2. Coorte Proprietária Observada

Pacientes observados e localizáveis na rede proprietária, apresentados somente como agregados. O funil separa pagador `sus`, `private` e `unknown` e preserva a origem de cada campo:

- `datasus_observed` — informação originária do DataSUS;
- `private_observed` — prontuário, laboratório, NLP, biomarcador, estágio etc.;
- `derived` — variável calculada;
- `text_proxy` — busca textual ainda não normalizada como entidade.

Responde: **quem é localizável na rede e quais características granulares foram observadas?**

### 3. População DataSUS Estatisticamente Caracterizada

Estimativa agregada transportada. Usa a distribuição granular ajustada da coorte proprietária para caracterizar os totais observados do DataSUS por estrato.

Responde: **dentro da população DataSUS, quantos provavelmente possuem a característica granular observada somente na base proprietária?**

Não cria pacientes sintéticos e não atribui características a indivíduos do DataSUS.

## Fórmula-alvo

Para cada estrato comparável `s`:

```text
N_transportado = Σ N_DataSUS,s × p_ajustada,s
```

Estratos iniciais:

```text
diagnóstico × faixa etária × sexo × UF × período
```

`p_ajustada,s` é estimada na coorte proprietária após harmonização, calibração de representatividade e qualificação granular.

## Pipeline quantitativo

1. Resolver indicação e CID-10.
2. Fixar janela temporal e data de referência.
3. Harmonizar idade, sexo, geografia, diagnóstico e utilização.
4. Construir a coorte rasa reproduzível nas duas bases.
5. Executar o funil granular na base proprietária.
6. Separar proprietário `sus`, `private` e `unknown`.
7. Comparar distribuições comuns entre DataSUS e proprietário SUS.
8. Estimar pesos de transportabilidade.
9. Estimar o desfecho granular por estrato.
10. Pós-estratificar sobre os totais observados do DataSUS.
11. Calcular intervalo, sensibilidade e cobertura.
12. Persistir as três visões separadamente.

## Estratégia estatística incremental

### Baseline auditável

- Padronização direta por estrato.
- Shrinkage em células pequenas.
- Intervalos derivados do numerador/denominador proprietário, transportados para o total DataSUS.

### Próxima versão

- Raking/IPF ou entropy balancing para alinhar marginais comuns.
- Diagnóstico de pesos extremos e effective sample size.
- Modelo interpretável do desfecho granular.
- Estimativa duplamente robusta combinando seleção e desfecho.

### Alta dimensionalidade

- MRP quando a quantidade de estratos produzir muitas células pequenas.
- Modelo hierárquico por UF/região.

## Overlap e cobertura

Cada estrato recebe um status:

- `adequate` — overlap e amostra proprietária suficientes;
- `limited` — extrapolação possível com alta incerteza;
- `out_of_support` — perfil inexistente ou quase inexistente na proprietária;
- `unavailable` — variável/coorte não harmonizável.

Estratos `out_of_support` não são extrapolados automaticamente. O relatório deve mostrar:

- participação do DataSUS coberta pelo modelo;
- effective sample size;
- pesos mínimos/máximos;
- células limitadas ou não cobertas;
- cenários de sensibilidade.

## Pagador

Na proprietária, a classificação é feita no grão do paciente:

```text
qualquer documento SUS → sus
senão, convênio documentado → private
senão → unknown
```

Uso das fatias:

- `sus`: coorte-ponte principal para transportar características ao DataSUS;
- `private`: supply observado/localizável na rede; não expandir nacionalmente sem denominador ANS/claims;
- `unknown`: manter separado; somente cenários de sensibilidade podem redistribuí-lo.

O proprietário SUS não é somado à estimativa DataSUS, pois pode representar o mesmo universo conceitual sem linkage individual.

## Contrato de saída

```json
{
  "datasus_observed": {
    "n": 0,
    "by_stratum": [],
    "source": {},
    "as_of": "YYYY-MM-DD"
  },
  "proprietary_observed": {
    "shallow_n": 0,
    "deep_n": 0,
    "by_payer": {"sus": 0, "private": 0, "unknown": 0},
    "by_site": [],
    "field_provenance": [],
    "as_of": "YYYY-MM-DD"
  },
  "datasus_statistically_characterized": {
    "estimated_n": 0,
    "ci_lo": 0,
    "ci_hi": 0,
    "by_stratum": [],
    "coverage": {
      "population_covered_pct": 0,
      "adequate": 0,
      "limited": 0,
      "out_of_support": 0
    },
    "method": {},
    "model_version": ""
  }
}
```

## Regras de apresentação

- Nunca usar “DataSUS enriquecido paciente a paciente”.
- Preferir “estimativa transportada” ou “população estatisticamente caracterizada”.
- Nunca somar DataSUS transportado com proprietário SUS.
- Privado permanece observado até existir denominador externo válido.
- Zero medido e dado indisponível são estados diferentes.
- Sem diagnóstico/CID ou overlap adequado, decisão e ranking quantitativo ficam suspensos.
- Toda estimativa mostra intervalo, método, versão e cobertura.

## Mensagem central

> Não estamos ligando ou enriquecendo pacientes individuais do DataSUS. Estamos usando uma coorte proprietária mais granular para estimar, de maneira calibrada, características agregadas da população DataSUS.
