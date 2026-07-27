# Reconstrução do detector — plano de implementação ponta a ponta

> **Origem.** A execução selada de 2026-07-25 terminou em `reject` (13 de 61 gates).
> O diagnóstico está em [`docs/detector-rebuild-assessment.md`](../../detector-rebuild-assessment.md);
> a revisão crítica e as errata em [`docs/detector-rebuild-critical-review.md`](../../detector-rebuild-critical-review.md).
> **Leia os dois antes de executar qualquer tarefa daqui.** Este plano não repete o
> diagnóstico; ele o traduz em trabalho.
>
> **Veredito de partida: no-go para retreino ou publicação.** Cinco bloqueios P0 —
> proveniência/grupos fictícios, governança simulada, ausência do domínio do produto,
> spans de diff usados como proveniência, e incerteza pós-seleção nos limiares — têm
> prioridade sobre backbone, suavizamento de rótulo e hiperparâmetro.
>
> Nome do candidato: **`cleanfeed-ptbr-v3`**. A v2 (`cleanfeed-ptbr-v1`, digest
> `d8f77f87…`) permanece intacta em disco como referência a ser batida.

## Como usar este documento

Cada tarefa é autocontida: objetivo, por que existe, arquivos, mudança, verificação e
critério de conclusão. Uma tarefa só pode começar quando as de `Depende de` estiverem
concluídas. Se a execução divergir do escrito, **atualize este documento na mesma
entrega** — um plano que mente é pior que nenhum.

Convenções herdadas do repo: código em `.worktrees/cleanfeed-mvp`, commits com
`--no-verify` (hook de nome de branch da organização), Python é bancada e TypeScript é
a esteira selada.

### Contrato de execução sem decisões pendentes

Este plano não delega escolhas de produto ou de método ao implementador. Os valores
abaixo são a fonte de verdade e serão materializados por A6 em
`benchmark/rebuild-v3-policy.json`, validados por
`benchmark/rebuild-v3-policy.ts` e incluídos em `EVALUATOR_FILES`. Código não pode
repeti-los como constantes soltas.

| decisão | valor congelado |
|---|---|
| uso e licença | produto e modelo **não comerciais**; Carolina permanece admissível; atribuição e share-alike são obrigatórios |
| alvo do produto | indicar **compatibilidade textual com geração por IA**, nunca inferir autoria, intenção ou processo real |
| positivo integral | `label = ai`, documento integralmente gerado por pipeline registrado |
| assistência material | `label = mixed`, `generationMode = mechanistic` e `aiFraction >= 0.50`; autoriza somente aviso/`indicator`, nunca ação visual |
| localização | spans observados avaliam/treinam a cabeça auxiliar; não criam alegação autônoma nem autorizam `blur`/`collapse`/`hide` |
| misto abaixo de 50% | fatia diagnóstica da curva v0–v8; não é positivo nem negativo de gate |
| estratos humanos core | `qa-informal`, `encyclopedic`, `social-media`, `university`, `institutional` |
| faixas de perfil | `50-79`, `80-199`, `200-plus`; menos de 50 palavras é abstenção |
| coorte temporal | quartis de `createdAt` real dentro de cada fonte, congelados antes do split; fonte com menos de 4 timestamps distintos ou sem poder usa `notApplicable` |
| famílias hard-negative | `formulaic`, `motivational`, `highly-polished`, `repetitive`, `non-native`, `corporate-structure` |
| fontes humanas v3 | somente os snapshots locais já presentes de pt.stackoverflow, ptwiki, B2W-Reviews01 e Carolina; cada byte é digestado, não há novo download |
| backbone | `neuralmind/bert-base-portuguese-cased`; não haverá bake-off de backbone nesta reconstrução |
| seeds de ablação | `712019`, `712020`, `712021`, `712022`, `712023`; checkpoint publicável usa `712019` |
| seeds de infraestrutura | split `20260726`, CV `20260727`, bootstrap `20260728` |
| bootstrap | 10.000 réplicas no piloto; 100.000 na medição de release; nunca reduzir por tempo |
| treino | 3 épocas, batch 16 documentos, AdamW `lr=2e-5`, `weight_decay=0,01`, warmup linear 6%, gradiente em fp32/autocast só no forward; época escolhida pelo objetivo de F3 |
| tamanho do ONNX INT8 | no máximo **109.681.931 bytes**, o tamanho do ONNX da v2 |
| orçamentos de FPR | aviso `0,05`; ação visual `0,02` |
| construção do aviso | split conformal unilateral em humanos de `cal-B`, por faixa de perfil e pior estrato; `0,025` para o caminho documental e `0,025` para o localizado |
| construção da ação | split conformal unilateral em humanos de `cal-B`, por faixa de perfil e pior estrato; `0,02` no caminho documental |
| comparador de runtime | `score >= nextUp(quantil)`; empates no quantil ficam do lado não acusado |
| calibrador | Platt, beta e isotônico competem em CV agrupada de 5 folds; vence menor Brier OOF; empate absoluto `<= 1e-4` favorece Platt, depois beta, depois isotônico |
| escopo da calibração | calibrador **global** por caminho; resultados por comprimento são diagnósticos; limiares conformais são específicos por faixa |
| multiplicidade do teste | intervalos individuais de 95% para descrição e intervalos unilaterais simultâneos por Bonferroni, `alpha_família = 0,05`, para todos os gates estatísticos de release |
| paridade bruta | `meanAbsDelta <= 0,02`, valores todos finitos; inversão em 0,5 é diagnóstico |
| paridade operacional | **zero inversões** em `dev + cal-A + cal-B` em cada limiar congelado; falha reprova o export, sem relaxar tolerância |
| reserva cega | inventário precisa sustentar **duas tentativas completas no total**: a publicação corrente e uma substituição independente |
| validade do perfil | 180 dias |
| rollout | v3 usa `bundle-verified -> shadow` (só desenvolvimento) -> `indicator`; `actions` permanece no contrato, mas não é promovido sem perfil de plataforma, inexistente sob L1 |

Seleções condicionadas a dados também são mecânicas: quando um critério desta tabela ou
de uma tarefa não é satisfeito, a saída é `reject`, `indicator-only`,
`insufficient-power` ou tarefa não concluída, conforme indicado. O agente **não pergunta
qual alternativa adotar**, não troca o estimando e não afrouxa gate.

Há 46 tarefas. `D0b` é um id deliberado, executado imediatamente após o piloto D0; não
existe E1. A Fase E começa em E2 porque o dimensionamento precisa bloquear a coleta D1,
e portanto pertence ao caminho D0 → D0b → D1.

### Protocolo comum de cada tarefa

1. Ler o corpo da tarefa e as dependências; não inferir dependência por proximidade.
2. Escrever primeiro o teste de aceitação citado, confirmar que falha pela razão esperada
   e só então alterar a implementação.
3. Rodar a verificação específica da tarefa e, antes de encerrar, `npm run
   typecheck:benchmark` para mudanças no benchmark ou `npm run typecheck` para mudanças
   compartilhadas com o runtime.
4. Registrar artefatos de bancada em `benchmark/out/rebuild-v3/<tarefa>/`; esse diretório
   é ignorado pelo Git. Artefatos publicáveis só entram na allowlist de evidência em H1.
5. Uma tarefa de dados que dependa de revisão humana real falha fechada se o recibo não
   existir. Agente não inventa revisor, consentimento, data, licença nem proveniência.
6. Cada commit contém uma tarefa ou um grupo explicitamente inseparável e inclui plano,
   código e testes coerentes. G5 exige a árvore limpa; este documento não autoriza
   `reset`, descarte de alterações alheias nem consumo antecipado do holdout.

Entradas operacionais obrigatórias, não decisões de desenho: GPU capaz de treinar o
backbone, acesso às seis famílias fixadas em D3, dois revisores para D5, 20 GiB livres em
H1 e o keyring/backup privado de C3. Ausência de uma delas deixa a tarefa `blocked`; o
agente não substitui modelo, reduz revisão, diminui amostra nem troca fonte.

---

## Glossário dos termos que já causaram erro

Vários defeitos corrigidos durante a redação deste plano envolveram **uma palavra com dois
sentidos**. Busca textual não resolve esse tipo de inconsistência: `grep "tupla"` acha as
duas leituras e não sabe distinguir. A defesa é nomear os conceitos separadamente e
registrar a leitura que não deve ser inferida. Ao editar este documento, confira aqui
antes de usar qualquer um deles.

| termo | sentido correto aqui | leitura errada que já causou defeito |
|---|---|---|
| **registro-linha** | uma linha/documento do corpus | usar `registro` sem qualificador quando a frase também admite a leitura linguística |
| **registro linguístico** / **estrato** | gênero ou variedade linguística que precisa de cobertura nas partições previstas | confundir com registro-linha; um registro-linha pertence a uma partição, um estrato contém muitos registros-linha |
| **tupla** | `datasetDigest`+`splitDigest`, o identificador que o ledger grava | supor que tupla nova restaura cegueira — ela não restaura (R2, H3b) |
| **eixo de agrupamento** | uma dimensão observável de dependência, como autor, página, thread, seed, prompt ou gerador | tratar qualquer eixo como identificador sintético por registro-linha |
| **cluster de split/exposição** | componente conectado pela união dos eixos aplicáveis; governa co-localização no split e elegibilidade futura para teste | supor que é automaticamente a unidade de reamostragem de toda métrica |
| **unidade de reamostragem** | eixo ou combinação hierárquica/multiway escolhida **por estimando** (C4) | supor que existe um único "cluster real" que serve igualmente para split, CV e todas as métricas |
| **dev** | duas coisas distintas: `benchmark/data/dataset/dev.jsonl` (artefato de treino) **e** a partição `development` do corpus selado | confundir as duas — gerou uma acusação falsa de reúso adaptativo |
| **não sobreposição textual** | ausência de hash exato e de quase-duplicata sob o contrato Jaccard ≥ 0,82 (R7) | chamar isso de independência semântica ou amostral |
| **independência amostral** | separação pelos eixos de agrupamento aplicáveis e inferência com unidade adequada ao estimando | inferi-la apenas da ausência de duplicatas textuais |
| **garantia** | cota condicionada, com a condição enunciada | prova; "por construção"; "garantido" (L1, B3, D1, H4) |
| **`labelBasis`** | base de evidência do rótulo **somente para `label = human`**: `date-cutoff` ou `observed-process` | atribuí-la a IA/misto, ou usar poucos casos `observed-process` para elevar a alegação do conjunto inteiro |
| **generatorFamily** | um único campo canônico, validado por schema | as duas grafias `gemini-3.5` e `gemini-3_5`, que quebraram fatia **e** split (3.3, A4) |
| **createdAt** | data real do texto | seletor de partição — foi o que o montador gravou, e por isso o split "temporal" não era temporal (3.4) |
| **misto mecanístico** vs **ecológico** | `mechanistic` = edições que nós executamos e registramos; `ecological` = coautoria humana observada | descrever resultado `mechanistic` como desempenho em edição humana real (D4) |
| **F5** | não existe: são **F5a** (paridade bruta) e **F5b** (paridade nos limiares) | referência solta a "F5", que já deixou uma dependência órfã |

Regra prática: se uma frase deste plano depende de qual sentido o leitor escolher, ela está
mal escrita. Reescreva até não depender.

## Limitações declaradas do projeto

Restrições de recurso, não de método. Elas não invalidam nada, mas **limitam o que pode
ser afirmado**, e por isso vêm antes das regras. Qualquer material sobre o detector —
relatório, README, divulgação — tem de ser consistente com esta seção.

### L1 — Sem coleta individual autorizada; só bases públicas

Decidido em 2026-07-26 (B3). O projeto não realizará coleta individual própria: não
recrutará doadores, não obterá consentimento por documento e não registrará sessões
próprias de escrita. Bases públicas que já contenham sessões instrumentadas continuam
admissíveis, sujeitas às verificações de licença, idioma, proveniência, poder amostral e
adequação ao estimando; a restrição é de aquisição, não de categoria de evidência.

**O que o corte de data faz, e o que não faz.** O corte `< 2022-11-30` (pré-ChatGPT), já
padrão em `common.py:149` e já política em `docs/corpus-sources.md`, é **evidência
temporal e mitigação de risco** — não observação do processo de autoria e não prova.
Ele torna implausível o uso de ChatGPT; não elimina assistência por ferramentas
anteriores, nem tradução automática, nem geração por modelos pré-2022, nem republicação
de texto com data enganosa. O MultiSocial, que adotou a mesma política, declara
expressamente que a autoria humana **não pode ser garantida em 100%**, e essa é a
formulação correta.

Ao escrever sobre isso — relatório, README, divulgação — use "mitigação declarada", nunca
"prova" nem "garante".

**O corte de data é prática difundida**, o que torna a nossa posição comum na área — não
superior a ela. Matriz auditável por fonte, verificada na fonte primária em 2026-07-26.
Cada linha nova de corpus tem de preencher esta mesma matriz antes de entrar (**R9**):

| corpus | data que ancora os bytes | processo de autoria | risco residual de automação | declarado pelos autores? |
|---|---|---|---|---|
| **RAID** (ACL 2024) | maioria **pré-2022** | inferido | baixo na maioria; **arXiv filtrado para ≥ 2023**, pós-ChatGPT, sem tratamento | **sim, textual**: *"To avoid contamination, most of our human-written documents are taken from publicly available pre-2022 datasets"* |
| **Jabarian & Imas** (NBER WP 34223) | **pré-2020** | inferido | baixo | sim; ressalva: ~1.000 dos 1.992 são romances — diversidade nominal ≠ balanceamento |
| **Liang et al.** (*Patterns* 2023) | TOEFL-91 + ASAP, pré-ChatGPT | inferido | baixo | usa bases preexistentes; **não** apresenta o corte como protocolo próprio de certificação |
| **MultiSocial** (ACL 2025) | pré-2022 por escolha | inferido | **os autores declaram que autoria humana não pode ser garantida em 100%** | sim, com a ressalva |
| **MULTITuDE** (EMNLP 2023) | MassiveSumm | inferido | não auditado aqui | reconhece ausência de licença do dataset |
| **IberAuTexTification** | heterogêneo (inclui OASST2) | inferido | **não é coorte antiga única** | licença `cc-by-nc-nd-4.0` (ver D2) |
| **AITDNA** (preprint 2026) | contemporâneo | **observado, instrumentado** | muito baixo | 452 coletados → 362 retidos, 99 participantes, **95 `human-only`** |
| **CoAuthor** (CHI 2022) | contemporâneo | **observado, instrumentado** | muito baixo | **1.445 sessões de escrita** (não redações independentes), 63 escritores |
| detecção em pt-BR (UFOP) | Folha, 2015–2017 | inferido | baixo | **monografia de graduação**, não artigo com referência verificável — não citar como "PT-Detect/ENIAC 2025" |

**Doadores existem, e em escala pequena.** O AITDNA tem **95 textos `human-only` de
participantes recrutados** em interface instrumentada. Logo é **falso** dizer que a área
não usa doadores. A afirmação sustentável é aritmética: **nenhum conjunto instrumentado
existente chega à escala de calibração.** Nosso piso é 300 negativos humanos **por fatia
crítica**, e com zero falsos positivos: n=95 dá limite superior unilateral de **2,77%**;
para ficar abaixo de 1% são necessários **268** (é por isso que o piso do pipeline é 300 —
ele rende 0,894%). Coletar texto contemporâneo instrumentado é possível e alguém já fez;
**este projeto não pode financiá-lo**, e isso é restrição local, não impossibilidade da
área.

**Proveniência por trecho é problema separado.** O corte de data dá rótulo de documento,
nunca de trecho. Das fontes acima, só as instrumentadas têm proveniência causal por
trecho — o **Beemo** (2.187 instâncias × 3 variantes ≈ 6,5 mil, 25 editores pagos) calcula
percentual de edição com `difflib` e deixa extração de spans como trabalho futuro, o mesmo
defeito que 3.5 descreve no nosso caso.

Como não temos doadores, D4 obtém proveniência por **construção controlada**, e isso vem
com um limite que precisa estar no schema e no relatório, não numa ressalva: ela é um
conjunto **mecanístico de estresse** — mede se o modelo localiza trecho de IA cuja origem
é conhecida — e **não estima a distribuição de coautoria natural**. A distribuição de
edições é a nossa. Ver D4, campo `generationMode`.

**O que isso compromete, e é definitivo:**

| limitação | consequência prática |
|---|---|
| O rótulo humano fica ancorado em texto **pré-nov/2022** | "público + contemporâneo + verificavelmente humano" é quase contraditório depois dessa data |
| Não existe base pública licenciada de **publicação profissional pt-BR** | o FPR no domínio de operação do produto **não será medido** |
| O falso alarme varia de **0% a 7,12%** entre os estratos linguísticos disponíveis | extrapolar dos estratos calibrados para o feed é inferência **sem cota superior** |

**Como o projeto responde a isso**, em vez de ignorar:
1. **Limiar escolhido contra o pior estrato linguístico calibrado**, não contra a média
   (G2).
2. **Teto de ação rebaixado** em plataforma sem perfil calibrado, com motivo exposto ao
   usuário (E4).
3. **Garantia conformal unilateral** sobre texto humano, que é o que dá cota de acusação
   falsa sem modelar a distribuição de geradores (G3) — mas ela exige exchangeability do
   domínio humano e não cobre mudança de estrato linguístico.
4. **Comunicação como detector de pt-BR genérico**, nunca como calibrado para feed
   profissional (H4).

### L2 — Detector local de ~106 MB em WASM

O vencedor do PAN 2025 é um Qwen3-14B e faz 0,6995 de ROC-AUC fora de distribuição; o
melhor sistema em autoria mista de 6 classes faz 64,46% de recall macro. Não vamos bater
isso, e o produto precisa ser desenhado em torno de abstenção e cota de acusação falsa —
não de recall (H4).

### L3 — Licença de origem pode restringir o modelo resultante

Carolina é CC BY-NC-SA 4.0 e representa 1600 dos 4000 humanos do corpus atual. O projeto
declarou em B1 que o produto e o modelo **não têm e não terão ambição comercial**.
Carolina permanece no inventário admissível, e o modelo, o bundle, os avisos e a
documentação carregam atribuição, share-alike e restrição não comercial. Não há ramo
comercial pendente neste plano.

## §0 Regras invioláveis

Quebrar qualquer uma destas invalida o trabalho a jusante. Elas existem porque cada uma
corresponde a um erro já cometido.

**R1 — A janela `fit` → `consume-holdout` é congelada.**
`EVALUATOR_FILES` ([`benchmark/digests.ts:57`](../../../benchmark/digests.ts#L57)) cobre
**a lista exportada por `benchmark/digests.ts`; a contagem é derivada, nunca fixada** —
inclui hoje `benchmark/commands/score.ts`, `benchmark/commands/consume-holdout.ts`,
`benchmark/prediction-shards.ts`, `benchmark/browser-scorer.ts` e (desde A1)
`contracts/failure-detail.ts`. Editar qualquer um deles depois do `fit` reprova
`integrity.evaluator-digest` e **queima a concessão do holdout**. Foi exatamente isso
que aconteceu em 2026-07-25.

A1 já adicionou `contracts/failure-detail.ts`; C3 adicionará
`cluster-exposure-ledger.ts`; A6 adicionará a política; G2 adicionará
`conformal-thresholds.ts`. Portanto nenhum gate, teste, prosa ou procedimento pode fixar
a cardinalidade da lista: a fonte de verdade é a lista exportada por `digests.ts`.

A regra é sobre a **fronteira G5**, não sobre fase: **toda tarefa que toca esses arquivos
tem de terminar antes de G5**, e várias delas estão em F e G, não só em A–E. Verificado
contra `digests.ts`, estão em `EVALUATOR_FILES`:

| tarefa | arquivos em `EVALUATOR_FILES` |
|---|---|
| A1–A7 | `commands/evaluate.ts`, `metrics.ts`, `gates.ts`, `slices.ts`, `split.ts`, `schema.ts`, `dataset-manifest.ts`, `report.ts`, `prediction-schema.ts`, `calibration-pipeline.ts`, `rebuild-v3-policy.ts`, `rebuild-v3-policy.json`, `digests.ts` |
| B2 | `schema.ts`, `metrics.ts`, `gates.ts` |
| C1, C3–C6 | `schema.ts`, `dataset-manifest.ts`, `split.ts`, `split-audit.ts`, `cluster-exposure-ledger.ts`, `commands/split.ts`, `cli.ts`, `digests.ts`, `bootstrap.ts`, `metrics.ts`, `corpus-source-audit.ts`, `cross-validation.ts`, `calibration-pipeline.ts` |
| D4 | `schema.ts`, `metrics.ts` |
| E2–E4 | `split.ts`, `split-artifact.ts`, `split-audit.ts`, `commands/split.ts`, `cluster-exposure-ledger.ts`, `gates.ts`, `slices.ts`, `report.ts`, `profile-artifact.ts` |
| F1, F6 | `contracts/runtime-parity.ts`, `contracts/model-release.ts` |
| G1–G4 | `calibration-pipeline.ts`, `calibrators.ts`, `cross-validation.ts`, `commands/fit.ts`, `conformal-thresholds.ts`, `digests.ts`, `report.ts`, `profile-artifact.ts`, `contracts/calibration-profile.ts` |

Fora do conjunto, e portanto livres depois de G5: `scripts/package-own-model.mjs`,
`benchmark/lab/*.py` e os `benchmark/tests/*`.

**R2 — O bloco de teste é cego e de uso único, e a cegueira é informacional.**
Nenhuma tarefa lê `test-labels.jsonl` fora de `consume-holdout`. Diagnóstico e
depuração usam `development` e `calibration`. A concessão é registrada em
`private/holdout-ledger.jsonl` por tupla `datasetDigest`+`splitDigest` — **mas o que a
concessão protege é a informação, não o identificador.** Rearranjar os mesmos registros
gera outra tupla e o ledger aceitaria; a cegueira, não. Todo registro de um teste
consumido fica inelegível para qualquer partição futura. Além disso, qualquer unidade
amostral primária que apareceu em uma partição anterior fica inelegível para blocos de
teste futuros: o novo teste precisa ser formado por clusters nunca revelados. Ver H3b
para o procedimento de uma segunda tentativa.

**R3 — Nenhum gate é afrouxado para passar.**
Mudar um limite exige: evidência medida, justificativa escrita no plano, e registro no
relatório. O único limite que este plano autoriza a mudar é
`warning.mixed-recall` (§4.5 do assessment), e só **depois** de a formulação mudar.

**R4 — Governança nunca é simulada.**
Se um registro não passou por revisão humana, ele é `automated/unreviewed`. Preencher
`annotation.reviewerIds` ou `piiAudit.status = passed` sem revisão real é falsificação
de proveniência, e hoje existe em 10.000 registros (tarefa **C5**).

**R5 — Erro de inferência nunca vira escore.**
`status = "error"` é um ramo explícito. Proibido `?? 0`, `?? 0.5` ou qualquer
substituição. Métricas saem em par: fim-a-fim e condicional a `status = "scored"`.

**R6 — Grupo é `known`, `notApplicable` ou `unknown` — nunca sintético.**
Cada eixo de agrupamento carrega um destes três estados, explicitamente. `unknown`
torna o registro inelegível; `notApplicable` é legítimo e **não** o torna inelegível.
Proibido gerar identificador único por registro para "satisfazer" o split.

Exigir autor/página/seed de *todo* registro seria errado: um artigo da Wikipédia é
coletivo e não tem autor único, texto de IA não tem autor humano, e um cluster de
quase-duplicata legitimamente tem um só representante **depois** da poda. Cada fonte
declara **todos os eixos de agrupamento aplicáveis** (Stack Overflow: thread e autor;
Wikipédia: página; B2W: produto e avaliador; Carolina: arquivo-membro; IA: seed + prompt +
batch + gerador). Split e validação cruzada usam o componente conectado pela união desses
eixos; bootstrap escolhe a unidade hierárquica ou multiway por estimando (C4). O critério
de aceitação é **poder estatístico suficiente por estrato**, nunca "grupos maiores que
um" — este último incentiva agrupamento artificial.

**R9 — Licença verificada na fonte antes de qualquer download ou incorporação.**
Ler o card/termo oficial e registrar o identificador exato. Já custou caro uma vez:
IberAuTexTification foi anotado neste plano como CC-BY-4.0 quando é
**`cc-by-nc-nd-4.0`** (ver D2). `NC` e `ND` mudam a decisão, não só a nota de rodapé.

**R7 — Declare o contrato, não a propriedade.**
Nunca escreva "independente do treino", "sem leakage" ou "calibrado por faixa" sem
dizer o que foi medido. `drop_seen()` verifica hash exato + Jaccard ≥ 0,82 sobre
shingles de 5 tokens — não independência semântica.

**R8 — Nenhuma alegação de qualidade antes de H1.**
Não há número publicável antes de um holdout válido. Isso inclui material de
divulgação, README e copy de produto.

---

## Fase A — Instrumentação e correções de avaliador

Barata, sem dependência de decisão, e altera o significado de números já publicados.
**Todas tocam `EVALUATOR_FILES`** — logo, todas antes de G5.

### A1 — Propagar a causa real de `INFERENCE_FAILED`

**Depende de:** nada. **Faça primeiro.**

**Por que:** 325 dos 5000 registros do teste falharam (6,57%, contra o limite de 1%),
todos humanos, 322 deles da Carolina, com taxa monotônica no comprimento (0% abaixo de
400 tokens, 58% acima de 3000). **A causa é indeterminável com os artefatos atuais**
porque três origens distintas colapsam no mesmo código. Testei e **refutei** a hipótese
de estouro na re-tokenização: a pior janela dá exatamente 512 e o guard só reprova
acima de 512. Sem instrumentar, qualquer correção é palpite.

**Arquivos:**
- [`src/inference/onnx-classifier.ts:252`](../../../src/inference/onnx-classifier.ts#L252) — descarta a mensagem do erro subjacente (`"ONNX inference failed."`).
- [`src/inference/aggregator.ts:52,59`](../../../src/inference/aggregator.ts#L52) — dois `INFERENCE_FAILED` distintos sem discriminação.
- [`src/model-benchmark/main.ts:107-118`](../../../src/model-benchmark/main.ts#L107) — `errorScore()` só carrega `reasonCode`.
- [`benchmark/prediction-schema.ts`](../../../benchmark/prediction-schema.ts) — o schema da linha de predição.

**Mudança:** adicionar `failureDetail?: string`, limitado a 160 caracteres e sanitizado
por allowlist de códigos/mensagens técnicas — **nunca conteúdo do documento** — a
`ModelBenchmarkScoreV1` e à
linha de predição; preservar `error.cause` ou a mensagem original em
`onnx-classifier.ts:252`; dar códigos distintos aos dois caminhos do agregador
(escore não finito vs. `totalUnique <= 0`).

**Verificar:** rodar `score` na partição `development` e confirmar que nenhuma linha de
erro sai com detalhe vazio. Se `development` não reproduzir falhas, usar
`calibration` (929 registros em `300_PLUS`).

**Concluída quando:** um documento longo que falha produz uma linha com causa legível, e
`npm run typecheck:benchmark` + `vitest run benchmark/tests/prediction-schema.test.ts`
passam.

**Proibido:** corrigir a falha antes de saber a causa; gravar texto do documento no
campo de detalhe.

**Executado (2026-07-27).** Implementado como planejado, com quatro registros de
divergência:

1. **O vocabulário de códigos virou um contrato compartilhado novo,**
   `contracts/failure-detail.ts`, importado pelo produtor (`src/model-benchmark/main.ts`)
   e pelo validador (`benchmark/prediction-schema.ts`), e **adicionado a
   `EVALUATOR_FILES`** (R1) porque decide quais causas uma linha de predição pode nomear.
   O detalhe **nunca** é uma mensagem livre: é `CÓDIGO` ou `CÓDIGO: <mensagem literal
   nossa da allowlist>`. Mensagem de runtime alheio (WASM/onnxruntime) casa por padrão e
   produz **só o código** — o texto é descartado. O validador é o **ponto fixo** do
   produtor (`isSanitizedFailureDetail(d) ⟺ sanitizeFailureDetail(d) === d`).
2. **O agregador ganhou quatro códigos, não dois.** O ramo de `aggregator.ts:47-53`
   confundia três coisas (`totalTokenCount` não finito, `totalTokenCount <= 0`, escore
   inválido) e o plano previa dois códigos. Ficaram `INVALID_TOTAL_TOKEN_COUNT`,
   `NON_FINITE_SCORE`, `SCORE_OUT_OF_RANGE` e `ZERO_UNIQUE_TOKEN_WEIGHT` — sem isso A2
   não distingue `NON_FINITE_SCORE`, que é uma das quatro causas de que a regra
   mecânica do item 2 de A2 depende. O conjunto de entradas rejeitadas é idêntico;
   só a mensagem mudou. `ErrorCode` continua `INFERENCE_FAILED`.
3. **`validateTokens` foi dividido em `onnx-classifier.ts`.** `TOKEN_LIMIT_EXCEEDED`
   compartilhava a mensagem `"Model input has an invalid length."` com o ramo de forma
   malformada; separados, porque é exatamente a distinção que autoriza (ou proíbe) A2 a
   cortar a janela.
4. **A verificação por `score` FOI executada, em `development` e em `calibration`.** Uma
   entrega anterior de A1 declarou a CLI "não executável neste ambiente"; **isso era
   falso**, e a correção importa porque A2 leria essa frase como um portão fechado. O que
   falha é só a **invocação nua**: `node benchmark/cli.ts` não carrega sob o modo
   strip-only do Node 22.22.3, com ou sem argumentos, por causa de uma **propriedade de
   parâmetro de construtor** pré-existente em
   [`benchmark/prediction-shards.ts:100`](../../../benchmark/prediction-shards.ts#L100)
   (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`). Isso é um defeito de formatação/sintaxe em um
   arquivo de `EVALUATOR_FILES`, fora do escopo de A1 — e **não** um bloqueio: a CLI roda
   sob `--experimental-transform-types`, sem alterar arquivo nenhum. **Toda tarefa que usa
   a CLI (A2 inclusive) deve usar esta invocação** até que uma tarefa dona daquele arquivo
   troque a propriedade de parâmetro por atribuição de campo:

   ```
   node --experimental-transform-types benchmark/cli.ts score \
     --dataset-dir benchmark/data/corpus-build/dataset \
     --split-artifact benchmark/data/corpus-build/out/split/split-artifact.json \
     --partition development --candidate-extension-dir dist-model-benchmark \
     --output benchmark/out/rebuild-v3/a1/dev-score --resume
   ```

   **Distribuição medida em `development`** — 20 shards, 2000 linhas, `runId`
   `development-8f48be33-f6f87d27-1d5cd776`, corrida completa:

   | status | linhas |
   |---|---:|
   | `scored` | 1961 |
   | `abstained` | 37 |
   | `error` | 2 |

   | `failureDetail` | linhas |
   |---|---:|
   | `TOKEN_LIMIT_EXCEEDED: Model input exceeds the model token limit.` | 2 |

   **Nenhuma** linha `status:"error"` saiu com detalhe ausente ou vazio, e as **2000**
   linhas passam por `validatePredictionRow` (o parser selado, incluindo a validação
   condicional nova). Os dois documentos que falharam são
   `src_ptso_5d2158474eab` (765 palavras, 5025 caracteres, `human`) e
   `mix_src_ptso_ba63d1168aa2` (624 palavras, 3884 caracteres, `mixed`).

   **Consequência para A2 — a hipótese de estouro está CONFIRMADA, não refutada.** O texto
   "Por que" de A1 acima afirma que a hipótese de estouro na re-tokenização foi "testada e
   **refutada**", porque "a pior janela dá exatamente 512". A medição contradiz isso: o
   único código observado em `development` é `TOKEN_LIMIT_EXCEEDED`, emitido pelo guard
   [`onnx-classifier.ts:421`](../../../src/inference/onnx-classifier.ts#L421)
   (`tokens.inputIds.length > maximumTokens`) — ou seja, uma janela real **passou** de 512.
   A2 **não deve herdar a refutação**: pelo item 2 de A2, `TOKEN_LIMIT_EXCEEDED` é
   exatamente o código que autoriza cortar tokens de conteúdo do fim e incrementar
   `contentCompositionVersion`. O insumo que a regra mecânica de A2 exige **existe agora**.

   **Latência não mostra deriva explosiva em `development`** (dado para a hipótese de
   pressão WASM acumulada de A2, não conclusão): sobre as 1961 linhas `scored`, p50 640 ms,
   p90 2259 ms, p99 4751 ms, máximo 6476 ms — longe dos 41 s observados na partição de
   teste. Mas o alcance é limitado: `development` tem cauda fina (p99 = 618 palavras,
   **zero** registros acima de 3000 palavras, 25 acima de 600), enquanto `calibration` tem
   642 acima de 600 palavras e 129 acima de 1500. É em `calibration` que o fenômeno vive,
   e é por isso que o plano manda usar essa partição.

   Em `calibration`, onde os documentos longos estão, a latência sobe mas **não deriva com
   a posição**: máximo 16 233 ms, e a média por bloco de 300 documentos cai de 1298 ms
   (posição 1500) para 393 ms (posição 1800) antes de subir para 3102 ms (posição 2100) —
   isto é, ela acompanha o **comprimento do documento**, não o tempo acumulado de sessão.
   Isso **enfraquece** (não refuta) a hipótese de pressão WASM acumulada de A2, e o fato de
   que nenhuma das 60 falhas foi `WASM_OOM` ou `MODEL_TIMEOUT` aponta na mesma direção.

   **Distribuição medida em `calibration`** — 30 shards, 3000 linhas, corrida completa
   (mesma invocação, `--partition calibration --output benchmark/out/rebuild-v3/a1/cal-score`),
   sobre o bundle **reconstruído** depois da extração de `selectFailureDetail`:

   | status | linhas |
   |---|---:|
   | `scored` | 2924 |
   | `abstained` | 18 |
   | `error` | 58 |

   | `failureDetail` | linhas |
   |---|---:|
   | `TOKEN_LIMIT_EXCEEDED: Model input exceeds the model token limit.` | 58 |

   Também aqui **nenhuma** linha de erro saiu sem detalhe, e as 3000 passam por
   `validatePredictionRow`. **Somando as duas partições: 5000 linhas, 60 linhas de erro,
   100% `TOKEN_LIMIT_EXCEEDED`, zero detalhe ausente ou vazio.** Nenhum `WASM_OOM`, nenhum
   `MODEL_TIMEOUT`, nenhum código do agregador foi observado.

   **A taxa de erro reproduz o padrão de §3.2 — e agora com a causa nomeada.** Em
   `calibration`, por faixa de palavras:

   | faixa (palavras) | linhas | erros | taxa |
   |---|---:|---:|---:|
   | < 200 | 1790 | 0 | 0,0% |
   | 200–599 | 568 | 3 | 0,5% |
   | 600–1499 | 513 | 36 | 7,0% |
   | 1500–2999 | 127 | 18 | 14,2% |
   | ≥ 3000 | 2 | 1 | 50,0% |

   Monotônica no comprimento, como no teste; e **55 dos 58 erros são Carolina/`human`**,
   o mesmo perfil dos 322 de 325 registrados no diagnóstico. Ou seja: o fenômeno que
   queimou a concessão **é** este, e ele tem **um** código.

   Bundle e navegador reais e offline: modelo `cleanfeed-ptbr-v1`
   `d8f77f870fbd35a17add2498b73d906bbc299026`, Chrome for Testing 150.0.7871.129,
   `backend=wasm`, toda requisição http/https abortada.

5. **O risco de EOL contra o digest do avaliador MATERIALIZOU — e é medido, não teórico.**
   `core.autocrlf` é `true` e não há `.gitattributes` para estes caminhos. Os blobs
   commitados são LF, mas durante A1 a árvore de trabalho apareceu **100% CRLF** em 8
   arquivos (por exemplo `benchmark/prediction-schema.ts`: 552 CRLF em disco contra 0 CRLF
   no blob de HEAD). `computeEvaluatorDigest`
   ([`benchmark/digests.ts:122-136`](../../../benchmark/digests.ts#L122)) lê **os bytes em
   disco sem normalizar newline**, então **o mesmo commit produziu dois digests**:

   | árvore de trabalho | `evaluatorDigest` |
   |---|---|
   | CRLF materializado | `bb1d59d6c84c4b108f8cb07b4079fb47ef92d74a338d910ef326bfb70326aa6f` |
   | LF (igual aos blobs) | `514cf2a0359c9eaf9c76a5af1f7372058192bfc7dd59cb869d48e17a56af1f75` |

   Isso é fatal para R1 se não for fechado **antes de G5**: `integrity.evaluator-digest`
   passaria a depender de quem fez o checkout, não do commit. A1 apenas normalizou a árvore
   (`prettier --write`, zero diferença de conteúdo — os blobs já eram LF); **a correção
   durável é um `.gitattributes` com `eol=lf`, e é de uma tarefa que possa mexer na
   configuração do repositório**, não de A1.

   Isso também **corrige um erro do relatório anterior de A1**, que dizia haver três falhas
   de `format:check` pré-existentes em HEAD e insinuava que `9dbbf63` entrou sem formatar.
   Comparando o conteúdo de HEAD normalizado em LF, **só
   `benchmark/lab/build_governance.ts` está realmente mal formatado**; as falhas de
   `benchmark/prediction-shards.ts` e `benchmark/tests/prediction-shards.test.ts` eram
   apenas o CRLF da árvore de trabalho.

6. **O vocabulário colapsava, uma camada abaixo, exatamente o defeito que A1 existe para
   remover — corrigido.** A primeira entrega de A1 cobria os sítios de `onnx-classifier.ts`
   e do agregador, mas **não** os do tokenizador. `scoreDocument` começa em
   [`runtime.tokenizer.encodeWithOffsets(text)`](../../../src/model-benchmark/main.ts#L257),
   e essa chamada lança **seis** literais distintos de
   [`model-runtime.ts`](../../../src/inference/model-runtime.ts#L267) (linhas 267, 340, 360,
   429, 439, 451). Nenhum estava na allowlist, então os seis reduziam ao **mesmo**
   `TOKENIZATION_FAILED` (medido: `selectFailureDetail("TOKENIZATION_FAILED", new Error(m))`
   devolvia uma única string para todos os seis). São guards de **tiling de offsets
   ByteLevel/WordPiece**, isto é, precisamente a classe que §6.4 (Unicode) torna plausível
   para documento longo da Carolina — a população que A2 tem de explicar. Um documento cujo
   fluxo de tokens não cobre o texto-fonte era indistinguível de um id inválido e de um
   caractere fora do alfabeto de bytes: três bugs com três remédios diferentes. Cada um
   ganhou seu código (`TOKENIZER_STREAM_LENGTH_MISMATCH`, `TOKENIZER_INVALID_TOKEN_ID`,
   `TOKENIZER_INVALID_INPUT_IDS_SHAPE`, `BYTE_LEVEL_OFFSET_OVERFLOW`,
   `BYTE_LEVEL_STREAM_NOT_TILED`, `BYTE_LEVEL_NON_ALPHABET_CHARACTER`) e a mudança é
   **aditiva dentro de `contracts/failure-detail.ts`** — `model-runtime.ts` não foi tocado.
   O comentário do módulo afirmava um guard de deriva que **não existia** ("o teste de
   propagação verifica cada sítio"): o teste cobria só `onnx-classifier.ts`. Agora
   `failure-detail-propagation.test.ts` **dirige os seis sítios reais** através de
   `ExactTokenizer` e afirma o detalhe que cada um produz, então reescrever a mensagem de um
   guard fica vermelho.

7. **Três correções menores no mesmo contrato, todas com teste que fixa o valor.**
   (a) O *fallback* de `selectFailureDetail` preferia o `reasonCode` até quando ele era
   `INFERENCE_FAILED` — ou seja, uma falha genuinamente não classificável era arquivada sob
   o **mesmo código opaco** que motivou o campo, tornando invisível a população
   desconhecida que A2 vai contar. Agora só `INFERENCE_FAILED` perde para
   `UNCLASSIFIED_RUNTIME_FAILURE`; todo outro `reasonCode` nomeia uma camada e continua
   preferido. (b) `FAILURE_DETAIL_CODES` e `ErrorCode` eram dois vocabulários sem vínculo e
   **já divergentes**: sete `ErrorCode` (`WORKER_UNAVAILABLE`, `WEBGPU_UNAVAILABLE`,
   `CACHE_ERROR`, `STORAGE_ERROR`, `INVALID_SETTINGS`, `INVALID_MESSAGE`,
   `PLATFORM_EXTRACTION_FAILED`) reduziam a "unclassified" mesmo quando o runtime já sabia o
   código exato. `src/shared/errors.ts` passou a exportar `ERROR_CODES` como **valor**
   (`ErrorCode` deriva dele, união idêntica) e um teste afirma a contenção, porque um union
   type não é iterável e o modo de falha é um guard **mudar de lugar**. (c) O sanitizador
   **podia lançar**: `messageOf`/`causeOf` liam `.message`/`.cause` de valor arbitrário sem
   guarda, e ele fica no único caminho que transforma um throw em linha de erro — o laço de
   shards não tem `catch` por documento, então um acessor hostil derrubava a partição
   inteira em vez de degradar o detalhe. As duas leituras agora são **totais**.

### A2 — Diagnosticar e corrigir a falha em documento longo

**Depende de:** A1.

**Por que:** 40,2% dos documentos humanos da Carolina no teste não foram pontuados, e
como são todos negativos, a falha entrou na medição do jeito mais favorável possível
(ver A3). Hipótese ainda aberta: pressão de memória WASM acumulada — a faixa de erros
é contígua (posições 3003–3799) e a latência máxima observada foi 41 s.

**Arquivos:** `src/inference/model-runtime.ts`, `src/inference/chunker.ts`,
`src/inference/aggregator.ts`, `src/inference/onnx-classifier.ts`,
`src/model-benchmark/main.ts`, `tests/unit/inference/aggregator.test.ts`,
`benchmark/tests/browser-scorer.test.ts`.

**Mudança:** aplicar a tabela abaixo. O item 1 é obrigatório; o item 2 segue
exclusivamente o código estruturado produzido por A1:

1. **Limitar a inferência a `maxWindows` — devida em qualquer cenário.** `buildWindows`
   gera todas as janelas e o laço infere cada uma; só depois `aggregateWindowsV2`
   seleciona 8 ([`main.ts:255-271`](../../../src/model-benchmark/main.ts#L255),
   [`aggregator.ts:42`](../../../src/inference/aggregator.ts#L42)). Um documento de 5000
   tokens paga ~20 inferências para usar 8. Selecionar **antes** de inferir, e ler
   `manifest.windowing.maxWindows` em vez da constante fixa em `aggregator.ts:17`.

   **Preservar a contabilidade das janelas descartadas.** Ao selecionar antes de inferir,
   é obrigatório manter `candidateWindowCount`, `truncated` e os **índices originais** das
   janelas escolhidas. Sem isso o relatório passa a dizer que só existiam oito candidatas,
   `coverage` fica errado e a diagnose de documento longo perde a informação que a
   sustenta.

2. **Folga na janela — regra mecânica pelo código de A1.** `contentTokens` é validado como
   `modelMaxTokens - specialTokenCount` = 510 de 512
   ([`model-runtime.ts:130`](../../../src/inference/model-runtime.ts#L130)), ou seja,
   folga zero. Se A1 registrar `TOKEN_LIMIT_EXCEEDED`, cortar deterministicamente tokens
   de conteúdo do fim até `encodedLength <= modelMaxTokens`, incrementar
   **`aggregationVersion`** e testar offsets. Para `WASM_OOM`, `MODEL_TIMEOUT` ou
   `NON_FINITE_SCORE`, não reduzir a janela: corrigir a causa e manter 510. Código
   diferente deixa A2 incompleta; não autoriza tentativa especulativa.

   **Correção de coordenada (esta linha já dizia `contentCompositionVersion` e estava
   errada).** `CONTENT_COMPOSITION_VERSION` versiona **como um texto se decompõe em
   unidades classificadas** — a precedência URL → hashtag → só-emoji → lexical → other que
   produz `totalUnits`/`lexicalUnits`/`lexicalRatio` e alimenta
   [`eligibility.ts`](../../../src/inference/eligibility.ts). Aparar `window.tokenEnd` é
   política de **janela de tokenizer**: não muda a decomposição, não muda `lexicalRatio` e
   não muda elegibilidade. A coordenada correta é `aggregationVersion`, exatamente como a
   nota de atenção logo abaixo sempre disse. `lexical-content-v2` **pertence a A5**, que
   altera de fato a decomposição (NFKC, largura zero, homóglifos); se A2 gastasse o número,
   o histórico atribuiria a mudança de composição à causa errada para sempre.

**Verificar:** taxa de erro em `calibration` restrita a `300_PLUS` cai a zero; o escore
de documento não muda para documentos com ≤ 8 janelas (a seleção é a mesma).

**Concluída quando:** erro de inferência ≤ 0,1% em todas as faixas de comprimento em
`development` + `calibration`, e o custo por documento longo cai proporcionalmente às
janelas economizadas.

**Atenção:** mudar a política de janelas muda `aggregationVersion` e o
`inferenceCoreDigest`. Isso é esperado nesta fase e **proibido** depois de G5.

#### A2 — o que a execução mediu (registro da entrega)

> **STATUS DE FECHAMENTO — leia antes de qualquer número abaixo.**
> **A2 fecha como NÃO CONCLUÍDA contra a sua própria definição de pronto.** O critério do
> plano é "erro de inferência ≤ 0,1% em **todas** as faixas de comprimento em
> `development` **+** `calibration`", e o segundo critério é "erro em `calibration`
> restrito a `300_PLUS` cai a **zero**".
>
> **O que a tarefa entregou, item por item:** o **item 1** (selecionar antes de inferir,
> preservando a contabilidade) está **completo e verificado por teste**. O **item 2** (folga
> na janela) estava condicionado ao código estruturado de A1, o código observado **foi**
> `TOKEN_LIMIT_EXCEEDED` nos 60 documentos que falharam, e portanto o item 2 foi
> **autorizado e implementado**. O que não fecha é o **critério de saída**, não os itens.
>
> Situação exata, por metade:
>
> | metade | estado |
> |---|---|
> | `development` | **MEDIDA e atingida** — 2000 de 2000 linhas, 0 erros nas seis faixas (`benchmark/out/rebuild-v3/a2-fix/dev-score`, `manifest.json` com `shardCount` 20), scorer selado em Chrome. **Mas a corrida foi feita sob `runtimeParityDigest` `897b1b49…`, que NÃO é a identidade desta árvore** — ver "Identidade entregue" adiante |
> | `calibration` | **NÃO MEDIDA fim-a-fim.** Não existe corrida completa do scorer selado sobre nenhum bundle pós-correção. O único residual disponível (3/3000) vem de uma varredura vitest que não instancia o classificador, o WASM nem o relógio de timeout — ver a tabela de bancadas adiante |
>
> O número que reprova é explícito: **`calibration/150_299` = 2/557 = 0,359%**, contra um
> teto de 0,1%. Portanto **nenhum dos dois critérios está fechado**, e o motivo é diferente
> em cada um: o de `development` está atingido mas é só metade do critério **e** a corrida
> não corresponde mais à identidade da árvore; o de `calibration` não foi medido pela
> bancada que o critério pressupõe. **Nenhum limite foi afrouxado (R3)** — a disposição
> explícita, com os caminhos de fechamento, está na seção "Disposição explícita dos dois
> critérios não atingidos" adiante. Quem fechar A2 **mede `calibration` com
> `score --partition calibration`**; herdar `3/3000` é proibido.
>
> **O critério não pode ser esquecido por ficar aberto aqui:** ele volta como **gate de
> release em H3** ("limite de erro de inferência **por comprimento**") e como **condição de
> promoção a `indicator` em I1** ("erro de inferência `<= 0,001` no replay de
> `dev + cal-A + cal-B`"). Deixar A2 aberta atrasa a tarefa; não dispensa o número.

**A hipótese de pressão de memória WASM está refutada, e o §3.2 tem um erro de
medição.** Com os códigos estruturados de A1, os **60** documentos de
`development` + `calibration` que falharam carregam **um único** detalhe:
`TOKEN_LIMIT_EXCEEDED: Model input exceeds the model token limit.` (2 de 2000 em
`development`, 58 de 3000 em `calibration`). A contiguidade das posições 3003–3799
citada no §3.2 é artefato da ordenação por id opaco — os registros `src_carolina_*`
ficam juntos —, não de memória acumulada.

O §3.2 diz que a hipótese "re-tokenizar o recorte de caracteres estoura 512" está
"refutada, a pior janela dá exatamente 512". **A medição da pior janela estava certa
para os documentos que pontuaram e errada para os que falharam.** Reproduzindo o
caminho exato (tokenizer do bundle + `ExactTokenizer` real) sobre todos os 5000
documentos de `development` + `calibration`: nos 40 documentos longos que pontuaram a
pior janela dá **exatamente 512**; nos 60 que falharam dá **513** (53 documentos),
**514** (4) ou mais (3). A folga zero custa **um** token.

**Item 1 — feito integralmente.** A seleção passou a acontecer antes da inferência,
com a mesma função (`selectDistributedWindows`), que agora carrega
`selectedWindows` — as janelas escolhidas com os índices originais. A contabilidade
(`candidateWindowCount`, `truncated`, índices) é passada à agregação via
`AggregateWindowsOptions.selection`, e `maxWindows` vem de
`manifest.windowing.maxWindows`; a constante do agregador virou
`FALLBACK_MAX_AGGREGATION_WINDOWS`, usada só por quem não tem manifesto (worker de
produção e smoke). Provado por teste: para 3, 8, 20 e 47 candidatas a agregação sobre
as janelas selecionadas é `toEqual` à agregação sobre todas as candidatas.

**`aggregationVersion` FOI incrementada — `tmr-aggregation-v2` → `tmr-aggregation-v3`.**
A primeira entrega não a incrementou, com o argumento de que a seleção prévia (item 1)
não muda nenhuma saída. O argumento é correto **e cobre só o item 1**. O item 2 muda a
política de janelas de fato: `fitWindowSlice` reduz `window.tokenEnd`, e esse valor
alimenta `uniqueTokenWeights` dentro de `aggregateWindowsV2`
([`aggregator.ts:190-204`](../../../src/inference/aggregator.ts#L190)) e portanto
`documentRawScore` ([`:145-148`](../../../src/inference/aggregator.ts#L145)) e `coverage`
([`:171`](../../../src/inference/aggregator.ts#L171)) — e converte, em 56 documentos, um
erro de inferência em escore. 56 documentos passam a produzir escore a partir de um
intervalo **cortado**, e o carimbo é parte da chave de calibração: deixá-lo em `v2` faria
dois conjuntos de escores incomparáveis compartilharem uma chave. Vale a advertência
literal deste plano — "mudar a política de janelas muda `aggregationVersion`".

**Correção de fato (uma versão anterior deste registro, e o comentário do código, diziam
que `truncated` também muda — não muda).** O `truncated` devolvido é exclusivamente
`selection.truncated` ([`aggregator.ts:172`](../../../src/inference/aggregator.ts#L172)):
é propriedade da **seleção** de janelas, não da aparagem do recorte. Um `tokenEnd` reduzido
não o toca. O que a aparagem move é **escore** e **`coverage`** — o que já basta para exigir
o incremento. O comentário de `AGGREGATION_VERSION` foi corrigido junto (R7).

**Item 1 tem um efeito colateral científico, medido:** `src_carolina_583c975dd4b4`
(11 candidatas) deixa de falhar **só** pela seleção prévia, porque a janela que
estourava não está entre as 8 escolhidas. Ou seja, item 1 e item 2 não são
independentes na população de erros.

**Ganho de custo, medido e modesto neste corpus** (bancada: **varredura vitest**, a mesma da
tabela de bancadas adiante — contagem de janelas, não de tempo de ONNX)**:** 7430 janelas
candidatas em `development` + `calibration`, 7414 inferidas — 16 inferências economizadas
(0,22%), porque só 11 documentos têm mais de 8 candidatas. Por documento longo o ganho é o
prometido: 12 → 8 janelas em `src_carolina_9e9842edb531`, 11 → 8 em
`src_carolina_583c975dd4b4`, 9 → 8 nos outros nove.

**Item 2 — implementado, porque o código observado é `TOKEN_LIMIT_EXCEEDED`.**
`fitWindowSlice` (em `chunker.ts`) corta tokens de conteúdo **do fim** pelo excesso
medido até `encodedLength <= modelMaxTokens - specialTokenCount`, e devolve o
intervalo realmente pontuado, de modo que `coverage` e os pesos por token único
descrevem o texto que foi ao modelo. Medido sobre os 5000 documentos de
`development` + `calibration` pela **varredura vitest** (tokenizer do bundle + `ExactTokenizer`
real, sem ONNX/WASM): 56 documentos passam a pontuar cortando **1 token** (50) ou **2** (6).

**O corte termina pela condição real, não por orçamento de tentativas.** A primeira
entrega limitava o laço a 8 remedições e depois declarava a janela irredutível. Isso
mistura duas coisas: `tokenEnd` decresce ao menos 1 por passo, então a terminação já é
garantida pela condição `nextEnd <= window.tokenStart`, e um teto rotularia como
irredutível uma janela que **ainda é** redutível — um tokenizer que subestima o excesso
converge um token por passo, e 25 tokens sobre orçamento de 10 precisam de 15 passos.
Nos dados medidos bastavam ≤ 2 passos, então não havia impacto observado; o teto saiu de
todo modo, porque o custo do erro é um documento perder o escore. Pelo mesmo motivo o
ramo de *offset* ausente ganhou código próprio, `WINDOW_OFFSETS_OUT_OF_RANGE`: um
intervalo fora do array de offsets é o autor da chamada discordando do tokenizer sobre
quantos tokens existem, defeito diferente de um mapa de offsets degenerado, e um código
para as duas causas é exatamente o que A1 desfez uma camada acima.

**Item 2 tem um caso em que a regra mecânica não se aplica, e ele falha fechado.**
Três documentos (`src_ai_public_madras_961c462e650f`, `…_a48e8a49816d`,
`…_be8b62bfe739`) caem no *coarse fallback* de `deriveWordPieceOffsets`, que mapeia
**todo** token para o texto inteiro. Nesses, a "janela" É o documento inteiro e cortar
`tokenEnd` não encurta o recorte: as 8 janelas viravam 8 cópias do mesmo prefixo, com
`coverage` calculado sobre intervalos que não descrevem mais nada. Isso é fabricar
resultado, não corrigir falha, então o corte detecta a ausência de progresso e falha
fechado sob o código próprio `WINDOW_SLICE_NOT_REDUCIBLE`.

**Disposição dos 5 residuais diagnosticados, um por um.** A evidência é
`benchmark/out/rebuild-v3/a2/coarse-cause.txt`: cinco documentos inspecionados, **todos**
quebrando no mesmo ponto — uma palavra que o WordPiece resolve como `[UNK]`, o que
dessincroniza o *tiling* de offsets. Dos cinco, **três falham hoje** (mais de 510 tokens,
logo mais de uma janela); os outros dois têm o **mesmo defeito latente** e só pontuam porque
cabem em uma janela só. Nenhum é "erro residual aceito": cada um tem destino nomeado.

| id | palavra em que os fluxos divergem | tokens | CJK no texto | falha hoje? | destino |
|---|---|---:|---:|---|---|
| `src_ai_public_madras_5a06a06a65c4` | `当我们` | 231 | 3 | não (1 janela) | fonte fora da v3 — **D2** |
| `src_ai_public_madras_be8b62bfe739` | `如播放器` | 901 | 4 | **sim** | fonte fora da v3 — **D2** |
| `src_ai_public_madras_a48e8a49816d` | `acadêmica` | 515 | 4 | **sim** | fonte fora da v3 — **D2** |
| `src_ai_public_madras_961c462e650f` | `作为` | 580 | 2 | **sim** | fonte fora da v3 — **D2** |
| `mix_src_wikipedia_pt_d3e3087c4ae9` | `花巻市` | 124 | 3 | não (1 janela) | dado v3 legítimo — **A5** |

Quatro dos cinco são `src_ai_public_madras_*`: **fonte externa que não existe no corpus v3**
— a decisão congelada nomeia somente pt.stackoverflow, ptwiki, B2W-Reviews01 e Carolina, e
D2 mantém conjunto externo fora. Eles foram medidos sobre o **corpus antigo**; depois de D2
não há registro-linha a corrigir. O quinto é **dado v3 legítimo** (topônimo japonês
`花巻市` num artigo da Wikipédia lusófona) e é obrigação de **A5**, cujo critério nº 3 já é
"teste que reconstrói offsets originais a partir do mapa".

**Cuidado com a coluna do meio, para não gerar hipótese falsa:** ela é o ponto onde a
comparação *diverge*, não necessariamente a causa. Em `…_a48e8a49816d` a divergência aparece
numa palavra latina (`acadêmica`, com `ê` pré-composto U+00EA), o que sugeriria uma causa
não-CJK — mas os **cinco** textos contêm CJK (contagem na coluna ao lado, medida sobre
`benchmark/out/rebuild-v3/a2/devcal-texts.jsonl`), e a dessincronia começa **antes** do ponto
reportado. Ou seja: a hipótese CJK explica os cinco, e "existe causa não-CJK" **não está
medido** — não o afirme sem medir.

**Resultado residual — dois números, duas bancadas diferentes; a distinção é
load-bearing (R7).** Diga sempre qual mediu o quê:

| número | quem mediu | o que essa bancada consegue observar |
|---|---|---|
| `calibration` 3/3000 (0,100%), `150_299` = 2/557 (0,359%), `300_PLUS` = 1/929 (0,108%), demais faixas 0,000% | **varredura vitest** (`benchmark/out/rebuild-v3/a2/lab/zz-a2-sweep.test.ts.txt`, saída em `…/a2/sweep-after.txt`), rodada com o código do item 2 já aplicado mas **antes de qualquer incremento de carimbo** — o que não afeta o número, porque carimbo é inerte no comportamento | somente `ExactTokenizer` + `buildContentWindows` + `selectDistributedWindows` + `fitWindowSlice`. **Não** instancia o classificador ONNX, **não** roda WASM e **não** tem relógio de timeout |
| `development` 0 erros sob `runtimeParityDigest` `897b1b49…` (**não** a identidade desta árvore, `6c5b6453…`) | **scorer selado em Chrome**, ver "Confirmação fim-a-fim" abaixo | o caminho inteiro, incluindo ONNX/WASM e timeout |

Consequência que ninguém deve contornar: **o residual de `calibration` não é uma taxa de
erro fim-a-fim.** A varredura não pode observar `WASM_OOM`, `MODEL_TIMEOUT` nem
`NON_FINITE_SCORE` — três das quatro classes de erro que o item 2 tinha de discriminar —,
então ela pode apenas **subestimar**, nunca confirmar, a taxa em `calibration`. Antes de
qualquer um tratar `3/3000` como taxa de erro de inferência, é obrigatório re-medir com
`score --partition calibration` sobre o bundle entregue. Não existe, hoje, nenhum
`cal-score` sobre bundle pós-correção: o único diretório de `calibration` em disco é
`benchmark/out/rebuild-v3/a1/cal-score`, que é a linha de base **pré**-correção (58/3000).
A varredura mede `development` 0/2000 também, e nisso concorda com o scorer selado — mas a
concordância vale para `development`, não transfere para `calibration`.

**Para quem for rodar esse `score --partition calibration`: uma corrida parcial quase não
informa, e isto é medido.** `score` percorre a partição em ordem de id e persiste por
*shard* de 100, então uma corrida interrompida cobre um prefixo. Localizando as 58 linhas
`error` de `a1/cal-score` nessa mesma ordem, elas estão concentradas no **último terço**:
1 no *shard* 14, 2 no 15, e as outras **55 nos shards 22–29** (histograma
`{14:1, 15:2, 22:4, 23:7, 24:7, 25:7, 26:7, 27:8, 28:3, 29:12}`) — e os três residuais
`src_ai_public_madras_*` caem nos *shards* 14 e 15 (índices 1445, 1503, 1578 de 3000).
Ou seja: parar antes do *shard* 22 mede 3 das 58 falhas conhecidas e diria "0 erros" por
não ter chegado nelas. **Só uma corrida completa dos 30 shards fecha o critério**; uma
parcial precisa declarar quantos shards cobriu e que a população de falha ficou de fora.

Com essa ressalva registrada, os dois critérios do plano **não** foram atingidos: "≤ 0,1%
em todas as faixas" falha em `150_299` e (por margem) em `300_PLUS`, e "erro em
`calibration` restrito a `300_PLUS` cai a zero" não cai a zero. Antes da correção eram
58/3000 em `calibration` (medido pelo scorer selado, `a1/cal-score`) e 2/2000 em
`development` (`a1/dev-score`).

**Identidade entregue (a única a conferir contra esta árvore).** O build regenera
`inferenceCoreDigest` a partir dos bytes de todo `.ts` sob `src/inference` mais
`FIXED_CORE_FILES` (que inclui `contracts/content-composition.ts` e
`src/shared/types.ts`), e `runtimeParityDigest` é derivado dele mais as coordenadas.
Nada disso é editado à mão. Os valores abaixo saíram de
`node scripts/runtime-parity.mjs write` (via `npm run build:model-benchmark`) sobre esta
árvore, e ficam em `dist-model-benchmark/runtime-parity.json` — que é **ignorado pelo Git**,
logo quem confere **regenera** em vez de confiar no arquivo em disco:

| campo | antes de A2 (`6298269`) | entregue |
|---|---|---|
| `aggregationVersion` | `tmr-aggregation-v2` | `tmr-aggregation-v3` |
| `contentCompositionVersion` | `lexical-content-v1` | `lexical-content-v1` (**inalterada**) |
| `inferenceCoreDigest` | `977bca0b…` | `82deb043…` |
| `runtimeParityDigest` | `35f31b32…` | `6c5b6453…` |

As duas colunas foram **recomputadas**, não copiadas: a coluna "antes de A2" é
`buildRuntimeParityManifest` sobre os *blobs* de `6298269` extraídos com `git cat-file blob`
(bytes brutos, LF — `git archive` aplicaria `core.autocrlf` e daria outro digest), e a
coluna "entregue" é a saída do build desta árvore.

**Três identidades anteriores NÃO são a entregue, e nenhuma deve ser usada para conferir:**
`benchmark/out/rebuild-v3/a2/dev-score` foi feita com `runtimeParityDigest` `e55472e7…`
(`inferenceCoreDigest` `647123a0…`); `a2/dev-score-final` com `61c5ff19…` (`145cc989…`) —
que é exatamente a identidade do commit `0e4231c`, a **primeira** entrega de A2; e
`a2-fix/dev-score` com `897b1b49…` (`d117f372…`), que era a identidade **antes** da
reversão de `contentCompositionVersion` descrita adiante. Quem conferir contra qualquer um
dos três vai concluir *drift* onde não há.

**Confirmação fim-a-fim em `development`** (Chrome for Testing 150.0.7871.129 travado,
extensão candidata, ONNX INT8 real — `runtimeParityDigest` `897b1b49…`, corrida **completa**
em `benchmark/out/rebuild-v3/a2-fix/dev-score`, `manifest.json` com `shardCount` 20 e
`createdAt` `2026-07-27T11:40:39.208Z`). Todo número deste parágrafo saiu **desta**
corrida, não de nenhuma anterior.

> **Ressalva de identidade, e ela é obrigatória (R7).** Esta corrida foi feita **antes** da
> reversão de `contentCompositionVersion`, sob `897b1b49…`. A identidade desta árvore é
> `6c5b6453…`. Os números abaixo continuam sendo o comportamento **desta** árvore, e a razão
> é verificável, não uma suposição: `CONTENT_COMPOSITION_VERSION` tem **um único** consumidor
> executável, [`onnx-classifier.ts:320`](../../../src/inference/onnx-classifier.ts#L320), que
> apenas o **carimba** no auto-relato de identidade; nenhuma janela, nenhum offset e nenhum
> escore o leem. Mas **a conferência de identidade não vale mais**: quem repetir a corrida
> tem de reconstruir o bundle desta árvore e conferir contra `6c5b6453…`. Tratar o par
> `897b1b49…`/`a2-fix/dev-score` como a evidência desta árvore é o erro que esta ressalva
> existe para impedir.

- **2000 linhas** (20 shards × 100), `status`: **1963 `scored`, 37 `abstained`, 0
  `error`** — eram 1961/37/**2** em `a1-fix/dev-score`.
- Por faixa do `sizeBucket` da bancada, **0 erros em todas as seis**: `0_49` 0/37,
  `50_79` 0/844, `80_99` 0/194, `100_149` 0/288, `150_299` 0/445, `300_PLUS` 0/192. A
  faixa que falhava era `300_PLUS`, 2/192 = 1,042%. Tabela em
  `benchmark/out/rebuild-v3/a2-fix/dev-bands.txt`.
- Comparando **linha a linha** com `a1-fix/dev-score` sobre o mesmo split:
  **1998 de 2000 idênticas** em todos os campos científicos (`status`,
  `documentRawScore`, `localizedRawScore`, `evidenceQuality`, `reasonCode`, `coverage`,
  `failureDetail`), e as duas que mudaram — `mix_src_ptso_ba63d1168aa2` e
  `src_ptso_5d2158474eab` — são exatamente as que falhavam, cada uma passando de
  `error`/`INFERENCE_FAILED`/`TOKEN_LIMIT_EXCEEDED` para `scored`/`SCORED` com
  `coverage` 1. Saída em `benchmark/out/rebuild-v3/a2-fix/dev-comparison.txt`.

Isso também mede que o incremento de carimbo de versão é inerte no comportamento: só o
carimbo muda, e `identityMatchesParity` continua casando (se não casasse, as 2000 linhas
sairiam `RUNTIME_PARITY_IDENTITY_MISMATCH`). É essa inércia medida — sobre as **duas**
coordenadas, porque a corrida trazia `v3`/`v2` — que sustenta a ressalva acima: reverter
uma das duas para `v1` não pode mudar escore, porque nem a `v2` mudava. O documento de 9
candidatas
(`src_ptso_9b3e98994bb0`) manteve `documentRawScore` `0.00011800936275887046` e
`coverage` `0.8989952406134321` bit a bit, pagando 8 inferências em vez de 9 — latência
**17070,1 ms → 15344,4 ms**, ambas as pontas lidas dos shards de `a1-fix/dev-score` e
desta corrida `a2-fix/dev-score`. (Duas versões anteriores deste registro citaram aqui
corridas que não eram a entregue: "17070 → 14069" é a intermediária `a2/dev-score`, e
"17070 → 15092" é a intermediária `a2/dev-score-final`. As três medem a mesma queda de 9
para 8 inferências; só esta usa o bundle entregue.) Latência de uma única página não é
número publicável (R8); é diagnóstico de custo.

**Disposição explícita dos dois critérios não atingidos (R3: nada é afrouxado).** Os
limites ficam como estão — "≤ 0,1% em **todas** as faixas" e "`calibration/300_PLUS` cai
a **zero**" — e **A2 fica registrada como não concluída contra a sua própria definição de
pronto**. São **três** passos de fechamento, e o primeiro é uma medição que falta, não um
defeito a corrigir:

1. **Medir `calibration` fim-a-fim** com
   `score --partition calibration --candidate-extension-dir dist-model-benchmark` sobre um
   bundle cuja identidade seja conferida contra `dist-model-benchmark/runtime-parity.json`.
   Isto é **obrigatório e não substituível**: o residual `3/3000` que este registro cita é
   de varredura vitest, que não observa `WASM_OOM`, `MODEL_TIMEOUT` nem
   `NON_FINITE_SCORE`, e a corrida tem de ser **completa** (30 shards) porque 55 das 58
   falhas conhecidas ficam nos shards 22–29. Até essa corrida existir, a metade
   `calibration` do critério não tem número, e escrever um seria inventá-lo.
2. **A5 corrige o *coarse fallback*** (`segmentBasicWords` espelhando
   `tokenize_chinese_chars`, ver o parágrafo seguinte) e **os ids da tabela de disposição
   acima são medidos de novo** — os três que falham hoje
   (`src_ai_public_madras_961c462e650f`, `…_a48e8a49816d`, `…_be8b62bfe739`) **e** os dois
   latentes (`…_5a06a06a65c4`, `mix_src_wikipedia_pt_d3e3087c4ae9`), que hoje só pontuam por
   caberem numa janela e voltariam a falhar se crescessem. Com offsets sãos, o corte
   determinístico se aplica e a expectativa é que passem a pontuar; **expectativa não é
   medição** — quem fechar A5 mede. `mix_src_wikipedia_pt_d3e3087c4ae9` é o único dos cinco
   que **não** sai por D2, então é ele que faz esta linha ser obrigatória.
3. **D2 remove `madras` da v3.** Quatro dos cinco residuais são `src_ai_public_madras_*`, e
   `madras` é conjunto externo que D2 mantém fora do corpus v3. Depois de D2 a medição
   tem de ser **repetida sobre o corpus pós-D2**, e o critério é avaliado ali; herdar o
   número de qualquer medição anterior seria avaliar um corpus que já não existe.

Enquanto os três não fecharem, o critério permanece **não atingido** e assim declarado.
A redução medida em `development` (2 → 0 sobre 2000 linhas, scorer selado — mas sob
`897b1b49…`, ver a ressalva de identidade acima) é mitigação real e verificada, e a redução
em `calibration` (58 → 3) é real na bancada que a mediu; **nenhuma das duas é o critério.**

**E o critério não morre com A2.** Ele reaparece duas vezes a jusante, sem depender desta
seção: em **H3** como gate de publicação ("limite de erro de inferência **por comprimento**")
e em **I1** como condição de promoção a `indicator` ("erro de inferência `<= 0,001` no
replay" de `dev + cal-A + cal-B`). Fechar A2 mais tarde é atraso; **não** fechar o número
antes de H3/I1 é reprovação mecânica. Quem herdar isto não precisa reabrir A2 para descobrir
que o número é devido.

**A causa dos três residuais é outro defeito, e não é de A2:** `segmentBasicWords`
(`model-runtime.ts`) não espelha `tokenize_chinese_chars: true` do
`tokenizer_config.json`. O BasicTokenizer do BERT separa **cada** ideograma CJK em
palavra própria; `segmentBasicWords` trata a sequência como uma só. Medido: os cinco
documentos com *coarse fallback* que inspecionei têm CJK e mais primeiras-peças que
palavras (por exemplo 202 peças iniciais contra 200 palavras), o que dessincroniza os
fluxos e derruba a verificação global `tokenIndex !== tokens.length`. São 21
documentos em `development` + `calibration` (7 + 14), todos `madras` ou
`wikipedia_pt`; 18 têm ≤ 510 tokens, uma janela só, e pontuam hoje. Corrigir isso muda
**offsets**, o que é escopo de **A5** (que já prevê o incremento de
`contentCompositionVersion` e exige o mapa `normalizado → original`), e a fonte
`madras` sai da v3 por D2. Fica registrado, não corrigido aqui.

A evidência bruta desse diagnóstico está em `benchmark/out/rebuild-v3/a2/coarse-cause.txt`
(uma linha por documento, com `firstPieces` vs `words` e a primeira palavra em que os
fluxos divergem) e o teste que a produziu em
`benchmark/out/rebuild-v3/a2/lab/zz-a2-coarse.test.ts.txt`. **`benchmark/out/` é ignorado
pelo Git** (`.gitignore:24`), então A5 **não pode depender** de esses arquivos existirem:
o `.txt` no `lab/` é o código-fonte do teste, guardado ali justamente para que a medição
seja **regenerável** — copie-o para `tests/unit/inference/` (ou equivalente), rode, apague.
A conclusão que importa e que não depende do arquivo: `segmentBasicWords` produz mais
primeiras-peças do que palavras em texto com CJK, e é essa dessincronia que derruba
`deriveWordPieceOffsets` no *coarse fallback*.

**`contentCompositionVersion` NÃO foi incrementada, e a `v2` que uma entrega intermediária
gastou foi REVERTIDA para `lexical-content-v1`.** Vale a pena registrar o vai-e-vem, porque
ele é instrutivo: a primeira entrega deixou em `v1` e escreveu aqui a própria dispensa; uma
revisão de spec exigiu o incremento, corretamente, porque **o plano mandava** ("incrementar
`contentCompositionVersion`", item 2); e o incremento foi então revertido porque **o plano
nomeava a coordenada errada**. A instrução era a autoridade certa apontando para o campo
errado, e a própria nota de atenção do item 2 já apontava para o certo: "mudar a política de
janelas muda `aggregationVersion` e o `inferenceCoreDigest`". O item 2 do plano foi corrigido
nesta mesma entrega.

**A razão é o que a constante versiona.** `CONTENT_COMPOSITION_VERSION` versiona *como um
texto se decompõe em unidades classificadas* — o cabeçalho de
[`contracts/content-composition.ts`](../../../contracts/content-composition.ts) diz
literalmente "the single, versioned definition of how a text is decomposed into **classified
units**", com a precedência URL → hashtag → só-emoji → lexical → other, produzindo
`totalUnits`/`lexicalUnits`/`lexicalRatio` e alimentando `src/inference/eligibility.ts`.
Aparar `window.tokenEnd` é **janela de tokenizer**: não muda `lexicalRatio`, não muda
elegibilidade, não muda a decomposição. É verdade — e continua verdade — que o campo é
também **coordenada de identidade** gravada por `contracts/calibration-profile.ts`,
`contracts/model-release.ts` e `contracts/runtime-parity.ts` e comparada por
`identityMatchesParity` (`src/model-benchmark/main.ts:344`); mas ser coordenada de identidade
não o torna o carimbo de *qualquer* mudança. O carimbo da mudança de A2 é
`aggregationVersion`, que É a coordenada de identidade da regra de agregação e foi
incrementada.

**A consequência a jusante é o motivo real de a reversão não ser cosmética: `lexical-content-v2`
pertence a A5.** A5 (NFKC + remoção de largura zero + mapeamento de homóglifos) **é** mudança
de composição de conteúdo: altera a decomposição em unidades e o `lexicalRatio`. Se A2
gastasse a `v2`, A5 iria para `v3` e o histórico de versão atribuiria a mudança de composição
à causa errada, para sempre. O critério de saída de A5 continua sendo "a versão de composição
foi incrementada", e o número que ela incrementa é **`v1` → `v2`**.

**O que o incremento arrastou, medido, para quem repetir a operação.** **52** arquivos
rastreados fora de `docs/` fixam a string de agregação, e a substituição **não** é cega: três
testes usavam justamente o novo valor como o valor **divergente** de um teste de *drift*, e a
substituição os tornaria silenciosamente iguais ao valor base — provando nada.
`tests/unit/contracts/runtime-parity.test.ts` ("binds every identity field into the
digest") e `tests/unit/storage/cache.test.ts` ("changes when any sealing coordinate…")
passaram a derivar o mutante do próprio valor base com sufixo `-mutated`, o que não pode
colidir com um incremento futuro; `tests/unit/inference/calibration-registry.test.ts`
passou a `tmr-aggregation-v3-other`. Além disso, os `profileDigest` das fixtures em
`tests/fixtures/model-release/**` são o SHA-256 canônico do perfil **incluindo** as duas
coordenadas, então foram recomputados (e com eles `release.calibrationSetDigest`); sem
isso 34 testes em 7 arquivos ficam vermelhos com `profileDigest does not match the
canonical digest`. Os dois planos de 2026-07-19 (fases 1 e 4) ainda citam
`tmr-aggregation-v2` / `lexical-content-v1` em trechos de código: são **registro
histórico** do que aquelas fases especificaram e não foram reescritos.

**A reversão da composição arrastou a mesma cadeia, e recomputá-la é o trabalho de verdade.**
Voltar a `lexical-content-v1` moveu os oito digests derivados de novo — cinco `profileDigest`
e três `calibrationSetDigest` em `tests/fixtures/model-release/**` —, e eles foram
**recomputados com as próprias funções do contrato** (`computeCalibrationProfileDigest` e
`computeCalibrationSetDigest` de `contracts/calibration-profile.ts`), nunca escritos à mão:
canonicalização à mão é exatamente como se produz um digest que passa no olho e falha no
parser. Os valores **não** voltaram aos de `0e4231c`, porque `aggregationVersion` continua em
`v3` — a coordenada revertida é uma das duas que entram no mesmo SHA. Uma ressalva de
ambiente que custa tempo se for ignorada: este repositório tem `core.autocrlf=true` e nenhum
`.gitattributes`, então `git archive` **converte para CRLF** e qualquer digest calculado sobre
essa extração está errado; para comparar identidades entre commits, extraia com
`git cat-file blob` (bytes brutos). Uma cópia não rastreada também tinha de ser ressincronizada:
`public/models/cleanfeed-ptbr-v1/cleanfeed-model.json` é o mesmo objeto que
`package-own-model.mjs` escreve nos dois destinos, e enquanto ela ficou em `v2`
`npm run model:verify` reprovava com `MANIFEST_FIELD_INVALID`.

**Contabilidade de janelas: a guarda que a torna um contrato.** O requisito 3 do item 1
exige que `candidateWindowCount`, `truncated` e os índices originais sobrevivam até o
relatório. Uma `selection` **fornecida** é a afirmação de que as janelas pontuadas são
exatamente as que ela escolheu; se for falsa, esses três campos descrevem um subconjunto
diferente do que o modelo viu, que é precisamente a perda de informação que o requisito
proíbe. Por isso a agregação falha fechado com `WINDOW_SELECTION_MISMATCH` em vez de
discordar em silêncio — é a aplicação do requisito 3, não um recurso extra. Registrado
aqui porque o código foi adicionado a `contracts/failure-detail.ts`, arquivo fora da
lista de A2.

**Desvio ABERTO e NÃO RATIFICADO, registrado para não ser re-litigado do zero.** Uma
revisão de conformidade exigiu **remover** essa guarda e o seu código, "mantendo o
comportamento anterior para uma seleção malformada", a menos que o desvio fosse
ratificado. A guarda foi **mantida** e a razão é factual, não preferência: *não existe*
comportamento anterior a manter. `git show 0e4231c^:src/inference/aggregator.ts` mostra a
assinatura `aggregateWindowsV2(windows: WindowScore[], totalTokenCount: number)` — sem
parâmetro de opções e sem qualquer forma de fornecer uma seleção —, e o corpo fazia
`selection.selectedIndices.map((index) => windows.find(...)!)`, uma asserção non-null que
colocaria `undefined` no array pontuado. Remover a guarda, portanto, **não restaura** nada:
cria um caminho novo em que `candidateWindowCount`, `truncated` e `selectedWindowIndices`
descrevem um subconjunto e `coverage` é computado sobre outro. Quem tiver autoridade sobre
o plano decide: se a remoção for ratificada, são duas deleções pequenas (o ramo em
`aggregator.ts` e a entrada em `contracts/failure-detail.ts`). Até lá isto fica como
desvio aberto, com a evidência acima, e **não** como pendência silenciosa.

**LACUNA DE PARIDADE DE RUNTIME — o achado mais importante desta entrega, e não é de A2.
Endereçada em F1.** A2 corrigiu o caminho da **bancada**
(`src/model-benchmark/main.ts:261,272`, que usa `buildContentWindows` + `fitWindowSlice`). O
caminho do **runtime** ficou como estava, em dois lugares:

- [`inference-worker.ts:27`](../../../src/inference/inference-worker.ts#L27) importa
  `createTextChunks` e [`:331`](../../../src/inference/inference-worker.ts#L331) o chama para
  montar os chunks; o laço então infere **todo** chunk e só
  [`:520`](../../../src/inference/inference-worker.ts#L520) chama `aggregateWindowsV2` — sem
  `options`, portanto **sem seleção prévia** — e em nenhum ponto passa por `fitWindowSlice`.
  Os DOIS defeitos que A2 corrigiu continuam ali.
- [`model-smoke/main.ts:175-224`](../../../src/model-smoke/main.ts#L175) tem um construtor de
  janelas **privado** (`buildWindows`) e um `scoreDocument` que fatia o texto direto dos
  offsets, também **sem aparagem**.
- [`chunker.ts:137-142`](../../../src/inference/chunker.ts#L137) já reconhece a duplicação em
  comentário, o que é honesto e não é conserto.

**Consequência exata, sem eufemismo:** o documento que perdia o escore por **um** token
continua perdendo-o na extensão. A mitigação medida vale para a bancada; o produto não a
tem. Nenhum dos dois arquivos está na lista de **Arquivos** de A2, então isto é **registro**,
não escopo desta tarefa — e F1 já tem o critério exato que o fecha: "a política de janelas do
treino e a do runtime são lidas da **mesma fonte**, e existe teste que prova a equivalência".
`inference-worker.ts` e `model-smoke/main.ts` devem entrar na lista de arquivos de F1.

**A tensão honesta, e as duas metades são verdadeiras.** A primeira entrega de A2 deduplicou
o `model-smoke`; a dedução foi **revertida**, e a reversão foi **certa** para o escopo de A2
(a única cobertura executável daquele arquivo é um spec de Playwright fora da verificação
desta tarefa, então a mudança seria feita às cegas). A mesma reversão **restaura uma
duplicação que F1 precisa matar**. Registrar as duas coisas é o ponto: quem fizer F1 não deve
descobrir a duplicação como surpresa, nem tratá-la como negligência de A2.

### A3 — Erro de inferência deixa de virar verdadeiro negativo

**Depende de:** nada (independente de A1/A2).

**Por que:** [`evaluate.ts:157`](../../../benchmark/commands/evaluate.ts#L157) faz
`documentRawScore: prediction.documentRawScore ?? 0`. Uma linha `status: "error"` tem
escore `null`, o `?? 0` a converte no escore **mais humano possível**, e
[`metrics.ts:550-551`](../../../benchmark/metrics.ts#L550) monta os negativos com
`items.filter(isHumanNegative)` sem filtro de status. Resultado: os 325 documentos que
falharam entraram como **verdadeiros negativos**. Viés assimétrico e todo favorável.

**Arquivos:** `benchmark/commands/evaluate.ts`, `benchmark/metrics.ts`,
`benchmark/report.ts`.

**Mudança:** remover a substituição; tornar `error` um ramo explícito; publicar **duas
famílias de métricas** (R5):
- **fim-a-fim** sobre todos os elegíveis, com erro contando como não-detecção;
- **condicional** a `status = "scored"`;
- cobertura e taxa de erro **por fonte, classe, faixa de comprimento e plataforma**.

Excluir os erros do denominador e parar aí é errado também: faria um sistema frágil
parecer melhor.

**Verificar:** `vitest run benchmark/tests/metrics.test.ts` com um caso novo que tenha
linha de erro; conferir que as duas métricas diferem quando há erro e coincidem quando
não há.

**Concluída quando:** nenhum caminho do avaliador atribui escore a linha de erro, e o
relatório mostra o par de métricas.

**Executado (2026-07-27).** O que foi entregue, e onde divergiu do texto acima:

1. **`EvaluationItem` virou união discriminada por `status`.** Só o ramo `scored`
   carrega `documentScore`, `warned` e `visualActioned`; `abstained` e `error` não
   carregam escore nem decisão. Não sobrou lugar para substituir escore — a proibição
   passou a ser regra do compilador, não convenção. `evaluate.ts` expõe
   `buildEvaluationItem`, que ramifica no `status` e **falha fechada**
   (`SCORED_PREDICTION_WITHOUT_SCORE`) numa linha `scored` com escore nulo.
2. **O par de famílias é `DecisionFamilies { endToEnd, conditionalOnScored }`**, e cada
   `DecisionMetrics` carrega o próprio campo `family`, então nenhum consumidor lê uma
   taxa sem saber o denominador. `metrics.warning` e `metrics.visualAction` passaram a
   ser esse par; os call sites (`gates.ts`, `slices.ts`, `profile-artifact.ts`,
   `report.ts`) foram atualizados mecanicamente e **todos leem `endToEnd`** — a família
   nunca mais favorável, logo nenhum gate foi afrouxado (R3).
3. **Célula nova, explícita:** `undecidedPositives` / `undecidedNegatives`. Um positivo
   sem decisão é falso negativo; um negativo sem decisão **não** é verdadeiro negativo e
   **não** é falso positivo — é uma célula própria. Duas decisões registradas aqui:
   - `falsePositiveRate` é `FP / (FP + TN)`, sobre os negativos que **receberam
     decisão**, nas duas famílias. Colocar as linhas sem decisão no denominador
     **reduziria** a taxa: é exatamente o viés favorável que o `?? 0` produzia. Contar
     um erro como acusação seria inventar acusação que não houve. A correção real está
     na célula: a linha de erro saiu de `trueNegatives`, e por isso a FPR **sobe** em
     relação ao comportamento antigo.
   - `clearanceRate` é `TN / negatives` sobre **todos** os negativos da família: uma
     linha sem decisão não é liberação correta. É aí que o erro cai no lado
     desfavorável, e é uma das grandezas em que as famílias diferem.
   Consequência: `falsePositiveRate` coincide entre as famílias por construção (só uma
   linha escorada é decidida); quem difere é `recall`, `clearanceRate`, os contadores e
   as células sem decisão. O teste de aceitação afere as duas coisas.
4. **Denominador dos dois pontos de operação virou o conjunto elegível** (pt-BR e
   `wordCount >= minimumEligibleWords`), como o texto pede; antes as matrizes rodavam
   sobre todos os itens. `coverage`/`abstentionRate`/`errorRate` já eram sobre elegíveis.
   **A restrição para aí.** `metrics.mixed` (`atLeastHalfAi` e `byFraction`) é bloco
   gateado **separado**, e o texto de A3 não fala dele: continua rodando sobre **todos**
   os itens. A primeira entrega de A3 o havia trocado para `eligible` — mudança eletiva,
   não forçada pela união (`mixedAtLeastHalfAi` aceita `EvaluationItem[]` e já narra por
   `isScoredItem`) e **afrouxamento medido**, portanto revertida na rodada de correção.
   Ver item 7.
5. **`metrics.resolution`** publica cobertura, abstenção e taxa de erro por
   `provenance.sourceId`, `label`, faixa de `sizeBucket` e `platform`, com chaves em
   ordem de codepoint; `report.ts` renderiza as quatro tabelas e o par de famílias numa
   tabela com os dois papéis nomeados.
6. **Abstenção recebe o mesmo tratamento de célula que erro** (não é sucesso, e conta
   como não-detecção em `endToEnd`). R5 fala de erro; estender à abstenção é o que
   mantém a conta coerente, já que uma linha `abstained` também não tem escore por
   schema. `abstentionRate` continua reportada em separado de `errorRate`.

**Rodada de correção (2026-07-27), depois da revisão de conformidade.** Dois defeitos
introduzidos pela primeira entrega, ambos no lado favorável, ambos corrigidos:

7. **`metrics.mixed` volta a rodar sobre `items`** (`benchmark/metrics.ts`). A troca para
   `eligible` encolhia uma população **gateada**, o que é afrouxamento (R3). Medido, não
   argumentado: com uma linha mista elegível avisada (120 palavras, `aiFraction` 0,9) mais
   uma linha mista inelegível (30 palavras, `abstained`), o código da primeira entrega dava
   `mixed.atLeastHalfAi = { sampleSize: 1, warningRecall: 1 }`; o código pré-A3 e o atual
   dão `{ sampleSize: 2, warningRecall: 0,5 }`. `gates.ts` alimenta exatamente esse número
   em `mixedRecallGate`, cuja barra é `MIXED_WARNING_RECALL_MIN = 0,5`: um valor que estava
   **na** barra passava a folgá-la. Pior, `mixedRecallGate` calcula
   `eligible = sampleSize > 0` e `passed = !eligible || …`, então empurrar a população para
   zero converte reprovação dura em **aprovação incondicional**, e `profile-artifact.ts`
   republicaria a figura com intervalo de Wilson sobre um `n` menor. A narração
   `isScoredItem(item) && item.warned` **fica**: linha mista errada ou abstida continua
   contando como perda no numerador. Pinado por
   `benchmark/tests/metrics.test.ts > "keeps the mixed gate population over every mixed row,
   eligible or not"`. Se a restrição a elegíveis for desejável, ela **não é de A3**: exige
   evidência medida e justificativa escrita aqui (R3), e fica proposta a A6/G2.
   **São dois eixos, não um.** `isEligible` (`metrics.ts`) é `language === "pt-BR"` **e**
   `wordCount >= minimumEligibleWords`, então rodar sobre `items` readmite duas populações
   distintas, cada linha contando como perda contra `MIXED_WARNING_RECALL_MIN`:
   - o **piso de palavras** — linha mista curta, em que a política manda o runtime abster-se;
   - o **eixo de idioma** — linha mista com `language !== "pt-BR"`, fora do escopo do
     detector.
   As duas direções são conservadoras (denominador maior, numerador igual), logo R3 está
   satisfeita nos dois casos; mas só a primeira é questão de medição. Cobrar de um detector
   pt-BR uma linha em outro idioma é o padrão **§4.1 (gate insatisfazível)**, não medida de
   desempenho. A6/G2 decide cada eixo **separadamente**; o comentário no código nomeia os
   dois para que ninguém trate "elegível" como uma coisa só.
8. **`slice.positives` / `slice.negatives` passam a ser lidos da população medida**
   (`benchmark/slices.ts`), isto é, de `slice.metrics.warning.endToEnd`. O item 4 fez a
   matriz de cada fatia ser medida só sobre o subconjunto elegível, mas os contadores da
   fatia continuavam recontando o bucket **cru** (`bucket.filter(isHumanNegative)`). Isso
   **não** era dívida herdada: antes de A3 `decisionMetrics` rodava sobre o bucket inteiro
   e as duas contagens coincidiam — a divergência foi criada pelo commit de A3. O efeito é
   contrato, não exibição: esses números são `GateResult.sampleSize` (`gates.ts:352,371,
   482,503`) e `ProportionGateEvidenceV1.sampleSize` no perfil selado
   (`profile-artifact.ts:345,350,362,369`), então o leitor da evidência inferia mais poder
   estatístico do que o intervalo pareado tem — lado favorável, e desalinhamento
   propriedade-vs-contrato no espírito de R7. Além disso `fprGateEligible` /
   `recallGateEligible` declaravam poder sobre linhas que a taxa nunca viu. `sampleSize` da
   fatia continua descritivo (o bucket todo). Invariante pinado por
   `benchmark/tests/slices.test.ts > "declares the population that produced the estimate,
   not the raw bucket"`. **Consequência a registrar:** os pisos de 300 negativos / 200
   positivos passam a contar elegíveis, então uma fatia cujo bucket cru chega ao piso mas
   cujo subconjunto elegível não chega deixa de gatear (`eligible: false`, não-gateante) —
   é a regra de poder aplicada à população real, não um limite mexido. Caso concreto: a
   faixa `lengthBucket = 0_49` tem população elegível **vazia** por política de abstenção;
   com a contagem crua ela era declarada gateante e reprovava com `observed: null`
   (reprovação espúria), e agora sai como não-gateante. A6/G2 deve confirmar essa leitura.

**Segunda rodada de correção (2026-07-27), depois da revisão de qualidade.** Só
comentário, teste e plano: **nenhuma mudança de comportamento**, e nenhum número de gate
se moveu.

9. **O rótulo `family` e os comentários voltaram a dizer a verdade** (`benchmark/metrics.ts`).
   A reversão do item 7 falsificou duas afirmações escritas dentro de um arquivo de
   `EVALUATOR_FILES` — o mesmo defeito que o item 7 da varredura corrigiu em `fit.ts`:
   - o cabeçalho de `mixedAtLeastHalfAi` dizia "the denominator is every **eligible**
     >=50% AI mixed record". Era verdade quando o call site passava `eligible`; passou a ser
     falso. Agora diz "eligible or not" e aponta para a nota de R3 no call site.
   - `mixedByFraction` estampa `family: "end-to-end"` em matrizes cuja população **não** é
     filtrada por elegibilidade, enquanto o doc de `MetricFamily` definia "end-to-end" como
     "every **eligible** record, whatever its status". O par de números do próprio teste novo
     expõe a incoerência: no mesmo relatório, `mixed.byFraction[75_100].warning.positives = 2`
     e `warning.endToEnd.positives = 1`, ambos rotulados `end-to-end`.
   **Resolvido pelo lado da definição, não do rótulo:** `MetricFamily` agora diz que o papel
   nomeia uma regra de **status** (linha sem decisão é não-detecção, nunca remoção), não uma
   regra de elegibilidade; que a população é escolha do chamador; e que os blocos `mixed`
   reusam o papel sobre população não filtrada. Fica escrito que ninguém deve inferir
   denominador do `family` — o denominador é o `sampleSize`/`positives`/`negatives` da própria
   matriz. Trocar o rótulo em vez da definição exigiria valor novo de `MetricFamily`, que é
   campo **serializado** no relatório selado e entra no `reportDigest`; seria mudança de
   contrato sem necessidade de medição.
10. **A invariante das contagens de fatia ficou com o alcance certo** (`benchmark/slices.ts`).
    O comentário do item 8 dizia que as contagens são lidas "da população que produziu a
    estimativa", frase verdadeira para `clearanceRate` (TN/negativos) e `recall`
    (TP/positivos) e **falsa** para `falsePositiveRate` (FP/(FP+TN)) e `precision`
    (TP/(TP+FP)), que rodam sobre o subconjunto **decidido**. Logo `slice.negatives` ainda
    superdeclara o `n` do intervalo de FPR em exatamente `undecidedNegatives`: uma fatia com
    305 negativos humanos elegíveis dos quais 10 falham publica
    `criticalFprSlices[...].indicatorFpr` com estimativa sobre 295 e `sampleSize: 305`, e
    `contracts/calibration-profile.ts` valida esse 305 contra
    `MINIMUM_CRITICAL_FPR_SAMPLE = 300`. O bloco `overall` (`profile-artifact.ts`) tem a mesma
    lacuna. **Não é hipotético:** a última rodada de holdout teve 325 falhas de inferência.
    O comentário agora **delimita** a alegação (contagens de **classe**; FPR e precisão sobre
    o subconjunto decidido; resíduo nomeado `undecidedNegatives`) em vez de sugerir invariante
    total. **Decisão em aberto para A6/G2, não de A3:** se a evidência de FPR deve declarar
    `FP + TN` como o próprio `sampleSize`. Motivo de não ser de A3: o número declarado é
    contrato do perfil selado e o piso de poder é regra de gate — mexer nele exige a evidência
    medida e a justificativa que R3 pede, e `profile-artifact.ts` não está entre os arquivos
    de A3. A direção seria **mais estrita** (menos linhas → mais fácil ficar sem poder), então
    não há afrouxamento em jogo, só quem assina.
11. **`benchmark/tests/slices.test.ts` passou a ter linha `error`.** O helper `item()` do
    arquivo não tinha campo `status`: toda linha era `scored`, e por isso `endToEnd` e
    `conditionalOnScored` eram numericamente idênticas ali — o arquivo não cobria o caso que
    o módulo existe para proteger. Mutação demonstrada: trocar as duas leituras de
    `slices.ts` para `conditionalOnScored` deixava a suíte de fatias, `gates.test.ts` e
    `profile-artifact.test.ts` **verdes**. O helper agora espelha
    `benchmark/tests/metrics.test.ts` (linha não escorada não carrega escore nem decisão) e o
    teste da invariante ganhou um negativo humano **elegível e errado**: bucket cru = 4
    negativos, `conditionalOnScored` = 2, e só a população elegível fim-a-fim dá 3, então a
    mutação da leitura de `negatives` passou a falhar com `expected 2 to be 3`. **Isso cobriu
    só metade da invariante** — a fixture pinava `negatives`, não `positives`. Corrigido no
    item 12; o texto original deste item, que dizia pinar "as contagens", superdeclarava o
    alcance do teste.

**Terceira rodada de correção (2026-07-27), depois da segunda revisão de qualidade.** Também
só comentário, teste e plano: **nenhuma mudança de comportamento**, nenhum número de gate
mexido.

12. **A invariante das contagens de fatia passou a pinar `positives` também**
    (`benchmark/tests/slices.test.ts`). A fixture do item 11 tinha uma única linha errada, e
    ela era um **negativo** humano; logo `warning.endToEnd.positives` e
    `warning.conditionalOnScored.positives` valiam 1 os dois, e **toda** asserção sobre
    `positives` — inclusive a igualdade com `endToEnd` — era satisfeita pelas duas famílias.
    Medido nesta rodada, antes de tocar a fixture: trocar `slices.ts:200` para
    `metrics.warning.conditionalOnScored.positives` deixava
    `slices.test.ts` + `gates.test.ts` + `profile-artifact.test.ts` **verdes** (3 arquivos,
    35 testes, exit 0). O comentário em `slices.ts:197-199` afirmava "the end-to-end family is
    deliberate and pinned by the test" acima das **duas** leituras: para `positives` a frase
    era falsa — o mesmo defeito de alegação-escrita-falsificada que os itens 9 e 11 existem
    para remover, reintroduzido uma linha abaixo. A fixture ganhou o **espelho positivo** de
    `h3`: uma linha `label: "ai"`, elegível (120 palavras), `status: "error"`. Agora as três
    populações candidatas são distintas nas duas classes — `negatives`: cru 4, fim-a-fim 3,
    condicional 2; `positives`: cru 3, fim-a-fim 2, condicional 1 — e a mutação de `positives`
    falha com `expected 1 to be 2`. **Dano concreto que isso passa a defender:** uma fatia de
    recall com 205 positivos elegíveis dos quais 8 falham publica `endToEnd.positives = 205`,
    fica acima de `DEFAULT_MINIMUM_RECALL_POSITIVES` e é gateada; lendo a família condicional
    daria 197, a fatia cairia abaixo do piso e sairia de `criticalRecallSlices` **e** da busca
    de pior fatia em `summarizeSlices` — a fatia mais prejudicada pelas falhas de inferência
    escaparia do gate de recall, no lado favorável.
13. **`MetricFamily` atribui o rótulo ao bloco que o carrega** (`benchmark/metrics.ts`). O doc
    do item 9 dizia que "os dois blocos `metrics.mixed`" carregam `family: "end-to-end"`. Só um
    carrega: `mixed.byFraction[].warning` é `DecisionMetrics` e tem o campo;
    `mixed.atLeastHalfAi` é `{ sampleSize, warningRecall, warningRecallLower95 }` e **não tem
    campo `family`**. Num bloco cujo propósito é evitar que o leitor re-derive a semântica, a
    imprecisão obrigava exatamente essa re-derivação. O texto agora separa os dois casos.
14. **O ponteiro para o plano em `benchmark/slices.ts` deixou de ser numérico.** Ele apontava
    para "A3 item 9" (reconciliação do `family`) quando a decisão em aberto sobre o
    denominador da FPR está no item 10. Trocado por ponteiro **por nome** — "o item titulado
    pela invariante das contagens de fatia, o que nomeia `undecidedNegatives`" —, no mesmo
    estilo já usado em `metrics.ts`, para sobreviver a renumeração.
15. **O guarda do helper `item()` cobre as três colunas do ramo `scored`**
    (`benchmark/tests/slices.test.ts` e `benchmark/tests/metrics.test.ts`). Ele checava
    `documentScore` e `warned` mas não `visualActioned`, que também é decisão: uma linha
    `{ status: "error", visualActioned: true }` era aceita e a decisão visual descartada em
    silêncio, com a mensagem do próprio helper ("carries no score and no decision") valendo só
    dois terços — e `visualAction` é justamente a família que nenhuma asserção de
    `slices.test.ts` lê. Corrigido nos **dois** helpers, para que sigam espelhos.

**Varredura do avaliador (requisito de A3), com o que ficou de fora:**

- `benchmark/commands/fit.ts:178-179` **mantém** `documentRawScore ?? 0` na amostra de
  **seleção de limiar** (o ajuste do calibrador já era restrito a `scored`). Não foi
  tocado: `commands/fit.ts` e a construção do limiar pertencem a **G1/G2**, e G2 reescreve
  essa população inteira. Fica registrado como defeito conhecido, porque a justificativa
  escrita naquele comentário — "stay symmetric with evaluate.ts's decision metrics" —
  **deixou de valer** com A3: evaluate não escora mais linha sem decisão. Contaminar a
  amostra humana com zeros puxa o quantil para baixo, isto é, derruba o limiar e
  **aumenta** a FPR real; G2 deve construir o quantil só sobre humanos escorados.
  O **comentário** acima das linhas 178-179 foi corrigido na rodada de correção: um arquivo
  dentro de `EVALUATOR_FILES` não pode carregar justificativa falsa. Ele agora nomeia o
  defeito como conhecido, diz que a simetria com `evaluate.ts` terminou em A3, e escreve a
  direção do viés. O **comportamento** ficou intacto, para não invadir G1/G2.
- `record.mixture?.aiFraction ?? 0` (`metrics.ts`, `slices.ts`, `fit.ts:290`) não é
  substituição de escore: o schema já exige `mixture` para `label = "mixed"`, e as duas
  leituras fora disso são guardadas por `label === "mixed"`.
- `benchmark/split.ts:126` e `benchmark/cli.ts:191` usam `Number(...)` seguido de
  `Number.isFinite` com erro codificado — sem coerção silenciosa.
- `benchmark/dataset-manifest.ts:375,498,506` e `benchmark/split.ts:398+` usam `?? 0`
  como valor inicial de contador, não como escore.

**Achado fora do escopo de A3, para G5 (registrado, não corrigido):** o repositório não tem
`.gitattributes` e a máquina do operador tem `core.autocrlf = true`. Um `git checkout` de
`benchmark/metrics.ts` rematerializa o arquivo com CRLF (medido na revisão: 1076 CRLF,
37.726 bytes contra 36.650) com `git status` ainda limpo, e `computeEvaluatorDigest`
(`benchmark/digests.ts`) hasheia os **bytes crus em disco**. Consequência: um clone novo
calcula `integrity.evaluator-digest` diferente da máquina que selou — a identidade congelada
de R1/G5 **não é reproduzível entre checkouts**. Antes de congelar a janela
`fit` → `consume-holdout`, G5 precisa de `.gitattributes` com `* text=auto eol=lf` (ou
`*.ts eol=lf`). Não é de A3 e não foi mexido.

### A4 — Identificador canônico de família geradora

**Depende de:** nada.

**Por que:** o mesmo erro de grafia quebra **dois** mecanismos.
`generation.family` usa pontos (`gemini-3.5-flash-low`), `groups.generatorFamily` e
`manifest.heldOutGeneratorFamilies` usam sublinhados (`gemini-3_5-flash-low`).
- [`slices.ts:129-134`](../../../benchmark/slices.ts#L129) compara com
  `generation.family` → a fatia `generatorExposure` só tem `seen`, e os 769 registros
  semeados para medir gerador não visto foram reportados como vistos.
- [`split.ts:359-360`](../../../benchmark/split.ts#L359) compara com
  `generation.family` → `component.heldOut` **nunca** fica verdadeiro, e a restrição
  "família retida vai para o teste" (`split.ts:249,380`) nunca foi exercida. O
  invariante valeu por acidente do `createdAt` sintético.

**Arquivos:** `benchmark/schema.ts`, `benchmark/split.ts`, `benchmark/slices.ts`,
`benchmark/dataset-manifest.ts`, `benchmark/report.ts`, `benchmark/lab/assemble_corpus.py`.

**Mudança:** um único campo canônico, validado pelo schema, com função de
normalização única. Adicionar **invariante de igualdade exata** entre: famílias
declaradas no manifesto, marcadas no split, derivadas pela auditoria e publicadas no
relatório — falha dura em divergência, não aviso.

**Verificar:** teste que declara uma família retida e afirma que (a) o split a força ao
teste, (b) a fatia `generatorExposure` produz um bucket `unseen` não vazio, (c) uma
grafia divergente **falha** em vez de passar silenciosamente.

**Concluída quando:** o teste acima passa e `grep` não encontra mais nenhuma comparação
de família contra campo não canônico.

### A5 — Normalização Unicode no caminho de inferência

**Depende de:** nada.

**Por que:** homóglifos zeram detectores — Binoculars e Fast-DetectGPT vão a 0,000 de
TPR@1%FPR e o Originality perde 75,7 pontos no RAID. É classe de bug, não pesquisa. O
`near_dupes.py` faz NFKC, mas isso é o montador, não o detector.

**Arquivos:** o pré-processamento do detector (`src/inference/`), e o mesmo caminho no
`model-benchmark`.

**Mudança:** NFKC + remoção de caracteres de largura zero + normalização de homóglifos
antes da tokenização, versionada em `contentCompositionVersion` para que a mudança seja
rastreável.

**Duas restrições que a normalização precisa respeitar:**
1. **Não destruir português legítimo.** Mapear cirílico `а` → latino `a` é correto;
   mexer em `ç`, `ã`, `õ` ou em pontuação legítima não é. A tabela de mapeamento precisa
   ser explícita e testada contra texto pt-BR real, não herdada de uma lista genérica.
2. **Produzir um mapa `normalizado → original`.** A normalização muda offsets de
   caractere, e os spans de proveniência de D4 são definidos em offsets. Sem o mapa, a
   cabeça de nível de span passa a treinar sobre offsets deslocados — bug silencioso e
   difícil de achar depois.

**Verificar:** teste com o mesmo texto em variante homóglifa produzindo escore
equivalente (dentro de tolerância declarada); teste que prova que acentuação e cedilha
sobrevivem; e teste que reconstrói offsets originais a partir do mapa.

**Concluída quando:** os três testes passam e a versão de composição foi incrementada.

### A6 — Métricas e gate de calibração

**Depende de:** A3.

A6 implementa o contrato e testa com planos de reamostragem sintéticos válidos. A
execução sobre o corpus real continua bloqueada por C4 e G5: sem o plano hierárquico ou
multiway de C4, o gate falha por evidência ausente em vez de cair para linhas i.i.d.

**Por que:** o gate de ECE é **estimativa pontual** — único gate numérico que não usa
limite, embora o relatório já calcule o bootstrap (0,0731–0,0908). E ECE-15 com bins de
largura fixa é sensível à escolha dos bins e esconde erro condicional. Além disso o
relatório publica ROC-AUC 0,9647 e PR-AUC 0,9788, que são justamente as métricas que
descolam do comportamento em FPR baixo.

**Arquivos:** `benchmark/rebuild-v3-policy.json`,
`benchmark/rebuild-v3-policy.ts`, `benchmark/digests.ts`,
`benchmark/metrics.ts`, `benchmark/gates.ts`, `benchmark/report.ts`,
`benchmark/tests/rebuild-v3-policy.test.ts`, `benchmark/tests/metrics.test.ts`,
`benchmark/tests/gates.test.ts`.

**Mudança:**
- gate de ECE passa a usar limite superior do bootstrap, não o ponto;
- adicionar ao relatório, com os papéis nomeados: **recall e FPR no limiar congelado**
  como métrica de release (ver H2), e **TPR@1%FPR + AUROC como diagnóstico de
  separabilidade** — nunca o contrário; mais Brier, log-loss, intercept e slope de
  calibração, diagrama de confiabilidade, **ECE equal-mass com 15 bins**, e
  calibração por comprimento, fonte, estrato linguístico e, para negativos humanos,
  **`labelBasis`**;
- publicar contagem, número de unidades amostrais e intervalos **separados** para
  `date-cutoff` e `observed-process`. Uma fatia `observed-process` abaixo do poder
  pré-registrado é diagnóstico suplementar: não pode aprovar gate, elevar teto de ação
  nem sustentar alegação mais forte para o agregado;
- adicionar **PPV e NPV** em prevalências plausíveis — o conjunto é ~50/50 e um feed é
  majoritariamente humano, então o escore calibrado nesse prior não é probabilidade
  posterior de autoria. (`simulatedPrecision` já existe em `metrics.ts` em 1/5/10%;
  estender e publicar com NPV.)
- aplicar aos gates estatísticos de H1 intervalos unilaterais simultâneos por
  **Bonferroni**, com `alpha_família = 0,05` dividido pelo número de gates elegíveis
  pré-registrados. `m` é congelado em G5 a partir de todos os gates estatísticos
  obrigatórios; célula sem poder continua em `m` e reprova, não reduz o divisor.
  Integridade e diagnósticos não entram. Intervalos individuais de 95% continuam no
  relatório, claramente marcados como descritivos.

**Verificar:** `vitest run benchmark/tests/metrics.test.ts benchmark/tests/gates.test.ts`.

**Concluída quando:** o relatório traz TPR@1%FPR ao lado do AUROC, o gate de ECE usa
intervalo, e misturar bases de rótulo deixa de ocultar a contagem e o intervalo de cada
uma.

### A7 — O `fprUpper95` do `fit` é diagnóstico, não garantia

**Depende de:** nada.

**Por que:** `selectWarningThresholds`
([`calibration-pipeline.ts:451`](../../../benchmark/calibration-pipeline.ts#L451)) é uma
busca **exata O(n²)** sobre todos os valores de escore como candidatos, escolhendo o par
de maior recall que cabe no orçamento — milhões de hipóteses nos mesmos 2000 negativos.
O `fprUpper95` gravado em `thresholdEvidence` é o Wilson nominal do par vencedor,
calculado nos dados que o escolheram: **não é limite pós-seleção**. A assinatura está no
artefato: o vencedor ficou em 4,62% contra orçamento de 5,00%, encostado na restrição.

**Arquivos:** `benchmark/calibration-pipeline.ts`, `benchmark/report.ts`.

**Mudança:** renomear o campo para deixar a natureza explícita (ex.:
`selectionFprUpper95Nominal`) e documentar no artefato que a certificação vem do teste
cego. Não é mudança de matemática — é mudança de rótulo, para remover a leitura errada
na origem. G2 constrói o limiar; a certificação propriamente dita vem de **H1**.

**Concluída quando:** nenhum campo do artefato congelado sugere garantia de 95% sobre
dados de seleção.

**Verificar:** `vitest run benchmark/tests/calibration-pipeline.test.ts
benchmark/tests/report.test.ts`; a fixture deve distinguir
`selectionFprUpper95Nominal` de `certifiedFprUpper`.

---

## Fase B — Decisões fechadas que bloqueiam o resto

Estas decisões já foram tomadas. O implementador apenas as materializa nos contratos,
testes e avisos indicados; não existe checkpoint de escolha nesta fase.

### B1 — DECIDIDO: política não comercial e Carolina admissível

**Depende de:** nada.

O produto e o modelo **não têm e não terão ambição comercial**. O Carolina
**CC BY-NC-SA 4.0** permanece admissível
([`models/cleanfeed-ptbr-v1/NOTICE.md`](../../../models/cleanfeed-ptbr-v1/NOTICE.md)).
Não existe variante comercial a preservar.

**Arquivos:** `docs/corpus-sources.md`, `models/cleanfeed-ptbr-v1/NOTICE.md`,
`models/cleanfeed-ptbr-v1/license-review.json`, `benchmark/source-manifest.ts`,
`benchmark/tests/source-manifest.test.ts`.

**Mudança:** registrar `commercialUse: false`, a licença exata por fonte, atribuição,
share-alike e o bloqueio de uso comercial no inventário, no review do modelo e no
NOTICE. Fonte `NC` é admissível; fonte `ND` continua proibida para corpus derivado.

**Verificar:** `vitest run benchmark/tests/source-manifest.test.ts` e `npm run
docs:check`; fixture com `commercialUse: true` e Carolina deve falhar.

**Concluída quando:** manifesto, review e NOTICE concordam que o artefato é não
comercial, Carolina está admissível e IberAuTexTification continua bloqueado por `ND`.

### B2 — DECIDIDO: alvos, métricas e ações de produto

**Depende de:** nada.

O detector estima **compatibilidade textual com geração por IA**, não autoria nem uso
real de uma ferramenta. Os três alvos são fechados:

| alvo | regra de anotação | métrica de gate | ação de produto |
|---|---|---|---|
| documento integralmente gerado | `label = ai`; geração integral registrada | recall de aviso e de ação no limiar congelado | `indicator`; ação visual somente se os gates de documento passarem |
| assistência material mecanística | `label = mixed`, `generationMode = mechanistic`, `aiFraction >= 0.50` | `warning.mixed-recall >= 0.50`; curva completa v0–v8 diagnóstica | **somente `indicator`** |
| spans observados | spans contíguos registrados pela operação de D4 | IoU de span, precisão/recall de token e recall do caminho localizado, todos diagnósticos nesta versão | explica/localiza um aviso; nunca autoriza ação visual sozinho |

Misto com `aiFraction < 0.50` não é negativo humano nem positivo de release. Texto
`ecological`, se aparecer numa base pública instrumentada, é uma coorte separada e não
é agregado ao mecanístico.

**Arquivos:** `benchmark/schema.ts`, `benchmark/metrics.ts`, `benchmark/gates.ts`,
`src/shared/classification-copy.ts`, `src/shared/classification-copy.json`,
`docs/superpowers/specs/2026-07-19-tmr-ptbr-classifier-design.md`.

**Verificar:** `vitest run benchmark/tests/schema.test.ts
benchmark/tests/metrics.test.ts benchmark/tests/gates.test.ts`; testes provam que misto
abaixo de 50% não entra em denominador de gate e que misto nunca eleva
`actionCeiling` acima de `indicator`.

**Concluída quando:** schema, métricas, gates e copy implementam exatamente a tabela e
nenhuma mensagem afirma autoria, intenção ou processo real.

### B3 — DECIDIDO: só bases públicas, sem coleta individual autorizada

**Depende de:** nada.

**Decisão registrada em 2026-07-26.** O projeto **não tem condições de adquirir textos
individualmente com autorização**. Não recrutará doadores, não obterá consentimento por
documento e não registrará sessões próprias de escrita. A coleta humana se limita a
**bases de dados públicas com licença compatível**. Isso não exclui bases públicas que já
contenham sessões instrumentadas: elas continuam admissíveis, sujeitas às mesmas
verificações de licença, idioma, proveniência e adequação ao estimando.

Isso resolve B3 pela terceira via: **o produto será calibrado e comunicado como detector
de texto pt-BR genérico**, não como detector calibrado para feed profissional. É uma
limitação de projeto, não uma pendência — ver §7.

**O que resta como base do rótulo humano: o corte de data.** `common.py:149` já tem
`date_cutoff: datetime | None = CHATGPT_CUTOFF` como **padrão**, e
`docs/corpus-sources.md` já declara a política: corte em **`< 2022-11-30` (pré-ChatGPT),
independentemente do vintage do dump**.

É **mitigação de risco, não prova de autoria** (ver L1). O corte exclui ChatGPT **apenas
se a data for confiável**, e não exclui: assistência por ferramentas anteriores a
nov/2022 (tradução automática, geração GPT-2/GPT-3, spinners, paráfrase automática),
data de contêiner divergente da data do texto, nem republicação com data enganosa. E é
**evidência mais fraca que sessão instrumentada**, não mais forte: um doador com
histórico de versões dá *observação do processo*; uma data dá *exclusão circunstancial de
uma ferramenta*.

**O que a decisão custa, e é preciso dizer com clareza:**

1. **Contemporaneidade.** O rótulo humano do corpus *core* fica ancorado em texto
   pré-nov/2022. Bases públicas contemporâneas e instrumentadas existem (AITDNA,
   CoAuthor), mas não atingem a escala nem as fatias de calibração exigidas (L1). Fora de
   uma coleta instrumentada, texto público recente pode ter assistência de IA, e a data
   de publicação sozinha não permite verificar o processo de autoria.
2. **O domínio do produto.** Não existe base pública licenciada de publicação
   profissional pt-BR. O FPR em feed profissional **não será medido**, e como ele varia
   de **0% a 7,12% conforme o estrato linguístico** (§1 do assessment), extrapolar dos
   estratos calibrados para o feed é uma inferência sem cota superior.
3. **A ambição da alegação.** Ver H4 e §7.

**Consequência de engenharia que compensa parcialmente:** se não é possível calibrar no
domínio de operação, o limiar deve ser escolhido contra o **pior estrato linguístico
calibrado**, não contra a média. Entre os estratos disponíveis, o mais próximo de um post
de feed é o informal curto (avaliações B2W, Q&A) — que é exatamente onde o falso alarme
foi pior. Isso é conservador de propósito e vai declarado em G2.

**Arquivos:** `docs/corpus-sources.md`, `docs/corpus-collection-runbook.md`,
`benchmark/source-manifest.ts`, `benchmark/tests/source-manifest.test.ts`.

**Verificar:** `vitest run benchmark/tests/source-manifest.test.ts` e `npm run
docs:check`; fonte individual sem licença pública compatível e registro sem
`labelBasis` devem falhar.

**Concluída quando:** runbook e manifesto só admitem bases públicas licenciadas, bases
instrumentadas públicas permanecem representáveis e nenhum passo exige recrutamento.

---

## Fase C — Proveniência e grupos (o bloqueio P0)

**Nada a jusante é confiável antes desta fase.** Split, validação cruzada, bootstrap e
dimensionamento dependem de eixos de agrupamento reais.

### C1 — Schema v3 com proveniência real

**Depende de:** B1, B2.

**Por que:** medindo o corpus selado, **seis dos oito `GROUP_KEYS` são identificadores
sintéticos únicos por registro e dois nunca são preenchidos**:

| eixo | distintos | maior grupo |
|---|---:|---:|
| `author`, `source`, `domainSource`, `nearDuplicate`, `derivationRoot` | 10.000 cada | 1 |
| `collectionBatch` | 4.067 | 476 |
| `generatorVersion`, `promptTemplate` | **0 — nunca preenchidos** | — |

A origem é [`assemble_corpus.py:154-163`](../../../benchmark/lab/assemble_corpus.py#L154),
com o comentário `# All UNIQUE per record so the blocked split sees singleton components.`
Foi deliberado, está documentado, e a consequência não foi pensada:

1. **A auditoria de leakage é tautológica.** `leakages: []` valida identificadores
   construídos para nunca colidir.
2. **O bootstrap "agrupado por autor" degenera em i.i.d.**, porque `groups.author` tem
   10.000 singletons. Todo intervalo do relatório trata registros correlacionados como
   independentes. **Quanto isso estreitou os intervalos é irrecuperável** — a identidade
   real do cluster nunca foi persistida.

**Arquivos:** `benchmark/schema.ts`, `benchmark/dataset-manifest.ts`,
`benchmark/source-manifest.ts`, `benchmark/tests/schema.test.ts`,
`benchmark/tests/dataset-manifest.test.ts`.

**Mudança:** campos obrigatórios, reais e pseudonimizados, para: autor/colaborador;
página, post, thread, produto ou documento de origem; seed humano; prompt template;
versão do modelo e configuração de geração (temperatura, top-p, penalidade de
repetição, decoding); batch de coleta ou geração; raiz de derivação; cluster de
quase-duplicata. Valor desconhecido → registro inelegível (**R6**), nunca sintetizado.

O schema fechado também passa a representar a **base de evidência do rótulo humano**:

- `labelBasis: "date-cutoff" | "observed-process"` é obrigatório **se e somente se**
  `label === "human"`; é proibido em registros-linha `ai` e `mixed`, cujos rótulos vêm de
  `generation`/`mixture`. Quando IA ou misto deriva de pai humano, `derivationRoot`
  resolve o `labelBasis` do pai sem duplicá-lo no registro derivado;
- `labelEvidenceRef` é obrigatório junto com `labelBasis` e aponta para uma entrada
  digestada no manifesto privado da fonte. Para `date-cutoff`, a entrada registra campo
  de data, valor observado, cutoff e snapshot; para `observed-process`, registra
  protocolo/versão, digest do log de sessão, controles aplicados e risco residual;
- `dataset-manifest.ts` publica `labelBasisCounts` e a contagem de unidades amostrais por
  base, sem incorporar o manifesto privado nem PII ao artefato público.

> **Boa notícia medida — não é recoleta, é repropagação.** Ver §8. Para os registros de
> IA, `provider`, `family`, `model`, `version`, `recipe`, `temperature`, `seed` +
> `seedNullReason`, `promptId`, `promptSha256` e `promptTemplateDigest` **já existem** em
> `meta` nos pools de candidatos — inclusive `promptTemplate` e `generatorVersion`, os
> dois eixos que nunca foram preenchidos no corpus. E `promptId` codifica o pai humano
> (`original_src_b2w_00848b3bc692`), logo a linhagem de derivação é recuperável. Para os
> registros humanos, `candidate_id = source_id + sha1(natural_key)[:12]`
> ([`common.py:214`](../../../benchmark/lab/common.py#L214)) é **estável por
> construção**, então uma passada de re-extração sobre os snapshots (todos em disco)
> reconstrói o mapa `candidateId → ptwiki:page_id` / `pt.stackoverflow:post_id` sem
> mudar um único id.

**Concluída quando:** o schema recusa um registro com grupo ausente; recusa humano sem
`labelBasis`/`labelEvidenceRef`; recusa IA ou misto que carregue esses campos; recusa
referência de evidência ausente ou divergente; recusa derivado cujo pai humano não
resolve; e os testes provam as cinco recusas e as contagens do manifesto.

**Verificar:** `vitest run benchmark/tests/schema.test.ts
benchmark/tests/dataset-manifest.test.ts benchmark/tests/source-manifest.test.ts`.

### C2 — Montador persiste grupos reais

**Depende de:** C1.

**Arquivos:** `benchmark/lab/assemble_corpus.py` (substituir `base_groups`),
`benchmark/lab/extract_*.py`, `benchmark/lab/generate_ai.py`,
`benchmark/lab/make_mixed*.py`.

**Mudança:** cada extrator passa a emitir a identidade real da fonte (id de página,
autor, thread, produto); o gerador passa a emitir template, versão e configuração; a
mistura preserva a linhagem do pai. **Toda a árvore seed → geração → derivados fica na
mesma partição.**

**Verificar:** no corpus reconstruído, a distribuição de tamanho de cluster por eixo
não é degenerada, e o maior cluster por eixo é reportado.

**Concluída quando:** cada fonte declara todos os **eixos de agrupamento aplicáveis** com
estado `known`/`notApplicable`/`unknown` por eixo (R6); a contagem e a distribuição dos
clusters de split/exposição são publicadas por fatia; e o critério de aceitação é **poder
suficiente por estrato**.

> **Não** adicionar um critério do tipo "nenhum eixo pode ter 100% de singletons". Depois
> da poda de quase-duplicatas, `nearDuplicate` **deve** ser todo singleton — é o que a poda
> faz — e texto de IA não tem autor humano. Exigir grupos > 1 incentivaria agrupamento
> artificial, que é o oposto do que se quer.

### C3 — Split e auditoria sobre clusters reais

**Depende de:** C2.

**Arquivos:** `benchmark/split.ts`, `benchmark/split-audit.ts`,
`benchmark/cluster-exposure-ledger.ts` (novo), `benchmark/digests.ts`.

**Mudança:** a auditoria publica **quantidade e distribuição de clusters
independentes, inclusive por fatia** — não só `leakages: []`. O relatório de split passa
a carregar esses números, e eles alimentam o gate de E3.

Implementar também um **ledger append-only de exposição de clusters**, separado do ledger
de consumo do holdout:

- o artefato de dados é **único para o projeto e atravessa versões de corpus/release**.
  O caminho canônico é
  `benchmark/data/private/cluster-exposure-ledger.v1.jsonl`; criar diretório ou ledger
  novo não reinicia elegibilidade;
- o keyring canônico é
  `benchmark/data/private/cluster-exposure-keyring.v1.json`. `cluster-ledger init` cria
  uma chave aleatória de 32 bytes, `keyVersion = "v1"`, uma única vez e recusa
  sobrescrever estado existente. Rotação adiciona chave; chaves antigas permanecem no
  keyring e cada identidade nova é HMACada sob todas as versões ainda presentes. Remover
  uma chave referenciada por evento é proibido;
- cada evento identifica `datasetDigest`, `splitDigest`, execução e, por registro-linha
  **ativo**, os eixos de agrupamento pseudonimizados e a partição atribuída; também
  registra apenas o digest do manifesto privado da reserva;
- o schema de evento é fechado e versionado:
  `schemaVersion`, `eventId`, `eventType`, `occurredAt`, `runId`, `datasetDigest`,
  `splitDigest`, `keyVersions`, `records`, `reserveManifestDigest`,
  `previousEventDigest`, `eventDigest`. `eventType` é `pilot-exposure`,
  `split-freeze`, `holdout-consumed` ou `retirement`; cada item de `records` contém
  `recordDigest`, `partition` e `groupDigests` por eixo;
- as identidades pseudonimizadas usam HMAC determinístico sob **todas** as chaves ativas.
  Rotação adiciona versão sem reescrever história; a comparação usa qualquer digest em
  comum e nunca cria clusters "novos" por troca de chave;
- o índice retém hash exato e assinatura suficiente para aplicar R7 contra registros
  expostos em corpora anteriores. Recalcular o id do registro-linha ou do cluster não
  contorna a verificação de quase-duplicata;
- congelar um split real é uma transação: primeiro reprova registro-linha de teste já
  consumido ou cluster de split/exposição usado por execução anterior; depois grava
  atomicamente a primeira exposição de todos os clusters das cinco partições;
- a reserva futura permanece fora das cinco partições e não gera evento de exposição;
  apenas seu manifesto privado digestado é registrado;
- toda mutação adquire lock, verifica a cadeia de `eventDigest`, cria backup autenticado
  de ledger + keyring em
  `<home>/.cleanfeed-ai/ledger-backups/<timestamp>/`, grava em arquivo temporário,
  faz `fsync` e substituição atômica. `restore` só escreve sobre estado ausente ou
  comprovadamente idêntico; divergência falha fechada;
- a CLI fechada é `cluster-ledger init|verify|preflight|record-pilot|commit-split|backup|restore`.
  `preflight` não escreve; `record-pilot` e `commit-split` fazem backup e transação;
- `benchmark/cluster-exposure-ledger.ts` e sua validação entram em `EVALUATOR_FILES`.
  `_exclude_ids.txt` continua útil para registros-linha, mas **não substitui** controle por
  cluster.

**Verificar:** `vitest run benchmark/tests/cluster-exposure-ledger.test.ts
benchmark/tests/split.test.ts benchmark/tests/split-audit.test.ts
benchmark/tests/digests.test.ts`; executar a CLI numa fixture temporária e provar init,
backup, restauração, rotação sem reaparecimento e recuperação após escrita interrompida.

**Concluída quando:** o artefato de split traz contagem e distribuição de clusters por
eixo e por fatia, e a auditoria falha quando **um eixo obrigatório declarado por uma
fonte está `unknown`**. C3 apenas mede a oferta; D0b calcula o poder e E3 aplica o gate,
evitando dependência circular. Há testes provando que mudar id ou tupla não torna um
cluster de split/exposição já usado test-elegível; que troca de `keyVersion` sem migração
falha; que quase-duplicata histórica é barrada mesmo com id novo; que registro-linha de
teste consumido não volta a nenhuma partição; que a reserva não aparece nas cinco
partições; e que split e evento de exposição são gravados juntos ou nenhum dos dois é.

> **Não** falhar por "eixo degenerado": depois da poda, `nearDuplicate` deve ser todo
> singleton, e texto de IA não tem autor humano (R6). Degeneração de um eixo
> `notApplicable` é o resultado correto, não um defeito.

### C4 — Bootstrap com unidade de reamostragem por estimando

**Depende de:** C2.

**Arquivos:** `benchmark/bootstrap.ts`, `benchmark/metrics.ts`.

**Mudança:** **não existe "o cluster real" único** — a unidade de reamostragem depende do
que se está estimando, e usar uma só para tudo é errado nas duas direções:

| estimando | unidade de reamostragem | como combinar |
|---|---|---|
| FPR / especificidade em texto humano | fonte ⊃ autor/doador | **hierárquico**: reamostrar fontes, depois autores dentro da fonte sorteada |
| recall em texto de IA | gerador ⊃ prompt template ⊃ seed/batch | **hierárquico** na mesma ordem de aninhamento |
| métricas em texto misto | par pai-humano × operação de edição | **multiway** (cruzado, não aninhado) |
| calibração (ECE, Brier) | a unidade do estrato sob análise | herda do estrato |

**E é preciso escolher o método explicitamente, não só nomear as unidades.** O
`clusterBy` atual aceita **uma** chave, então "autor e fonte" não cabe nele. Duas
unidades aninhadas pedem **bootstrap hierárquico** (reamostrar o nível externo, depois o
interno dentro de cada externo sorteado); duas unidades cruzadas e não aninhadas — como
pai-humano × operação de edição no texto misto — pedem **bootstrap multiway**, porque
aninhar o que é cruzado subestima a variância. A escolha vai declarada por estimando no
relatório, não implícita no código.

O multiway é o **pigeonhole bootstrap**: pesos multinomiais independentes para
pai-humano e operação, multiplicados por célula. O hierárquico sorteia com reposição no
nível externo e, para cada ocorrência sorteada, no nível imediatamente interno. Não
substituir por bootstrap de linhas, cluster único achatado ou aninhamento de eixos
cruzados.

Se a unidade exigida estiver `unknown` (R6), **falhar** em vez de silenciosamente
reamostrar linhas — o modo de falha atual é o pior possível, porque produz intervalos
que parecem válidos. `notApplicable` cai para a unidade seguinte declarada pela fonte,
com o rebaixamento registrado no relatório.

Implementar sobre estatísticas suficientes por cluster, sem copiar registros-linha em
cada réplica. D0 usa 10.000 réplicas; H1 usa 100.000 com seed `20260728`, quantidade
fixa para sustentar as caudas do Bonferroni. Tempo de execução não autoriza reduzir.

**Concluída quando:** cada métrica publicada declara sua unidade de reamostragem; existe
teste que prova a falha sob unidade `unknown`; e existe teste que prova o alargamento do
intervalo sob correlação intra-cluster injetada.

**Verificar:** `vitest run benchmark/tests/bootstrap.test.ts
benchmark/tests/metrics.test.ts`; fixtures cobrem hierárquico, multiway, `unknown` e
fallback documentado de `notApplicable`.

### C5 — Recibos de revisão e PII reais

**Depende de:** B1, C1.

**Por que:** `annotation` tem **exatamente uma forma** nos 10.000 registros —
`{agreement: "agree", protocolVersion: "annotation-v1", reviewerIds: ["reviewer_a","reviewer_b"]}` —
e `piiAudit` tem três formas que diferem só no timestamp sintético, todas
`status: passed`, `reviewerId: reviewer_pii`, `method: manual-and-automated`. Dez mil
registros afirmam concordância entre dois revisores e auditoria de PII que nunca
ocorreram, e os gates `integrity.review-ledger-hash` e `integrity.dataset-audit-sealed`
passam sobre isso.

**Arquivos:** `benchmark/lab/assemble_corpus.py`, `benchmark/source-manifest.ts`,
`benchmark/corpus-source-audit.ts`.

**Mudança:** recibo real por registro com identificador pseudonimizado do revisor,
decisão individual, desacordo e adjudicação, data real, método de detecção e tratamento
de PII, e justificativa ou código de exclusão. **Registro não revisado é
`automated/unreviewed`** (R4). O gate passa a exigir coerência entre o recibo e a
alegação, não a mera presença do campo.

**Concluída quando:** um registro sem revisão humana não pode carregar
`agreement: agree`, e existe teste que prova isso.

**Verificar:** `vitest run benchmark/tests/source-manifest.test.ts
benchmark/tests/corpus-source-audit.test.ts benchmark/tests/corpus-import.test.ts`.

---

### C6 — Validação cruzada agrupada

**Depende de:** C2.

**Por que:** **esta tarefa faltava no plano.** `benchmark/cross-validation.ts` declara no
próprio cabeçalho: *"Author-grouped cross-validation… Five disjoint folds are formed so
that NO author ever spans a fold's train and validation halves — the same author-as-atom
discipline"*, e usa `authorGroup` para formar os folds. Como `groups.author` tem 10.000
singletons, **a CV agrupada está tão degenerada quanto o bootstrap** — os folds são
aleatórios por linha, e a seleção do calibrador que ela faz herda essa degeneração. C3
corrigia o split e C4 o bootstrap; ninguém corrigia a CV.

**Arquivos:** `benchmark/cross-validation.ts`, `benchmark/calibration-pipeline.ts`.

**Mudança:** usar exatamente **5 folds estratificados por classe**, tendo o cluster de
split/exposição formado pela união dos eixos aplicáveis (R6) como átomo indivisível.
Clusters são atribuídos deterministicamente por hash do id pseudonimizado + seed da
política. Não há uma segunda CV hierárquica: o componente conectado já impede que autor,
fonte, gerador, prompt ou seed aplicável atravesse treino e validação. Eixo obrigatório
`unknown` falha como em C4.

**Verificar:** `vitest run benchmark/tests/cross-validation.test.ts
benchmark/tests/calibration-pipeline.test.ts`.

**Concluída quando:** existe teste que prova que um cluster de split/exposição não
atravessa treino e validação do mesmo fold, e que a CV falha sob eixo obrigatório
`unknown`.

## Fase D — Dados

### D0 — Coleta piloto para estimar ICC e efeito de desenho

**Depende de:** B3, C3.

**Bloqueia:** D0b.

**Por que:** D0b precisa do número de clusters independentes para dimensionar, e a
contagem de clusters só existe depois de coletar — dependência circular. O piloto a
quebra. Reutilizar primeiro clusters já expostos do corpus inválido. Se algum estrato
core não tiver ao menos 30 clusters expostos, amostrar nele exatamente
`min(50 clusters, 5% do inventário elegível)`, sob o mesmo protocolo de D1, para
estimar a **correlação intraclasse** por fonte e o **efeito de desenho**
(`1 + (m̄ − 1)·ICC`), que é o fator pelo qual o tamanho em linhas precisa ser inflado para
dar o poder em clusters. Como os registros-linha do piloto são observados pelo
desenvolvimento, seus clusters são gravados no ledger de C3 e ficam inelegíveis para
testes futuros. O piloto já obedece ao schema de C1, inclusive
`labelBasis`/`labelEvidenceRef`; não é uma exceção de governança.

**Arquivos:** `benchmark/lab/estimate_cluster_power.py`,
`benchmark/lab/test_cluster_power.py`, `benchmark/cluster-exposure-ledger.ts`,
`benchmark/tests/cluster-exposure-ledger.test.ts`.

**Verificar:** `python -m unittest benchmark/lab/test_cluster_power.py` e `vitest run
benchmark/tests/cluster-exposure-ledger.test.ts`; a fixture correlacionada precisa
produzir intervalo mais largo que a i.i.d., e repetir a mesma exposição precisa falhar.

**Concluída quando:** existe estimativa de ICC e de efeito de desenho por fonte, com
intervalo; D0b pode ser calculado a partir dela; e a exposição dos clusters do piloto está
registrada.

### D0b — Dimensionamento por clusters e reserva de nova tentativa

**Depende de:** C3, C4, D0.

**Bloqueia:** D1, D3, D4, D5 e E2.

**Por que:** cada fatia crítica de FPR precisa de **300 negativos humanos** e cada fatia
de recall de 200 positivos antes do ajuste por desenho e multiplicidade. Marginalmente:
`hardNegativeFamily` 6×300, `domain` 5–6×300, `humanSourceType` 5×300,
`lengthBucket` (sem `0_49`) 5×300 e `temporalCohort` até 4×300. O piso otimista do
bloco de teste é ≈ **1800 humanos + 1200 de IA + 300 mistos >= 0,5**, mas o total
definitivo vem de clusters, células conjuntas core, Bonferroni de H2 e efeitos de desenho
medidos em D0.

R2 torna inelegível para testes futuros toda unidade amostral já exposta em qualquer
partição. O cálculo precisa reservar capacidade para **duas tentativas completas no
total**: a corrente e uma substituição independente. Modelar explicitamente:

1. clusters já expostos pelo corpus anterior e pelo piloto D0;
2. clusters consumidos por `train`, `dev`, `cal-A`, `cal-B` e `test`;
3. reserva futura selada, fora das cinco partições, com um segundo bloco de teste de
   igual poder em cada célula core;
4. cenários informativos de uma, duas e três tentativas, sem mudar o gate obrigatório de
   duas.

Não dividir inventário por tamanho de teste: cluster colocado em qualquer partição ativa
também deixa de ser candidato a teste futuro.

**Arquivos:** `benchmark/lab/plan_cluster_inventory.py`,
`benchmark/lab/test_cluster_inventory.py`, `benchmark/rebuild-v3-policy.json`,
`docs/corpus-collection-runbook.md`.

**Verificar:** `python -m unittest benchmark/lab/test_cluster_inventory.py`; fixtures
provam inflação por ICC, ajuste de Bonferroni, consumo pelas cinco partições e falha
quando a segunda tentativa não mantém poder em toda célula core.

**Concluída quando:** `benchmark/out/rebuild-v3/D0b/power-plan.json` e
`power-plan.md` registram tamanho por célula/eixo, efeito de desenho, partições, reserva
e tentativas; `supportedReleaseAttempts >= 2`. Valor menor é `insufficient-power` e
bloqueia coleta cara e congelamento, sem pedido de decisão.

### D1 — Humanos de bases públicas, com corte de data como mitigação de rótulo

**Depende de:** B3 (decidido), C2, C5, D0b.

**Base do rótulo, e seu limite:** a admissão aplica `CHATGPT_CUTOFF` (`< 2022-11-30`) por
padrão em `common.py:149`. Isso torna **implausível** o uso de ChatGPT — condicionado à
confiabilidade da data — e **não** prova autoria humana nem ausência de outras automações
anteriores a nov/2022 (ver B3 e L1). O rótulo é `human` com **risco residual declarado**,
nunca `human` certificado, e o relatório precisa dizer isso na mesma frase em que
publica qualquer número de FPR.

**Duas bases de rótulo distintas, e cada registro-linha humano declara qual usou.** O
corte de data é a base para material público comum. Uma base pública **já instrumentada**
(B3 admite a categoria) tem base diferente e mais forte: observação do processo, ainda
com o risco residual documentado pelo protocolo. C1 define `labelBasis` e
`labelEvidenceRef`; A6, E3 e H2 impedem que poucos registros-linha instrumentados elevem a
alegação do conjunto inteiro.

**Requisitos da coleta:**

1. **Corte de data obrigatório e verificado por fonte**, não presumido do vintage do dump.
   Carolina 1.3, dumps recentes de Wikipédia e Stack Exchange **exigem** corte pelo campo
   de data do próprio documento. Um dump de 2026 sem corte por revisão traz texto
   pós-LLM.
2. Registro `labelBasis = date-cutoff` com data `>= 2022-11-30` é rejeitado de **todas**
   as partições. Texto contemporâneo só entra com `labelBasis = observed-process` de base
   pública instrumentada e permanece fatia separada. AITDNA não é incorporado na v3:
   seus 95 `human-only` não alcançam o piso e a tabela de L1 serve apenas como precedente.
3. **Amostragem representativa dentro do possível** — espalhar por comprimento e gênero
   conforme D0b, não conforme a conveniência de extração.
4. **Revisão cega ao escore e à classe** na auditoria de C5: quem revisa não vê predição
   de detector.
5. **Pseudonimização com HMAC e segredo** para qualquer identificador de pessoa que venha
   das bases públicas (autor de post do Stack Exchange, avaliador do B2W). Hash simples de
   identificador de baixa entropia é reversível por força bruta, e continua sendo dado
   pessoal mesmo vindo de fonte pública.

**Estratos linguísticos disponíveis, e o que cada um cobre:** encyclopedic (Wikipédia),
qa-informal (Stack Exchange pt), social-media (avaliações B2W), institutional e
university (Carolina — **admissível por B1**, CC BY-NC-SA), legislative e domínio público
(Carolina, tipologias ainda não usadas). Nenhum deles é publicação profissional. É essa
a limitação.

**Arquivos:** `benchmark/lab/common.py`, `benchmark/lab/extract_wikipedia.py`,
`benchmark/lab/extract_stackexchange.py`, `benchmark/lab/extract_b2w.py`,
`benchmark/lab/extract_carolina.py`, `benchmark/lab/test_extractors.py`,
`docs/corpus-sources.md`.

**Verificar:** `python -m unittest discover -s benchmark/lab -p "test_*.py"`; fixtures
com data ausente, data >= cutoff, evidência inexistente e HMAC simples precisam ser
rejeitadas.

**Concluída quando:** o volume atinge o dimensionamento de D0b para os estratos *core*, com
corte de data verificado por fonte e proveniência real (C1/C2); todo registro-linha humano
resolve sua evidência no manifesto privado; e o relatório declara separadamente bases de
rótulo e estratos linguísticos existentes e ausentes.

### D2 — Suíte de robustez/OOD a partir do que já existe

**Depende de:** C2.

**Por que:** há **51.825 textos distintos já extraídos e não usados** (união de
`candidates/` + `dataset/` = 61.825; o selado usa 10.000), e todos os snapshots de
origem continuam em disco (`Posts.xml` 748 MB, `ptwiki` 1,9 GB, Carolina `archive.zip`
3,0 GB com 567 membros em 7 tipologias, B2W 48 MB). Além disso
**IberAuTexTification** tem 32.450 textos em português em 7 domínios
(`Genaios/iberautextification` no HuggingFace), e **MultiSocial** tem 44.178.

> **BLOQUEIO DE LICENÇA — não incorporar.** O card oficial de IberAuTexTification declara
> **`cc-by-nc-nd-4.0`**, e o texto do card pede contato com os organizadores
> (`organizers.autextification@gmail.com`) para adaptar ou construir sobre o dataset.
> **ND = sem derivados**: montar um corpus derivado dele é justamente o que a licença
> restringe, e NC bloqueia uso comercial independentemente de B1. **Não incorporar sem
> autorização escrita dos organizadores.** MultiSocial e qualquer outro conjunto externo
> ficam fora da v3; uma reconstrução futura só os reabre depois de R9.

**Mudança:** montar a suíte OOD com o material **cuja licença já foi verificada** —
Wikipédia, Stack Exchange, Carolina e avaliações B2W já locais. Não baixar nem incorporar
conjunto externo nesta tarefa. **Ela mede limites de generalização; não governa
calibração nem decisão de release** (isso é D1).

**Verificar:** overlap com os pools próprios medido antes da incorporação, sob o
contrato de R7.

**Arquivos:** `benchmark/lab/build_ood_suite.py`,
`benchmark/lab/test_build_ood_suite.py`, `benchmark/near-duplicates.ts`,
`docs/corpus-sources.md`.

**Concluída quando:** a suíte OOD existe como ativo separado, com licença por fonte
registrada, zero overlap exato e nenhum par com Jaccard de shingles >= 0,82 contra
`train`, `dev`, `cal-A` ou `cal-B`.

### D3 — IA pareada por estrato linguístico

**Depende de:** B1, C2, D0b, D1.

**Por que:** hoje **todo texto de IA tem `domain: "geral"` e `humanSourceType: null`**,
enquanto todo humano tem um gênero real — classe e domínio perfeitamente confundidos. É
a causa do achado principal: a taxa de falso alarme varia de **0% a 7,12%** conforme o
estrato linguístico. Enquanto isso não mudar, o modelo pode decidir pelo estrato.

**Mudança:** para cada registro-linha humano, gerar texto de IA no **mesmo gênero, tópico
e faixa de comprimento**, com prompt do gênero ("escreva um verbete de enciclopédia
sobre X", "responda a esta pergunta", "escreva uma avaliação deste produto"). O plano de
geração é fechado:

| papel | família/modelo canônico |
|---|---|
| core | `gpt-4o-mini` |
| core | `claude-haiku-4-5-20251001` |
| core | `gemini-2.0-flash` |
| core | `claude-sonnet-4-6` |
| OOD exclusivo de teste | `gpt-5.6-luna` |
| reserva futura, não exposta | `gemini-3.6-flash-low` |

Os templates core são igualmente fechados; todos terminam com “aproximadamente
`{words}` palavras; não copie frases da referência; responda apenas com o texto” e
incluem a referência somente como âncora temática:

| `humanSourceType` | instrução de registro |
|---|---|
| `encyclopedic` | “Escreva um verbete enciclopédico neutro em pt-BR sobre o tema.” |
| `qa-informal` | “Responda à pergunta em pt-BR de forma direta e informal.” |
| `social-media` | “Escreva uma avaliação de produto em pt-BR, em primeira pessoa.” |
| `university` | “Redija um trecho acadêmico universitário em pt-BR.” |
| `institutional` | “Redija uma comunicação institucional formal em pt-BR.” |

Em `train`, 80% usam o template do registro e 20% usam a receita `parafrase`; esta
última nunca entra em `dev/cal/test` por ser quase-duplicata deliberada. Em
`dev/cal-A/cal-B/test` core, 100% usam o template de registro. A receita `humanizado`
é OOD de teste: 100 positivos de `gpt-4o-mini` e 100 de
`claude-haiku-4-5-20251001`, sem entrar em treino ou calibração. A família OOD
`gpt-5.6-luna` usa os templates de registro, mantendo separados os dois fatores.

A4 agrupa aliases e versões materialmente equivalentes antes da atribuição; se uma
família OOD for alias de core, ela é inelegível e D3 falha até haver família realmente
distinta. Para cada família core, distribuir deterministicamente as receitas
`temperature ∈ {0.2, 0.7, 1.0}` e `top_p ∈ {0.8, 0.95}`; usar penalidade default do
provedor, registrar quando não configurável e nunca inventar seed não exposta pela API.
Diversidade de geradores prevalece sobre volume repetido da mesma família.

**Atenção de custo:** só **48 registros de sobra** nos pools de IA do pipeline. Isso
significa gerar milhares de documentos novos, e foi onde a cota dos CLIs limitou a
coleta anterior. Reservar famílias inteiras para o teste desde o início (E2).

**Arquivos:** `benchmark/lab/generate_ai.py`,
`benchmark/lab/generation-plan-v3.json`, `benchmark/lab/test_extractors.py`,
`benchmark/lab/assemble_corpus.py`, `docs/corpus-collection-runbook.md`.

**Verificar:** `python -m unittest discover -s benchmark/lab -p "test_*.py"`; o
`--dry-run` precisa reproduzir exatamente pais, famílias e receitas, e falhar sob alias,
metadado ausente ou tentativa de abrir a reserva.

**Concluída quando:** cada estrato *core* de registro tem contraparte de IA no mesmo
gênero e faixa, com diferença absoluta de proporção humano/IA <= 1 ponto percentual em
cada célula; a família OOD só está em `test` e a família de reserva não aparece em
nenhuma partição ativa.

### D4 — Classe mista com proveniência observável

**Depende de:** B2, C2, D0b, D1, D3.

**Por que:** [`make_mixed.py`](../../../benchmark/lab/make_mixed.py) deriva os spans de
um `difflib.SequenceMatcher` entre pai e editado — bloco igual → `human`, inserção →
`ai`. Isso mede **diferença textual, não proveniência causal**, e o prompt de edição
exige que "a maior parte do texto fique idêntica ao original"
(`make_mixed.py:46`), o que *garante* que a maior parte de um documento processado
inteiro pela IA seja rotulada como humana. **Treinar cabeça de token sobre esses spans
ensinaria o oposto do pretendido.** Além disso os trechos de IA têm mediana de **16
caracteres** (~7 fragmentos de duas ou três palavras salpicados), o que não é o modelo
de ameaça real, e **1761 dos 2000 registros mistos** (`aiFraction < 0.5`) não entram em
nenhuma métrica.

**Mudança:**
- gerar com proveniência observável usando exatamente três operações: inserção de seção
  contígua, substituição de seção contígua e concatenação de introdução humana com corpo
  de IA; cada operação registra offsets antes/depois e hashes dos segmentos;
- padrões realistas e **contíguos** (humano escreve a introdução e a IA redige o corpo;
  uma seção humana é substituída por redação de IA), não fragmentos salpicados nem
  alegação de edição humana não observada;
- montar a **curva v0–v8 de cobertura de IA** (0%, 15%, 25%, 40%, **50%**, 60%, 75%,
  90%, 100%), porque versões intermediárias são *mais difíceis* que ambos os extremos e
  uma avaliação só com extremos é cega ao próprio ponto de falha;
- texto livremente reescrito recebe **rótulo de documento** ("assistido por IA"), nunca
  rótulo por trecho.

**Campo obrigatório `generationMode: mechanistic | ecological`.** Tudo que este plano
produz é `mechanistic`: nós escolhemos e executamos as operações de edição, então a
proveniência por trecho é conhecida, mas a **distribuição** de coautoria é nossa, não a de
pessoas reais. `ecological` fica reservado para uma futura amostra com processo de escrita
observado (AITDNA/CoAuthor-like), que L1 impede de coletar.

Consequências que o schema e o relatório têm de impor:
- a curva v0–v8 mecanística **nunca** é descrita como prevalência de uso de IA, nem como
  desempenho em edição humana real;
- as duas coortes, se algum dia coexistirem, são **fatias separadas** e nunca agregadas;
- qualquer alegação sobre texto misto declara em qual modo foi medida.

**Proibido:** reutilizar os spans de diff atuais como rótulo de token; descrever resultado
`mechanistic` como desempenho em coautoria natural.

**Arquivos:** `benchmark/lab/make_mixed_v3.py`,
`benchmark/lab/test_make_mixed_v3.py`, `benchmark/schema.ts`,
`benchmark/metrics.ts`, `benchmark/tests/schema.test.ts`,
`benchmark/tests/metrics.test.ts`.

**Verificar:** `python -m unittest benchmark/lab/test_make_mixed_v3.py` e `vitest run
benchmark/tests/schema.test.ts benchmark/tests/metrics.test.ts`; reconstruir o texto a
partir dos segmentos e provar offsets após a normalização A5.

**Concluída quando:** existe conjunto com proveniência por trecho verificável e a curva
v0–v8 está montada nas três operações, no volume calculado por D0b; somente os pontos
`>= 0,50` entram no gate misto e nenhum deles autoriza ação visual.

### D5 — Hard negatives curados

**Depende de:** C2, C5, D0b, D1.

**Por que:** as famílias são atribuídas aos primeiros registros disponíveis de certos
gêneros, sem classificação ou revisão que demonstre a característica declarada. E são
**20 por família** onde os gates exigem 300 — `assemble_corpus.py:670` calcula
`tag_per = 4000 // 200 = 20`, déficit de 15×.

**Mudança:** curar a partir de critérios observáveis, com revisão, de múltiplas fontes e
autores, atingindo `max(300, tamanho calculado em D0b)` por família. A família
`non-native` merece atenção
especial (ver §6.7 do assessment: o mecanismo do viés **inverte** em língua
morfologicamente rica, e ninguém mediu isso em português).

**Arquivos:** `benchmark/lab/curate_hard_negatives.py`,
`benchmark/lab/test_curate_hard_negatives.py`, `benchmark/source-manifest.ts`,
`benchmark/corpus-source-audit.ts`, `docs/corpus-collection-runbook.md`.

**Verificar:** `python -m unittest benchmark/lab/test_curate_hard_negatives.py` e
`vitest run benchmark/tests/corpus-source-audit.test.ts`; item sem dois pareceres cegos
ou sem adjudicação de desacordo permanece `automated/unreviewed` e não conta para gate.

**Concluída quando:** cada família atinge o tamanho de D0b, com ao menos duas fontes e
unidades amostrais suficientes, critérios observáveis e recibos reais de revisão.

---

## Fase E — Corpus e split

### E2 — Congelar o split de cinco partições

**Depende de:** C3, D0b, **D1–D5** (não se congela um split antes de os dados existirem).

> **Nota de sequenciamento.** O **algoritmo** de split (implementação em `split.ts` +
> auditoria) é parte de **C3** e pode ser escrito e testado com dados sintéticos assim
> que C2 existir. **Esta tarefa é apenas o congelamento do split final** sobre o corpus
> real. Separar as duas coisas é o que permite paralelizar código e coleta.

**Por que:** o desenho atual tem três partições e **nenhuma de treino** — o detector foi
treinado num artefato separado e não governado (`dataset/train.jsonl`, 32.853 linhas). E
`createdAt` tem **três valores sintéticos** (1000000/2000000/3000000) que
`stamp_block()` ([`assemble_corpus.py:313`](../../../benchmark/lab/assemble_corpus.py#L313))
grava também em `collectedAt`, `generatedAt` e `piiAudit`: o "blocked temporal split" não
separa nada no tempo, a fatia `temporalCohort` colapsa num único bucket, e a atribuição
de partição é manual. Foi assim que calibração e teste ficaram sem nenhum registro
humano em comum além de `qa-informal` — a causa do achado principal.

**Mudança:**

```
train  (50%) -> treina o detector, dentro da mesma governança
dev    (10%) -> arquitetura, hiperparâmetro, época, política de janelas
cal-A  (10%) -> escolhe e ajusta o calibrador
cal-B  (10%) -> constrói o limiar conformal congelado
test   (20%) -> cego, uso único

future-holdout-reserve -> não é partição; permanece selada e intocada
```

Invariantes:
1. **Estratos *core* presentes em todas as cinco partições** — estratificar por
   `humanSourceType` × faixa de comprimento **dentro** da atribuição por cluster.
2. **Coortes *OOD* exclusivas do teste**, explicitamente separadas dos core: a família
   geradora retida em D3, conteúdo misto mecanístico e a receita `humanizado` já
   existente. Templates e decodings comuns são variados nas partições core, não
   artificialmente chamados de unseen. A suíte humana D2 permanece externa ao split e
   diagnóstica. Não criar “fonte humana não vista” ou “período não visto” artificial:
   faltam fontes in-domain, e os quartis temporais core são definidos pela política e
   distribuídos entre as cinco partições.
3. **Restaurar a data real do texto** em vez de abandonar o eixo temporal. As datas
   reais **já estão nos pools** e foram sobrescritas por `stamp_block()`; medindo:
   Wikipédia 2011-09→2022-03 (1335 valores distintos), Stack Overflow
   2013-12→2016-12 (1046), B2W 2018-01→2018-04 (94), Carolina 2020-01→2021-05 (**apenas
   8** — grosso demais para coorte). Logo Wikipédia e Stack Overflow sustentam uma coorte
   temporal real; Carolina e B2W têm resolução mais grossa. Aplicar a regra congelada:
   quartis por fonte quando houver pelo menos 4 timestamps distintos **e** poder D0b;
   caso contrário `notApplicable`, nunca timestamp sintético.
   Nunca mais gravar data sintética em `createdAt`, `collectedAt`, `generatedAt` ou
   `piiAudit`.
4. Toda a linhagem seed → geração → derivados na mesma partição (C2).
5. **Reserva futura fora do split.** Nenhum registro-linha ou cluster reservado aparece
   em `train`, `dev`, `cal-A`, `cal-B` ou `test`; texto e identificadores reservados não
   entram em artefatos acessíveis ao desenvolvimento. O relatório público traz somente
   contagens agregadas por estrato e poder resultante. O manifesto privado da reserva é
   digestado, e o congelamento atualiza atomicamente o ledger de C3 para as cinco
   partições ativas.

**Concluída quando:** **cada estrato *core* tem clusters suficientes em todas as cinco
partições e na reserva futura, e cada registro-linha/cluster ativo aparece em exatamente
uma partição**; nenhum reservado aparece numa partição; as coortes OOD estão marcadas
como tal; a auditoria passa sobre os eixos de agrupamento declarados (R6); e o evento de
exposição foi gravado atomicamente.

Um registro-linha pertence a exatamente uma partição; um estrato linguístico contém
muitos registros-linha e precisa da cobertura declarada acima.

**Arquivos:** `benchmark/split.ts`, `benchmark/split-artifact.ts`,
`benchmark/split-audit.ts`, `benchmark/commands/split.ts`,
`benchmark/cluster-exposure-ledger.ts`, `benchmark/tests/split.test.ts`,
`benchmark/tests/split-artifact.test.ts`, `benchmark/tests/split-audit.test.ts`.

**Verificar:** `vitest run benchmark/tests/split.test.ts
benchmark/tests/split-artifact.test.ts benchmark/tests/split-audit.test.ts
benchmark/tests/cluster-exposure-ledger.test.ts`; repetir com a mesma seed produz os
mesmos digests e uma segunda gravação da exposição falha.

### E3 — Gates de composição do split

**Depende de:** E2.

**Arquivos:** `benchmark/gates.ts`, `benchmark/slices.ts`, `benchmark/report.ts`,
`benchmark/tests/gates.test.ts`, `benchmark/tests/slices.test.ts`,
`benchmark/tests/report.test.ts`.

**Mudança:** gates novos, que teriam pegado o que passou:
- **composição *core*** conforme o plano — **todo estrato core** com clusters suficientes
  em cada partição prevista (E2), sem exigir que um registro-linha humano apareça em mais
  de uma partição, o que é impossível por definição;
- **número mínimo de clusters independentes por fatia**;
- **base do rótulo humano** — `labelBasis`/`labelEvidenceRef` válidos em todo humano,
  contagem e unidades amostrais separadas por base; `date-cutoff` sustenta os gates *core*;
  `observed-process` só sustenta gate ou alegação própria se atingir sozinho o poder
  pré-registrado;
- **igualdade exata** entre heldouts declarados, marcados, auditados e publicados (A4);
- **divergência calibração-vs-teste**, comparando **apenas os estratos *core*, com pesos
  padronizados**: o fit mediu FPR 3,85% e o teste 0,00% com o mesmo limiar, e divergência
  dessa ordem entre o conjunto que escolheu o limiar e o que o avalia deve ser um gate de
  integridade. Mas o teste contém coortes **OOD deliberadas** (E2, item 2), então
  divergência *agregada* é esperada por desenho e um gate sobre o agregado dispararia
   espuriamente. Comparar como-com-como: mesmos estratos, mesma padronização de pesos.

Fatia core e família hard-negative obrigatória sem o poder de D0b é `reject`. Coorte
OOD, `observed-process` suplementar ou curva mista abaixo de 50% sem poder é
`insufficient-power` diagnóstico e não entra em `m`. Essa classificação é congelada no
split; H1 não a reinterpreta.

E uma correção de gate existente: **`action.fpr.slice.lengthBucket.0_49` é
insatisfazível** — exige 300 negativos humanos com menos de 50 palavras, que a admissão
proíbe (humanos e IA são barrados abaixo de 50) e onde o produto **se abstém**
(`DEFAULT_MINIMUM_ELIGIBLE_WORDS = 50`). Cobrar FPR onde o sistema nunca age, e que a
admissão proíbe povoar, significa que o nível de ação **nunca** pode chegar a `pass`.
Colocar `0_49` explicitamente fora de escopo, com a razão registrada.

**Concluída quando:** os cinco gates novos existem com teste, agregação entre bases de
rótulo não mascara fatia sem poder, e `0_49` está fora de escopo com justificativa no
relatório.

**Verificar:** `vitest run benchmark/tests/gates.test.ts
benchmark/tests/slices.test.ts benchmark/tests/report.test.ts`.

### E4 — Teto de ação reduzido fora dos estratos linguísticos calibrados

**Depende de:** B3 (decidido: só bases públicas), E3.

**Por que:** hoje o caminho inteiro força `generic`, e por L1 isso é permanente, não
transitório:
- [`src/inference/calibration.ts`](../../../src/inference/calibration.ts) normaliza
  **qualquer** id de adaptador para `"generic"` incondicionalmente — o comentário diz
  "v1 policy: the sealed corpus is generic pt-BR, so ONE pool of `generic` profiles
  serves every adapter", e se identifica como "the single seam to change";
- [`profile-artifact.ts`](../../../benchmark/profile-artifact.ts) publica só para o pool
  `"generic"`, com o mesmo raciocínio.

O risco concreto: o produto roda num feed profissional com um perfil calibrado em
enciclopédia, judiciário, Q&A e avaliações de produto — e o falso alarme varia de **0% a
7,12%** entre esses registros. Cair no genérico silenciosamente reintroduz o problema do
registro por outra porta, agora sem medição que o limite.

**Arquivos:** `src/inference/calibration.ts`, `benchmark/profile-artifact.ts`,
`contracts/calibration-profile.ts`, `src/inference/inference-worker.ts` (teto de ação).

**Mudança:** a normalização para `generic` deixa de ser silenciosa. Plataforma sem perfil
calibrado próprio **rebaixa o teto de ação** (no máximo `indicator`, nunca blur/hide) e o
motivo aparece na interface. A arquitetura já tem o mecanismo — `actionCeiling` e os
códigos de razão.

**Concluída quando:** existe teste que prova (a) rebaixamento do teto em plataforma não
calibrada, (b) que nenhum caminho aplica ação visual sob perfil genérico numa plataforma
não calibrada, e (c) que o motivo é exposto ao usuário.

**Verificar:** `vitest run src/inference/calibration.test.ts
benchmark/tests/profile-artifact.test.ts` e `playwright test
tests/e2e/tmr-release.spec.ts`. Perfil `generic` numa plataforma sem cobertura própria
precisa resultar em `indicator`, mesmo quando a preferência do usuário é `hide`.

---

## Fase F — Treino

### F1 — Aprendizado multi-instância com a política de janelas do runtime

**Depende de:** E2.

**Por que:** o treino vê **um** truncamento de 512 tokens por documento
([`train_detector.py:111-120`](../../../benchmark/lab/train_detector.py#L111)) e a
inferência vê janelas de 510 com média ponderada de até 8 — documentos longos são
treinados só no primeiro trecho. E a paridade do export INT8 foi medida em passagem
única de 512 (`export_onnx.py:125-167`), **nunca no pipeline com janelas**.

**Herdar o rótulo do documento para cada janela é errado** e não deve ser feito: marca
citação e boilerplate como se tivessem a origem do documento, é claramente incorreto em
documento misto, dá peso maior a documento longo, e continua divergindo do runtime, que
agrega no máximo oito janelas selecionadas.

**Mudança:** amostrar as janelas com a **mesma política do runtime**, agregar os escores
com a **mesma regra**, calcular a perda **no nível do documento**, manter peso total
semelhante por documento, e usar perda auxiliar de span **apenas onde houver
proveniência real** (D4).

**Arquivos:** `benchmark/lab/train_detector.py`,
`benchmark/lab/windowing.py`, `benchmark/lab/test_windowing.py`,
`src/inference/chunker.ts`, `src/inference/aggregator.ts`,
`contracts/runtime-parity.ts`, **`src/inference/inference-worker.ts`**,
**`src/model-smoke/main.ts`**.

Os dois últimos entraram por causa da **lacuna de paridade de runtime** registrada em A2:
`inference-worker.ts` ainda infere todo chunk sem seleção prévia e sem `fitWindowSlice`
(`:27`, `:331`, `:520`), e `model-smoke/main.ts:175-224` mantém um construtor de janelas
privado, também sem aparagem. "Mesma fonte" é literal: enquanto esses dois lerem a política de
outro lugar, o critério de F1 não está atendido, e o documento que A2 salvou na bancada
continua perdido no produto.

**Verificar:** `python -m unittest benchmark/lab/test_windowing.py`, `vitest run
tests/unit/inference/aggregator.test.ts` e `npm run test:model-benchmark`; os mesmos
tokens e logits sintéticos precisam selecionar as mesmas janelas e produzir o mesmo
agregado nos dois runtimes.

**Concluída quando:** a política de janelas do treino e a do runtime são lidas da mesma
fonte, e existe teste que prova a equivalência.

### F2 — Aumento por truncamento (ablação, não adoção)

**Depende de:** F1. **É uma ablação de F3, não uma decisão tomada.**

**Por que:** é a intervenção de melhor retorno medido em texto curto: **+24,2 de F1**
(58,60 → 82,76 no HC3-En-Sent), preservando texto longo (97,42 → 98,40). E a
alternativa "inteligente" — perda PU sensível a comprimento — **custa 13,3 de F1
sozinha**. Fazer a coisa simples. Custo zero em inferência, e ataca de frente a faixa
`50_79`, que é a maior do corpus (3026 registros).

Rodar as cinco seeds congeladas, pareadas com e sem aumento. Adotar aumento somente se
a mediana do **pior estrato core em TPR@1%FPR** melhorar pelo menos `0,02`, nenhuma
célula core degradar mais de `0,01` e a taxa de erro não aumentar. Caso contrário,
`truncationAugmentation = false`; não há julgamento residual.

**Arquivos:** `benchmark/lab/train_detector.py`,
`benchmark/lab/run_ablation.py`, `benchmark/lab/test_run_ablation.py`,
`benchmark/rebuild-v3-policy.json`.

**Verificar:** `python -m unittest benchmark/lab/test_run_ablation.py`; fixtures cobrem
adoção, rejeição por ganho insuficiente e rejeição por regressão de uma célula.

**Concluída quando:** `benchmark/out/rebuild-v3/F2/ablation.json` contém as cinco
diferenças pareadas e a decisão booleana reproduzível.

> **Ressalva.** O +24,2 de F1 é medido em **inglês** (HC3-En-Sent). Português tem
> morfologia mais rica e o efeito do truncamento sobre a distribuição de subtokens não é
> o mesmo. O número justifica **testar**, não adotar. Se a ablação em pt-BR não
> reproduzir ganho, não adotar — e registrar o resultado negativo, que é informação útil
> e a literatura em português não tem.

### F3 — Ablações, não crenças

**Depende de:** F1, F2.

**Por que:** a saturação (88,8% dos documentos de IA acima de 0,999; só 2,8% na faixa
intermediária 0,01–0,99) **não tem causa demonstrada**. Candidatas plausíveis: atalho de
domínio/fonte/época, separabilidade artificial do corpus, cross-entropy pura, composição
dos prompts, quantização INT8, e diferença de população entre fit e avaliação. Nenhuma
delas é corrigida por suavizamento de rótulo, e **nenhuma técnica de perda corrige
confounding**.

**Mudança:** comparar em `dev`, nas cinco seeds congeladas e com a decisão de F2 fixa:

1. cross-entropy;
2. label smoothing `0,05`;
3. focal loss `gamma = 2`, `alpha = balanceamento da classe em train`;
4. Brier loss;
5. mixup no embedding, `Beta(0,4; 0,4)`.

Agregação não compete aqui: F1 fixou a regra idêntica ao runtime. Uma configuração é
elegível se o erro de inferência em dev for `<= 0,001`. Vence a maior mediana, entre
seeds, do **mínimo TPR@1%FPR entre células core**. Diferença absoluta `<= 0,005` é
empate; desempatar por menor pior-Brier core, depois pela ordem 1→5. AUROC é diagnóstico.
Dentro de cada execução, a época vence pela mesma ordem; empate escolhe a época mais
cedo.
Depois de escolher a configuração, treinar o checkpoint publicável com seed `712019`
somente em `train`; `dev` continua fora do fit final.

Registrar corpus digest, split digest, commit, ambiente, dependências, revisão do modelo
base, seeds, hiperparâmetros e hash do checkpoint.

Medida barata e independente: **preservar os logits** no artefato de calibração para
auditoria de saturação. Eles não adicionam uma quarta família de calibrador; G1 continua
restrito a Platt, beta e isotônico.

**Arquivos:** `benchmark/lab/train_detector.py`,
`benchmark/lab/run_ablation.py`, `benchmark/lab/test_run_ablation.py`,
`benchmark/rebuild-v3-policy.json`.

**Verificar:** `python -m unittest benchmark/lab/test_run_ablation.py`; duas execuções
sobre a mesma fixture escolhem a mesma configuração e seed, inclusive nos empates.

**Concluída quando:** existe tabela das 25 execuções, seleção mecânica reproduzível e
checkpoint seed `712019` com hash registrado.

### F4 — Confirmar o backbone e o orçamento congelados

**Depende de:** F3.

**Decisão:** usar `neuralmind/bert-base-portuguese-cased`. ModernBERT, mDeBERTa,
mmBERT, poda de vocabulário e contexto longo ficam fora desta reconstrução. O ONNX INT8
precisa ter no máximo **109.681.931 bytes**; exceder reprova o candidato em vez de abrir
novo bake-off.

**Arquivos:** `benchmark/lab/train_detector.py`,
`benchmark/lab/export_onnx.py`, `benchmark/rebuild-v3-policy.json`,
`models/cleanfeed-ptbr-v1/source-lock.json`.

**Verificar:** o `training-run.json` registra exatamente o backbone e revisão resolvida;
teste de política falha para outro id ou ONNX maior que o limite.

**Concluída quando:** checkpoint e export apontam para o backbone congelado e respeitam
o orçamento em bytes.

### F5a — Paridade bruta do export, sobre o pipeline com janelas

**Depende de:** F1, **F3, F4** (é o checkpoint vencedor que se exporta; exportar outro
artefato e calibrar sobre ele não vale).

**Arquivos:** `benchmark/lab/export_onnx.py`, `scripts/package-own-model.mjs`.

**Mudança:** a verificação de paridade fp32 vs INT8 passa a rodar **no pipeline com
janelas e agregação**, não em passagem única de 512, e **arquivar o
`parity_report.json`** — hoje não existe nenhum no repo, porque o export real rodou fora
dele. Nesta passada o critério de inversão continua em 0,5, porque ainda não há limiar
operacional: é paridade **bruta**, para autorizar a calibração a começar. Rodar sobre
todo `dev`; exigir valores finitos e `meanAbsDelta <= 0,02`. Inversão em 0,5 é
diagnóstico e não substitui F5b.

**Concluída quando:** existe `parity_report.json` versionado do export real medido no
pipeline com janelas, com `meanAbsDelta <= 0,02` e zero valor não finito.

**Verificar:** `python -m unittest benchmark/lab/test_export_onnx.py` e
`npm run model:verify`; fixture acima de `0,02` falha.

> **Não** tentar medir aqui a paridade nos limiares operacionais: ela depende de G2, que
> depende de G1, que depende desta tarefa. É **F5b**, logo depois de G2. Juntar as duas
> numa só tarefa cria um ciclo de dependências.

### F6 — Vínculo criptográfico entre treino e modelo publicado

**Depende de:** F1, F3, F4, F5a.

**Por que:** o runbook já registra a lacuna e ela continua aberta: **nada amarra
`train.jsonl` ao ONNX empacotado.** `release.json` carrega digests de bundle, tokenizer,
calibração, perfil e evidência — nenhum de dados de treino. F3 manda "registrar", o que
é bom-mocismo: registro que não entra em digest não é verificável.

**Arquivos:** `scripts/package-own-model.mjs`, `contracts/model-release.ts`,
`benchmark/lab/train_detector.py`, `benchmark/lab/export_onnx.py`.

**Mudança:** emitir um `training-run.json` contendo digest do corpus, digest do split,
commit, revisão do modelo base, ambiente e dependências, seeds, hiperparâmetros,
checkpoint escolhido e critério de escolha, digest do ONNX e parâmetros de quantização.
**O digest desse arquivo entra no manifest e no `release.json`**, e a verificação de
release falha se ele estiver ausente ou divergente.

**Concluída quando:** `npm run model:verify` reprova um bundle cujo `training-run.json`
não case, e existe teste que prova a reprovação.

**Verificar:** `vitest run tests/unit/contracts/model-release.test.ts` e `npm run
model:verify`; alterar uma seed, digest de corpus ou byte do ONNX precisa reprovar.

---

## Fase G — Calibração e certificação

### G1 — Calibrador em `cal-A`

**Depende de:** E2, **F1, F3, F4, F5a** (é preciso o checkpoint vencedor e o ONNX INT8
exportado com paridade bruta verificada — calibrar sobre outro artefato que não o
publicável não vale), **C6** (a seleção do calibrador usa CV agrupada).

**Arquivos:** `benchmark/calibration-pipeline.ts`, `benchmark/calibrators.ts`,
`benchmark/cross-validation.ts`, `benchmark/commands/fit.ts`.

**Mudança:** escolher e ajustar a família de calibrador **apenas** em `cal-A`, com CV
agrupada (C6). O `fit` deixa de reunir `development` + `calibration` num único pool:
`dev` não entra no ajuste final, `cal-A` escolhe o calibrador, `cal-B` escolhe o limiar
(G2). Para document e localized, comparar Platt, beta e isotônico em 5 folds. Vence
menor Brier OOF agregado com pesos iguais por cluster; empate absoluto `<= 1e-4`
favorece Platt, depois beta, depois isotônico. Registrar candidatos, folds, Brier e
desempate no artefato.

**Verificar:** `vitest run benchmark/tests/calibration-pipeline.test.ts benchmark/tests/cross-validation.test.ts`;
`partitionsUsed` no artefato congelado passa a distinguir os papéis de cal-A e cal-B.

**Concluída quando:** o artefato congelado nomeia a partição usada em cada seleção, e
nenhuma delas é `development`.

**Proibido:** ajustar o calibrador em dados que também escolheram o limiar.

### G2 — Construir os limiares conformais em `cal-B`

**Depende de:** G1, A7.

**Por que:** separar `cal-A` de `cal-B` não torna um Wilson pós-seleção válido. Esta
tarefa não faz busca O(n²), não usa Wilson para aprovar limiar e não oferece vias
alternativas: aplica a construção conformal pré-registrada abaixo. A certificação
empírica independente continua sendo H1.

**Mudança:** sobre humanos `date-cutoff` core de `cal-B`, depois do calibrador de G1:

1. formar as faixas de perfil `50-79`, `80-199` e `200-plus`;
2. dentro de cada faixa, separar cada `humanSourceType` core;
3. para cada célula e caminho, ordenar os escores crescentes, com `n` humanos, e tomar
   `k = ceil((n + 1) * (1 - epsilon))`;
4. usar `epsilon = 0,025` separadamente em document e localized para aviso
   (Bonferroni dos dois caminhos, orçamento conjunto `0,05`) e `epsilon = 0,02` no
   document para ação;
5. o limiar da faixa é o maior quantil entre os estratos core: o pior estrato governa,
   nunca a média;
6. serializar `nextUp64(quantil)` e comparar no runtime com `>=`, para que empates no
   quantil não sejam acusados. Se `k > n`, o quantil for `1`, ou não houver célula core
   com poder, marcar o caminho `enabled: false`; aviso desabilitado produz `reject`, ação
   desabilitada produz no máximo `indicator-only`;
7. o limiar documental de ação é ainda `max(limiar conformal de ação, limiar documental
   de aviso)`.

Não há fallback para cross-fitting: D0b dimensiona dois blocos e E2 cria `cal-A` e
`cal-B`. Se qualquer bloco faltar, a tarefa falha. `observed-process` abaixo do poder
permanece diagnóstico e não reduz o limiar.

**Arquivos:** `benchmark/calibration-pipeline.ts`,
`benchmark/conformal-thresholds.ts`, `benchmark/rebuild-v3-policy.ts`,
`contracts/calibration-profile.ts`, `benchmark/tests/conformal-thresholds.test.ts`,
`benchmark/tests/calibration-pipeline.test.ts`.

**Verificar:** `vitest run benchmark/tests/conformal-thresholds.test.ts
benchmark/tests/calibration-pipeline.test.ts`; fixtures cobrem quantil, empate,
`nextUp64`, `k > n`, pior estrato, união dos dois caminhos e desabilitação.

**Concluída quando:** `frozen-calibration.json` carrega, para cada faixa/caminho,
`epsilon`, `n`, `k`, quantil por estrato, estrato governante, limiar serializado e
`enabled`; não contém alternativa metodológica nem cota certificada em `cal-B`.

### G3 — Validar e selar o contrato conformal

**Depende de:** G2.

G3 não escolhe outro limiar. Ela reproduz a construção de G2 a partir de
`cal-B`, verifica que o digest, quantis, células, comparadores e flags `enabled`
coincidem e sela `conformal-evidence.json` no digest da calibração.

> **Limites da garantia — não superestimar.** O controle vale sob
> **exchangeability entre o texto humano de calibração e o de operação**. Portanto:
> **(a) não protege contra mudança de domínio humano** — se o feed real tiver estrato
> diferente do calibrado, a garantia não se transfere, e é exatamente o risco que o
> achado principal expôs (0% a 7,12% conforme o estrato linguístico); **(b) não diz nada sobre
> recall**, muito menos sob gerador novo. É garantia de **taxa de acusação falsa**, e só.
> Comunicar como tal, no produto e em qualquer material.

**Arquivos:** `benchmark/conformal-thresholds.ts`,
`benchmark/calibration-pipeline.ts`, `benchmark/digests.ts`,
`benchmark/report.ts`, `benchmark/tests/conformal-thresholds.test.ts`,
`benchmark/tests/digests.test.ts`.

**Verificar:** `vitest run benchmark/tests/conformal-thresholds.test.ts
benchmark/tests/digests.test.ts benchmark/tests/report.test.ts`; alterar score,
`epsilon`, célula ou comparador precisa quebrar o digest/reprodução.

**Concluída quando:** a evidência é reproduzível byte a byte e o artefato declara que a
cobertura será certificada no teste independente H1, não em `cal-B`.

> **Não** verificar a cobertura em `cal-B`: se foi `cal-B` que calculou os quantis, medir
> a cobertura nele mede o próprio ajuste. Vale o princípio de G2 — a certificação sai do
> conjunto de seleção.

### F5b — Paridade nos limiares operacionais

**Depende de:** G2, G3. **Nome com F porque é a segunda passada de F5a**; fica aqui
porque só agora existem os limiares congelados e validados.

**Arquivos:** `benchmark/lab/export_onnx.py`, `scripts/package-own-model.mjs`.

**Por que:** [`export_onnx.py:152`](../../../benchmark/lab/export_onnx.py#L152) conta
inversão como `(p_torch >= 0.5) != (p_onnx >= 0.5)` — só concordância sobre cruzar **0,5**.
Os limiares que rodam não são 0,5: na v2 foram **0,0795** para aviso e **0,4075** para
ação visual. Uma deriva de quantização de 0,01 perto de 0,0795 inverteria muitos avisos e
produziria **zero** "inversões" nesse teste. Ou seja: a paridade INT8 do modelo publicado
nunca foi verificada nos pontos onde ele decide.

**Mudança:** medir inversões **em cada limiar congelado** (aviso documento, aviso
localizado, ação visual), sobre o pipeline com janelas e sobre todos os registros
pontuáveis de `dev + cal-A + cal-B`. A tolerância é **zero inversões**. Falha exige
corrigir/reexportar a quantização e repetir G1–G3; é proibido relaxar a tolerância ou
olhar o teste.

**Verificar:** `python -m unittest benchmark/lab/test_export_onnx.py`; uma fixture com
delta que cruza qualquer limiar precisa falhar.

**Concluída quando:** existe um segundo `parity_report.json` com contagem zero em cada
faixa/caminho/partição, e G5 o exige presente.

### G4 — Calibrador global declarado e diagnóstico por comprimento

**Depende de:** G1, G2.

**Por que:** [`profile-artifact.ts:483-487`](../../../benchmark/profile-artifact.ts#L483)
copia `frozen.calibrators.document` e `frozen.calibrators.localized` — os calibradores
**globais** — para os três perfis `50-79`, `80-199` e `200-plus`, derivando os limiares
dos mesmos `frozen.thresholds`. Só o `actionCeiling` varia. Não é calibração
condicional; é uma calibração global republicada três vezes.

**Decisão:** usar um calibrador **global por caminho**, escolhido em G1. Os perfis
declaram `calibrationScope: "global"` e publicam Brier, ECE, intercept e slope por faixa
como diagnóstico. Somente os limiares conformais de G2 variam por faixa. É proibido
copiar o calibrador global para três campos que pareçam ajustes separados.

**Arquivos:** `benchmark/profile-artifact.ts`,
`contracts/calibration-profile.ts`, `benchmark/report.ts`,
`benchmark/tests/profile-artifact.test.ts`,
`tests/unit/contracts/calibration-profile.test.ts`.

**Verificar:** `vitest run benchmark/tests/profile-artifact.test.ts
tests/unit/contracts/calibration-profile.test.ts benchmark/tests/report.test.ts`; o
parser rejeita perfil sem `calibrationScope` ou que alegue `per-length`.

**Concluída quando:** artefato, relatório e UI dizem “calibrador global; limiar por
faixa” e trazem os diagnósticos condicionais sem linguagem ambígua.

### G5 — Congelar e verificar antes do holdout

**Depende de:** A1–A7, B1–B3, C1–C6, D0, D0b, D1–D5, E2–E4, F1–F4,
**F5b**, F6, G1–G4.

**Por que:** **este é o ponto onde a execução anterior falhou.** Editei
`consume-holdout.ts` depois do `fit`, `integrity.evaluator-digest` reprovou, e a
concessão foi gasta sem medição válida.

**Mudança / procedimento:**
1. Rodar `npm run verify` e `npm run typecheck:benchmark` — verde.
2. `git status --short` — **árvore limpa**. Nenhuma modificação pendente em nenhum dos
   arquivos enumerados por `EVALUATOR_FILES`; não usar contagem fixa.
3. Rodar `fit`.
4. Recomputar o digest do avaliador e conferir que casa com o gravado em
   `frozen-calibration.json`.
5. **A partir daqui, até H1 terminar, nenhum commit e nenhuma edição** — nem de teste,
   nem de comentário, nem de formatação.

**Arquivos:** nenhum arquivo é alterado nesta tarefa; ela só executa a árvore congelada
e escreve `benchmark/out/rebuild-v3/G5/freeze-receipt.json`.

**Verificar:** `npm run verify`, `npm run typecheck:benchmark`, `npm run
model:verify`, `npm run test:model-benchmark`, `npm run docs:check`, `git status
--short` vazio e recomputação do `evaluatorDigest`.

**Concluída quando:** o digest recomputado casa e a árvore está limpa.

---

## Fase H — Medição e publicação

### H1 — Consumir o holdout uma única vez

**Depende de:** G5.

**Atenção:** o ledger de consumo registra a concessão por tupla
`datasetDigest`+`splitDigest`, mas o consumo é **informacional** (R2): uma tupla nova não
restaura cegueira. A execução anterior está `completed`. Antes de rodar, conferir no
ledger de exposição de C3 que (a) nenhum registro-linha de teste consumido voltou a qualquer
partição, (b) cada cluster do teste atual teve sua **primeira exposição no split atual**,
nunca em execução anterior, e (c) nenhum cluster da reserva entrou nas cinco partições.
Confirmar também espaço em disco — o preflight exige **20 GiB** livres
([`candidate-preflight.ts:51`](../../../benchmark/candidate-preflight.ts#L51)); esse
limite **não deve ser afrouxado**.

**Arquivos:** nenhum arquivo de código pode ser alterado. Executar
`benchmark/commands/consume-holdout.ts` pela CLI congelada; saídas em
`benchmark/out/rebuild-v3/H1/` e evento nos dois ledgers privados.

**Verificar:** conferir antes da confirmação o digest do avaliador, o backup automático
do ledger de exposição, `supportedReleaseAttempts >= 2`, 20 GiB livres e o
`consumptionId`. Depois de iniciar, apenas retomar a mesma sessão é permitido.

**Concluída quando:** existe `benchmark-report.json`, `benchmark-report.md` e
`gate-report.json`, e o ledger registra `completed`.

### H2 — Conteúdo obrigatório do relatório

**Depende de:** A3, A6 (o código do relatório é escrito na Fase A, **nunca depois de
G5**), H1 (a execução que o preenche).

**A métrica primária de release é o recall no limiar congelado**, com o FPR no mesmo
limiar. **TPR@1%FPR é diagnóstico**, não desempenho: ele escolhe um ponto na ROC do
próprio teste, enquanto o sistema implantado opera num limiar fixo escolhido antes.
Publicar os dois, com os papéis nomeados.

> **Não** eleger TPR@1%FPR nem AUROC como métrica de release: as duas medem
> separabilidade, e release se mede no limiar que vai rodar.

Publicar, sempre: recall e FPR **no limiar congelado**, **fim-a-fim** e **condicionais a
escore válido**; cobertura e erro de inferência **por fonte, classe, comprimento e
plataforma**; TPR@1%FPR e AUROC como diagnóstico; Brier, log-loss, intercept e slope de
calibração; calibração global **e por fatia**; pior fonte/estrato linguístico; **cada
família geradora OOD** separadamente; cada coorte mista; PPV/NPV em prevalências
plausíveis; e intervalos com a **unidade de reamostragem por estimando** (C4), nomeada.

Para negativos humanos, publicar ainda contagem de registros-linha, unidades amostrais,
FPR e calibração por `labelBasis`. Qualquer agregado entre `date-cutoff` e
`observed-process` é apenas descritivo, traz os pesos usados e **não** substitui os
resultados separados. Uma fatia sem poder aparece como `insufficient-power`, nunca como
evidência favorável.

**Multiplicidade declarada.** Publicar intervalos individuais de 95% como descrição e
usar nos gates os intervalos unilaterais simultâneos por **Bonferroni** de A6, com
`alpha_família = 0,05 / m`, onde `m` é o número pré-registrado de gates estatísticos
obrigatórios congelado em G5. Célula sem poder permanece em `m` e falha; o relatório
publica `m`, o alpha de cada gate e ambos os intervalos.

**Nunca publicar um número único de FPR sem nomear o estrato linguístico e a base do
rótulo humano.** Na execução anterior o
mesmo limiar congelado deu **7,12% em avaliações de produto, 2,68% em texto
universitário e 0% em Wikipédia, judiciário e Stack Overflow** — e os dois registros
ruins estavam ausentes do bloco de teste, então nenhum gate os viu.

**Arquivos:** somente leitura em H2: `benchmark/report.ts`,
`benchmark/metrics.ts`, `benchmark/slices.ts`,
`benchmark/tests/report.test.ts`, `benchmark/tests/metrics.test.ts`. A implementação
foi concluída em A6/E3 antes de G5; H2 apenas verifica os artefatos de H1.

**Verificar:** `vitest run benchmark/tests/report.test.ts
benchmark/tests/metrics.test.ts`; fixture com múltiplos gates precisa mostrar
intervalos individual e simultâneo distintos, com `m` reproduzível.

**Concluída quando:** os três relatórios de H1 contêm todos os itens desta seção, sem
agregado de FPR desacompanhado de estrato/base e sem intervalo de gate nominal não
ajustado.

### H3 — Verificar os gates mínimos de publicação

**Depende de:** H1, H2.

> **Atenção de sequenciamento — esta tarefa NÃO implementa gate nenhum.** `gates.ts`
> está em `EVALUATOR_FILES`: escrever gate depois do `fit` reprova
> `integrity.evaluator-digest` e queima a concessão (**R1**). Toda a implementação dos
> gates é **A6 + E3 + E4**, antes de G5. Aqui só se **verifica** o resultado.

Conferir no `gate-report.json`: zero leakage **por unidades amostrais reais, sob contrato
declarado**; número mínimo de clusters independentes por fatia; composição *core*
conforme o plano; igualdade entre heldouts declarados e observados; FPR global **e por
fonte, estrato linguístico e `labelBasis`** dentro do orçamento; fatia sem poder
reprovada se obrigatória ou marcada como diagnóstico conforme a classificação congelada
em E3; recall mínimo por
gerador OOD; limite de erro de inferência **por comprimento**; calibração aceitável
global **e condicional**; teste cego não consumido anteriormente; artefatos de treino e
publicação integralmente rastreáveis (F6).

**Arquivos:** nenhum código. Ler `gate-report.json`, `benchmark-report.json`,
`frozen-calibration.json`, `training-run.json` e os eventos dos ledgers.

**Verificar:** `npm run release:assert-publishable`. Saída permitida:
`pass`, `indicator-only` ou `reject`; qualquer divergência entre relatórios é `reject`.

**Concluída quando:** a decisão mecânica está registrada com a lista completa de gates
falhos; nenhuma exceção manual altera o resultado.

### H3b — Protocolo se H1 reprovar

**Depende de:** H3.

Se a decisão for `reject` ou `indicator-only`, é **proibido ajustar qualquer coisa usando
aquele teste**. Nem limiar, nem calibrador, nem política de janelas, nem seleção de
checkpoint. `indicator-only` é publicado como indicador e **não abre retry desta
release** só para buscar ações. `reject` aposenta a tentativa e volta a D0b. Olhar o
`gate-report.json` para saber *o que* falhou é legítimo; usar os escores do teste para
escolher um novo valor não é — isso converte o holdout num conjunto de validação e
destrói a única medição cega que existe.

**Novo digest não restaura cegueira.** Rearranjar os mesmos registros produz outra tupla
`datasetDigest`+`splitDigest` e o ledger aceitaria — mas aqueles textos já foram
revelados ao processo de desenvolvimento, e a concessão protege **informação**, não
identificadores. **Uma nova tupla de digests, por si, não autoriza nada** — é o caminho que
levaria exatamente à fraude que a concessão existe para impedir.

Nova tentativa exige, cumulativamente:
1. **Clusters nunca revelados** no novo bloco de teste — não apenas registros novos, mas
   unidades amostrais primárias (autor, doador, thread, seed, prompt) que nunca
   apareceram em nenhuma partição de nenhuma execução anterior;
2. **Os registros-linha do teste consumido não voltam** para `train`, `dev`, `cal-A`, `cal-B`
   nem `test` — eles saem do pool elegível de vez. `_exclude_ids.txt` é só uma defesa por
   id; a decisão é imposta pelo ledger de exposição de C3, por registro-linha e cluster;
3. Evento no ledger de exposição com a decisão anterior, a razão da nova tentativa, os
   registros-linha aposentados, os clusters aposentados e o digest da nova reserva.

É caro de propósito. Se o custo parecer alto, a alternativa correta é não medir ainda —
não medir de novo no mesmo material.

**Arquivos:** `benchmark/cluster-exposure-ledger.ts`,
`benchmark/commands/split.ts`, `benchmark/tests/cluster-exposure-ledger.test.ts`.

**Verificar:** `vitest run benchmark/tests/cluster-exposure-ledger.test.ts
benchmark/tests/split.test.ts`; fixture de retry com qualquer cluster anterior precisa
falhar.

**Concluída quando:** para `reject`, a aposentadoria foi gravada e um novo plano volta a
D0b; para `indicator-only`, a publicação fica limitada a indicador e nenhum retry é
aberto; para `pass`, a tarefa é `not-applicable`. Em nenhum ramo o teste escolhe ajuste.

### H4 — Expectativa calibrada, para o material de divulgação

**Depende de:** H2, H3.

O vencedor do PAN 2025, um **Qwen3-14B** robustamente ajustado, fez **0,9972 de ROC-AUC
dentro da distribuição e 0,6995 fora**. O melhor sistema na única competição de autoria
mista em 6 classes fez **64,46% de recall macro**. Um detector local de ~106 MB em WASM
não vai bater isso.

O produto deve ser comunicado em torno de **abstenção, cota de acusação falsa e incerteza
honesta** — não de um número de recall. E a cota tem de ser enunciada com as duas
condições que a sustentam: é **cota conformal condicionada a exchangeability entre o texto
humano de calibração e o de operação**, e **restrita aos estratos calibrados** (G3).
Escrever "taxa de acusação falsa garantida", sem essas condições, afirma o que L1 e G3
dizem explicitamente que não temos. Abstenção tem respaldo: o PAN
Voight-Kampff é a única competição que a permite explicitamente, pontuando com
**C@1 + F0.5u + Brier**, o que a torna custosa mas permitida. Sobre ECE, o contexto
importa: existem **apenas dois artigos publicados com ECE para esta tarefa**, ambos
in-distribution, e nenhum em português — o limite de 5% é escolha nossa, não convenção
da área.

**Teto da alegação, dado L1.** O que se poderá afirmar, e nada além:

> Detector de texto **pt-BR genérico**, executado localmente, com falso alarme medido em
> teste cego de uso único **sobre os estratos públicos calibrados** — enciclopédico,
> Q&A informal, avaliações de produto, institucional — e **com o número por estrato
> nomeado, nunca agregado num só**.

O que **não** se poderá afirmar: taxa de falso alarme em publicação profissional
contemporânea (não medida, e não inferível dos estratos disponíveis, dada a dispersão de
0% a 7,12%); nem desempenho em texto humano posterior a nov/2022, que está fora do escopo
do rótulo. Onde o produto agir sobre plataforma não calibrada, isso aparece na interface
(E4) e o material de divulgação diz o mesmo — não é ressalva de rodapé, é o escopo.

**Arquivos:** `README.md`, `docs/limitations.md`,
`docs/releases/cleanfeed-ptbr-v3.md`, `src/shared/classification-copy.ts`,
`src/shared/classification-copy.json`.

**Verificar:** `npm run docs:check`, `vitest run
tests/unit/shared/classification-copy.test.ts` e busca normalizada pelas expressões
proibidas “garante autoria”, “FPR no feed” e “texto contemporâneo”.

**Concluída quando:** todo material usa a decisão real de H3, os números por estrato e
as condições de exchangeability, sem alegação causal ou extrapolação de domínio.

---

## Fase I — Operação depois da publicação

Um plano "ponta a ponta" que termina na publicação não é ponta a ponta. Estas tarefas
faltavam.

### I1 — Rollout gradual

**Depende de:** H2, H3, H4.

O produto é local/offline: **não existe rollout por fração de usuários ou posts**. Usar
os estados já contratados:

1. `bundle-verified`: `npm run model:verify` e smoke real, sem classificar feed;
2. `shadow`: somente build de desenvolvimento, sem apresentação; replay determinístico
   de todo `dev + cal-A + cal-B`;
3. `indicator`: estado máximo da v3 quando H3 for `pass` ou `indicator-only`, depois de
   `npm run verify:release`, `npm run test:performance:release`, zero inversões F5b,
   erro de inferência `<= 0,001` no replay e pelo menos 30 dias restantes em todos os
   perfis;
4. `actions`: permanece implementado e testado, mas **não é promovido por este plano**.
   L1 não oferece perfil de plataforma e E4 impõe teto `indicator`. H3=`pass` registra
   capacidade científica nos estratos calibrados, não remove essa limitação de produto.

Não há avanço automático, backend, telemetria, coorte remota nem kill switch. Promoção é
alteração versionada de `release.json` e novo build auditado. Falha mantém o estado
anterior.

**Arquivos:** `contracts/model-release.ts`,
`benchmark/commands/verify-published-evidence.ts`,
`scripts/activate-model-release.mjs`, `tests/e2e/tmr-release.spec.ts`,
`docs/release-checklist.md`.

**Verificar:** `npm run verify:release` e `npm run test:performance:release`; fixtures
provam as quatro transições válidas e rejeitam salto, ação sob `indicator-only`, shadow
em produção e perfil com menos de 30 dias.

**Concluída quando:** o release promovido corresponde à decisão H3, nunca excede
`indicator` na v3 e a transição é reproduzível offline.

### I2 — Monitoramento de deriva, erro e cobertura em produção

**Depende de:** I1.

Medir **somente no dispositivo**, em contadores e histogramas limitados: documentos
elegíveis, tentativas, escores válidos, abstenções, erro por faixa de comprimento,
latência nas faixas existentes, abertura do circuit breaker e histograma de score com
20 bins. Nunca persistir texto, URL, autor, id/hash de documento ou evento individual.
Nunca transmitir nada.

Comparar o histograma local com a referência do perfil por PSI. Com pelo menos 1.000
escores, `PSI >= 0,25` mostra aviso local de possível mudança de distribuição nas
opções, mas **não** certifica deriva, não promove e não rebaixa sozinho o release. Falhas
operacionais continuam sob a regra existente do circuit breaker: três em dez minutos
abrem fallback local até retry explícito.

**Arquivos:** `src/storage/metrics.ts`, `src/storage/diagnostics.ts`,
`src/shared/diagnostic-types.ts`, `src/inference/circuit-breaker.ts`,
`src/options/components/ModelSettings.tsx`,
`tests/unit/storage/diagnostics.test.ts`,
`tests/unit/inference/circuit-breaker.test.ts`.

**Verificar:** `vitest run tests/unit/storage/diagnostics.test.ts
tests/unit/inference/circuit-breaker.test.ts`; testes provam limite dos histogramas,
ausência dos campos proibidos, piso de 1.000 e PSI 0,25.

**Concluída quando:** diagnóstico local mostra cobertura/erro/latência/distribuição sem
conteúdo identificável e nenhuma chamada de rede é introduzida.

### I3 — Rollback e renovação de perfil

**Depende de:** I1.

Caminho local, sem estado remoto:

- falha operacional abre o circuit breaker e usa o classificador estilométrico;
- perfil ausente, incompatível ou vencido rebaixa o teto para `indicator`;
- rollback de artefato é uma **nova versão da extensão** contendo o último
  bundle/release verificado; não se altera `release.json` em runtime e não se baixa
  perfil;
- configurações do usuário sobrevivem à atualização porque não pertencem ao bundle;
- perfil expira exatamente em 180 dias. Renovação volta a D0b e usa clusters humanos
  inéditos da reserva e novas famílias de IA; não reutiliza holdout consumido e não
  precisa fingir uma coorte temporal humana posterior ao cutoff.

**Arquivos:** `contracts/calibration-profile.ts`,
`src/inference/calibration-registry.ts`, `src/inference/model-catalog.ts`,
`src/inference/circuit-breaker.ts`, `tests/e2e/tmr-release.spec.ts`,
`tests/unit/inference/calibration-registry.test.ts`,
`tests/unit/inference/runtime-activation.test.ts`.

**Verificar:** `vitest run tests/unit/inference/calibration-registry.test.ts
tests/unit/inference/runtime-activation.test.ts
tests/unit/inference/circuit-breaker.test.ts` e `playwright test
tests/e2e/tmr-release.spec.ts`.

**Concluída quando:** existe teste E2E de rollback, e o perfil carrega prazo de validade
de 180 dias que o runtime respeita sem apagar preferências.

## §5 Rastreio: tarefa → defeito

| tarefa | defeito que corrige | seção do assessment |
|---|---|---|
| A1, A2 | 325 falhas de inferência, janela sem folga, custo linear desnecessário | 3.2 |
| A3 | `?? 0` converte falha em verdadeiro negativo | 3.1 |
| A4 | fatia `generatorExposure` vazia **e** restrição de heldout do split inerte | 3.3 |
| A5 | ausência de normalização Unicode | 6.4 |
| A6 | gate de ECE pontual; métrica primária errada; prior ≠ produção; bases de rótulo humano agregadas | 4.4, 4.6 |
| A7, G2 | incerteza pós-seleção nos limiares | 4.8 |
| C1–C4, **C6** | seis de oito eixos de agrupamento sintéticos, dois ausentes; bootstrap **e CV agrupada** degenerados; ausência de ledger de exposição entre reconstruções | 3.6 |
| **D0, D0b** | circularidade entre dimensionar e coletar; dimensionamento em linhas; ausência de reserva para retry | 4.7 |
| **E4** | runtime normaliza toda plataforma para `generic`; dados in-domain não chegam ao produto | 3.8 |
| **F6, F5a, F5b** | nada amarra treino ao ONNX; paridade só testada em 0,5, não nos limiares operacionais | 6, item 1 |
| **H3b** | ausência de protocolo quando o holdout reprova | — |
| **I1–I3** | plano terminava na publicação, sem rollout, deriva ou rollback | — |
| C5 | governança de revisão constante | 3.7 |
| D1, B3 | corpus sem o domínio do produto; base de evidência do rótulo humano não representada | 3.8 |
| D3 | classe confundida com domínio e estrato linguístico | 1, 2 |
| D4 | spans de diff usados como proveniência; classe mista inerte | 3.5 |
| D5 | hard negatives não validados e 15× subdimensionados | 4.7 |
| E2 | `createdAt` sintético; estratos quase disjuntos entre partições; sem treino governado nem reserva selada | 1, 3.4, 5 |
| E3 | gate `0_49` insatisfazível; ausência de gates de composição e divergência | 4.1, 4.2 |
| F1 | treino truncado vs inferência com janelas | 6, item 1 |
| F3 | saturação atribuída a causa não demonstrada | 6, item 3 |
| G4 | três perfis por comprimento sem calibração por comprimento | 4.9 |
| E2 item 3, D1 | época sem sobreposição entre classes — risco medido e **não** encontrado (§7) | 6, item 5 |

## §6 Verificação

| o que | comando |
|---|---|
| esteira completa | `npm run verify` |
| tipos do benchmark | `npm run typecheck:benchmark` |
| um teste do benchmark | `vitest run benchmark/tests/<arquivo>.test.ts` |
| CLI do benchmark | `npm run benchmark -- --help` |
| bundle do modelo | `npm run model:verify` |
| links da documentação | `npm run docs:check` |
| E2E do scorer no Chrome fixado | `npm run test:model-benchmark` |

Antes de G5, adicionalmente: `git status --short` vazio.

## §7 O que da base atual é reaproveitável

Medido em 2026-07-26, direto dos pools. A distinção que importa é **texto vs. artefato**:
o texto está intacto e a maior parte dos metadados é **recuperável, não perdida**.

### Reaproveitável sem trabalho

- **Os 61.825 textos distintos** (união de `candidates/` + `dataset/`; o selado usa
  10.000). São pt-BR limpo em UTF-8 — confirmei zero `U+FFFD` e acentuação íntegra nas
  três classes — e já passados pelo **filtro automático** de PII (`pii_hits` em
  `common.py`), de licença por fonte e de comprimento. **Filtro automático não é
  auditoria**: a alegação de revisão humana nos 10.000 registros é fabricada (C5), então
  estes textos são **candidatos recuperáveis**, e precisam de auditoria nova sob a
  governança de C5 antes de entrar num corpus publicável.
- **Todos os snapshots de origem em disco**: `Posts.xml` 748 MB, `ptwiki` 1,9 GB,
  Carolina `archive.zip` 3,0 GB (567 membros, 7 tipologias), B2W 48 MB, Madras 251 MB.
- **A esteira selada em TypeScript**: gates de três níveis, cadeia de digests, concessão
  unidirecional, fatias, Wilson, auditoria de governança. Os defeitos são as sete
  correções da Fase A, não arquitetura.
- **O modelo v2** (`cleanfeed-ptbr-v1`, 106 MB) como referência a ser batida.

### Recuperável sem recoletar — só repropagar ou re-extrair

- **Proveniência de geração de IA: já está nos pools**, em `meta` (ver C1). Inclui
  `promptTemplateDigest` e `version`, os dois `GROUP_KEYS` que nunca foram preenchidos, e
  `promptId`, que codifica o pai humano.
- **Datas reais do texto: já estão nos pools** (ver E2, item 3). Zero re-extração.
- **Identidade da fonte humana: re-extração determinística.** `candidate_id` é
  `source_id + sha1(natural_key)[:12]`, estável por construção. Uma passada sobre os
  snapshots reconstrói o mapa sem mudar id nenhum. Os extratores já leem `Id` do
  Posts.xml e `page_id` do dump — só não os persistem.
- **Autor e thread para Stack Overflow, produto e avaliador para B2W, arquivo-membro
  para Carolina**: estão nos snapshots e os extratores hoje os ignoram. É mudança de
  código + re-execução, não perda de dado.

### Precisa ser novo, sem alternativa

- **IA pareada por registro** (D3). Todo o texto de IA existente é `domain: geral`; o
  volume bruto não resolve o confundimento.
- **Classe mista com proveniência observável** (D4). Os 1.318 pares
  `{parentText, editedText}` são matéria-prima boa; os rótulos por trecho não servem.
- **Hard negatives a 300 por família** (D5), contra 20 hoje.

### Indisponível por limitação declarada

- **Humano profissional contemporâneo**: hoje é zero e L1/B3 proíbem aquisição
  individual. D1 amplia apenas os estratos públicos licenciados; E4 limita o produto e
  H4 limita a alegação. Nenhum implementador deve tentar “fechar” esta lacuna com texto
  público recente de autoria não observada.

### Descarte

- **O corpus selado como artefato**: digests gastos, grupos sintéticos, governança
  fabricada. Os 10.000 textos dentro dele sobrevivem; o artefato não.
- **`annotation` e `piiAudit`** dos 10.000 registros (C5) — revisão simulada.
- **Os `createdAt` de bloco** (1000000/2000000/3000000).
- **A medição de 2026-07-25**, e a concessão daquela tupla.

### Época: risco plausível, mas testado e não encontrado

Com as datas reais à vista, o texto humano é de 2011–2022 e o de IA é de 2026: **zero
sobreposição temporal**. Isso soa alarmante, mas o mecanismo precisa ser dito com
precisão — e não é "o modelo aprendeu que texto pré-2022 é humano".

**O modelo nunca vê data.** `train_detector.py` alimenta o dataset com
`{"text", "label"}` apenas ([`train_detector.py:105-120`](../../../benchmark/lab/train_detector.py#L105)),
e o schema de treino não tem nenhum campo temporal. O único canal possível é
**indireto**: correlatos textuais de época — entidades, eventos, vocabulário, convenções
de formatação da plataforma na ocasião.

Testei esse canal na maior extensão de datas disponível. Wikipédia, 798 registros
humanos pontuados, datas reais de 2017 a 2022:

| ano | n | média do escore | mediana |
|---:|---:|---:|---:|
| 2017 | 20 | 0,0063 | 0,0001 |
| 2018 | 22 | 0,0004 | 0,0001 |
| 2019 | 72 | 0,0019 | 0,0001 |
| 2020 | 119 | 0,0005 | 0,0001 |
| 2021 | 378 | 0,0012 | 0,0001 |
| 2022 | 178 | 0,0019 | 0,0001 |

**Spearman(data real, escore de IA) = +0,015, IC95 [−0,054, +0,085]** — indistinguível de
zero. Se a época vazasse, o texto humano mais recente pontuaria mais parecido com IA, já
que a IA é de 2026. Não pontua. No ptso (2013–2016, n=399) o resultado é o mesmo:
ρ = −0,047.

Há também uma **mitigação de desenho já presente**: os prompts de IA foram derivados de
pais humanos (`promptId = original_src_b2w_00848b3bc692`), então o assunto do texto de IA
é herdado do corpus humano pré-2022. O canal mais óbvio — tópico e entidades — está
controlado por construção.

**O que o teste não estabelece:** ele varia a data *dentro* do texto humano, logo detecta
gradiente, não **degrau**. Se houver algo que marque "gerado em 2026" e que nenhum texto
humano pré-2022 exiba em nenhum grau, esta medição não o vê. Resolver isso exigiria texto
humano contemporâneo com processo observado, indisponível sob L1/B3. O risco permanece
declarado, é acompanhado pela coorte temporal real (E2, item 3) e **não** é descrito como
confundimento demonstrado nem como problema resolvido por D1.

## §8 Rastro de revisão

Este plano passou por três rodadas de revisão crítica externa. **O histórico das
correções não fica aqui de propósito** — um plano de execução deve conter só a instrução
válida, para que nenhum agente implemente uma versão retratada.

O rastro completo — o que foi afirmado, quando, o que se verificou e o que foi retirado —
está em [`detector-rebuild-critical-review.md`](../../detector-rebuild-critical-review.md),
no registro de errata e no adendo de auditoria de precedentes. A seção 9 de
[`detector-rebuild-assessment.md`](../../detector-rebuild-assessment.md) lista as
afirmações corrigidas do diagnóstico.

Consulte-os antes de reabrir uma decisão deste plano: várias já foram discutidas e
revertidas uma vez.

## §9 Trabalho herdado obrigatório da Fase A

Duas modificações não commitadas de 2026-07-25 continuam na árvore:
`benchmark/commands/score.ts` e `benchmark/commands/consume-holdout.ts`, ambas com a
espera pela publicação da API do candidato (`waitForFunction`, timeout de 300 s). **Ambas
estão em `EVALUATOR_FILES`.** Elas precisam ser commitadas na Fase A, junto com A1/A2,
e nunca depois de G5.
