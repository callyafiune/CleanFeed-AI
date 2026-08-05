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
> autoridade, em ordem: **`benchmark/preregistration-v4.json`** (validado por
> `benchmark/preregistration-v4.ts`, dentro de `EVALUATOR_FILES`) é a autoridade
> do valor congelado `commercialUse: false` e das obrigações congeladas
> `attributionRequired`/`shareAlikeRequired`; **`benchmark/source-manifest.ts`**
> **lê** esse arquivo (`CORPUS_USE_POLICY`, `FROZEN_CORPUS_OBLIGATIONS`) e é a
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

Fechar a rota de consentimento, porém, fecha só **metade** da regra: ela recusa a
aquisição que **nomeia** um doador individual, e deixava passar duas licenças
registradas que não são base pública. Isso também está fechado agora, num eixo
próprio. Cada licença do registro declara um `publicationRegime`, e a distinção é
invisível nas cláusulas — `autoria-propria-v1`, `autorizacao-interna-v1` e
`lei9610-art8` têm atribuição/NC/SA/ND todas falsas, e só as duas primeiras são
recusadas:

| `publicationRegime` | licenças | veredito |
| --- | --- | --- |
| `published-base` | as quatro CC/ODC e `lei9610-art8` | única rota que B3 admite |
| `operator-authorship` | `autoria-propria-v1` | recusada — **é** a rota `operator-authored-session` |
| `internal-authorization` | `autorizacao-interna-v1` | recusada — base não publicada |

`parseReviewedSourceManifest` chama os dois eixos: `assertNoIndividualAcquisition`
(como o regime `operator-authorship` **determina** a rota, `autoria-propria-v1`
falha aqui, com `operator-authored-session`) e depois
`assertPublicBaseLicensesOnly` (`non-public-base`). A ordem é deliberada e está
fixada por teste: publicar a própria sessão de escrita **não** destrava uma rota
que B3 recusa, então nomear a publicação nomearia motivo que o chamador poderia
satisfazer sem ficar admissível — a mesma regra de precedência que já vale para ND
sobre NC. Autorização interna **não** é aquisição individual (existe terceiro real
e autorização escrita real, e nenhuma das três rotas proibidas a descreve com
honestidade), então ela é recusada pelo eixo da publicação, e não por um rótulo de
rota inventado (R4). `isAuthorizedHumanSource`, no auditor, repete as duas recusas
pelo mesmo motivo de sempre: ele recebe objeto já parseado.

Uma rodada anterior deixou a recusa **sem chamador**, argumentando que retirar a
rota moveria junto três contratos. O argumento estava errado na medição e fica
registrado para não voltar: `benchmark/corpus-import.ts` cruza **apenas**
`provenance.sourceId` contra o conjunto de ids do manifesto — não existe
verificação de par `sourceKind`/`legalBasis` em lugar algum —, e nenhum
`ReviewedSourceManifestV1` em disco tem entrada `linkedin-contribution`, então nada
selado deixou de ser legível. (O corpus sintético de smoke sob `benchmark/work/`
tem `{"id": "consent", "kind": "authorized-contribution"}`, mas é **outra forma de
artefato**, de outro produtor e outro loader; este parser a rejeitaria por chave
desconhecida antes de chegar à varredura de aquisição.)
O que sobra para **C1** é vocabulário do registro-linha, não brecha:
`provenance.sourceKind: "authorized-contribution"` e
`provenance.legalBasis: "consent"` ainda são grafáveis pelo schema, e
`acquisitionCounts.consent` ainda é chave obrigatória do contrato de prontidão.
Nenhum dos três pode trazer fonte que o manifesto recusa: registro cujo
`sourceId` não está no manifesto é rejeitado como `SOURCE_ENTRY_ABSENT`.

## Inventário aprovado para o piloto

| sourceId (sugerido) | Fonte | Base legal / licenseId | Registro/estilo | NC? | Papel |
| --- | --- | --- | --- | --- | --- |
| ~~`src_ptso`~~ | ~~pt.stackoverflow.com (dump oficial do Stack Exchange)~~ | CC BY-SA 4.0 → `cc-by-sa-4.0` | Informal, curto, tech | não | **BLOQUEADA (A1, 2026-07-31)** — fora do corpus v1/v2, ver abaixo |
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
share-alike são obrigações do corpus, e o corpus tem de poder mostrar de qual
fonte cada uma vem** (é o que `NOTICE.md` e `license-review.json` publicam, por
identificador exato, sob `corpusObligations`), e é por ele que
`assertLicenseInventoryAdmissible` recusa uma fonte ND antes de qualquer
incorporação.

A redação anterior deste parágrafo dizia que atribuição e share-alike "propagam
para o artefato". Era a mesma inversão do `NOTICE.md`, num arquivo que ninguém
tinha revisado com esse olhar, e foi a terceira tela de over-claim
(`weightInheritanceOverclaimIn`) que a encontrou — não uma varredura manual.

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
| ~~`src_ptso`~~ | ~~`pt-stackoverflow`~~ | `Posts.xml`, atributo `CreationDate` | documento | **bloqueada (A1)** — registro preservado em `A1_BLOCKED_HUMAN_SOURCES` |
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

**Quais destas são fontes humanas estocadas.** Depois de A1 (2026-07-31) eram
**três**; depois da emenda da moldura (2026-08-05) é **uma**: `src_wikipedia_pt` —
exatamente o snapshot congelado em `benchmark/preregistration-v4.json`
(`humanSources.snapshots` é `["ptwiki"]`), com `newDownloadsAllowed: false`.
`src_b2w` e `src_carolina` continuam **declaradas e admissíveis** por rota e
licença, em `OUT_OF_FRAME_HUMAN_SOURCES`: resenha de produto não é a célula da
moldura, e as três tipologias da Carolina saíram dela por proveniência — instituição
única, nenhum autor declarado (ESTADO.md § 5.5) —, e nada disso é o mesmo que estar
recusada. `src_ptso` está **bloqueada**: o
snapshot vive agora em `humanSources.blockedSnapshots` e a declaração da fonte em
`A1_BLOCKED_HUMAN_SOURCES`, e `auditCorpusSources` reprova
(`SOURCE_BLOCKED_BY_ACCESS_TERMS`) um manifesto que a declare. `src_empresa` (autorização interna escrita) e
`src_proprio` (autoria do operador) **não** entram: nenhuma das duas é base
pública licenciada, que é a única rota que B3 deixa aberta.

E, desde 2026-07-28, essa recusa das duas **não é mais só prosa** — antes, era: a
tabela do piloto dizia que não entravam e nenhum código dizia. Agora a licença que
cada uma declara é o que as recusa, pelo `publicationRegime` da tabela acima, em
três caminhos independentes: `parseReviewedSourceManifest` (um manifesto selado com
qualquer das duas **não carrega**), `humanSourceAdmissibility` /
`assertV3HumanInventoryAdmissible` (`non-public-base-license`, que é o que impede
um registro de declarar `acquisition: "public-dataset"` **e** nomear
`autoria-propria-v1` — contradição entre dois campos do próprio registro) e
`isAuthorizedHumanSource` no auditor. O que continua valendo é o alerta inverso: as
três linhas do piloto são recusadas pela **licença** que nomeiam, não pelo
`sourceId`; um `sourceId` novo com licença pública seria admissível, como deve ser.

`src_atos_oficiais` é público, mas não está na lista congelada, e por isso é
recusado por um motivo **distinto** — `snapshot-not-frozen`, não
`individual-acquisition` nem `non-public-base`: `lei9610-art8` é
`published-base` (atos oficiais são publicados pelo Estado), e o que falta é bytes
em disco, porque nenhum download novo está autorizado. As três permanecem no
inventário como registro do piloto; nenhuma é fonte humana da v3.

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
(CC BY-SA) + Carolina (CC BY-NC-SA).** ⚠️ **Superado por A1 (2026-07-31):** o
Stack Exchange saiu, e o volume vem de Wikimedia + Carolina + B2W.

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
    "notice": "Cláusula NC satisfeita: commercialUse é false e congelado. Atribuição e share-alike são obrigações do corpus; rastreada por fonte para que a origem de cada obrigação seja auditável."
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
| ~~1~~ | ~~Stack Exchange PT~~ | **NÃO BAIXAR — bloqueada por A1 (2026-07-31).** O argumento antigo desta linha era que um snapshot ≤ set/2022 "evita os termos de acesso de 2024"; a seção A1 o considera insuficiente, porque os dumps saíram do archive.org em jul/2024 e o que falta é disposição jurídica verificável, não um vintage anterior | — | — |
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
3. **Uma licença por artefato — RESOLVIDO na Fase 0.1 da v1.0 (2026-07-31).** A
   pergunta "qual licença" não tem uma resposta só, porque os três artefatos que
   o projeto publica não correm o mesmo risco:

   | artefato | licença | onde |
   |---|---|---|
   | código | MIT | `LICENSE`, na raiz |
   | pesos treinados | `cleanfeed-weights-nc-1.0` (própria, não comercial, usos de alto risco proibidos) | `models/cleanfeed-ptbr-v1/LICENSE` |
   | documentação e evidência | CC BY 4.0 | `docs/LICENSE-DOCS.md` |

   O rascunho anterior deste item propunha PolyForm Noncommercial para o código
   e CC BY-NC para docs. Foi descartado, e a razão importa: restrição comercial
   no **código** não protege ninguém — quem quiser um detector comercial treina
   o próprio, e a única coisa que a restrição consegue é impedir que a bancada
   de avaliação (a parte do projeto que a auditoria de 2026-07-30 não encontrou
   precedente) seja reusada por quem deveria reusá-la. A restrição pertence ao
   artefato que pode causar dano a uma pessoa: os **pesos**.

   Precisão terminológica, porque ela continua valendo: uma licença com
   restrição de uso não é "open source" pela definição da OSI. O projeto diz
   "pesos abertos, uso restrito", nunca "open source", e
   `cleanfeed-weights-nc-1.0` declara `osiApproved: false`.

   Duas afirmações do rascunho anterior eram falsas e ficam registradas como
   tal: "nada neste inventário depende dela" (a semântica de obrigação neste
   inventário mudou junto — ver a seção seguinte) e "o que falta é apenas
   alinhar o arquivo `LICENSE`" (a Fase 0.1 foi retrabalho de código em
   `benchmark/source-manifest.ts`, nos testes que o prendiam, no `NOTICE.md`, no
   campo `artifactObligations` e no script de empacotamento).

## Posição (a) — de quem são as obrigações, e sobre o quê

Toda obrigação que este inventário calcula é obrigação sobre o **corpus**:
adquirir os bytes, prepará-los, usá-los. Nenhuma é obrigação sobre os pesos
treinados. Os pesos saem sob `cleanfeed-weights-nc-1.0`, que é política própria
do projeto — escolhida, não importada.

A razão não é organização. Lido o artefato treinado como derivado das suas
fontes, as licenças registradas seriam conjuntamente insatisfazíveis:
`cc-by-sa-4.0` proíbe acrescentar restrição, logo proíbe NC, enquanto o
share-alike de `cc-by-nc-sa-4.0` exige que o derivado carregue a mesma licença,
que inclui NC. A própria Creative Commons documenta o par como incompatível.
Uma função que derivasse a licença do artefato da união das licenças de fonte
estaria derivando o conjunto vazio e publicando o resultado como licença.

**O que a posição (a) NÃO é:** não é parecer jurídico, não é consenso e não é
conclusão da Creative Commons. O primer da CC diz que um modelo frequentemente
não é adaptação, e na mesma passagem ressalva as cópias feitas durante o treino
e registra que as jurisdições divergem; o Brasil não tem exceção clara de
mineração de dados. É **decisão de risco do operador**, registrada como tal em
`models/cleanfeed-ptbr-v1/license-review.json` (`weightPolicy.positionAuthority`)
e sujeita à ratificação B1 antes de qualquer publicação de pesos.

**O que ela não afrouxa:** nada na direção da aquisição. O termo de acesso de
uma fonte é independente da tese sobre obra derivada, e continua bloqueando —
é exatamente por isso que o dump do Stack Exchange está fora do corpus v1/v2.

No código a separação tem nome: `FROZEN_CORPUS_OBLIGATIONS` e
`corpusLicenseObligations` respondem pelo corpus, `WEIGHT_USE_POLICY` responde
pelos pesos, e `weightInheritanceOverclaimIn` é a terceira tela de over-claim —
ela recusa, nestes documentos, a frase que diz o contrário.

## A1 — o dump do Stack Exchange sai, e sai NOMEADO

Decisão A1, em vigor por delegação desde 2026-07-30 e implementada em
2026-07-31: **`pt-stackoverflow` está bloqueada para incorporação** no corpus v1
e v2.

O motivo é independente de qualquer tese sobre obra derivada. O conteúdo continua
CC BY-SA 4.0 — a licença está limpa. O que não está limpo é o **termo de acesso**
do dump: desde 12/07/2024 o download exige login sob termo que exclui "projects
that [...] include training a large language model (LLM)", e os dumps saíram do
archive.org. Sem registro verificável de data e mecanismo de aquisição **mais**
disposição jurídica explícita desse termo, a fonte não entra. Documentar a
limitação não concluiria a tarefa.

**Bloqueada, não apagada.** Apagar a fonte da lista congelada teria sido o
conserto silencioso: o inventário encolhe, todo denominador parece completo, e a
auditoria de vazamento que hoje reconhece um registro `src_ptso` passa a **não
conhecer** a fonte — deixa de reprovar e fica quieta, sobre linhas que existem no
disco de trabalho. Então:

- `humanSources.blockedSnapshots` (em `benchmark/preregistration-v4.json`) nomeia o
  snapshot, a razão (`access-terms-unresolved`) e a condição que levanta o
  bloqueio. O validador recusa uma política que nomeie a mesma base nas duas
  listas: uma fonte não pode estar recusada e em uso ao mesmo tempo;
- `humanSourceAdmissibility` recusa por nome, **acima** da licença e do regime de
  publicação, porque ambos estão corretos e apontar qualquer um deles diria ao
  chamador que há algo a consertar ali. Abaixo da rota, porque B3 recusa a rota
  para toda fonte, e isso é a afirmação mais geral;
- `A1_BLOCKED_HUMAN_SOURCES` (em `benchmark/source-manifest.ts`) preserva a
  declaração — campo de âncora e eixos de dependência —, o que torna a reversão
  barata se a disposição jurídica aparecer.

**Consequência declarada:** o estrato `qa-informal` perde a única fonte que o
alimentava. Na pré-inscrição v4 ele não existe mais em vocabulário nenhum:
`humanCoreStrata` e `preRegistration.quotaAxis.cells` são a MESMA lista de uma
string (`ptwiki`) desde a emenda da moldura de 2026-08-05, e `uncoveredCoreStrata`
está vazio — uma população fora da moldura não é um estrato descoberto, e as duas
listas que as separam são `OUT_OF_FRAME_HUMAN_SOURCES` e `humanSources.blockedSnapshots`.

O piso de poder **deve** reprovar essa célula antes da selagem. O número está
congelado (`powerFloors.samplingUnits: 300`) e o gate que o lê é o gate de
composição (`benchmark/composition-gate.ts`), que conta as duas unidades por
célula em `test`. O que a declaração garante é que a lacuna está escrita no
arquivo onde o denominador vive, em vez de um denominador que encolheu sem aviso.

A consequência já mecânica é outra:
`RELEASE_CORPUS_POLICY.requiredHumanSourceTypes` deixou de exigir `qa-informal`.
Exigir um estrato cuja única fonte a mesma política recusa não tornaria o selo
estrito, tornaria-o **insatisfazível** — nenhum corpus passaria, e a falha leria
como corpus incompleto em vez de requisito impossível.

## Fase 0.2 — o que foi congelado antes de qualquer selagem

> **Seção HISTÓRICA.** Descreve a pré-inscrição v3, hoje `ABANDONADA`, e os valores
> abaixo **não valem**: a **manchete do pior estrato**, o piso de **250** unidades por
> célula, o eixo de cota **por fonte com quatro células** e a cota em **n=250 / n=512**
> estão em ESTADO.md § 6 (NÃO APLICAR). O que vale é
> `benchmark/preregistration-v4.json`, validado por `benchmark/preregistration-v4.ts`,
> dentro de `EVALUATOR_FILES`: família **por célula** sobre **uma** célula, `m = 4`, piso
> de **300**, e a cota em **n=300** (1,4501 %) e **n=800** (0,5463 %). Que o `m` desta
> tabela também seja 4 é coincidência de contagem, não continuidade: a família v3 tinha o
> pior estrato como manchete, a v4 tem um `fpr-<célula>` por célula.

Tudo em `benchmark/rebuild-v3-policy.json`, o par que saiu de `EVALUATOR_FILES`.

| decisão | valor | onde |
| --- | --- | --- |
| família primária, nomeada | FPR do pior estrato core · recall no limiar · calibração global · integridade | `multiplicity.primaryFamily` |
| `m` | 4 | `multiplicity.primaryFamilySize` |
| α por hipótese | 0,0125 — **recomputado** de `familyAlpha / m` no load | `multiplicity.perHypothesisAlpha` |
| cota sob zero eventos | `1 − α^(1/n)`: **1,7375 %** em n=250, **0,8522 %** em n=512 — as duas **recomputadas** no load | `preRegistration.zeroEventCeiling` |
| unidade do inventário de poder | componentes conectados, não linhas | `preRegistration.powerInventoryUnit` |
| piso por célula | 250 unidades independentes; célula abaixo **deve** reprovar antes da selagem — número congelado na Fase 0.2. O piso vigente é 300, e o gate que o lê existe: `benchmark/composition-gate.ts` | `powerFloors.samplingUnits` |
| eixo da cota | **fonte**, quatro células, pooling declarado como perda de resolução | `preRegistration.quotaAxis` |
| partições | `train 45 / dev 5 / cal-A 10 / cal-B 20 / test 20` — soma verificada no load | `preRegistration.partitionFractions` |
| análise primária | 95 % unilateral, marginal por versão (Regime 2) | `preRegistration.primaryAnalysis` |
| candidato elegível | mesmo hash de pesos da v1.0 | `preRegistration.eligibleCandidate` |
| adaptação a feedback público | nenhuma | `preRegistration.publicFeedbackAdaptation` |

Três coisas que valem dizer sobre esse quadro.

**Por que `m` nomeado, e não uma faixa.** O plano carregou "m = 3–6" por um
tempo, e faixa não é pré-registro: com α de família 0,05, o α por hipótese anda
de 0,0167 a 0,0083 nesse intervalo, e a cota em n=250 anda com ele. Pior: a
versão "conservadora" era a autodestrutiva — um `m = 61` anterior dava α =
0,00082 e cota de **2,80 %** em n=250, quando publicar perto de 1 % exigiria 707
registros por célula. Com m=4, 1 % exige n=436.

**Por que a aritmética é recomputada e não conferida à mão.** Os dois tetos e o α
por hipótese estão escritos no arquivo, porque quem audita a cota não deveria
precisar dividir. E estão **derivados** no load, porque escritos-e-não-derivados
é exatamente o defeito que a auditoria externa encontrou: o α de família ficou
0,05 enquanto `m` se mexia, e os números publicados passaram a pertencer a uma
família de tamanho diferente do que o plano alegava. Divergir agora é erro duro.

**Uma divergência preservada de propósito.** `preRegistration
.plannedCertifyingMeasurements` é **1**, e `blindReserveCompleteAttempts`
continua **2**. O corte da reserva de segunda tentativa foi corte de escopo de
engenharia da v1.0, não ordem para recongelar um valor cuja janela fecha em G5.
A divergência fica registrada nos dois lugares em vez de resolvida em silêncio.

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
