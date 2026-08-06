# Glossário

> Os termos que este projeto usa, com a **área de origem** de cada um e **onde ele morde aqui**. A
> organização é por procedência e não alfabética de propósito: a disciplina que este projeto impõe vem de
> **ensaio clínico** e de **teste de software**, não de machine learning, e ver os termos agrupados assim
> explica por que o repositório se parece mais com um protocolo de fase III do que com um projeto de
> Kaggle.
>
> Onde um termo é **local deste projeto**, está marcado. Onde é **padrão da área**, há a referência que o
> ancora — o detalhe completo vive em [references.md](references.md).

---

## 1. Teste de software

A origem do rigor de verificação. Nada nesta seção é de machine learning; a maior parte é anterior.

**Prova por mutação** (*mutation testing*) — quebrar o código de propósito e conferir que um teste
nomeado fica vermelho. Se a suíte continua verde, o teste não testa o que diz. Campo estabelecido desde
Hamlet (1977) e DeMillo, Lipton & Sayward (1978). Aqui é rito obrigatório de cinco passos: linha de base
verde → mutação → vermelho no teste nomeado → restauração → conferência byte a byte.

**Mutante sobrevivente** — a mutação que passa verde. O canônico da literatura é "matar o mutante"; o
idioma deste repositório é dizer que a guarda **não morde**.

**Morder** — *local deste projeto*, em uso desde 2026-07-23 ([uso-responsavel.md](uso-responsavel.md):
"onde a deriva morde primeiro"). Uma guarda morde quando alguma entrada real a faz falhar. Guarda que
existe, tem teste e passa, mas que nenhuma entrada aciona, não morde — e protege nada.

**As cinco formas de não morder** — *taxonomia deste projeto, montada em 2026-08-05* a partir de defeitos
medidos, cada item mapeando para um conceito conhecido:

1. **ramo inalcançável** — a comparação existe e nenhuma entrada a alcança (medido: três valores de piso
   todos vindos do mesmo `frozenNumber`, logo incapazes de divergir);
2. **asserção pelada** — `toThrow()` sem código nem razão, satisfeito por qualquer exceção, inclusive de
   outro defeito;
3. **guarda no lugar errado** — existe e nenhum caminho de produção a chama (medido: quatro guardas
   podiam sair do `main()` do lab e a suíte ficava verde, porque os testes exercitavam as funções e não o
   `main()`);
4. **verde por construção do fixture** — o fixture satisfaz a condição por acidente, não por invariante
   (medido: guarda que recusava **sem** a mutação, então o teste não provava a injeção que alegava);
5. **guarda medindo um mundo que não existe mais** — o fixture cravava a moldura aposentada, e a
   viabilidade sob a moldura nova não era medida em lugar nenhum.

**Falso verde** — teste que passa por razão errada. **Teste intermitente** (*flaky*) — passa e falha sem
mudança de código; aqui há um caso registrado (`consume-holdout.test.ts`, `ENOTEMPTY` no `rmdir` de
temporário sob contenção; isolado passa 47/47).

**Fixture** — corpo de dados sintético que um teste monta. Regra local: **povoa as cinco partições**, ou
os caminhos das partições vazias ficam vácuos e nada os exercita.

**Guarda** — verificação de invariante em tempo de execução, não em tempo de teste.

**Fail-closed** — na dúvida, recusar. Uma *allowlist* fail-closed recusa o que não está nela, em vez de
aceitar o que não está proibido. Vale para licença por documento, tipologia e lane.

**Forma canônica** — a única serialização admitida de um artefato, para que os **bytes** sejam
comparáveis. O JSON da pré-inscrição só pode ser escrito por `JSON.stringify(canonical, null, 2)` mais
newline, e está no `.prettierignore` porque o Prettier reescreveria arrays curtos e moveria o digest.

**Digest por conteúdo** — identidade derivada dos bytes, não de um nome ou versão. Instâncias aqui:
`datasetDigest`, `splitDigest`, `reportDigest` e o **`evaluatorDigest`**, este último o sha256 do conjunto
fechado de arquivos em `EVALUATOR_FILES` — toda mudança em qualquer um deles move o digest, e é por isso
que ele se calcula **por último** (foi publicado errado duas vezes por ter sido calculado antes do último
conserto).

---

## 2. Estatística e metodologia de ensaio clínico

A origem da disciplina de medição. Também não é de machine learning.

**Pré-inscrição** (*pre-registration*) — congelar hipótese, população, métrica e critério **antes** de
ver o dado, para que a análise não seja escolhida em função do resultado. Vem de ensaios clínicos e da
reforma de replicação da psicologia. Aqui é o arquivo `benchmark/preregistration-v4.{json,ts}`, e é
membro do `EVALUATOR_FILES`.

**Estimando** (*estimand*) — a quantidade que se pretende estimar, definida sobre uma população concreta.
Vocabulário estatístico específico, popularizado pelo adendo **ICH E9(R1)** (2019). É o que sustenta a
frase mais load-bearing do projeto: *"sem moldura amostral não há estimando"* — sem população declarada,
não existe número a estimar, então não há alegação possível.

**Moldura amostral** (*sampling frame*) — a lista concreta de onde a amostra é sorteada. "Texto em pt-BR
em geral" não é moldura; "Wikipédia pt, dump 2022-03-01" é.

**Estrato** e **célula** — subdivisão declarada da moldura sobre a qual se publica um número separado.

**Multiplicidade**, **erro familiar** (*family-wise error rate*), **Bonferroni** — testar várias hipóteses
infla a chance de pelo menos um falso positivo; corrigir divide o α entre elas. Aqui: família de **m**
hipóteses com α = 0,05/m. O projeto foi de m=7 (quatro células) para **m=4** (uma célula), e o α por
hipótese subiu de 0,00714 para **0,0125** — o que **estreita** o teto publicado.

**Teto sob zero eventos** — quando nenhum falso positivo é observado em *n* sorteios, o limite superior
unilateral é `1 − α^(1/n)`. É o limite de **Clopper–Pearson** com k=0; a conhecida "regra de três" (3/n)
é a aproximação disso a α≈0,05. Aqui: 0,55 % a n=800, 1,45 % a n=300. **O número não contém o modelo** —
só n e α. Modelo melhor não estreita o teto; ele só torna mais provável observar zero eventos.

**Unidade independente** — o que pode ser sorteado sem arrastar outro. Não é a linha: linhas do mesmo
autor, documento ou cluster de quase-duplicata são dependentes. Aqui a unidade é o **componente conexo**
sob os eixos de união do split, e o piso é 300 por célula. Um denominador contado em linhas quando as
linhas são dependentes produz intervalo estreito demais — foi por isso que a moldura de quatro células
caiu (o material oferecia 37, 7 e 2 unidades).

**Bootstrap agrupado** — reamostrar clusters em vez de linhas, para que o intervalo respeite a
dependência. `fallbackToIndependentRows: false` fecha a rota para o bootstrap i.i.d. disfarçado.

**Eixo/nível degenerado** — eixo com um único valor, que não distingue nada. Com uma célula,
`domainSource` virou degenerado e saiu da tabela de reamostragem.

**Poder** e **piso de poder** — a capacidade de detectar um efeito; aqui, pisos mínimos de denominador
(300 negativos humanos, 300 unidades, 200 positivos) sem os quais o gate recusa antes de selar.

**Holdout** — partição cega gasta **uma vez**. Consumi-la é irreversível e, sob a política local, a
evidência é publicada **passe ou reprove**.

**Predição conformal** — método de intervalo com garantia de cobertura sob permutabilidade (Vovk,
Gammerman & Shafer). Aqui está **reservado para a v2**, com população `cal-b-humans`.

---

## 3. Machine learning

A parte que é, de fato, da área.

**Backbone** — o modelo pré-treinado que se afina. Aqui, **BERTimbau** (`neuralmind/bert-base-portuguese-cased`,
Souza, Nogueira & Lotufo 2020), BERT pré-treinado em português do Brasil; o candidato descartado foi o
**XLM-R** (Conneau et al. 2020), RoBERTa multilíngue de 100 idiomas. Diferença medida: ~110 M contra
~278 M parâmetros, com o **encoder idêntico** (~85 M) e toda a diferença na matriz de embeddings (22,9 M
contra 192 M).

**Fine-tuning**, **encoder**, **checkpoint**, **seed**, **cross-entropy**, **weight decay**, **warmup**,
**early stopping** — vocabulário de treino. Aqui o treino é pré-fixado e **sem ablação**: seed `712019`,
3 épocas, lr 2e-5, batch 16, AdamW, warmup 0,06, weight decay 0,01. Sem *early stopping*, porque parar
olhando o `dev` é seleção.

**Tokenizer**, **WordPiece**, **SentencePiece**, **fertilidade** — como o texto vira tokens. WordPiece
português de ~30 k contra SentencePiece multilíngue de 250 k. *Fertilidade* (tokens por palavra) é padrão
em NLP/tradução; aqui foi levantada como argumento e **retirada por não ter sido medida**.

**Janela** e **agregação** — documento longo é cortado em janelas de até 512 tokens, cada uma pontuada, e
os escores agregados. O `documentRawScore` é o softmax do próprio head **após** a agregação — o mesmo
escore que o limiar corta.

**Limiar** (*threshold*) — o corte que transforma escore em decisão. Aqui é **provisório e versionado**,
fixado por quantil unilateral 0,95 sobre negativos humanos de `dev + cal-A`, e **sem calibrador
probabilístico** na v1.

**Calibração** e **ECE** (*Expected Calibration Error*, Guo et al. 2017) — se o escore 0,9 corresponde a
90 % de acerto. Medido aqui com 15 bins de massa igual sobre o escore cru. O projeto **não** publica
probabilidade nem confiança numérica, e o ECE existe para limitar a descalibração do head, não para
licenciar linguagem de probabilidade.

**FPR / TPR / recall** — taxa de falso positivo, verdadeiro positivo, e a fração de positivos recuperada
no limiar. A manchete deste projeto é FPR, porque acusar texto humano é o erro caro.

**Vazamento** (*leakage*) — informação do teste chegando ao treino. **Group split** (`GroupKFold`) —
manter todas as linhas de um mesmo grupo na mesma partição. **Out-of-fold** — previsões geradas por
modelos que não viram aquele exemplo, requisito para empilhar modelos sem vazar.

**OOD** (*out-of-distribution*) — fora da distribuição de treino. Aqui as famílias OpenAI ficam
**reservadas** como teste de **gerador não visto**: nenhuma entra em treino.

**Hard negative** — o exemplo negativo difícil, que o modelo erra. *Hard negative mining* é acrescentá-los
progressivamente; aqui as seis famílias são de **estilo** (formulaico, motivacional, polido, repetitivo,
não nativo, estrutura corporativa) e estão congeladas na política.

**Ablação** — remover um componente para medir sua contribuição. Aqui é **proibida na v1**: cada variante
é uma decisão que nada mediu, e o orçamento é de **uma** medição certificadora.

**Ensemble**, **meta-classificador**, **stacking** — combinar modelos. Fora do escopo da v1, pela mesma
razão.

**Validação adversarial** — treinar um classificador auxiliar para prever de onde o dado veio (partição,
fonte, pipeline). Se a **partição** é previsível, há vazamento ou deslocamento. Idioma da comunidade de
competição, não da academia. Aqui virou sonda, e só a de partição **decide**.

**Estilometria** — medir estilo por atributos superficiais (tamanho de frase, diversidade lexical,
pontuação, conectivos). Anterior a ML, de linguística computacional e atribuição de autoria. Aqui é
**diagnóstico**: existe para dizer em que sinal o modelo se apoia, não para competir.

**Zero-shot** — detectar sem treinar um classificador, usando um modelo de linguagem para pontuar
(perplexidade, log-rank, DetectGPT, Fast-DetectGPT, Binoculars). Fora do escopo da v1.

**TF-IDF** e **n-gramas** de palavra e de caractere — baseline lexical barato. Aqui o papel dele não é
competir: é ser **detector de vazamento** (desempenho alto demais indica artefato de fonte ou formatação),
e n-grama de **caractere** é o que pega artefato tipográfico que n-grama de palavra atravessa sem ver.

**Deriva** (*drift*) — a distribuição muda com o tempo; modelo novo que não existia no treino é o caso
mais duro.

**ONNX**, **opset**, **quantização INT8**, **paridade fp32→int8** — empacotar o modelo para rodar fora do
framework de treino, com pesos de 8 bits, provando que o veredito não muda. Aqui o teto de bytes está
ancorado num export medido (109.681.931 bytes, teto 130.000.000 com 18,5 % de folga declarada).

**Model card** (Mitchell et al. 2019) e **datasheet / data card** (Gebru et al. 2018) — os dois artefatos
de governança que **são** nativos de ML. Aqui o datasheet é **seção** do model card, não artefato
separado.

---

## 4. Corpus e proveniência

**Corpus**, **dump**, **snapshot** — o material e a versão concreta e imutável dele.

**Lote de aquisição** (`sourceMaterialBatch`) — um evento de download de um instantâneo. Um download da
Carolina cobre as três tipologias: são **partições de uma aquisição**, não três aquisições. É eixo de
**registro, manifesto e ledger**, e deliberadamente **não** entra na união do split, porque um lote por
fonte tornaria a célula um bloco indivisível.

**Proveniência** — de onde cada documento veio, verificável por terceiro. A ausência dela foi o que
derrubou três células: sem autor por documento e com um host, o material não sustenta independência na
escala que a alegação exige.

**TEI** e **header TEI** — o padrão de marcação de corpora e o cabeçalho por documento que carrega data,
licença, autor e URL.

**Corte de data** — o rótulo `human` vem de **campo de data do documento**, nunca de declaração; aqui,
anterior a 2022-11-30 (pré-ChatGPT).

**drop_seen**, **quase-duplicata**, **Jaccard**, **shingles de 5 tokens** — a poda de material repetido:
hash exato do normalizado mais similaridade de Jaccard ≥ 0,82 sobre janelas de 5 tokens. *MinHash* e *LSH*
são as técnicas padrão para fazer isso em escala.

**Linhagem**, `humanSeed`, `derivationRoot` — qual texto humano gerou ou foi editado para produzir aquela
linha. É o que mantém pai e filho na mesma partição.

**Lane de geração** — uma combinação congelada de provedor, modelo e harness. Contaminação acima de 2 %
numa família manda **regenerar a lane inteira**: poda seletiva mascara o viés da lane.

**Gate antiartefato** — recusa, antes do treino, texto gerado que entrega o rótulo de graça: eco de
prompt, recusa do modelo, metaconversa, assinatura de harness, e a assinatura **tipográfica** (espaço
anômalo, encoding, caractere invisível, Markdown, cabeçalho, frase-padrão de prompt).

**PII** e **pseudonimização** — dado pessoal e sua remoção. A auditoria aqui é **amostral** e não produz
aprovação por registro.

---

## 5. Governança deste projeto

*Todos locais.* Vocabulário medido no repositório, anterior a esta sessão salvo indicação.

**Caminho selado** — as unidades cujo resultado entra no digest do avaliador. Exigem três etapas:
verificação de desenho → implementação contra o contrato → **cross-review adversarial**.

**Partições cegas** — `test` e `cal-B`, privadas e byte-intocadas. Ninguém as lê; contá-las não é lê-las.

**Botão do operador** — ação irreversível que nenhum agente executa: `consume-holdout`, publicação
externa, assinatura de licença.

**Decidir–registrar–ratificar** — o agente decide ancorado no escopo, registra razão e custo de reversão,
e **não para**. Ratificação só antes de marco irreversível.

**Nunca delegado** — lista curta e fechada: risco jurídico pessoal, calendário, botão de publicação, ler
partição cega ou ledger real, dinheiro além do teto.

**Fonte da verdade** — [ESTADO.md](ESTADO.md) diz o que **é** e é **sobrescrito**, nunca acrescentado; o
[registro de decisões](superpowers/plans/2026-07-30-registro-de-decisoes.md) traz a **razão**; o
[plano](superpowers/plans/2026-08-03-plano-entrega-modelo.md) traz o roteiro. Precedência: **código
medido** vence tudo, inclusive o ESTADO.

**Ratificado / retratado** — decisão confirmada pelo operador; e afirmação anterior marcada como
retirada, em vez de reescrita — o registro não reescreve história, retrata.

**Divergência** (`D0`–`D35`) — item medido em que o código implementado discorda do ESTADO. **Conforme**
(`C0`–`C17`) — o inverso.

**Over-claim** — alegar mais do que o material sustenta. É o defeito que o projeto existe para não
cometer, e o que derrubou a moldura de quatro células: os nomes prometiam populações que o corpus não
amostrava.

**Fatia** (*slice*) — recorte sobre o qual um número é reportado separadamente.

**Ledger de exposição** e **lease de mão única** — o registro de que material foi visto, e a marca de
consumo que não volta atrás. *Ledger ausente não significa bloco não gasto.*

**Regime 2** — cada release certifica **só a própria hipótese versionada**; erro familiar ao longo da
história do produto não é alegado, e **toda** execução certificadora é publicada, passe ou reprove.

---

## 6. Licenciamento

**CC BY-SA 4.0**, **CC BY-NC-SA 4.0**, **CC BY-NC-ND 4.0**, **ODC-By**, **Lei 9.610 art. 8º, I** (atos
oficiais, não protegidos) — as licenças do material. Medido: **100 %** dos documentos das tipologias da
Carolina declaram `cc by-nc-sa 4.0`; a Wikipédia é `cc-by-sa-4.0`.

**Share-alike** e **NC** — obrigação de licenciar o derivado igual, e proibição de uso comercial. A tensão
entre as duas é o argumento central da posição (a): `cc-by-sa-4.0` **proíbe acrescentar restrição** (logo
proíbe NC) enquanto o share-alike de `cc-by-nc-sa-4.0` **exige** NC no derivado — nenhum artefato obedece
às duas, e regra que não pode ser cumprida não pode ser a regra.

**Posição (a)** — as obrigações das fontes regem **aquisição, preparação e uso do corpus** e não se
propagam aos pesos; o regime não comercial dos pesos é **política própria**, escolhida. Declaradamente
**não é consenso jurídico**.

**OpenRAIL-M** — família de licença que combina liberdade de uso com restrições comportamentais. A dos
pesos aqui é `cleanfeed-weights-nc-1.0`.

**Gated** — no Hugging Face, acesso condicionado a aceitação de termos.

**NOTICE / ATTRIBUTION** — os arquivos que cumprem a obrigação de atribuição.

---

## 7. Procedência dos termos, em resumo

| origem | o que vem de lá |
|---|---|
| **teste de software** | prova por mutação, mutante sobrevivente, falso verde, flaky, fixture, guarda, fail-closed, forma canônica, digest por conteúdo |
| **estatística e ensaio clínico** | pré-inscrição, estimando, moldura amostral, estrato, multiplicidade, Bonferroni, Clopper–Pearson, teto sob zero eventos, unidade independente, bootstrap agrupado, poder, holdout, conformal |
| **machine learning** | backbone, fine-tuning, tokenizer, janela e agregação, limiar, ECE, FPR/TPR, vazamento, group split, out-of-fold, OOD, hard negative, ablação, ensemble, validação adversarial, zero-shot, TF-IDF, ONNX/INT8, model card, datasheet |
| **linguística computacional** | estilometria, atribuição de autoria, TEI |
| **local deste projeto** | morder, caminho selado, partições cegas, botão do operador, decidir–registrar–ratificar, Regime 2, over-claim como critério, divergência/conforme numerados |
| **montado nesta sessão** | as cinco formas de não morder |

A leitura que essa tabela permite: o núcleo metodológico **não é de ML**. Machine learning como área é
frouxa exatamente nos pontos que aqui são invioláveis — não pré-registra hipótese, raramente corrige
multiplicidade, e reusa benchmark até esgotá-lo. Existe literatura de reforma dentro de ML apontando isso,
e dela vêm o model card e o datasheet; mas as ferramentas conceituais que resolvem o problema foram
importadas de ensaio clínico e de engenharia de software.
