# Elasticsearch local e importacao JSONL

O servico e apenas para desenvolvimento local: usa um unico no, persiste os dados
no volume Docker `tb-elasticsearch` e publica a porta somente em `127.0.0.1`. Ele
fica no profile `search`, portanto nao altera o `docker compose up` normal da aplicacao;
ao nomear `elasticsearch` no comando abaixo, o Compose ativa o servico explicitamente.

## 1. Subir e verificar

```bash
cd trialbridge
docker compose up -d elasticsearch
docker compose ps elasticsearch
curl http://localhost:9200/_cluster/health?pretty
```

Por padrao, o heap e de 2 GB. Para alterar (heap nao e o limite total do container):

```bash
ES_HEAP=4g docker compose up -d elasticsearch
```

## 2. Instalar o template antes do primeiro indice

O template configura como `nested` os arrays clinicos conhecidos em `preds.*`. Ele se
aplica a indices com nome `clinical-*`.

```bash
curl -X PUT http://localhost:9200/_index_template/clinical-jsonl \
  -H 'Content-Type: application/json' \
  --data-binary @elasticsearch/index-template.json
```

## 3. Importar

JSONL com um documento JSON por linha:

```bash
python3 scripts/elasticsearch/import_jsonl.py \
  --index clinical-records \
  --optimize \
  '/caminho/cn-backup-mt/**/*.jsonl'
```

O modo automatico tambem reconhece NDJSON da Bulk API, com linhas alternadas de acao
e documento. Por padrao, o `_index` original e substituido por `--index`; use
`--preserve-index` se quiser manter os indices do dump. Arquivos `.gz` sao aceitos.

Para validar a carga:

```bash
curl 'http://localhost:9200/_cat/indices?v'
curl 'http://localhost:9200/clinical-records/_count?pretty'
curl 'http://localhost:9200/clinical-records/_mapping?pretty'
```

## Operacao e limpeza

```bash
# parar sem apagar os dados
docker compose stop elasticsearch

# apagar apenas o indice de teste
curl -X DELETE http://localhost:9200/clinical-records

# apagar o volume persistente (irreversivel)
docker compose down
docker volume rm trialbridge_tb-elasticsearch
```

O limite HTTP padrao do Elasticsearch e 100 MB por requisicao. O importador usa lotes
de ate 5.000 documentos ou 20 MB e faz retry de erros transitorios. Para uma base muito
grande, confirme antes o espaco livre do Docker; os indices podem ocupar uma fracao
substancial do tamanho dos JSONL de origem.

## Recorte de demo para cinco NCTs

O exportador `build_demo_5ncts.sh` cria uma coorte ampla a partir do Parquet iHealth,
mantendo o snapshot mais recente de cada hospital e classificando documentos por CID
primario. O resultado e uma base de candidatos para busca, nao uma lista de pacientes
elegiveis. Como o Parquet preserva o texto mas nao os arrays NLP originais, este indice
suporta busca em `preds.text`, mas nao consultas `nested` em entidades/biomarcadores.

```bash
scripts/elasticsearch/build_demo_5ncts.sh \
  '/caminho/parquet_ihealth/*.parquet' \
  '/caminho/clinical-demo-5ncts-v1.jsonl'

curl -X PUT http://localhost:9200/_index_template/clinical-demo-5ncts \
  -H 'Content-Type: application/json' \
  --data-binary @elasticsearch/demo-5ncts-template.json

python3 scripts/elasticsearch/import_jsonl.py \
  --index clinical-demo-5ncts-v1 \
  --optimize \
  '/caminho/clinical-demo-5ncts-v1.jsonl'
```
