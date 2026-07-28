# NOTICE — cleanfeed-ptbr-v1

Detector de texto gerado por IA para pt-BR, treinado pelo projeto CleanFeed AI
(fine-tune de BERTimbau-base — neuralmind/bert-base-portuguese-cased, MIT).

## Uso NÃO COMERCIAL — bloqueado, não opcional

`commercialUse: false` (política `noncommercial-v1`). O produto e o modelo não
têm e não terão ambição comercial, e não existe variante comercial a preservar.
O conjunto de treino inclui dados sob CC BY-NC-SA 4.0 (Corpus Carolina/USP),
então o regime não comercial é também obrigação de licença, não só política do
projeto.

Obrigações que este artefato herda das licenças das suas fontes e propaga para
qualquer derivado: atribuição, não comercial e share-alike (o derivado carrega
a mesma licença).

Demais dados de treino: Stack Exchange PT e Wikipédia PT (CC BY-SA 4.0,
snapshots pré-2022-11), subset sintético de Madras1/corpus-ptbr-v1 (ODC-By 1.0)
e gerações próprias (OpenAI/Gemini/Anthropic via APIs/CLI).

## Licenças do inventário de fontes (identificador exato)

Uma linha por licença, com as obrigações que ela impõe (a suíte compara linha a linha com o registro do módulo, então a lista não pode ficar velha em silêncio):

- `cc-by-sa-4.0` — Creative Commons Attribution-ShareAlike 4.0: atribuição, share-alike.
- `cc-by-nc-sa-4.0` — Creative Commons Attribution-NonCommercial-ShareAlike 4.0: atribuição, não comercial, share-alike.
- `odc-by-1.0` — Open Data Commons Attribution License 1.0: atribuição.
- `lei9610-art8` — Atos oficiais (Lei 9.610/98, art. 8º, I): sem obrigação de licença, texto não protegido.
- `autorizacao-interna-v1` — Autorização interna escrita: sem obrigação de licença.
- `autoria-propria-v1` — Autoria própria do operador: sem obrigação de licença.
- `cc-by-nc-nd-4.0` — Creative Commons Attribution-NonCommercial-NoDerivatives 4.0: atribuição, não comercial — **BLOQUEADA para corpus derivado por ND**.

O bloqueio da última é por **ND**, nunca por NC. NC é admissível neste regime;
ND proíbe justamente o derivado que um corpus é. Exemplo registrado:
IberAuTexTification (`cc-by-nc-nd-4.0`), não incorporado.

Os termos acima são validados contra `benchmark/source-manifest.ts`
(`CORPUS_LICENSE_REGISTRY`) e contra `license-review.json`; os três não podem
divergir sem que a suíte falhe.

O modelo emite um score TÉCNICO não calibrado até que uma decisão científica
selada exista (release.json permanece "pending"); nenhuma saída constitui
alegação de autoria.
