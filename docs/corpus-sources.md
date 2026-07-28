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

> **Regime de uso congelado (B1):** `commercialUse: false`, política
> `noncommercial-v1`. O produto e o modelo não têm e não terão ambição
> comercial, e **não existe variante comercial a preservar**. A cadeia de
> autoridade, em ordem: **`benchmark/rebuild-v3-policy.json`** (validado por
> `benchmark/rebuild-v3-policy.ts`, dentro de `EVALUATOR_FILES`) é a autoridade
> do valor congelado `commercialUse: false` e das obrigações congeladas
> `attributionRequired`/`shareAlikeRequired`; **`benchmark/source-manifest.ts`**
> **lê** esse arquivo (`CORPUS_USE_POLICY`, `FROZEN_ARTIFACT_OBLIGATIONS`) e é a
> autoridade do registro de licenças, do veredito por fonte e das obrigações que
> cada licença impõe (`CORPUS_LICENSE_REGISTRY`, `sourceAdmissibility`,
> `assertLicenseInventoryAdmissible`); **`models/cleanfeed-ptbr-v1/NOTICE.md`** e
> **`models/cleanfeed-ptbr-v1/license-review.json`** publicam o resultado. Cada
> elo tem um teste em `benchmark/tests/source-manifest.test.ts`: "reads the
> frozen non-commercial decision from the policy file, not a copy of it" e
> "derives the frozen flag in its source instead of restating it" prendem o
> primeiro elo, "imposes every obligation the frozen contract requires" prende as
> obrigações ao registro, e os testes do describe `licence policy agreement
> across manifest, review and NOTICE` prendem review, NOTICE e este documento
> (sem contagem fixa aqui de propósito: a lista cresce, e uma contagem em prosa
> aponta para menos elos do que existem no minuto seguinte). Nesse regime **`NC`
> é admissível** (a cláusula está satisfeita) e **`ND` é proibido para corpus
> derivado** — montar um corpus é exatamente o derivado que `ND` restringe. As
> duas cláusulas são restrições distintas: nunca as trate como uma única
> "licença restritiva".

> **Regime de aquisição congelado (B3, 2026-07-26):** a coleta humana se limita
> a **bases de dados públicas com licença compatível**. O projeto não recruta
> pessoas para doar texto, não obtém autorização por documento e não registra
> sessões de escrita próprias — não por objeção de método, e sim porque não tem
> como financiar nem governar isso (plano §L1: é restrição local, não
> impossibilidade da área; o AITDNA tem 95 textos `human-only` de participantes
> instrumentados, então doadores existem e alguém já os usou). A restrição é de
> **aquisição**, nunca de **categoria de evidência**: base pública que já
> contenha sessões instrumentadas continua admissível, sob as mesmas
> verificações de licença, idioma, proveniência, poder amostral e adequação ao
> estimando, e com base de rótulo mais forte (`observed-process`). Quem impõe
> isso no código é `benchmark/source-manifest.ts` — `HumanSourceRegistrationV1`,
> `humanSourceAdmissibility` e `assertV3HumanInventoryAdmissible` — com testes
> no describe `B3 — only public licensed bases enter as human sources`.

## As duas camadas legais (resumo)

1. **Direito autoral (Lei 9.610/98)** — protege o texto. Sai da frente com:
   domínio público, atos oficiais (art. 8º, I) ou licença explícita.
   **"Acessível na internet" ≠ "domínio público"** — todo texto nasce protegido.
2. **LGPD** — protege dados pessoais no/ao redor do texto. Mitigada por:
   pseudonimização total, PII-scrub, uso local de avaliação, nenhuma
   redistribuição.

A rota `linkedin-contribution` (autorização por documento, post pessoal) está
**fechada por B3**, e fechada **no caminho de admissão**, não só em prosa:
`parseReviewedSourceManifest` chama `assertNoIndividualAcquisition`, então um
manifesto que traga uma entrada de consentimento **não carrega** — falha com
`individual-acquisition`. `auditCorpusSources` recusa a mesma entrada por conta
própria (`LINKEDIN_SOURCE_NOT_AUTHORIZED`), porque ele recebe objeto já parseado
e `benchmark/lab/audit_sources.ts` chega nele com `JSON.parse` puro, sem passar
pelo parser. Todas as fontes abaixo entram pela rota `licensed-corpus`.

Uma rodada anterior deixou a recusa **sem chamador**, argumentando que retirar a
rota moveria junto três contratos. O argumento estava errado na medição e fica
registrado para não voltar: `benchmark/corpus-import.ts` cruza **apenas**
`provenance.sourceId` contra o conjunto de ids do manifesto — não existe
verificação de par `sourceKind`/`legalBasis` em lugar algum —, e nenhum manifesto
em disco tem entrada de consentimento, então nada selado deixou de ser legível.
O que sobra para **C1** é vocabulário do registro-linha, não brecha:
`provenance.sourceKind: "authorized-contribution"` e
`provenance.legalBasis: "consent"` ainda são grafáveis pelo schema, e
`acquisitionCounts.consent` ainda é chave obrigatória do contrato de prontidão.
Nenhum dos três pode trazer fonte que o manifesto recusa: registro cujo
`sourceId` não está no manifesto é rejeitado como `SOURCE_ENTRY_ABSENT`.

## Inventário aprovado para o piloto

| sourceId (sugerido) | Fonte | Base legal / licenseId | Registro/estilo | NC? | Papel |
| --- | --- | --- | --- | --- | --- |
| `src_ptso` | pt.stackoverflow.com (dump oficial do Stack Exchange) | CC BY-SA 4.0 → `cc-by-sa-4.0` | Informal, curto, tech — **melhor proxy limpo do feed** | não | avaliação + treino |
| `src_wikipedia_pt` | Wikipédia PT (dumps oficiais dumps.wikimedia.org) | CC BY-SA 4.0 → `cc-by-sa-4.0` | Enciclopédico/formal | não | treino/volume |
| `src_empresa` | Blog/comunicados corporativos próprios pré-nov/2022 | Autorização interna escrita → `autorizacao-interna-v1` | Corporativo — match com o feed | não | avaliação + treino |
| `src_proprio` | Textos do próprio operador | Autoria própria → `autoria-propria-v1` | Variado | não | avaliação + treino |
| `src_atos_oficiais` | Leis/decisões/atos (Diário Oficial, LexML) | Lei 9.610, art. 8º, I (não protegidos) → `lei9610-art8` | Formal | não | lastro de treino apenas (nunca dominar a distribuição) |
| `src_carolina` | **Corpus Carolina — snapshot em disco: Version 2.0 (Bea)** (verificado 2026-07-27; o cabeçalho do próprio pacote diz que é o corte por data que o torna utilizável). Vintages anteriores (Ada 1.0/1.1/1.3) **não** estão em disco | CC BY-**NC**-SA 4.0 no header do pacote; **licença POR DOCUMENTO nos metadados TEI**, com allowlist fail-closed no extrator → `cc-by-nc-sa-4.0` | Variado, proveniência por documento. ⚠️ A 2.0 (Bea) **contém datas TEI de 2024 e 2025**, então o corte por data do header TEI (`< 2022-11-30`) é **load-bearing**, não defesa em profundidade: sem ele o rótulo `human` fica contaminado | sim — admissível (`commercialUse: false`) | treino/volume + fatias informais |
| `src_b2w` *(opcional)* | B2W-Reviews01 (reviews pt-BR) | CC BY-**NC**-SA 4.0 → `cc-by-nc-sa-4.0` | Curto, informal, opinativo | sim — **utilizável** | avaliação + treino |

**Regra NC × ND (congelada em B1, 2026-07-26):** o projeto é **não comercial**
(`commercialUse: false`) e essa decisão não tem ramo alternativo. Nesse regime,
fontes CC BY-NC(-SA) são plenamente admissíveis — a cláusula NC está satisfeita.
Fonte **ND** (`cc-by-nc-nd-4.0`, p. ex.) continua **proibida**: o corpus é um
derivado, e é o derivado que ND restringe; declarar-se não comercial não
destrava ND. O rastreio por `licenseId` por fonte permanece obrigatório por dois
motivos que continuam valendo com a decisão congelada: **atribuição e
share-alike propagam para o artefato** (é o que `NOTICE.md` e
`license-review.json` publicam, por identificador exato), e é por ele que
`assertLicenseInventoryAdmissible` recusa uma fonte ND antes de qualquer
incorporação.

Nunca usar raspagem de plataformas com ToS restritivo (LinkedIn, X, Reddit,
Instagram) nem derivados de Common Crawl (copyright subjacente não licenciado —
abaixo do nosso padrão de governança).

## A base do rótulo humano: corte de data, por campo do documento

O que sustenta o rótulo `human` das fontes acima é o corte `< 2022-11-30`
(pré-ChatGPT). Ele é **mitigação declarada** de risco: não é prova de autoria
humana, não é certificado, e não vale "por construção". A formulação correta é a
que o MultiSocial usa sobre a mesma política — a autoria humana **não pode ser
garantida em 100%**. O corte torna implausível o uso do ChatGPT *se a data for
confiável*, e não exclui: assistência por ferramentas anteriores a nov/2022
(tradução automática, geração GPT-2/GPT-3, spinners, paráfrase automática), data
de contêiner divergente da data do texto, nem republicação com data enganosa. É
evidência **mais fraca** que sessão instrumentada, nunca mais forte: um histórico
de versões dá *observação do processo*; uma data dá *exclusão circunstancial de
uma ferramenta*. Também é **prática difundida** na área (RAID, MultiSocial,
Liang et al., Jabarian & Imas), o que torna a nossa posição comum — não superior.

**O corte é verificado por campo de data do documento, nunca presumido do vintage
do dump.** Cada fonte declara qual campo ancora os seus bytes, e o corte é
comparado contra *esse* campo. Quem aplica o corte é o banco Python:
`benchmark/lab/common.py` define `CHATGPT_CUTOFF = datetime(2022, 11, 30,
tzinfo=timezone.utc)` como **padrão** de `CandidateWriter.date_cutoff`, e um
candidato **sem** data é descartado (falha fechada — ausência de data não passa).
O lado TypeScript apenas registra o campo, o escopo e a data
(`PRE_CHATGPT_CUTOFF_ISO`); ele não recompara nada, e o teste "reads the same
cutoff the extractors apply, from common.py" extrai a data do próprio Python para
que as duas não divirjam em silêncio.

| sourceId | snapshot | campo que ancora os bytes | escopo | base do rótulo |
| --- | --- | --- | --- | --- |
| `src_ptso` | `pt-stackoverflow` | `Posts.xml`, atributo `CreationDate` | documento | `date-cutoff` |
| `src_wikipedia_pt` | `ptwiki` | `page/revision/timestamp` | documento | `date-cutoff` |
| `src_carolina` | `carolina` | `teiHeader//date[@type="Download"]`, por documento | documento | `date-cutoff` |
| `src_b2w` | `b2w-reviews01` | coluna `submission_date` | documento | `date-cutoff` |

Escopo `container` — o vintage do dump, do zip ou do release — **não** sustenta
`date-cutoff`, e `humanSourceAdmissibility` recusa com
`anchor-date-is-container-vintage`. O motivo é medido, não teórico: o Carolina
2.0 (Bea) em disco traz datas TEI de 2024 e 2025, e `pages-articles` guarda só a
revisão corrente de cada página. Um snapshot recente de qualquer um dos dois é
texto pós-LLM com nome antigo — daí o campo por documento ser *load-bearing* e
não defesa em profundidade.

**Quais destas são fontes humanas da v3.** Só quatro: `src_ptso`,
`src_wikipedia_pt`, `src_carolina` e `src_b2w` — exatamente os snapshots
congelados em `benchmark/rebuild-v3-policy.json` (`humanSources.snapshots`), com
`newDownloadsAllowed: false`. `src_empresa` (autorização interna escrita) e
`src_proprio` (autoria do operador) **não** entram: nenhuma das duas é base
pública licenciada, que é a única rota que B3 deixa aberta.
`src_atos_oficiais` é público, mas não está na lista congelada, e por isso é
recusado por um motivo **distinto** — `snapshot-not-frozen`, não
`individual-acquisition`: não há bytes em disco para ele e nenhum download novo
está autorizado. As três permanecem no inventário como registro do piloto;
nenhuma é fonte humana da v3.

**Base pública instrumentada continua representável.** Uma base publicada que já
tenha registrado o processo de escrita entra com `acquisition: "public-dataset"`,
`labelBasis: "observed-process"` e **sem** campo de data — a base dela é a
observação, não a data. O piso de poder, porém, é separado e não se mistura: o
maior conjunto instrumentado publicado tem 95 textos `human-only` (limite
superior unilateral de 2,77%) contra o piso de 300 negativos por fatia crítica,
então um conjunto assim é diagnóstico suplementar e nunca eleva a alegação do
conjunto inteiro (`labelBasis.pooledClaimAllowed: false`). Hoje nenhuma fonte da
v3 usa essa base; inventar uma seria inventar proveniência (R4).

O custo definitivo dessa decisão — os três itens que ela fecha e as quatro
respostas do projeto — está em [limitations.md](limitations.md).

### Fonte de classe IA aprovada — corpus de TREINO (2026-07-22)

- **`src_ai_public_madras`** — [Madras1/corpus-ptbr-v1](https://huggingface.co/datasets/Madras1/corpus-ptbr-v1),
  **apenas o subset `synthetic`** (1,6M textos pt-BR de modelos abertos
  modernos 2024-25: Qwen, GPT-OSS, mixes via OpenRouter; 20 estilos incl.
  posts LinkedIn/Twitter/WhatsApp). Licença **ODC-By 1.0** (atribuição — esta
  entrada é o registro). O lado "real" do dataset (C4/FineWeb2) **NÃO é usado**
  (Common Crawl = copyright subjacente; FineWeb2 é pós-ChatGPT). Importador:
  `benchmark/lab/import_public_corpus.py`, com **filtro de vazamento de canal
  de raciocínio** (linhas com meta-texto em inglês tipo "analysisWe need to
  write…" são descartadas — senão o detector aprende o atalho falso
  "meta-inglês = IA"). Tags de família parciais (`madras:<batch>`); lotes
  `openrouter*` são mix não identificável — não usar como held-out.

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
- **IberAuTexTification (`Genaios/iberautextification`)** — **bloqueado por ND**,
  não por NC. O card oficial declara `cc-by-nc-nd-4.0`: `NC` estaria satisfeito
  neste projeto (`commercialUse: false`), mas **ND = sem derivados** e montar um
  corpus derivado é exatamente o que a cláusula restringe; o card ainda pede
  contato com os organizadores para adaptar ou construir sobre o dataset.
  Registrado no inventário como `derivedCorpus: "blocked"`,
  `blockedBy: "no-derivatives"`. Não baixar e não incorporar sem autorização
  escrita dos organizadores. Conjuntos externos (MultiSocial e outros) ficam
  fora da v3 até licença verificada na fonte (R9).
- **Common Crawl / OSCAR / mC4 / CC-100** — copyright subjacente não licenciado.
- **cnmoro/Fab1e5-traces-2M-ptbr** — rejeitado 2026-07-22 para o corpus do
  detector: (1) pt-BR por **tradução automática** do inglês — a assinatura vira
  do tradutor, não do gerador (treinaria um detector de translationese);
  (2) registro de chat assistente (turnos user/assistant), não texto de feed;
  (3) sem licença declarada no card.

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
    "name": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
    "source": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    "evaluationUseApproved": true,
    "redistribution": "not-published",
    "notice": "Cláusula NC satisfeita: commercialUse é false e congelado. Atribuição e share-alike propagam para o artefato; rastreada por fonte para que essa propagação seja auditável."
  },
  {
    "id": "odc-by-1.0",
    "name": "Open Data Commons Attribution License 1.0",
    "source": "https://opendatacommons.org/licenses/by/1-0/",
    "evaluationUseApproved": true,
    "redistribution": "not-published",
    "notice": "Subset sintético de Madras1/corpus-ptbr-v1; atribuição registrada nesta notice."
  }
]
```

Uma licença **ND** nunca entra neste bloco: `evaluationUseApproved: true` para
uma fonte ND seria a contradição que `assertLicenseInventoryAdmissible` recusa
(`blockedBy: "no-derivatives"`).

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

**Implementado em [benchmark/lab/](../benchmark/lab/README.md)** — extratores
streaming (Python-bancada, só stdlib: `bz2`/`xml.sax`/`zipfile`),
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
   costuma-se dizer "source-available não-comercial". A troca do texto de
   licença do repositório é uma tarefa pendente do operador; nada neste
   inventário depende dela, e ela **não** é um ramo comercial pendente — o
   regime `commercialUse: false` está congelado, e o que falta é apenas alinhar
   o arquivo `LICENSE` a ele antes da publicação.

## Dependência pendente

**RESOLVIDO em 2026-07-23: pivô confirmado, contratos atualizados.** O manifesto
selado agora exige `datasetId: "ptbr-generic-v1"` e `intendedDomain: "generic"`,
e a política de release cobre os cinco tipos de fonte humana das fontes deste
inventário (`qa-informal`, `encyclopedic`, `social-media`, `university`,
`institutional`). Os perfis de calibração são publicados com platform
`generic`; o runtime normaliza o id do adapter (ex.: `linkedin`) para esse pool
único no lookup — o adapter da extensão continua `linkedin`. Ver o
[runbook de coleta](corpus-collection-runbook.md).

## Disclaimer

Este inventário é engenharia informada pela leitura da lei, não parecer
jurídico. Antes do corpus de release as fontes devem passar pela revisão
jurídica formal — os dois `legalReviewerIds` por fonte são exatamente o lugar de
registrar essa revisão.
