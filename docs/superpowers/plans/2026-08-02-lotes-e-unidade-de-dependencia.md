# Lotes de material e unidade de dependência — vocabulário da nova pré-inscrição

**Estado:** rascunho de vocabulário, escrito em 2026-08-02. É o passo 1 da metade em código da F1-5q, e
o único que não depende da ratificação de `domainSource`. Os passos 2 a 7 estão no registro, § F1-5q.

**Por que este documento existe antes do código.** A pré-inscrição v3 foi abandonada porque a metade
humana do corpus não admite um split de cinco partições: `collectionBatch` valia
`extraction_<arquivo de pool>`, e quatro arquivos produzem no máximo quatro componentes conectados,
enquanto cinco partições exigem presença humana em todas (a menor fração permitida é 3%). A causa raiz
não foi um número errado — foi **ambiguidade de vocabulário**: a execução local de um script de
extração foi tratada como se fosse um evento de coleta, e portanto como unidade estatística. Definir os
termos é o que impede a próxima confusão do mesmo tipo, e é por isso que vem antes.

## Os cinco termos

### 1. Documento de origem

A unidade de TEXTO que existe no mundo independentemente deste projeto: um artigo, um post, uma
resenha, uma resposta de fórum. É o que um leitor chamaria de "um texto".

Não é unidade de dependência por si. Dois documentos de origem podem ser fortemente correlacionados
(mesmo autor, mesma thread) ou independentes.

### 2. Lote de material (`sourceMaterialBatch`)

O conjunto de documentos de origem que entrou no projeto **pelo mesmo evento de aquisição**, e a
identidade que CARREGA DEPENDÊNCIA. É o que o split precisa manter indivisível.

Um lote de material é identificado por:

- `batchId` — token estável, único;
- `sourceId` — a fonte declarada no manifesto revisado;
- **versão ou digest imutável do material** — a versão concreta do que foi adquirido (por exemplo, a
  data do dump da Wikipédia, a release do Carolina), não a data em que eu rodei um script;
- **janela ou evento de aquisição** — quando e como aquele material passou a existir aqui;
- a **evidência** correspondente, que torna os quatro anteriores verificáveis por terceiro.

**O teste que define se dois documentos estão no mesmo lote:** eles vieram do mesmo material, adquirido
no mesmo evento? Se sim, tratá-los como observações independentes é super-contagem, e é exatamente o
que o eixo de conectividade existe para impedir.

### 3. Evento de aquisição

O ato pelo qual material externo passou a existir dentro do projeto: um download de dump, uma release
baixada, uma coleta autorizada. Tem data, mecanismo e — quando a fonte exige — condição jurídica.

**Distinção que a pré-inscrição abandonada não fazia:** reextrair o MESMO material adquirido é
processamento, não aquisição. Não cria lote novo, e fatiar o mesmo dump em dez pedaços na mesma sessão
produz dez rótulos sem decorrelacionar nada — seria enfraquecer o eixo sem declarar que enfraqueceu.

### 4. Execução de extração (`extractionRun`)

Uma execução local de um extrator sobre material já adquirido. Produz linhas a partir de documentos de
origem.

**NÃO é unidade estatística, e este é o ponto do documento.** Duas execuções sobre o mesmo material
produzem as mesmas linhas correlacionadas; uma execução sobre dois materiais distintos produz linhas de
dois lotes. O `extractionRun` serve como **diagnóstico** — reproduzir o que rodou, quando, com que
código — e nunca como eixo de conectividade. Foi tratá-lo como lote que produziu
`extraction_<arquivo de pool>` e, com isso, quatro componentes para o corpus inteiro.

### 5. Estrato de domínio (`domainSource`)

De que **domínio** o texto é: enciclopédico, resenha de produto, fórum técnico, institucional. É
propriedade de CONTEÚDO, e serve para relatar métrica por fatia e para compor cota.

**Não carrega dependência** (decisão do agente em F1-5q, pendente de ratificação do operador). Dois
textos enciclopédicos adquiridos em anos diferentes não são correlacionados por serem ambos
enciclopédicos. Enquanto `domainSource` for eixo de conectividade, qualquer corpus fica preso em no
máximo tantos componentes quantos domínios existam, quantas aquisições independentes haja — que é o
segundo gargalo que o cross-review mediu, e o que torna insuficiente mexer só em `collectionBatch`.

## O que segue de imediato para o código

**A ordem abaixo estava errada, e a medição corrigiu.** Ver
`benchmark/lab/test_connectivity_feasibility.py`, que mede com o código de produção: hoje
`domainSource` está em `GROUP_KEYS` e une por valor compartilhado, então **todo registro de um
domínio cai num único componente** — quatro domínios dão quatro componentes de 25% do corpo. O
splitter coloca componente inteiro numa só partição, e a menor partição do desenho de cinco é 5%.
Logo o tamanho do maior componente é um limite superior de viabilidade, e 25% > 5%.

Acrescentar lote **não muda nada** enquanto isso valer: cinco lotes por domínio produzem os mesmos
quatro componentes, porque o estrato já uniu tudo. A contraprova está no mesmo arquivo — sem o
estrato agrupando, os cinco lotes dão vinte componentes de 5%.

Quem sustenta a viabilidade é o item 2, não o 1. E há ainda uma imprecisão a corrigir: o campo
`collectionBatch` de hoje **já é a execução de extração** — o comentário em `assemble_corpus.py`
diz isso com todas as letras ("The EXTRACTION RUN that produced the row"), e o preenchimento é
`extraction_{fname}` ou `extraction_{domainSource}`. Portanto o trabalho não é acrescentar um eixo
ao lado dele: é PARTIR o que ele carrega em dois campos com papéis distintos.

1. `collectionBatch` deixa de significar execução: o que carrega dependência passa a ser
   `sourceMaterialBatch`, com os cinco campos do termo 2.
2. `domainSource` sai de `GROUP_KEYS` e passa a estrato de relato — **é o item que decide a
   viabilidade**, e depende da ratificação. Enquanto ele não sai, 1 e 3 são reorganização de nome.
3. `extractionRun` recebe o que sobra de `collectionBatch` — diagnóstico, e **não** entra em
   `GROUP_KEYS`.
4. O manifesto revisado ganha inventário de lotes, com os cinco campos do termo 2.
5. Extratores recusam linha cujo lote esteja ausente ou ambíguo — fail-closed, como o resto do projeto.
6. O fallback `extraction_{fname}` é eliminado **depois** de 1 a 5, quando houver para onde as linhas
   recuarem. Removê-lo antes deixaria registros sem lote.
7. Preflight de viabilidade antes da montagem: exigir que exista solução 45/5/10/20/20 dentro de ±0,02
   sobre os tamanhos e intervalos temporais dos componentes. A guarda que o E2 produziu
   (`assert_stamped_corpus_is_splittable`) é a base, e ela já espelha as condições da auditoria com a
   tabela "espelho / não decidível" escrita.

## O que este documento NÃO decide

Não fixa fontes, cotas, tamanho de corpus nem dataset ID novo. Essas são as escolhas que a nova
pré-inscrição precisa registrar **antes** de qualquer coleta, e três delas tocam o operador: quais
fontes públicas entram, quantos lotes independentes por fonte, e a condição jurídica do PT.SO — que
segue **fora** até o termo de acesso de 2024 ser resolvido.

Também não altera a pré-inscrição abandonada. Ela fica legível e explicitamente morta, com marcador em
`benchmark/rebuild-v3-policy.ABANDONADA.md`; a razão e a âncora metodológica estão em
`docs/references.md` § 2.2g.
