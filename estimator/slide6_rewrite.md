# Slide 6 — reescrita (standardization, não Rosetta Stone)

Conteúdo pronto para colar no deck (Slides/Canva/PowerPoint). Substitui a
versão anterior de `TrialBridge_pitch.md` que descrevia um "Rosetta Stone" —
imputação calibrada no overlap de pacientes entre DataSUS e a base
proprietária. Ver [ROADMAP.md #7](outputs/trialbridge_estimator/ROADMAP.md)
para o porquê: sem identificador compartilhado entre as duas fontes, e um
spike confirmou que nem um linkage probabilístico por (hospital, ano de
nascimento, sexo, diagnóstico) teria precisão suficiente — mediana de 14-44
candidatos indistinguíveis por célula nos hospitais de maior volume.

---

## Título do slide

**Duas fontes, dois papéis — não duas bases fundidas em uma**

## Diagrama (substitui o antigo diagrama do Rosetta Stone)

Um funil em duas colunas, sem nenhuma seta ligando pacientes individuais
entre os lados — essa é a mudança visual central:

```
┌─────────────────────────────┐        ┌─────────────────────────────┐
│         DataSUS              │        │   Base proprietária (NLP)    │
│  63M pacientes, nacional      │        │  28.490 pacientes, 14        │
│  exato, por CID/idade/sexo/UF │        │  hospitais, profundidade     │
│                               │        │  clínica (HER2/ECOG/estágio) │
└──────────────┬────────────────┘        └──────────────┬────────────────┘
               │                                          │
      cohort exato por estrato                   taxa de profundidade
      (dx, faixa-etária, sexo)                   por estrato (mesma chave)
               │                                          │
               └───────────────────┬──────────────────────┘
                                    │
                    NENHUM paciente individual cruza esta linha
                                    │
                                    ▼
                estimated_eligible[site] = Σ_estrato
                    base_DataSUS[estrato] × taxa_profundidade[estrato]
```

A chave que conecta os dois lados é o **estrato** (diagnóstico × faixa
etária × sexo) — nunca um `person_id`. É por isso que a linha central não é
uma seta de "pareamento", é uma junção estatística: a proprietária empresta
uma **taxa**, o DataSUS fornece a **contagem exata**.

## O que dizer (narrativa de 30s)

> "Não cruzamos pacientes entre as duas bases — nenhuma das duas tem um
> identificador em comum, e testamos: mesmo tentando parear por hospital,
> ano de nascimento, sexo e diagnóstico, um mesmo hospital grande tem dezenas
> de pacientes indistinguíveis nessa combinação. Em vez disso, a base
> proprietária nos diz *que fração* de cada subgrupo (por diagnóstico, idade,
> sexo) tende a ser elegível — a profundidade clínica que o DataSUS não
> documenta — e aplicamos essa taxa à contagem exata e nacional do DataSUS
> para aquele mesmo subgrupo. O resultado sai **standardizado à população
> nacional**, não enviesado pela mistura de idade da nossa base proprietária."

## Número real de exemplo (já verificado, não é mock)

> HER2+, ECOG 0-1, câncer de mama metastático:
> **Estimated N nacional: 4.588** (IC 95%: 4.048–5.127)
> vs. base DataSUS (câncer de mama, feminino, 18+): **394.255**
> → fração elegível standardizada: **1,16%**

(fonte: `outputs/trialbridge_estimator/README.md`, seção "Real data is wired
in", `demo_real.py` — dado real ponta a ponta, 14 hospitais, não sintético)

## Limites honestos a declarar no slide (não esconder)

- A transportabilidade depende de a base proprietária ter cobertura decente
  nos estratos mais pesados do DataSUS (ex. pacientes mais velhos) — onde é
  fina, o *shrinkage* Bayesiano puxa para a taxa agregada, não inventa dado.
- A base proprietária hoje está concentrada em 1 hospital (67% dos pacientes)
  — a mesma razão pela qual matching pessoa-a-pessoa não seria confiável
  também limita a representatividade da taxa; declarado, não escondido.
- Cada estimativa carrega IC 95% (Wilson); nunca é apresentado como número
  único sem incerteza.

## Onde isso já bate com o produto (não é só slide, é o que o `/feasibility/estimate` retorna)

`POST /feasibility/estimate` já devolve exatamente esse par lado a lado:
**Estimated N** (standardizado, nacional/regional, com IC) e **Observed N**
(contagem direta, linha-a-linha, só nos sites com dado proprietário real,
sem modelo nenhum) — ver `README.md` linha 86 e `estimator.py:124`. O slide
está descrevendo o que o sistema já faz, não uma aspiração.
