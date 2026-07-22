# benchmark/lab — bancada Python de coleta (nunca ciência selada)

Extratores de **candidatos humanos** a partir dos snapshots licenciados
pré-ChatGPT (ver [docs/corpus-sources.md](../../docs/corpus-sources.md)). Python
3.11+ **stdlib apenas**; determinístico (sem aleatoriedade/relógio na saída).

Regra de ouro do projeto: Python é bancada — o que embarca é ONNX/WASM e o que
sela ciência é o pipeline TypeScript ([benchmark/](../README.md)). A saída daqui
são apenas CANDIDATOS (`benchmark/data/candidates/*.jsonl`, gitignored) que
ainda passam por revisão humana + PII-audit antes de virarem registros do
`ingest`.

Pipeline compartilhado (`common.py`): corte temporal `< 2022-11-30` →
normalização NFC+LF → janela de 50–5000 palavras → **drop por PII** (e-mail,
telefone BR, CPF/CNPJ, @handle — descarta, nunca reescreve) → amostragem
determinística. Cada saída ganha um `.stats.json` com as contagens de descarte.

```bash
cd benchmark/lab
python -m unittest -v                     # fixtures dos 3 parsers + pipeline

python extract_stackexchange.py --input <Posts.xml> \
  --output ../data/candidates/ptso.jsonl --limit 4000 --sample-rate 7
python extract_wikipedia.py --input <ptwiki-...-pages-articles.xml.bz2> \
  --output ../data/candidates/wikipedia.jsonl --limit 4000 --sample-rate 40
python extract_carolina.py --input <carolina.zip> \
  --output ../data/candidates/carolina.jsonl --limit 4000
```

Notas por fonte: SE-PT descarta `<code>/<pre>` inteiros (payload de programação
não é prosa); Wikipédia usa só a seção-lede de artigos ns=0 sem redirect;
Carolina lê licença + `<date type="Download">` POR DOCUMENTO (o que torna o
pacote v2.0 utilizável), exclui a tipologia `wikis` e nunca lê os campos de
nomes/autores dos headers.
