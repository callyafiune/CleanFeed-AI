# Revisão crítica do plano de reconstrução do detector

**Data da revisão:** 26 de julho de 2026  
**Documento revisado:** [`detector-rebuild-assessment.md`](./detector-rebuild-assessment.md)  
**Escopo:** corpus, governança, split, treinamento, calibração, avaliação e publicação dos perfis de runtime.

## Parecer executivo

O assessment identificou problemas reais e relevantes: dependência do falso
positivo em relação ao registro humano, confusão entre classe e domínio, datas
sintéticas, inconsistência no identificador das famílias geradoras, baixa
representatividade dos textos mistos e divergência entre treino truncado e
inferência por janelas.

Apesar disso, a metodologia proposta ainda não sustenta uma recalibração
confiável. O estado atual deve ser tratado como **no-go para retreino ou
publicação** até que sejam corrigidos, no mínimo:

1. a falsa independência dos grupos usados no split e no bootstrap;
2. o reúso adaptativo de desenvolvimento e calibração;
3. a distância entre o benchmark genérico e o domínio real do produto;
4. a governança manual registrada apenas como metadado estático;
5. os rótulos de proveniência artificial dos textos mistos.

Esses problemas têm prioridade sobre troca de arquitetura, label smoothing,
mixup ou ajustes marginais de hiperparâmetros.

## O que deve ser preservado do assessment

- O FPR depende fortemente do gênero e da fonte humana.
- Classe, domínio, fonte e registro estão confundidos no corpus atual.
- `createdAt` sintético não permite uma avaliação temporal válida.
- Os identificadores das famílias geradoras não são canônicos entre manifesto,
  split e fatias.
- A classe mista não representa adequadamente o comportamento esperado.
- Treino com um truncamento e runtime com agregação de janelas estão
  desalinhados.
- O próximo corpus deve incluir treino, desenvolvimento, calibração e teste sob
  a mesma governança.
- O teste deve permanecer bloqueado e ser usado uma única vez por versão
  candidata.

## Achados críticos não cobertos

### P0 — A auditoria de leakage é tautológica

O assessment afirma que a disjunção por grupo já funciona porque a auditoria
retorna `leakages: []`. Essa conclusão não é sustentada pelo assembler.

Em [`benchmark/lab/assemble_corpus.py`](../benchmark/lab/assemble_corpus.py), a
função `base_groups` cria valores únicos por registro para:

- `author`;
- `source`;
- `domainSource`;
- `collectionBatch`;
- `nearDuplicate`;
- `derivationRoot`, salvo derivações específicas.

No corpus selado de 10.000 registros, `author`, `source`, `domainSource`,
`nearDuplicate` e `derivationRoot` têm 10.000 valores distintos. Portanto, a
auditoria não demonstra independência entre autores, páginas, tópicos ou
linhagens: ela verifica identificadores construídos para nunca colidir.

Consequências:

- o split agrupado se comporta majoritariamente como split por linha;
- a validação cruzada do calibrador também se aproxima de CV por linha;
- o bootstrap por `record.groups.author` em
  [`benchmark/metrics.ts`](../benchmark/metrics.ts) degenera para bootstrap
  comum;
- intervalos de confiança tratam registros correlacionados como observações
  independentes;
- o tamanho efetivo da amostra é superestimado.

`promptTemplate` e `generatorVersion` fazem parte dos eixos de agrupamento, mas
não são preenchidos de modo consistente. Os candidatos de IA carregam
`pairedWith` e `pairedDomainSource`, porém essa linhagem não é preservada como
grupo atômico no corpus final.

#### Correção exigida

Persistir identificadores reais e pseudonimizados para:

- autor ou colaborador;
- página, post, thread, produto ou documento de origem;
- seed humano;
- prompt template;
- versão do modelo e configuração de geração;
- batch de coleta ou geração;
- raiz de derivação;
- cluster de quase duplicatas.

Toda a árvore composta por seed, geração e derivados deve permanecer na mesma
partição. A auditoria deve publicar quantidade e distribuição dos clusters,
inclusive o número de clusters independentes por fatia.

### P0 — A seleção de limiares é adaptativa e o limite de 95% publicado não a corrige

> **ERRATUM 2026-07-26 (E1).** A primeira redação desta seção intitulava-se
> "Desenvolvimento e calibração são reutilizados de forma adaptativa" e afirmava que
> `train_detector.py` "já usa o desenvolvimento para escolher o checkpoint de maior
> AUC", implicando reúso do mesmo conjunto pelo `fit`. **A afirmação está incorreta e
> foi retirada.** Verificação: `train_detector.py` recebe
> `--dev benchmark/data/dataset/dev.jsonl` (4118 linhas, o artefato de treino
> separado), enquanto `fit.ts` lê a partição `development` do corpus selado (2000
> registros). São artefatos distintos, e a seleção de checkpoint não contamina a
> calibração. O achado P0 **permanece válido por outro mecanismo** — a busca de
> limiares descrita abaixo — e o título foi corrigido para refletir isso.

[`benchmark/commands/fit.ts`](../benchmark/commands/fit.ts) reúne predições de
desenvolvimento e calibração para ajustar calibradores e selecionar limiares. Ambas as
seleções — família de calibrador e par de limiares — ocorrem nos mesmos dados.

Depois disso, o pipeline:

1. compara famílias de calibradores;
2. reajusta o calibrador vencedor;
3. percorre combinações de limiares de documento e localização;
4. escolhe a combinação com maior recall que satisfaz um limite de Wilson.

A busca de limiares em
[`benchmark/calibration-pipeline.ts`](../benchmark/calibration-pipeline.ts) é
explicitamente O(n²). O limite de Wilson usado é pontual e não corrige a seleção
adaptativa entre muitas combinações no mesmo conjunto. Logo, o `upper 95%`
publicado não deve ser interpretado como garantia de 95% para o limiar
selecionado.

#### Correção exigida

Separar as responsabilidades:

- **train:** ajuste dos pesos;
- **dev:** arquitetura, hiperparâmetros, época e política de janelas;
- **cal-A:** escolha e ajuste do calibrador;
- **cal-B:** escolha pré-especificada dos limiares e controle de risco;
- **test:** avaliação cega e de uso único.

Se o volume não permitir dois blocos de calibração, aplicar cross-fitting
agrupado, aninhando seleção de calibrador e limiar. O agrupamento precisa usar
clusters reais, não o `author` sintético atual.

> **ERRATUM 2026-07-26 (E2) — esclarecimento necessário.** A separação `cal-A`/`cal-B`
> acima **não torna o limite de Wilson pós-seleção válido**, e não deve ser lida como
> se tornasse. Ela apenas evita que a escolha do calibrador contamine a escolha do
> limiar. Se o limiar é escolhido em `cal-B`, um limite calculado em `cal-B` continua
> sendo pós-seleção para aquela escolha.
>
> Para que o valor publicado signifique 95%, a certificação precisa vir de uma destas
> três vias:
>
> 1. **teste independente e cego** — escolher o limiar em `cal-B` e reportar como
>    garantia o limite medido no teste, uma única vez (o pipeline já suporta);
> 2. **controle simultâneo** sobre a grade de pares efetivamente avaliados, aceitando
>    o limiar mais conservador resultante;
> 3. **controle formal de risco** (Bates et al., *Conformal Risk Control*), que dá
>    garantia sobre o parâmetro selecionado por construção.
>
> A divisão em cinco partições é condição necessária, não suficiente.

### P0 — O benchmark não representa o domínio declarado do produto

O produto é descrito como detector para conteúdo em português em um feed
profissional. No corpus selado:

- todos os registros têm `platform = generic`;
- todos têm `topic = geral`;
- os 800 humanos classificados como `social-media` são avaliações de produtos
  B2W, não posts profissionais;
- os adaptadores de runtime são normalizados para o pool `generic`.

Uma calibração sobre esse corpus pode medir semelhança com o benchmark genérico,
mas não estima diretamente o FPR em publicações profissionais contemporâneas.
Também existe assimetria: há prompts de IA pedindo posts de rede profissional,
sem uma contraparte humana equivalente.

#### Correção exigida

O desenho ideal teria dois ativos separados:

1. **benchmark in-domain:** textos profissionais contemporâneos, consentidos,
   com a distribuição de comprimento e formato observada no produto;
2. **suíte de robustez/OOD:** Wikipedia, Stack Exchange, Carolina, avaliações de
   produtos e outros gêneros.

Porém, a limitação L1, decidida em 2026-07-26, exclui a aquisição individual
autorizada e restringe o projeto a bases públicas admissíveis. Enquanto não for
identificada uma base pública adequada ao domínio, o primeiro ativo **não
existe**. A suíte pública pode governar apenas uma calibração genérica e
histórica; não pode ser promovida por redação a benchmark do feed profissional.
No domínio real, o produto precisa abster-se ou assumir explicitamente um modo
experimental sem alegação de FPR calibrado. O adendo sobre L1 abaixo detalha as
consequências.

### P0 — A governança manual é metadado estático

O assembler atribui a todos os registros:

- `reviewer_a` e `reviewer_b`;
- `agreement: agree`;
- PII com `status: passed`;
- método `manual-and-automated`;
- um único revisor genérico de PII.

Esses campos são constantes em
[`benchmark/lab/assemble_corpus.py`](../benchmark/lab/assemble_corpus.py). Eles
não constituem evidência de revisão independente, desacordo, adjudicação ou
redaction manual.

#### Correção exigida

Registrar recibos reais contendo:

- identificadores pseudonimizados dos revisores;
- decisão individual;
- desacordo e adjudicação;
- data real da revisão;
- método de detecção e tratamento de PII;
- justificativa ou código de exclusão.

Registros não revisados devem ser marcados como `automated/unreviewed`, sem
simular revisão humana.

### P0 — Os spans mistos não são rótulos de autoria em nível de token

[`benchmark/lab/make_mixed.py`](../benchmark/lab/make_mixed.py) usa
`difflib.SequenceMatcher`: blocos iguais ao texto pai recebem origem `human`;
inserções e substituições recebem origem `ai`.

Esse procedimento mede diferença textual, não proveniência causal. Uma IA pode
ter regenerado, selecionado ou aprovado palavras iguais às do texto original.
Consequentemente, usar diretamente `mixture.spans` para treinar uma cabeça
token-level introduziria ruído sistemático de rótulo.

#### Correção exigida

Separar pelo menos três tarefas:

1. documento integralmente gerado;
2. documento materialmente revisado ou assistido por IA;
3. localização de spans com proveniência observável.

Para a terceira tarefa, usar inserções/concatenações controladas ou um pipeline
que registre cada operação de edição. Textos livremente reescritos devem receber
rótulo document-level de assistência, a menos que a proveniência de cada trecho
seja conhecida.

## Outros pontos fracos

### P1 — Hard negatives não são semanticamente validados

As famílias de hard negative são atribuídas aos primeiros registros
disponíveis de determinados gêneros. Não existe classificação, anotação ou
revisão demonstrando que cada texto apresenta a característica declarada.

O challenge set deve ser curado a partir de critérios observáveis, revisado e
composto por múltiplas fontes e autores.

### P1 — Classe e época do texto estão confundidas

Grande parte dos humanos vem de fontes históricas, enquanto as gerações de IA
são recentes. O detector pode aprender características de época, formatação ou
vocabulário, em vez de autoria.

Sob L1, esse confundimento não tem solução completa com o inventário atual.
Datas sintéticas devem ser removidas das análises temporais; datas reais devem
formar coortes temporais explícitas. O relatório precisa tratar o desempenho em
texto humano contemporâneo como **não medido**, e não como algo corrigido pelo
corte pré-ChatGPT ou pelo pior registro histórico.

### P1 — O heldout de gerador está quebrado em mais de um ponto

O problema de formato `gemini-3.5` versus `gemini-3_5` não afeta apenas a
construção de fatias. O split também compara `generation.family` diretamente
com a lista de famílias retidas. Parte do comportamento atual só funciona
porque o assembler pré-posiciona registros no teste.

Deve existir um identificador canônico validado pelo schema e um invariante
exigindo igualdade exata entre:

- famílias declaradas no manifesto;
- famílias marcadas no split;
- famílias derivadas pela auditoria;
- famílias publicadas nos relatórios.

Prompt template, estratégia de decoding e configuração de amostragem devem ser
eixos de holdout próprios.

### P1 — Os perfis por comprimento não são calibrados por comprimento

[`benchmark/profile-artifact.ts`](../benchmark/profile-artifact.ts) publica três
perfis de runtime, mas copia os mesmos calibradores e limiares globais para
`50-79`, `80-199` e `200-plus`. O comprimento altera apenas o teto de ação
depois do fit.

Isso não demonstra calibração condicional em cada faixa. Se o score variar com
o comprimento, cada perfil pode estar sistematicamente mal calibrado mesmo
quando o ECE global parece aceitável.

Deve-se ajustar e validar calibradores por faixa, usar um calibrador condicional
com regularização ou declarar explicitamente que o score é global e publicar a
calibração por faixa apenas como diagnóstico.

### P1 — `?? 0` exige métricas duplas, não simples exclusão

Erro de inferência não deve ser transformado em score zero. No entanto,
simplesmente retirar erros do denominador também pode fazer um sistema frágil
parecer melhor.

Publicar simultaneamente:

- métricas end-to-end sobre todos os registros elegíveis;
- métricas do classificador condicionais a `status = scored`;
- cobertura e taxa de erro por fonte, classe, comprimento e plataforma.

O estado `error` deve ser um ramo explícito, nunca um score calibrado.

### P1 — Label smoothing não é uma causa demonstrada

Saturação pode resultar de:

- atalhos de domínio, fonte e época;
- separabilidade artificial do corpus;
- treino com cross-entropy;
- composição dos prompts;
- quantização;
- distribuição diferente entre fit e avaliação.

Label smoothing, mixup, focal loss ou Brier loss devem ser comparados em
ablações controladas. Eles não corrigem confounding ou shift de domínio.
Também é recomendável preservar logits no artefato de calibração para permitir
temperature scaling antes de comprimir a saída em probabilidades saturadas.

### P1 — Treinar toda janela com o rótulo do documento cria ruído

Herdar o rótulo do documento para cada janela:

- marca citações e boilerplate como se tivessem a mesma origem;
- é especialmente incorreto para documentos mistos;
- dá maior peso a documentos longos;
- continua divergindo do runtime, que agrega no máximo oito janelas.

É preferível usar aprendizado multi-instance ou hierárquico:

1. amostrar por documento a mesma política de janelas do runtime;
2. agregar os scores;
3. calcular a perda principal no nível do documento;
4. usar perda auxiliar de span apenas onde houver proveniência real;
5. manter peso total semelhante por documento.

### P1 — ECE-15 não deve ser o único gate de calibração

ECE de 15 bins fixos é sensível à escolha dos bins e pode ocultar erro
condicional.

Publicar também:

- Brier score;
- log-loss;
- calibration intercept e slope;
- reliability diagram;
- ECE equal-mass ou estimador com correção de viés;
- métricas por comprimento, fonte e registro;
- intervalos por bootstrap hierárquico.

O gate deve usar intervalo de confiança ou limite superior, não apenas uma
estimativa pontual.

### P1 — O prior do benchmark não é o prior de produção

O conjunto binário tem aproximadamente metade de humanos e metade de
positivos. Em um feed predominantemente humano, um score calibrado nesse prior
não é uma probabilidade posterior de autoria por IA.

É necessário definir o significado do score como:

- risco sob uma distribuição de referência explícita; ou
- evidência relativa, sem alegação de probabilidade real.

Devem ser publicados PPV e NPV sob cenários plausíveis de prevalência e custos
de erro. Um FPR de 5% pode ser operacionalmente alto quando quase todo conteúdo
é humano.

### P1 — Os baselines foram superinterpretados

AUC estilométrica acima do acaso não prova sinal causal de autoria. O sinal
pode vir de pontuação, formatação, fonte, época, template, decoding ou artefato
de preprocessing.

Adicionar:

- baselines de fonte, comprimento, pontuação e char n-gram;
- teste de predição de fonte/domínio a partir dos embeddings;
- permutação de rótulos dentro de blocos pareados;
- leave-one-source-out;
- leave-one-generator-out;
- leave-one-prompt/decoding-out;
- avaliação adversarial com humanização, paráfrase e pequenas edições.

### P1 — O dimensionamento proposto é internamente inconsistente

O assessment estima teste mínimo próximo de 3.300 registros e depois propõe
25% de um corpus total de 11.000. Isso produziria apenas 2.750 registros. Para
3.300 no teste com 25%, seriam necessários pelo menos 13.200 registros.

Esse ainda é um limite inferior otimista: o cálculo deve considerar clusters
independentes, pior fonte e múltiplas fatias pré-especificadas, não apenas o
número total de linhas.

Também é necessário esclarecer a aparente contradição entre manter cada
registro humano nas quatro partições e reservar uma fonte/registro humano
inteiro para o teste. A formulação correta é:

- estratos **core** presentes em todas as partições;
- coortes **OOD** exclusivas do teste.

## Metodologia revisada

### 1. Definir o alvo

Formalizar separadamente:

- texto integralmente gerado por IA;
- texto com assistência material de IA;
- texto com spans gerados localizáveis;
- ação do produto associada a cada caso.

Cada alvo precisa de regra de anotação, métrica e comunicação próprias.

### 2. Construir o corpus

- Usar somente bases públicas com licença e finalidade compatíveis, conforme L1.
- Tratar o corte pré-ChatGPT como redução de risco de contaminação, não como
  prova causal de autoria humana.
- Registrar, por fonte, qual data é observada: criação, última edição, snapshot,
  download ou publicação; elas não são intercambiáveis.
- Manter explícita a ausência de humanos in-domain contemporâneos.
- Preservar grupos e proveniência reais.
- Parear humanos e IA por registro, tópico, comprimento e época.
- Variar modelo, versão, prompt, temperatura, top-p, penalidade de repetição e
  estratégia de decoding.
- Não selecionar exemplos apenas porque o detector atual os considera fáceis.
- Separar corpus de calibração do challenge set.

### 3. Definir o split

Usar componentes atômicos contendo toda a linhagem de derivação.

Uma estrutura possível:

- train: 50–55%;
- dev: 10%;
- cal-A: 10%;
- cal-B: 10%;
- test: 15–20%.

As proporções devem ser ajustadas depois do cálculo de poder por cluster. O
teste deve conter:

- bloco core estratificado;
- geradores não vistos;
- prompts/decoding não vistos;
- fontes humanas não vistas;
- período temporal não visto, quando a data for real;
- conteúdo misto com proveniência;
- ataques e humanização.

### 4. Treinar

- Aplicar a mesma política de janelas do runtime.
- Calcular a perda principal no nível do documento.
- Comparar múltiplas seeds.
- Selecionar checkpoint pelo objetivo operacional pré-registrado, não apenas
  por AUC.
- Executar ablações para smoothing, losses e estratégia de agregação.
- Registrar corpus digest, split digest, commit, ambiente, dependências, base
  model revision, seeds, hiperparâmetros e hash do checkpoint.

### 5. Calibrar

- Não reutilizar dev no fit final.
- Selecionar o calibrador em cal-A.
- Selecionar limiar em cal-B com política pré-registrada ou controle formal de
  risco.
- Considerar calibração condicional por comprimento quando houver evidência e
  volume suficientes.
- Nunca converter erro de inferência em probabilidade.

### 6. Avaliar

Publicar:

- FPR e recall end-to-end;
- FPR e recall condicionais a score válido;
- cobertura e erro de inferência;
- AUC apenas como diagnóstico;
- calibração global e por fatia;
- pior fonte/registro;
- cada família geradora OOD;
- cada coorte mista;
- PPV/NPV em prevalências plausíveis;
- intervalos por clusters reais.

### 7. Gates mínimos

Antes de uma nova publicação:

- zero leakage por grupos reais, sob contrato declarado (ver ERRATUM E3: o que a poda
  atual verifica é hash exato + Jaccard ≥ 0,82, não independência semântica);
- número mínimo de clusters independentes por fatia;
- composição core presente conforme o plano;
- igualdade entre heldouts declarados e observados;
- FPR global e por fonte dentro do orçamento;
- recall mínimo por gerador OOD;
- limite de erro de inferência por comprimento;
- calibração aceitável global e condicional;
- teste cego não consumido anteriormente;
- artefatos de treino e publicação integralmente rastreáveis.

## Correções necessárias no assessment original

1. Remover a afirmação de que a disjunção por grupo já funciona.
2. Não recomendar `fit` final sobre `dev + calib`.
3. Qualificar o problema de `?? 0` com métricas end-to-end e condicionais.
4. Não usar os spans de diff como ground truth token-level.
5. Tratar label smoothing e mixup como ablações, não como causa confirmada.
6. Corrigir a matemática entre tamanho total e proporção de teste.
7. Separar estratos core de coortes humanas OOD.
8. Explicitar que existe seleção do melhor checkpoint por AUC de dev, embora
   não haja interrupção antecipada — deixando claro que esse `dev` é
   `benchmark/data/dataset/dev.jsonl`, do artefato de treino, e **não** a partição
   `development` do corpus selado (ver ERRATUM E1).
9. Adicionar calibração por comprimento ou retirar a aparência de que os três
   perfis foram calibrados separadamente.
10. Substituir poder por quantidade de linhas por poder baseado em clusters
    independentes.

## Ordem recomendada de execução

1. Definir alvo e política de produto.
2. Corrigir o schema de proveniência e os grupos.
3. Corrigir a governança de revisão e PII.
4. Fechar o inventário de bases públicas admissíveis e a evidência temporal de
   cada fonte; declarar o domínio profissional contemporâneo como lacuna não
   coberta.
5. Gerar IA pareada e coortes OOD.
6. Reconstruir o corpus e auditar clusters.
7. Congelar o split de cinco partições.
8. Retreinar com objetivo document-level e política de janelas equivalente ao
   runtime.
9. Ajustar calibrador e limiares em dados independentes.
10. Executar o teste cego uma única vez.
11. Publicar somente se todos os gates pré-registrados passarem.

## Adendo — revisão da limitação L1

**Decisão aceita:** o projeto não fará coleta individual autorizada e usará
somente bases públicas admissíveis. Isso reduz o escopo científico e de produto;
não é uma pendência que um agente possa contornar.

**Parecer sobre a incorporação no plano:** a direção de D1, E4, G2 e H4 está
correta, mas a resposta registrada pelo Claude ainda superestima três garantias
e deixa documentos ativos contraditórios. A aprovação continua **condicional**
aos ajustes abaixo.

### L1.1 — Data anterior ao ChatGPT não prova autoria humana

O corte `< 2022-11-30` prova, quando a data realmente ancora os bytes
observados, que o texto antecede o lançamento do ChatGPT. Ele não prova que o
texto foi produzido integralmente por humano, que é o alvo mais amplo definido
em B2. A API com modelos da família GPT-3 já existia desde junho de 2020
([fonte oficial](https://openai.com/index/openai-api/)); além disso, bots,
templates, tradução automática e outros sistemas de geração precedem o
ChatGPT.

Portanto, L1, B3, D1, o assessment e o comentário de `common.py` devem trocar
“garante/prova autoria humana por construção” por algo como:

> critério temporal de elegibilidade que exclui assistência por ChatGPT e reduz
> substancialmente o risco de geração moderna, mas preserva risco residual de
> automação anterior, tradução, template e proveniência incorreta.

O corpus precisa registrar esse risco como possível contaminação de rótulo e
executar análise de sensibilidade. Nenhum corte de calendário, isoladamente,
estabelece autoria causal.

### L1.2 — O corte atual não é seguro para dumps recentes do Stack Exchange

`extract_stackexchange.py` entrega o `Body` presente no dump, mas filtra apenas
por `CreationDate`. O formato também possui `LastEditDate`
([schema documentado](https://meta.stackexchange.com/questions/2677/database-schema-documentation-for-the-public-data-dump-and-sede)).
Assim, um post criado em 2020 e reescrito em 2025 passa pelo extrator atual.

D1 não pode afirmar que o mecanismo já funciona “independentemente do vintage
do dump”. Para Stack Exchange, deve valer uma das duas regras:

1. usar snapshot integralmente anterior ao corte; ou
2. em dump recente, exigir `max(CreationDate, LastEditDate) < cutoff`, com teste
   de regressão para post antigo editado depois do corte.

As datas das demais fontes também precisam ser nomeadas corretamente:
`Download` no Carolina prova disponibilidade até aquela data; timestamp de
revisão na Wikipédia ancora os bytes daquela revisão; data de submissão no B2W
ancora a avaliação. Chamar todas de “data do documento” esconde contratos
distintos.

### L1.3 — “Pior registro observado” é heurística, não cota no feed

Escolher o limiar pelo pior registro calibrado é mais conservador do que usar a
média, mas não fornece limite superior de FPR para um domínio ausente. Também
pode sobreajustar ao pior valor amostral entre várias fontes.

G2 deve:

- pré-registrar quais registros entram no máximo;
- selecionar usando o máximo dos limites superiores por registro, não apenas o
  maior FPR pontual;
- tratar multiplicidade e tamanhos efetivos por cluster;
- certificar cada registro em dados independentes;
- declarar literalmente que a garantia termina na população pública medida.

Mesmo depois disso, não existe garantia de FPR para feed profissional.

### L1.4 — Conformal não elimina a necessidade do domínio

L1 diz que a garantia conformal fornece cota de acusação falsa “sem precisar do
domínio” e logo depois reconhece que ela depende de *exchangeability*. As duas
afirmações não podem coexistir: mudança de registro ou época quebra justamente
a condição necessária à garantia.

G3 pode certificar risco apenas para a população representada pela calibração
e sob sua hipótese de troca. Deve sair da lista de mecanismos que compensam a
ausência do domínio profissional.

### L1.5 — Reduzir `actionCeiling` mitiga dano, não falso positivo

Um indicador visível ainda é uma inferência positiva sobre o texto. Rebaixar
`blur/hide` para `indicator` reduz a severidade da ação, mas não corrige nem
limita o FPR no feed.

Além disso, o publicador atual emite apenas perfis `generic` e o runtime
normaliza todo adaptador para esse pool. Sob L1, nenhuma plataforma de operação
tem perfil próprio; portanto, a consequência coerente é que **todas** permaneçam
sem ações visuais. E4 precisa decidir explicitamente entre:

1. falha fechada: sem perfil do domínio, não há apresentação; ou
2. indicador experimental por adesão explícita, com motivo visível e sem
   alegação de calibração no domínio.

`actionCeiling` sozinho não expressa essa diferença. Hoje não existe
`DecisionReasonCode` específico para “domínio de implantação não calibrado”; o
plano precisa criar esse estado e provar sua propagação até a interface.

### L1.6 — “Pública” não significa “admissível”, e ausência não se prova

Uma base acessível publicamente pode continuar protegida por direitos autorais,
ter licença incompatível, termos de uso restritivos ou dados pessoais. O
critério operacional deve ser “base pública **com uso de treino/avaliação
documentadamente admissível**”, com R9 aplicado antes do download.

Também é forte demais registrar “não existe base pública licenciada de
publicação profissional pt-BR”. O fato verificável é:

> nenhuma base pública admissível desse domínio foi identificada no inventário
> pesquisado até a data registrada.

O inventário deve guardar consultas, fontes rejeitadas, motivo e data, e pode
ser reaberto sem mudar L1. A própria restrição não torna texto contemporâneo
impossível: registros públicos com evidência de processo podem aparecer, embora
continuem exigindo auditoria de licença e de rótulo.

Quanto às fontes CC, a política conservadora de não comercialidade é defensável,
mas deve ser apresentada como política de conformidade do projeto, não como
conclusão jurídica categórica de que um dataset necessariamente “torna o modelo
não comercial”. A Creative Commons descreve a aplicação das licenças a treino
como dependente do direito aplicável e oferece uma rota conservadora de
conformidade
([orientação oficial](https://creativecommons.org/using-cc-licensed-works-for-ai-training-2/)).

### L1.7 — A decisão ainda não foi propagada pelos documentos ativos

Permanecem incompatíveis com L1:

- `docs/corpus-sources.md` ainda aprova `src_empresa`, `src_proprio` e rotas de
  autorização individual, que não são bases públicas;
- `docs/coleta-doacoes.md` ainda oferece doações como slice opcional;
- `docs/uso-responsavel.md` ainda exige sonda contemporânea com doadores;
- `detector-rebuild-assessment.md`, nas seções 7 e 8, ainda chama aquisição
  consentida in-domain de caminho crítico;
- a versão anterior desta própria revisão ainda recomendava doadores; os trechos
  normativos foram corrigidos neste adendo.

Documentos históricos podem ser preservados, mas precisam de cabeçalho
“superado por L1” e não podem continuar linkados como procedimento vigente.
Perfis que expiram em 180 dias também não resolvem deriva se a reavaliação apenas
repete os mesmos registros históricos.

### Consequência consolidada

Com L1 e o inventário atual, o produto pode ser descrito como detector genérico
de pt-BR avaliado por fonte pública histórica. Não pode ser descrito como
calibrado para publicação profissional contemporânea. Aplicá-lo nesse feed é
transferência OOD sem garantia; a interface e o release devem refletir isso como
estado de primeira classe, e não apenas em uma ressalva textual.

## Adendo — auditoria dos precedentes usados para justificar L1

Auditoria feita em 2026-07-26, nas fontes primárias citadas ou identificáveis. O
resultado não invalida a restrição de recurso L1 nem o uso de bases públicas.
Invalida a narrativa de que o corte temporal prova autoria humana e de que a
literatura verificada é quase unânime ou dispensa coleta instrumentada.

### Resultado por afirmação

| afirmação registrada no plano | veredito | correção necessária |
|---|---|---|
| **PT-Detect (ENIAC 2025, UFOP)** usou Folha 2015–2017 explicitamente para “garantir autoria humana” | **parcialmente falsa** | A fonte primária localizada é uma [monografia de graduação da UFOP de 2025](https://monografias.ufop.br/handle/35400000/7640), não um artigo ENIAC identificado como “PT-Detect”. Ela diz que as datas anteriores à popularização do ChatGPT garantem a coerência da categorização, não prova causal de autoria. O nome, o venue e a citação entre aspas devem sair até existir referência bibliográfica verificável. |
| Jabarian & Imas usaram 1.992 trechos pré-2020 de seis gêneros | **confirmada no núcleo** | O [repositório dos autores](https://github.com/brianjabarian/DetectionAI#study-design) documenta o corte e as fontes públicas. “A auditoria independente mais forte” é superlativo sem critério e deve sair. Além disso, 1.000/1.992 textos são romances; diversidade nominal de gêneros não equivale a balanceamento. |
| Liang et al. usaram TOEFL-91 e Hewlett ASAP | **confirmada, mas superinterpretada** | O [artigo em *Patterns*](https://pmc.ncbi.nlm.nih.gov/articles/PMC10382961/) usa 91 redações TOEFL e 88 redações de oitavo ano do ASAP. Isso prova reutilização de bases preexistentes; o artigo não apresenta o corte pré-ChatGPT como protocolo próprio de certificação de autoria. |
| RAID não declara guarda contra contaminação humana | **falsa** | O [artigo do RAID](https://aclanthology.org/2024.acl-long.674.pdf) declara que a maioria dos textos humanos vem de datasets públicos pré-2022 “to avoid contamination”. A exceção de resumos arXiv filtrados para 2023+ está correta e visa reduzir memorização pelos geradores. Também é correto que não há Wayback Machine. A política do RAID reduz risco, mas continua sem provar autoria humana ampla. |
| MAGE, M4/M4GT, MULTITuDE, MultiSocial e IberAuTexTification usam garantia implícita pela idade | **generalização falsa** | As políticas diferem e precisam ser auditadas por corpus. MultiSocial escolheu dados pré-2022 para elevar a confiança, mas diz expressamente que autoria humana não pode ser garantida em 100% ([apêndice B.1](https://aclanthology.org/2025.acl-long.36.pdf)). MULTITuDE usa MassiveSumm e reconhece ausência de licença do dataset, assumindo permissão para pesquisa não comercial ([ética](https://aclanthology.org/2023.emnlp-main.616.pdf)). IberAuTexTification inclui, entre as fontes “humanas”, OASST2 e outros conjuntos heterogêneos, não uma única coorte antiga ([dataset card](https://huggingface.co/datasets/Genaios/iberautextification)). |
| CoAuthor tem 1.445 redações de 63 escritores | **números corretos, unidade errada** | São [1.445 sessões de escrita](https://cs.stanford.edu/~minalee/pdf/chi2022-coauthor.pdf), criativas e argumentativas, com 63 escritores e quatro instâncias de GPT-3; não 1.445 redações independentes. Autor deve ser a unidade de agrupamento. |
| AITDNA tem 362 textos, 99 autores e histórico de interação | **confirmada, com omissão decisiva** | O [preprint AITDNA](https://arxiv.org/pdf/2606.04906) coletou 452 textos e reteve 362 após filtro, de 99 participantes. Desses, **95 são `human-only`**, escritos sem suporte de LLM na interface. A própria fonte contradiz “ninguém usa doadores para texto humano puro”. É também preprint recente, não precedente consolidado por revisão por pares. |
| Beemo oferece proveniência por trecho e tem 6,5 mil textos de editores pagos | **parcialmente falsa** | Beemo tem 2.187 instâncias, cada uma com versões humana, gerada e editada, somando cerca de 6,5 mil nessas três variantes; os 25 editores receberam acima do salário mínimo. Porém o artigo calcula percentual de edição com `difflib` e deixa **extração de spans** como trabalho futuro. Portanto, [Beemo](https://aclanthology.org/2025.naacl-long.357.pdf) não é exemplo de rótulo causal por trecho. |
| GPTZero publica métricas, mas não origem do corpus humano | **desatualizada/falsa** | A página atual publica origem parcial: OpenReview pré-2022 para revisões acadêmicas, dados “web-scale” não identificados para três domínios e MULTITuDE+CulturaX no multilíngue. Os 0,08% de FPR e 99,60% de recall são médias internas em quatro domínios, não auditoria externa ([benchmark de 2026](https://gptzero.me/news/gptzero-ai-detection-benchmarking-the-industry-standard-in-accuracy-transparency-and-fairness/)). A proveniência continua insuficiente para reprodução integral, mas não é inexistente. |
| Pangram teve 0% de FPR em TOEFL-91, ELLIPSE, ICNALE e PELIC | **falsa** | A [página da Pangram](https://www.pangram.com/blog/how-accurate-is-pangram-ai-detection-on-esl) reporta 0% nos três primeiros e **0,019% no PELIC**, com 0,012% no conjunto da tabela. O fato de as bases serem públicas cria risco de vazamento, mas não prova que entraram no treino; a empresa afirma tê-las mantido fora. |

### Conclusões que não seguem das fontes

1. **“Praticamente ninguém usa doadores” não foi demonstrado.** A lista não é
   revisão sistemática, não define universo, critérios de inclusão nem contagem.
   E o próprio AITDNA contém uma condição `human-only` instrumentada.
2. **“O poço de texto verificavelmente humano está congelado no tempo para todo
   mundo” é falso.** Texto contemporâneo com processo observado existe; o que L1
   estabelece é que este projeto não pode financiá-lo. Restrição local não deve
   ser promovida a impossibilidade da área.
3. **“Nossa política está acima do padrão” só pode se referir à transparência da
   limitação**, não à força do rótulo. Enquanto o plano disser “prova” ou
   “garante por construção”, ele reproduz uma garantia que MultiSocial rejeita
   expressamente.
4. **Repetir uma premissa em trabalhos anteriores não a valida.** Pré-ChatGPT é
   evidência temporal e mitigação de risco; não é observação do processo de
   autoria.
5. **D4 controlada é legítima como conjunto mecanístico de estresse**, porque
   permite conhecer inserções e concatenações executadas pelo pipeline. Ela não
   estima a distribuição de coautoria natural. O próprio AITDNA conclui que,
   exceto CoAuthor, os conjuntos anteriores sintetizam operações que apenas
   imitam coautoria. D4 deve separar `mixed_mechanistic` de qualquer futura
   amostra `mixed_ecological` e limitar as alegações à primeira.

### Mudanças exigidas no plano

1. Substituir a tabela de “garantia declarada” por uma matriz auditável por
   **fonte**, com: data que ancora os bytes, processo de autoria observado ou
   inferido, risco residual de automação, licença/termos, unidade autoral e uso
   permitido.
2. Remover “ninguém”, “quase unânime”, “garante”, “prova” e os superlativos de
   divulgação que não têm protocolo de revisão sistemática.
3. Corrigir a linha do RAID, a identificação de PT-Detect, a unidade do
   CoAuthor, o papel do Beemo e a taxa do PELIC.
4. Não usar os números internos de GPTZero ou Pangram como evidência de
   generalização. Eles demonstram apenas desempenho nas amostras e versões
   declaradas pelos próprios fornecedores.
5. Em D4, exigir `generationMode: mechanistic | ecological` e proibir que a
   curva v0–v8 mecanística seja descrita como prevalência ou desempenho em
   edição humana real.

**Veredito deste adendo:** a observação limitada de que grandes benchmarks
frequentemente reutilizam corpora públicos procede. A justificativa forte
registrada em L1 não procede. L1 continua válida como restrição de recursos, mas
não como “prova por construção” nem como alegação de superioridade metodológica.

## Registro de errata

Correções aplicadas a esta revisão após verificação contra o código e os dados. As
afirmações originais foram preservadas no texto, marcadas em bloco de citação, para
manter o rastro do que foi afirmado e quando.

| id | seção | natureza | estado |
|---|---|---|---|
| **E1** | P0 — seleção adaptativa de limiares | **retratação parcial**: o mecanismo atribuído (reúso do `dev` entre `train_detector.py` e `fit.ts`) é incorreto; os dois `dev` são artefatos distintos. O achado permanece válido pela busca O(n²) de limiares. | aplicada |
| **E2** | P0 — correção exigida | **esclarecimento**: separar `cal-A`/`cal-B` é condição necessária, não suficiente; o limite pós-seleção só se certifica no teste cego, com controle simultâneo, ou com controle formal de risco. | aplicada |
| **E3** | Gates mínimos, "zero leakage por grupos reais" | **qualificação de escopo**: `near_dupes.drop_seen()` prova ausência de sobreposição por hash exato e de quase-duplicata sob o contrato Jaccard ≥ 0,82. Isso **não** é independência semântica — um documento pode tratar do mesmo assunto, citar a mesma fonte ou parafrasear um texto de treino e passar folgado pelo limiar. O gate deve declarar o contrato que verifica, não "independência". | aplicada |
| **E4** | P0 domínio, metodologia e ordem | **mudança de premissa**: a recomendação de obter doadores/in-domain contemporâneos tornou-se inexequível sob L1. O benchmark público passa a sustentar apenas alegações genéricas e por fonte; o domínio profissional permanece não medido. | aplicada |
| **E5** | Adendo L1 | **correção de garantia**: pré-ChatGPT não prova autoria humana ampla; pior registro e conformal não limitam FPR sob mudança de domínio; `actionCeiling` reduz severidade, não taxa de falso positivo. | aplicada |
| **E6** | Precedentes de L1 | **correção factual e de inferência**: RAID declara seleção majoritariamente pré-2022; PT-Detect/ENIAC não foi identificado como citado; AITDNA contém condição humana pura; Beemo não fornece rótulo causal por span; GPTZero publica proveniência parcial; PELIC não teve FPR zero. | aplicada |

O parecer executivo e a classificação **no-go** não mudam com nenhuma destas seis
correções. Os cinco P0 permanecem, com o segundo reformulado por E1/E2.

Contraparte deste registro no documento revisado: seção 9 de
[`detector-rebuild-assessment.md`](./detector-rebuild-assessment.md), que lista as nove
afirmações do assessment corrigidas nas duas rodadas.

## Referências metodológicas

- Dugan et al. [RAID: A Shared Benchmark for Robust Evaluation of Machine-Generated Text Detectors](https://aclanthology.org/2024.acl-long.674/).
- Bates et al. [Conformal Risk Control](https://openreview.net/pdf/482dcb57a6da0d60fce0a3b533b80bcbe99b03f6.pdf).
- Roelofs et al. [Mitigating Bias in Calibration Error Estimation](https://proceedings.mlr.press/v151/roelofs22a.html).
- Zhang et al. [MixSet: Detecting Machine-Generated Text in Mixed Human-Machine Content](https://aclanthology.org/2024.findings-naacl.29/).
