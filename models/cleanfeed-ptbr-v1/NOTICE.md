# NOTICE — cleanfeed-ptbr-v1

Detector de texto gerado por IA para pt-BR, treinado pelo projeto CleanFeed AI
(fine-tune de BERTimbau-base — neuralmind/bert-base-portuguese-cased, MIT).

## O que governa estes pesos

Os pesos saem sob a licença própria do projeto, `cleanfeed-weights-nc-1.0`
(texto integral no arquivo `LICENSE` deste mesmo diretório). Ela é não comercial
e proíbe usos de alto risco. Não é MIT: o `LICENSE` da **raiz** do repositório é
outro arquivo e governa o **código**, não este artefato.

`commercialUse: false`, sob a política própria dos pesos,
`weights-noncommercial-v1`. O produto e o modelo não têm e não terão ambição
comercial, e não existe variante comercial a preservar.

Não confunda com `noncommercial-v1`: esse é o id da política do **corpus**. As
duas dizem a mesma coisa sobre uso comercial e são duas políticas — um
identificador só para as duas deixaria este arquivo incapaz de dizer de qual
delas o `false` acima veio.

O regime não comercial destes pesos é **política própria do projeto**. Uma
licença de fonte não é a origem dele: as obrigações das licenças do corpus
regem a aquisição, a preparação e o uso dos **dados**, e o projeto sustenta que
não alcançam o artefato treinado.

Isso é **posição de risco assumida pelo operador**, não parecer jurídico e não
conclusão da Creative Commons — o primer da CC diz que um modelo frequentemente
não é adaptação, mas ressalva as cópias feitas durante o treino e registra que
as jurisdições divergem; o Brasil não tem exceção clara de mineração de dados.
Quem discordar da posição tem de saber que ela existe, e é por isso que está
escrita aqui e não implícita numa omissão.

A posição não afrouxa nada na direção da aquisição: uma fonte cujo termo de
acesso proíba o uso continua bloqueada, independentemente do que se conclua
sobre obra derivada.

## Usos proibidos — condição da licença, não recomendação

Os limites abaixo são termos de `cleanfeed-weights-nc-1.0` e acompanham os
pesos onde eles forem. A cópia da extensão não viaja com pesos extraídos do
pacote, então uma restrição que vivesse só na interface não restringiria nada.

- integridade acadêmica: nada de decidir sobre autoria de redação, tese ou
  trabalho escolar;
- uso disciplinar: nada de sanção, advertência ou processo interno;
- uso empregatício: nada de demissão, reprovação de entrega ou seleção;
- uso decisório sobre pessoas, em qualquer forma;
- triagem punitiva em massa.

Revisão humana não conserta nenhum desses usos: um sinal não validado revisado
por uma pessoa continua não validado, e a revisão precisa de evidência
independente de processo, não de "confirmar" o detector.

## Licenças do inventário de fontes (identificador exato)

Estas obrigações são do **corpus** — aquisição, preparação e uso dos dados.
Uma linha por licença, com as obrigações que ela impõe (a suíte compara linha a
linha com o registro do módulo, então a lista não pode ficar velha em silêncio):

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

Que as duas famílias de CC acima sejam mutuamente incompatíveis é exatamente o
motivo de a licença dos pesos ser própria: `cc-by-sa-4.0` proíbe acrescentar
restrição, logo proíbe NC, e `cc-by-nc-sa-4.0` exige que o derivado saia com a
mesma licença, que inclui NC. Ler o artefato como derivado das duas seria
exigir dele duas coisas que não coexistem.

## Dados de treino

Wikipédia PT (CC BY-SA 4.0, snapshot pré-2022-11), Corpus Carolina/USP
(CC BY-NC-SA 4.0), B2W-Reviews01 (CC BY-NC-SA 4.0), subset sintético de
Madras1/corpus-ptbr-v1 (ODC-By 1.0) e gerações próprias (OpenAI/Gemini/
Anthropic via APIs/CLI).

Stack Exchange PT **não** é dado de treino desta versão. O termo de acesso do
dump (2024) exclui projetos de treino de LLM, e sem disposição jurídica
verificável a fonte fica bloqueada para incorporação — decisão A1. O estrato
`qa-informal`, que era a única célula que a fonte cobria, deixou de existir: as
células alegadas são quatro — enciclopédico, judiciário, universitário e rede
social — e `uncoveredCoreStrata` está vazio porque nenhuma delas ficou sem fonte.

## De onde vem cada valor

`commercialUse: false` é decisão congelada em
`benchmark/preregistration-v4.json` (validada por `benchmark/preregistration-v4.ts`,
dentro de `EVALUATOR_FILES`); `benchmark/source-manifest.ts` a lê e é a autoridade
do registro de licenças, do veredito por fonte e das obrigações do corpus, e
também de `WEIGHT_USE_POLICY`, que é o que governa os pesos; este NOTICE e
`license-review.json` publicam o resultado. Os testes que prendem cada elo estão
em `benchmark/tests/source-manifest.test.ts` — "the NOTICE states the
non-commercial regime and the corpus obligations" e "the NOTICE lists every
registered licence with exactly its obligations" prendem este arquivo, linha a
linha, ao registro do módulo, e "screens every document that states the licence
position" recusa aqui a frase de propagação que este arquivo já publicou uma vez.

O modelo emite um score TÉCNICO não calibrado até que uma decisão científica
selada exista (release.json permanece "pending"); nenhuma saída constitui
alegação de autoria.
