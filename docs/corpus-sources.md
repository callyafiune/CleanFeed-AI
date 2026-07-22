# Fontes de corpus sem consentimento individual — inventário e política

> **Política inegociável (condição do operador):** o corpus NUNCA contém nome,
> handle, URL de perfil, e-mail, telefone, CPF ou qualquer dado pessoal — sensível
> ou não. Isso é garantido estruturalmente pelo pipeline: o schema fechado
> **rejeita** chaves de autor (`authorName`/`handle`/`sourceUrl` derrubam o parse),
> identidades viram tokens pseudonimizados `[A-Za-z0-9_-]` (o regex recusa `@`,
> `.` e espaço), todo registro exige `piiAudit: passed` (método
> `manual-and-automated`), e o corpus nunca entra no Git nem é republicado — só
> digests e agregados sanitizados saem. PII encontrada **dentro** do texto é
> removida/pseudonimizada ANTES do ingest (o hash de conteúdo é recomputado do
> texto já limpo).

## As duas camadas legais (resumo)

1. **Direito autoral (Lei 9.610/98)** — protege o texto. Sai da frente com:
   domínio público, atos oficiais (art. 8º, I) ou licença explícita.
   **"Acessível na internet" ≠ "domínio público"** — todo texto nasce protegido.
2. **LGPD** — protege dados pessoais no/ao redor do texto. Mitigada por:
   pseudonimização total, PII-scrub, uso local de avaliação, nenhuma
   redistribuição.

Consentimento individual só é exigido pela rota `linkedin-contribution`
(post pessoal de LinkedIn). As fontes abaixo usam a rota `licensed-corpus`.

## Inventário aprovado para o piloto

| sourceId (sugerido) | Fonte | Base legal / licenseId | Registro/estilo | NC? | Papel |
| --- | --- | --- | --- | --- | --- |
| `src_ptso` | pt.stackoverflow.com (dump oficial do Stack Exchange) | CC BY-SA 4.0 → `cc-by-sa-4.0` | Informal, curto, tech — **melhor proxy limpo do feed** | não | avaliação + treino |
| `src_wikipedia_pt` | Wikipédia PT (dumps oficiais dumps.wikimedia.org) | CC BY-SA 4.0 → `cc-by-sa-4.0` | Enciclopédico/formal | não | treino/volume |
| `src_empresa` | Blog/comunicados corporativos próprios pré-nov/2022 | Autorização interna escrita → `autorizacao-interna-v1` | Corporativo — match com o feed | não | avaliação + treino |
| `src_proprio` | Textos do próprio operador | Autoria própria → `autoria-propria-v1` | Variado | não | avaliação + treino |
| `src_atos_oficiais` | Leis/decisões/atos (Diário Oficial, LexML) | Lei 9.610, art. 8º, I (não protegidos) → `lei9610-art8` | Formal | não | lastro de treino apenas (nunca dominar a distribuição) |
| `src_carolina` | **Corpus Carolina — versão preferida: Ada 1.1 (22/07/2022, Portulan)**; alternativas: Ada 1.0 no HuggingFace (08/04/2022) ou Ada 1.3 | CC BY-**NC**-SA 4.0 no header; **licença POR DOCUMENTO nos metadados TEI** → `cc-by-nc-sa-4.0` | Variado, proveniência por documento. Ada 1.1/1.0 são **inteiramente pré-ChatGPT por construção** (release < nov/2022) — mesma garantia dos snapshots SE/ptwiki. ⚠️ Se usar a 1.3 (2024): corte por data do header TEI (< 2022-11-30) vira OBRIGATÓRIO | sim — utilizável | treino/volume + fatias informais |
| `src_b2w_reviews` *(opcional)* | B2W-Reviews01 (reviews pt-BR) | CC BY-**NC**-SA 4.0 → `cc-by-nc-sa-4.0` | Curto, informal, opinativo | sim — **utilizável** | avaliação + treino |

**Regra NC (atualizada 2026-07-22):** o operador declarou que o projeto será
disponibilizado **sem uso comercial**. Nesse regime, fontes CC BY-NC(-SA) são
plenamente utilizáveis (a cláusula NC é satisfeita). O rastreio por
`licenseId` por fonte permanece obrigatório mesmo assim — ele preserva a
opcionalidade (trocar fontes NC se a postura um dia mudar) e é o que o gate de
inventário verifica.

**Proveniência humana por data:** para as fontes pré-novembro/2022, a data de
publicação sustenta o rótulo `human` — registre-a como `collectedAt`/metadado da
fonte. Nunca usar raspagem de plataformas com ToS restritivo (LinkedIn, X,
Reddit, Instagram) nem derivados de Common Crawl (copyright subjacente não
licenciado — abaixo do nosso padrão de governança).

### Fontes avaliadas e REJEITADAS (governança de rejeição)

- **BrWaC (UFRGS)** — rejeitado 2026-07-22: distribuído "solely for academic
  research purposes" (sem licença formal detalhada), e o copyright dos textos
  subjacentes (web crawleada) nunca foi licenciado — o mesmo problema do Common
  Crawl. O projeto não está formalizado como pesquisa acadêmica (operador é
  pós-graduando na FIAP, mas o projeto é **pesquisa independente não-comercial**
  — a categoria "pesquisa acadêmica" exige vínculo institucional: projeto
  registrado/TCC/orientação, não apenas matrícula). Substituto direto:
  **Corpus Carolina**. Caminho de destravamento futuro: formalizar como TCC na
  FIAP e/ou publicar resultados (PROPOR/STIL/arXiv) — aí o formulário de acesso
  do BrWaC pode ser preenchido com o vínculo real e a concessão dos mantenedores
  vira o documento de autorização.
- **Common Crawl / OSCAR / mC4 / CC-100** — copyright subjacente não licenciado.

**Trio FECHADO para volume (2026-07-22): Stack Exchange PT + Wikimedia
(CC BY-SA) + Carolina (CC BY-NC-SA).**

## Blocos prontos para o `ingest`

### `licenses[]` do template de dataset-manifest

```json
[
  {
    "id": "cc-by-sa-4.0",
    "name": "Creative Commons Attribution-ShareAlike 4.0",
    "source": "https://creativecommons.org/licenses/by-sa/4.0/",
    "evaluationUseApproved": true,
    "redistribution": "not-published",
    "notice": "Textos de pt.stackoverflow.com e Wikipédia PT (dumps oficiais) usados exclusivamente para avaliação local; o corpus não é redistribuído; atribuição coletiva registrada nesta notice. Share-alike não é acionado por não haver redistribuição."
  },
  {
    "id": "lei9610-art8",
    "name": "Atos oficiais — Lei 9.610/98, art. 8º, I",
    "source": "https://www.planalto.gov.br/ccivil_03/leis/l9610.htm",
    "evaluationUseApproved": true,
    "redistribution": "not-published",
    "notice": "Textos de leis, decretos, decisões judiciais e demais atos oficiais não são objeto de proteção autoral."
  },
  {
    "id": "autorizacao-interna-v1",
    "name": "Autorização interna escrita (conteúdo corporativo próprio)",
    "source": "registro interno da autorização",
    "evaluationUseApproved": true,
    "redistribution": "not-published",
    "notice": "Conteúdo institucional pré-2022 autorizado por escrito pelo detentor para avaliação local; sem dados pessoais após scrub."
  },
  {
    "id": "autoria-propria-v1",
    "name": "Autoria própria do operador",
    "source": "declaração do operador",
    "evaluationUseApproved": true,
    "redistribution": "not-published",
    "notice": "Textos de autoria do próprio operador do corpus."
  },
  {
    "id": "cc-by-nc-sa-4.0",
    "name": "Creative Commons BY-NC-SA 4.0",
    "source": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    "evaluationUseApproved": true,
    "redistribution": "not-published",
    "notice": "Cláusula NC satisfeita: o projeto é declarado sem uso comercial. Rastreada por fonte para preservar opcionalidade."
  }
]
```

### Entradas do `private/source-manifest.json` (rota `licensed-corpus`)

```json
[
  {
    "sourceId": "src_ptso",
    "sourceType": "licensed-corpus",
    "acquisition": "licensed",
    "evaluationUseApproved": true,
    "licenseId": "cc-by-sa-4.0",
    "consentReceiptDigest": null,
    "collectionProtocolVersion": "collection-v1",
    "legalReviewerIds": ["legal_a", "legal_b"]
  },
  {
    "sourceId": "src_wikipedia_pt",
    "sourceType": "licensed-corpus",
    "acquisition": "licensed",
    "evaluationUseApproved": true,
    "licenseId": "cc-by-sa-4.0",
    "consentReceiptDigest": null,
    "collectionProtocolVersion": "collection-v1",
    "legalReviewerIds": ["legal_a", "legal_b"]
  },
  {
    "sourceId": "src_empresa",
    "sourceType": "licensed-corpus",
    "acquisition": "licensed",
    "evaluationUseApproved": true,
    "licenseId": "autorizacao-interna-v1",
    "consentReceiptDigest": null,
    "collectionProtocolVersion": "collection-v1",
    "legalReviewerIds": ["legal_a", "legal_b"]
  },
  {
    "sourceId": "src_proprio",
    "sourceType": "licensed-corpus",
    "acquisition": "licensed",
    "evaluationUseApproved": true,
    "licenseId": "autoria-propria-v1",
    "consentReceiptDigest": null,
    "collectionProtocolVersion": "collection-v1",
    "legalReviewerIds": ["legal_a", "legal_b"]
  },
  {
    "sourceId": "src_atos_oficiais",
    "sourceType": "licensed-corpus",
    "acquisition": "licensed",
    "evaluationUseApproved": true,
    "licenseId": "lei9610-art8",
    "consentReceiptDigest": null,
    "collectionProtocolVersion": "collection-v1",
    "legalReviewerIds": ["legal_a", "legal_b"]
  },
  {
    "sourceId": "src_carolina",
    "sourceType": "licensed-corpus",
    "acquisition": "licensed",
    "evaluationUseApproved": true,
    "licenseId": "cc-by-nc-sa-4.0",
    "consentReceiptDigest": null,
    "collectionProtocolVersion": "collection-v1",
    "legalReviewerIds": ["legal_a", "legal_b"]
  }
]
```

`legalReviewerIds` são tokens pseudonimizados das DUAS pessoas distintas que
revisaram **a licença da fonte** (não cada texto) — minutos por fonte. Substitua
`legal_a`/`legal_b` pelos tokens reais do seu registro interno.

## Procedimento por fonte (sempre dumps oficiais, nunca raspagem)

- **pt.stackoverflow**: baixar o dump oficial (Posts.xml via Stack Exchange data
  dump/Internet Archive); filtrar corpos de perguntas/respostas com ≥ 50
  palavras; remover blocos de código e markdown; PII-scrub (menções a nomes →
  pseudônimo); registrar data de criação.
- **Wikipédia PT**: dump XML oficial; extrair parágrafos corridos de artigos
  (excluir listas, infobox, referências); PII irrelevante na prática, scrub
  mesmo assim. **Obrigatório snapshot pré-nov/2022**: `pages-articles` contém
  só a revisão corrente, e a Wikipédia de hoje já tem edições assistidas por IA
  — um dump atual contaminaria o rótulo `human`.
- **Carolina**: zips TEI por tipologia; ler a licença POR DOCUMENTO no header
  TEI e filtrar as compatíveis; **excluir a tipologia de wikis** (near-dup com a
  Wikipédia direta — escolher um canal só por conteúdo); registrar a tipologia
  como `domainSource`.
- **Conteúdo corporativo**: exportar do CMS com a autorização arquivada; scrub
  de nomes de funcionários/clientes.
- **Atos oficiais**: LexML/Planalto; usar trechos dispositivos corridos.
- **Receita 1 fonte → 3 classes** (do runbook): original → `human`; reescrita
  por IA sobre o mesmo tema → `ai` (pareada por tópico, evita o classificador
  aprender "antigo vs novo"); edição por IA com spans capturados por diff →
  `mixed`.

## Divisão de trabalho — downloads manuais × automação

O ambiente de automação não tem rede para arquivos grandes; os dumps são
baixados **manualmente pelo operador** para `benchmark/data/raw-sources/`
(gitignored — dado nunca entra no Git). Todo o resto é automatizável.

### Downloads manuais (operador)

| # | Fonte | Onde baixar | Arquivo | Destino local |
| --- | --- | --- | --- | --- |
| 1 | Stack Exchange PT | archive.org → item "Stack Exchange Data Dump", **snapshot ≤ set/2022** (evita os termos de acesso de 2024) | `pt.stackoverflow.com.7z` (centenas de MB); extrair `Posts.xml` com 7-Zip | `benchmark/data/raw-sources/stackexchange/Posts.xml` |
| 2 | Wikipédia PT | espelhos de dumps no archive.org (buscar `ptwiki` de ~2022-03 a 2022-09) | `ptwiki-2022XXXX-pages-articles.xml.bz2` (~2–3 GB; **não extrair** — o extrator lê .bz2 em streaming) | `benchmark/data/raw-sources/wikipedia/` |
| 3 | Carolina **Ada 1.1 (22/07/2022)** — preferida por ser inteiramente pré-ChatGPT | **Portulan CLARIN** (espelho da 1.1); alternativas: HuggingFace `carolina-c4ai/corpus-carolina` em revisão antiga (Ada 1.0, 08/04/2022) ou site USP (1.3, exige corte por data) | zips TEI por tipologia (**pular wikis**); o extrator ainda filtra data + licença do header TEI como defesa em profundidade | `benchmark/data/raw-sources/carolina/` |

Nota de defesa em profundidade: o extrator corta por data
(`< 2022-11-30`, pré-ChatGPT) independentemente do vintage do dump — mas para a
Wikipédia o snapshot antigo é obrigatório mesmo assim (ver procedimento acima).

### Automatizado (sessão)

Extratores streaming (Python-bancada, só stdlib: `bz2`/`xml.sax`/`zipfile`),
corte temporal, filtro ≥ 50 palavras, limpeza de markup/código, PII-scrub,
montagem do JSONL no formato exato do `ingest` + scaffold do review-ledger,
fixtures de teste dos parsers, e a execução/verificação de ponta a ponta assim
que os arquivos estiverem no destino. Fase seguinte (classes `ai`/`mixed`):
scripts de geração multi-API com receitas registradas — as **chaves de API são
do operador**.

## Implicações de disponibilizar o projeto como aberto e não-comercial

Decisão do operador (2026-07-22): o projeto será publicado abertamente, **sem
uso comercial**. Três consequências práticas:

1. **Código ≠ corpus.** Abrir o código NÃO publica o corpus. O corpus continua
   local e não redistribuído por padrão (`redistribution: "not-published"`) —
   pela LGPD/PII e pelas licenças das fontes. Publicar o corpus (open data) é
   uma decisão SEPARADA e futura; se acontecer, o share-alike das fontes
   CC BY-SA passa a valer (o corpus derivado herda BY-SA) e as fontes NC
   impõem NC ao conjunto — a rastreabilidade por `licenseId` por registro é o
   que torna esse desmembramento possível.
2. **Fontes NC destravadas.** Com o projeto não-comercial, CC BY-NC(-SA)
   (B2W-Reviews01, subcorpora do Carolina, etc.) entram no inventário sem
   segregação.
3. **⚠️ A licença atual do repositório é MIT — e MIT PERMITE uso comercial por
   terceiros.** "Aberto porém sem uso comercial" exige outra licença: para o
   código, algo como PolyForm Noncommercial 1.0.0 (ou dual licensing); para
   docs/dados publicáveis, CC BY-NC 4.0. Nota de precisão terminológica: uma
   licença com restrição comercial não é "open source" pela definição OSI —
   costuma-se dizer "source-available não-comercial". A troca de licença é uma
   decisão pendente do operador; nada neste inventário depende dela, mas os
   avisos NC acima assumem que ela será feita antes da publicação.

## Dependência pendente

O manifesto selado hoje exige `datasetId: "ptbr-linkedin-v1"` e
`intendedDomain: "linkedin"` (literais nos contratos). O piloto roda FORA do
pipeline selado e não é afetado; se o pivô de escopo ("modelo genérico +
avaliação em social curto pt-BR") for confirmado, os literais serão atualizados
em contrato antes do corpus de release. Ver o
[runbook de coleta](corpus-collection-runbook.md).

## Disclaimer

Este inventário é engenharia informada pela leitura da lei, não parecer
jurídico. Antes do corpus de release (e de qualquer comercialização), as fontes
devem passar pela revisão jurídica formal — os dois `legalReviewerIds` por fonte
são exatamente o lugar de registrar essa revisão.
