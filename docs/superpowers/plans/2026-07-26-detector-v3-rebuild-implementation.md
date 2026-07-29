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

**Superada por A5 (2026-07-27):** a coluna "entregue" acima descreve a árvore de A2 e não
esta. A5 gastou `contentCompositionVersion` = `lexical-content-v2` e editou o núcleo, então a
identidade corrente é `inferenceCoreDigest` `1a7a1cd1…` / `runtimeParityDigest` `41ccf6d3…`
(regenerados, ver "A5 — como foi executada"). Nenhuma corrida de bancada anterior a A5 pareia
com esta árvore.

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

   **MEDIDO em A5 (2026-07-27), na etapa dos offsets e do encaixe de janela:** os cinco
   deixam de produzir erro, e o varrimento de `development` + `calibration` vai de 21
   documentos com offsets grosseiros e 3 falhas `WINDOW_SLICE_NOT_REDUCIBLE` para **0 e 0**.
   Números e ids na subseção "A5 — como foi executada". Isso **não** fecha o critério de
   ≤ 0,1% por faixa: falta o replay fim-a-fim no Chrome, que continua sendo H3/I1.
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

**Gasto em 2026-07-27 por A5**, exatamente nessa coordenada e por essa razão: a
decomposição em unidades passou a correr sobre o texto normalizado.

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

#### A4 — como foi executada

**Forma canônica escolhida: o sublinhado** (`gemini-3_5-flash-low`), não o ponto. O
motivo não é gosto: o valor canônico tem de caber em `groups.generatorFamily`, e todo
token de agrupamento é validado como pseudônimo (`/^[A-Za-z0-9_-]+$/` em `schema.ts`)
exatamente para que nome ou endereço cru nunca se torne chave de agrupamento — `.` é um
dos separadores que essa regra exclui. A grafia com ponto, portanto, **não podia** ser a
canônica. `generation.family` continua com o rótulo literal do provedor, porque
`corpus-source-audit.ts` o compara byte a byte com a receita do lote declarado.

**Novo arquivo `benchmark/generator-family.ts`** (adicionado a `EVALUATOR_FILES`):

- `normalizeGeneratorFamily` é a definição única da forma canônica (colapsa runs fora
  de `[A-Za-z0-9_-]` em um `_`, apara `_` das pontas, **preserva caixa** — minusculizar
  fundiria dois rótulos de provedor que só diferem em caixa, o que é perda de fato, não
  normalização). Falha fechado quando o rótulo não tem conteúdo canônico, em vez de
  inventar um token de reserva.
- **Canônico é definido como ponto fixo do normalizador**, não como um segundo regex:
  `isCanonicalGeneratorFamily(v)` ⟺ `v` é token de pseudônimo e `normalize(v) === v`.
  Assim idempotência é verdadeira por construção e as duas definições não podem divergir.
- `GeneratorFamily` é **tipo nominal (branded)**. É isso que torna o defeito original
  impossível de escrever: `heldOut.has(record.generation.family)` não compila mais, e a
  conversão do parâmetro `heldOutGeneratorFamilies` em todos os consumidores obrigou 22
  literais de fixture a passar por `asGeneratorFamily`.
- `generatorFamilyOf(record)` é o **único** acessor; `slices.ts`, `split.ts` e
  `split-audit.ts` passaram a usá-lo.

**Schema (`schema.ts`) recusa, não corrige:** `groups.generatorFamily` precisa estar em
forma canônica, e um registro com `generation` precisa carregá-lo **igual** a
`normalizeGeneratorFamily(generation.family)`. Três mensagens distintas: campo ausente,
campo divergente, campo fora da forma canônica.

**Invariante de igualdade exata, em três lugares e com falha dura:**

1. `commands/split.ts` — o único ponto onde os quatro conjuntos existem juntos:
   declarado (manifesto), **marcado** (novo `markedHeldOutGeneratorFamilies`, que
   devolve as famílias que de fato ligaram `component.heldOut`, derivado do mesmo
   `buildComponents` que o splitter usa), derivado (auditoria) e publicado (artefato
   selado, que é de onde o relatório lê). Divergência → `HELD_OUT_FAMILY_DISAGREEMENT`.
2. `split-artifact.ts` — onde o artefato reentra tipado a partir de JSON (todo comando o
   carrega com cast): revalida a forma canônica em runtime e compara declarado × selado ×
   derivado.
3. `report.ts` — compara publicado × derivado **antes de qualquer métrica** e passou a
   **publicar** o conjunto numa seção própria do markdown ("Famílias geradoras retidas"),
   porque o relatório tinha um bucket `unseen` e nenhuma linha dizendo o que "unseen"
   significa. `BenchmarkReportInput.split` ganhou `heldOutGeneratorFamilies`; a receita do
   `reportDigest` **não** foi tocada (o conjunto já está preso pelo `splitDigest`).

**`assemble_corpus.py`** ganhou `generator_family()`, espelho Python do normalizador, nos
dois lugares que gravavam família (`ai_record`, `mixed_record`). Diferente de `slug()`,
ele levanta em vez de devolver `"x"`. Havia arquivo de teste Python
(`benchmark/lab/test_extractors.py`) mas nenhum caso para isso: foram adicionados três
(`python -m unittest` em `benchmark/lab`: 26 → 29 testes, OK).

**Divergência do plano — fixtures que declaravam uma reserva que nada satisfazia.** O
invariante reprovou 17 testes existentes por um motivo real: `cli.test.ts`,
`fit.test.ts` e `consume-holdout.test.ts` declaravam `heldout_family` no manifesto
(que exige ≥ 1 família) mas nenhum registro do corpus carregava essa família, e o
`passingAudit` fixo devolvia `[]`. Em vez de afrouxar a checagem (R3), as fixtures
foram corrigidas: as linhas de IA da partição `test` passaram a carregar a família
reservada, e os três `passingAudit` passaram a **derivar** o conjunto da partição
como `split-audit.ts` deriva. Também: `dataset-manifest.test.ts` tinha
`generation.family = "acme-large"` com `groups.generatorFamily = "acme_family"` — a
divergência exata que A4 recusa — e ficou coerente; as fábricas de registro de
`split.test.ts`, `split-audit.ts`, `split-artifact.test.ts`, `slices.test.ts`,
`corpus-import.test.ts` e do gerador de corpus sintético passaram a gravar o campo
canônico, porque construíam registros que o schema agora recusa.

**A única comparação legítima que sobrou contra `generation.family`** é a de
`recipeMatchesBatch` (em `benchmark/corpus-source-audit.ts`, cuja explicação está no
comentário imediatamente acima da função — ponteiro por nome, não por linha, porque a
linha já se moveu uma vez): ali os dois lados são o rótulo do provedor e a pergunta não é
"essa família foi reservada", é "essa receita é a do lote revisado".

**Verificação:** suíte 153 arquivos/1714 testes → 154/1738, tudo verde (+21 no arquivo
novo `generator-family.test.ts`, +3 em `report.test.ts`, saldo 0 no reparo de fixtures);
três projetos `tsc` verdes; `eslint` limpo em todos os arquivos tocados.
`prettier --check .` acusa quatro arquivos (`gates.ts`, `metrics.ts`,
`rebuild-v3-policy.ts`, `lab/build_governance.ts`), **nenhum** deles tocado por A4 — é
estado de HEAD, fora de escopo.

**Rodada de correção de spec — a busca de limpeza tinha sido só em TypeScript.** O
critério "`grep` não encontra mais nenhuma comparação de família contra campo não
canônico" foi verificado com `--include=*.ts`, e o arquivo que o próprio brief põe no
escopo (requisito 5) é Python. Sobrevivia uma comparação da classe exata em
`assemble_corpus.py`: o aviso de piso `!! held-out families magras` contava
`generation.family` (rótulo pontuado do provedor) e testava pertinência em `held_out`
(tokens canônicos sublinhados), logo **nunca podia disparar**, quaisquer que fossem as
contagens. O contador virou a função testável `thin_held_out_families`, que lê
`groups.generatorFamily` — o mesmo campo de que `held_out` é construído — e itera
`held_out` em vez das chaves do `Counter`, para que uma família declarada retida e
estocada por **nenhum** registro seja reportada como `0` em vez de desaparecer do
relatório. Ela não substitui o `below_floor` do `main()`: aquele pergunta na declaração,
esta pergunta aos registros efetivamente escritos, depois do particionamento. Hoje as
duas concordam por construção (só se declara família que já passa do piso) — o valor é
pegar qualquer edição futura que descarte registros depois da declaração, ou afrouxe o
piso, antes de escrever um corpus que o `validate` recusaria com `DATASET_COVERAGE_INVALID`.
Quatro casos novos em `test_extractors.py` (29 → 33, `OK`), vermelhos em dois estágios
antes da correção: primeiro `ImportError` (função inexistente) e depois, com a função
extraída **mantendo a leitura pontuada**, `AssertionError: {} != {'gemini-3_5-flash-low':
3}` — o defeito real reproduzido, não a ausência do símbolo. A busca foi refeita sobre
`*.ts`, `*.py`, `*.mjs`, `*.js`, `*.cjs` e `*.mts`; fora de comentários e do
`recipeMatchesBatch`, os únicos usos executáveis restantes de `generation["family"]` são
`schema.ts` (onde o campo canônico é derivado e exigido) e `assign_generation_batches` em
`assemble_corpus.py`, que **grava** a receita do lote — o mesmo rótulo de provedor que o
`recipeMatchesBatch` compara byte a byte, e nenhum teste de pertinência.

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

#### A5 — como foi executada (2026-07-27)

**Entregue.** Commits: `2cff056` (núcleo) e o commit de fechamento desta seção.

**A implementação compartilhada é `contracts/text-normalization.ts`**, chamada por
`src/inference/inference-worker.ts` (`prepare()`, **antes** da detecção de idioma, da
tokenização e do fatiamento em janelas) e por `src/model-benchmark/main.ts`
(`scoreDocument`). Não há segunda cópia. `computeContentComposition` também passa o texto
por ela, então composição e tokenização nunca discordam sobre qual é o texto; como
`normalizeForInference` é idempotente, tanto faz o chamador passar texto cru ou já
normalizado. O arquivo entrou em `EVALUATOR_FILES` (`benchmark/digests.ts`) e no
inventário do núcleo em `scripts/runtime-parity.mjs` — ele decide **quais bytes chegam ao
modelo**.

**`CONTENT_COMPOSITION_VERSION` = `lexical-content-v2`**, a versão que A2 devolveu.
Justificativa registrada na própria constante e **fixada por teste** em
`tests/unit/contracts/content-composition.test.ts` (`the movements that justify
lexical-content-v2`), que reproduz o split do `v1` — `/\S+/gu` + `classifyContentUnit`,
idêntico byte a byte entre as duas versões — e compara:

1. **unidade feita só de invisível desaparece**, logo `totalUnits` **cai** e `lexicalRatio`
   sobe: `uma <U+200B> palavra` era 3 unidades / 2 léxicas / razão 2/3 e agora é 2 / 2 / 1.
   Vale para U+200B, U+2060, U+180E e U+00AD;
2. **invisível não fica mais dentro de uma unidade**, o que move a **categoria** da unidade:
   `#Cle<U+200B>anFeed` era `lexical` (U+200B não está em `[\p{L}\p{N}_]`) e agora é
   `hashtag`;
3. **URL escrita com confusável ou em latino de largura total** passa a classificar como
   `url`: `htt<U+0440>s://exemplo.com` e `ｈｔｔｐｓ://exemplo.com`.

Além das contagens, **o texto pontuado em si muda em 222 dos 5.000 registros de
`development` + `calibration`** — as mesmas unidades, feitas de outros bytes, chegando ao
tokenizador. Essa é a outra metade da razão para gastar a coordenada.

**Correção de uma justificativa errada (rodada de conformidade).** A primeira redação
afirmava que "separador exótico agora **separa** unidades". Isso é **falso e foi medido**:
o `\s` do JavaScript já casa todo Zs/Zl/Zp, então o `/\S+/gu` do `v1` **já separava** em
NO-BREAK SPACE, IDEOGRAPHIC SPACE, LINE SEPARATOR e OGHAM SPACE MARK — dobrar esses para
U+0020 não move contagem nenhuma. Igualmente falsa era a metade "hashtag" do movimento 3:
`\p{L}` casa cirílico, então `#Cle<U+0430>nFeed` já era `hashtag` no `v1`. As duas metades
negativas agora têm teste próprio, para que a razão não volte a ser uma não medida.

**Divergências do texto do plano — três, todas por medição, nenhuma afrouxando critério:**

1. **A tabela de confusáveis não é aplicada incondicionalmente.** O plano diz "mapear
   cirílico `а` → latino `a` é correto"; medido sobre `development` + `calibration`
   (5.000 registros), aplicar isso a toda palavra **destrói texto legítimo**: `TNF-α` virava
   `TNF-a` e `NF-κB` virava `NF-kB` em quatro registros
   (`src_ai_public_madras_7e700c7f00ab`, `…_7e8a1465ec45`, `…_7fe4198396df`,
   `src_carolina_7bb17c80e5de`) e o nome checheno `Муса` virava `Myca` em
   `mix_src_wikipedia_pt_5eff3608eeb8`. A regra final tem duas portas
   (**script misto** e **pseudo-latina**) mais duas exceções gregas, e o mesmo varrimento
   depois dela reporta **0 registros com confusável dobrado**. São **três** preços, todos
   nomeados no código: (i) uma palavra **inteiramente confusável** dentro de documento que
   carregue **qualquer** testemunha não latina, (ii) um **ponto de código** grego dentro de
   documento que também escreve grego — por ponto de código e não por palavra, ver a
   requalificação abaixo —, e (iii) uma palavra de **uma letra** disfarçada com `α`/`ο`/`ι` —
   nenhum dos três é restaurado. A esses três a terceira rodada acrescentou uma **quarta**
   exclusão da tolerância que não é preço de regra nenhuma, e sim ordem dos passos: a chave
   `ϲ`, que o NFKC dobra antes de a dobra de confusáveis existir. A quarta rodada acrescentou
   ainda a classe que corre na direção **contrária** — texto não latino **genuíno** que a dobra
   **reescreve**, `𝛽`/`Муса` → `Myca` — porque a tolerância também é violada quando a dobra
   dispara onde não devia, e não só quando deixa de disparar. Está no bloco de preço mais
   abaixo e fixada no mesmo `describe` das outras.
2. **NFKC ganhou duas recusas que o plano não previa**, ambas na classe "cuidado com
   NFKC" que o próprio plano levanta: superscritos/subscritos (`km²` → `km2`, `H₂O` → `H2O`;
   `₂` sozinho são 28 reescritas no corpus) e **qualquer dobra que inventaria espaço em
   branco** (todo diacrítico espaçador decompõe em U+0020 + marca combinante; `´` são 9
   reescritas). Espaço inventado é fronteira de palavra inventada, logo `totalUnits` e a
   faixa de comprimento se movem. A primeira recusa protege os três caracteres do Latin-1
   (`² ³ ¹`) mais o bloco **Superscripts-and-Subscripts** (U+2070-U+209C) — e **não** todo
   caractere elevado do Unicode: as **letras modificadoras** ficam fora e continuam
   achatando (`30ᵉ` → `30e`, U+1D49, e `xᶰ` → `xɴ`, U+1DB0; uma reescrita cada em
   `development` + `calibration`). Resíduo **nomeado e fixado por teste**; estender a guarda
   moveria o texto pontuado desses dois registros, o que exige novo varrimento e nova
   medição do `222 de 5.000` — é trabalho de medição, não de comentário.
   **Correção da terceira rodada:** a redação acima enunciava o resíduo como **lista de
   faixas**, e lista de faixas é o mesmo excesso de alegação um nível abaixo. Varrido
   U+0020–U+A7FF nesta árvore, há 29 letras modificadoras que o NFKC achata **fora** das
   faixas nomeadas — entre elas as **Spacing Modifier Letters** (U+02B0-U+02B8,
   U+02E0-U+02E4): `xʰ` → `xh` e `xʷ` → `xw`, medido. O resíduo passa a ser enunciado como
   **propriedade** ("toda letra elevada que o NFKC achata e que está fora de U+2070-U+209C"),
   com as duas famílias citadas como exemplo e não como enumeração, e o teste passou a
   afirmar **dois blocos diferentes** para que a enumeração não volte. Deste resíduo todo, o
   corpus contém exatamente `ᵉ` e `ᶰ`. E a glosa do que **é** protegido também estava
   estreita: U+2070-U+209C não são só dígitos e operadores — `ⁱ` (U+2071) e `ⁿ` (U+207F) são
   **letras** e estão protegidas (verificado, com teste próprio). **Correção da quarta
   rodada:** o bloco Unicode é U+2070-U+209F e a redação anterior dizia que U+2070-U+209C é "a
   parte atribuída" dele, com "os três últimos pontos de código não atribuídos" — as duas
   metades erradas na mesma direção. Varrido nesta árvore, **seis** pontos de código do bloco
   não têm categoria geral (U+2072, U+2073, U+208F, U+209D, U+209E, U+209F) e **três** deles
   (U+2072, U+2073, U+208F) ficam **dentro** da faixa guardada, que portanto não é "a parte
   atribuída" de nada: a parte atribuída não é intervalo. U+2070-U+209C é a **menor faixa que
   abrange** todo ponto de código atribuído do bloco, e cobre seis não atribuídos de lambuja —
   inofensivo, e é justamente por isso que a guarda tem forma de bloco em vez de lista
   escolhida à mão. Os seis e os três interiores estão fixados por teste (`\p{Cn}`), para que a
   glosa não volte a inventar contagem.
3. **A terceira restrição do brief (CJK) exigiu corrigir `segmentBasicWords`**, em
   `src/inference/model-runtime.ts`, e não só normalizar. O `tokenizer.json` selado tem
   `handle_chinese_chars: true` e o BERTimbau não tem ideograma nu em `vocab.txt`, então
   `花巻市` são **três** palavras e três `[UNK]`; tratá-lo como uma palavra consumia um token
   por três, deslocava todo offset seguinte e, quando os totais divergiam,
   `deriveWordPieceOffsets` degradava o documento inteiro para spans grosseiros — que
   `fitWindowSlice` recusa como `WINDOW_SLICE_NOT_REDUCIBLE` no momento em que o documento
   precisa de uma segunda janela.

**Requalificação da tolerância declarada (segunda rodada de conformidade).**
`HOMOGLYPH_SCORE_TOLERANCE = 0` continua **zero** — o valor não mudou e não pode mudar,
porque variante coberta normaliza para bytes idênticos. O que mudou é a **precondição**: a
primeira redação prometia zero para "toda variante cujas substituições estejam cobertas por
`CONFUSABLE_TO_LATIN`", o que é **mais largo do que o código entrega** e portanto quebra R7.
Cobertura na tabela **não** é suficiente — `foldConfusables` só reescreve dentro de palavra
que a regra de script misto/pseudo-latina marca como ataque, e as duas exceções gregas ainda
incidem por cima. Medido nesta árvore, com sonda temporária, antes de editar:

| classe fora da tolerância | ataque | resultado |
|---|---|---|
| palavra inteiramente confusável + testemunha não latina | `…(贵州) e uma casa amarela` → `саѕа` | **não** dobra; normalizações diferem |
| disfarce grego + documento que escreve grego | `a constante β … uma vida longa` → `νida` | **não** dobra; normalizações diferem |

Nos dois casos, **removida a testemunha**, o mesmo ataque volta a ser coberto — a exclusão é
a testemunha, não a palavra nem a tabela. As duas classes agora estão **fixadas como
não-invariantes** em `tests/unit/contracts/text-normalization.test.ts`; escritas primeiro na
forma que a redação antiga prometia, as duas **falharam** (saídas no relatório), e é isso
que impede a leitura incondicional de voltar verde. Nenhuma regra de dobra foi alterada:
elas foram medidas contra registros reais e mexer nelas reintroduziria `TNF-a` e `Myca`.

**A definição de "coberta" é por SUBSTITUIÇÃO, não por palavra (terceira rodada).** A
redação da rodada anterior dizia "coberta quando toda substituição é chave da tabela **e
toda palavra** em que ela entrou é uma que `foldConfusables` dobra" — e essa regra geral
**ainda admite** o caso que o seu próprio segundo item exclui, porque a exceção grega incide
por **ponto de código dentro de** palavra já marcada como ataque. Medido nesta árvore:
`a constante β vale 3 e uma νidа longa` (nu grego + `id` latino + `а` cirílico) normaliza
para `… νida longa` — o `а` **foi** reescrito, logo a palavra **é** dobrada, e o `ν`
sobrevive. Pela definição por palavra essa variante era "coberta" e tinha zero prometido; pela
exclusão três linhas abaixo não era coberta. A definição passou a ser: coberta quando o ponto
de código é chave da tabela **e** `foldConfusables` reescreve **aquele ponto de código**.
Fixado por asserção no teste da classe grega (a forma `νidа`: `а` dobra, `ν` fica).

**Terceira classe fora da tolerância, achada por medição: `ϲ`.** `ϲ` (U+03F2 GREEK LUNATE
SIGMA SYMBOL) **é** chave de `CONFUSABLE_TO_LATIN`, mas o passo 1 (NFKC) a dobra para `ς`
antes de o passo 3 existir, e `ς` não é chave: `uma ϲasa` fica `uma ςasa`. É a **única** das
54 chaves que não é NFKC-estável, e o teste afirma isso **sobre a tabela** (não contra um
número copiado), de modo que uma chave nova instável tem de encarar o teste. A entrada
**permanece** na tabela e agora é load-bearing por outro motivo: depois da correção abaixo,
`countScriptWitnesses` lê a fonte, e é essa entrada que impede o `ϲ` de um atacante de ser
contado como testemunha grega genuína.

**A testemunha de script passou a ser evidência do AUTOR, não do NFKC (terceira rodada).
Única mudança de comportamento desta rodada.** O passo 3 contava testemunhas sobre os átomos
**já dobrados** pelo passo 1, então o NFKC podia **fabricar** a própria evidência que
desligava a defesa de homóglifos no documento inteiro:

| fonte | script na fonte | NFKC | efeito na árvore anterior |
|---|---|---|---|
| U+00B5 MICRO SIGN (`µm`, `µg`, `µl`) | **Common** (nenhum) | U+03BC `μ` | contava como testemunha `nonLatin` **e** `greek`: `unmixedLatin` falso e `greekIsContent` verdadeiro para todo o documento |
| `ϲ` U+03F2 — **chave da tabela** | Greek | `ς` (não é chave) | a substituição do próprio atacante virava testemunha grega |

O primeiro é medido no corpus: `src_carolina_23f8e515f0eb` (um registro de `development`,
**quatro** ocorrências de `µ`) pontuava com a defesa desligada, e digitar um micro sinal era
uma maneira de um caractere de desligá-la. *(A revisão que motivou esta rodada disse "4
registros"; são 4 **ocorrências** em **1** registro — a classe do defeito está certa, a
contagem não.)*

A regra que corrige os dois é uma só: **evidência de script vem de caractere que o Unicode
atribui a um script específico, lido na fonte.** Common e Inherited são script-neutros por
definição do próprio Unicode e não testemunham nada (`SCRIPT_NEUTRAL`); caractere da fonte
que já é confusável conhecido é suspeito, não testemunha. **Não** se exige que a fonte seja
letra: `⼀` U+2F00 KANGXI RADICAL ONE é Script=Han mas categoria `So` e dobra para a letra
`一` — exigir letra jogaria essa testemunha Han fora. O lado **latino** continua sendo lido
no átomo dobrado, deliberadamente: é o lado que **habilita** a porta pseudo-latina em vez de
vetar reescrita, e lê-lo na fonte quebraria a idempotência (`𝐚 саѕа` não dobraria nada na
primeira passada e dobraria `саѕа` na segunda).

Escopo da classe, varrido U+0020–U+10FFFF nesta árvore: **541** pontos de código cuja dobra
NFKC produz letra não latina a partir de fonte latina ou neutra, dos quais **297** produzem
grego (`㎛`, `㏀`, `ℽ`, os alfabetos gregos matemáticos U+1D6A8-U+1D7CB, U+2135-U+2138). É
por isso que a correção é **regra** e não lista de bloqueio.

**Preço da regra, medido e nomeado — nas duas direções (corrigido na quarta rodada).**
Caractere script-neutro que o NFKC dobra para letra não latina deixa de testemunhar, e isso
tem uma metade benigna (a palavra atacada ao lado volta a ser dobrada) e uma metade **danosa**
que a redação anterior deixava implícita: documento cuja **única** evidência não latina é uma
dobra dessas **perde** a proteção, e uma palavra não latina genuína feita só de chaves da
tabela é reescrita. Medido nesta árvore, um ponto de código de diferença para cada lado:

| entrada | saída | por quê |
|---|---|---|
| `a constante 𝛽 vale 3 e o nome Муса aparece aqui` (U+1D6FD, Script=Common, NFKC → `β`) | `… o nome **Myca** aparece aqui` | `М у с а` são todas chaves da tabela e não sobra testemunha |
| a mesma frase com `β` de verdade | intacta | o `β` é Script=Greek na fonte |

Isso é o **centro** da regra e não um canto: os alfabetos gregos matemáticos U+1D6A8-U+1D7CB
são 297 das dobras varridas acima, e `㎛` U+339B e `㈠` U+3220 → `(一)` se comportam igual.
No corpus de hoje o custo é **nulo** (0 registros dos 5.000 de `development` + `calibration`
normalizam diferente), e é essa medição que sustenta a escolha da regra — mas as duas metades
ficaram fixadas como **quarta classe NÃO invariante** em
`tests/unit/contracts/text-normalization.test.ts`, contrastando `𝛽` com `β`, para que um corpus
futuro com grego matemático ou CJK entre parênteses em volume vire teste vermelho e não
reescrita silenciosa. A alternativa era julgar 541 dobras uma por uma e manter a lista contra
cada revisão do Unicode. Fonte Script=Greek continua testemunhando, inclusive `Ω` U+2126 OHM
SIGN, cujo Script **é** Greek; essa direção só desliga a dobra, que é o lado conservador, e foi
deixada em paz de propósito.

**Varrimento de confirmação (`benchmark/out/rebuild-v3/a5-r2/`, dev + cal, 5.000
registros).** `sweep-before.txt` (árvore em `4ee6c8d`) e `sweep-after.txt` (esta árvore),
produzidos pelo **mesmo** script, saíram **byte a byte idênticos**: `changed 222`,
`records with a folded confusable: 0`, 35 reescritas distintas, e `TNF-α`, `NF-κB` e `Муса`
intactos. A **idempotência** foi medida em vez de afirmada em fixture: 10.005 textos (os
5.000 como escritos, os mesmos 5.000 com ataque de homóglifo aplicado a todo `a/c/e/i/o/s/u/v`
— para que a dobra seja de fato exercitada — e 5 casos à mão, entre eles `𝐚 саѕа`), **0 não
idempotentes** (`idempotence.txt`). Logo a correção **não reescreve texto legítimo em nenhum
dos 5.000 registros de `development` + `calibration`, nem nas 5.000 variantes atacadas** — o
escopo é esse, e não a propriedade geral: `a constante 𝛽 vale 3 e o nome Муса aparece aqui`
→ `Myca` é texto legítimo que esta correção **reescreve**, e é o quarto preço nomeado acima
(R7 — declare o contrato, não a propriedade). Nenhum
limite foi afrouxado (R3), e `CONTENT_COMPOSITION_VERSION` **fica** em `lexical-content-v2`: o `222 de 5.000` que
`contracts/content-composition.ts` cita foi **re-medido** e continua verdadeiro, então
incrementar mandaria re-pontuar sem que nenhum artefato tenha ficado errado. Essa decisão
está registrada no docstring da constante, não só aqui.

**Uma marca combinante reabria o caminho fechado, e agora `\p{M}` é neutro (quarta rodada).
Única mudança de comportamento desta rodada.** O passo 1 trabalha por *grapheme cluster* e
cobra **todo** átomo de um cluster que mudou ao cluster **inteiro** — logo a fatia da fonte que
`countScriptWitnesses` lê é base **mais** as marcas combinantes dela. Como `SCRIPT_NEUTRAL` só
tinha Common e Inherited, uma marca com Script específico testemunhava aquele script para o
documento todo, e o caminho do micro sinal reabria com **um** caractere a mais. Medido na
árvore de `86cd8d4`:

| entrada | saída | marca |
|---|---|---|
| `a medida de 5 µ҃m e uma саѕа fica ali` | `a medida de 5 μ҃m e uma **саѕа** fica ali` (ataque sobrevive) | U+0483 COMBINING CYRILLIC TITLO (Script=Cyrillic) |
| a mesma frase com U+05B0 | idem | HEBREW POINT SHEVA (Script=Hebrew) |
| a mesma frase **sem** marca | `… uma casa fica ali` | — |

A divisão por Script também não tinha princípio nenhum atrás dela: U+064B (árabe) e U+0951
(devanágari) são Script=Inherited e **já** não testemunhavam, enquanto as equivalentes hebraica
e cirílica testemunhavam. Correção: `\p{M}` entra no conjunto neutro — **adição deliberada, não
propriedade do Unicode** —, porque **marca senta sobre base do próprio script e a base
testemunha sozinha** (fixado por teste: `Журнал about ро҃к и джаз` continua intacto). A marca
**sobrevive** ao texto normalizado; fechou-se um caminho de testemunha, não se apagou nada do
que o autor escreveu. Resíduo enunciado: marca cuja base **não** testemunha — titlo cirílico
sobre letra latina, ponto hebraico citado sozinho — passa a não testemunhar nada, e é o caso em
que o argumento "a base testemunha" não vale.

Varrimento de confirmação desta mudança (`benchmark/out/rebuild-v3/a5-r3/`): `sweep-before.txt`
(árvore em `86cd8d4`) e `sweep-after.txt` (esta árvore), mesmo script, **byte a byte idênticos**
— `changed 222`, `records with a folded confusable: 0`, 35 reescritas distintas, `TNF-α`,
`NF-κB` e `Муса` intactos. Idempotência re-medida em **10.009** textos (os 9 casos à mão agora
incluem as duas variantes com marca, o `𝛽`/`Муса` e `ро҃к`): **0 não idempotentes**. Por isso
`CONTENT_COMPOSITION_VERSION` **continua** em `lexical-content-v2` pelo mesmo argumento medido
da rodada anterior, e nenhum limite foi tocado (R3).

**Medição do critério de erro que A2 deixou aberto** (artefatos em
`benchmark/out/rebuild-v3/a5/`; harness de bancada com o `vocab.txt` real e o WordPiece
real, **sem** o modelo — mede a etapa dos offsets e do encaixe de janela, que é onde os
cinco erros foram diagnosticados, não o replay fim-a-fim no Chrome):

| | documentos com offsets grosseiros | falhas de encaixe de janela |
|---|---:|---:|
| sem o split de CJK (`development`) | 7 | 0 |
| sem o split de CJK (`calibration`) | 14 | 3 |
| **com o split de CJK** (`development`) | **0** | **0** |
| **com o split de CJK** (`calibration`) | **0** | **0** |

As três falhas do estado anterior são `src_ai_public_madras_961c462e650f`,
`…_a48e8a49816d` e `…_be8b62bfe739` — três dos cinco ids de A2, com o código exato
`WINDOW_SLICE_NOT_REDUCIBLE`. Os outros dois (`…_5a06a06a65c4` e
`mix_src_wikipedia_pt_d3e3087c4ae9`) aparecem como **grosseiros mas sem falhar**: exatamente
o estado latente que o brief descreve. Depois da correção nenhum dos cinco produz erro nesta
etapa. O critério de ≤ 0,1% por faixa **não** está declarado fechado: falta o replay
fim-a-fim no Chrome, que é H3/I1.

**Normalização muda 222 de 5.000 registros** (4,4%): quase tudo espaço exótico → U+0020
(506 ocorrências) e U+2011 → U+2010 (347).

**Identidade desta árvore, regenerada (não editada à mão):**
- `inferenceCoreDigest` `ad6ba14dd5feb21259646867b2da461abf40d06f5f4328dd70735b2bac0a73de`
- `runtimeParityDigest` `82d0e0b04f00d791070b820811ee1d98feb40bd8f61e87c2e01134376c59a746`

Os dois valores acima são **derivados da árvore**, não constantes: `contracts/`
`text-normalization.ts` e `contracts/content-composition.ts` estão em `EVALUATOR_FILES` e no
inventário do núcleo, e o que entra no hash são os **bytes crus** — logo uma edição de
**comentário** move os dois. Ela já moveu **quatro** vezes desde a entrega de A5
(`1a7a1cd1…`/`41ccf6d3…` → `4f535552…`/`cf882d5e…` → `e1661009…`/`71c23a85…` → estes), uma vez
por rodada de conformidade. As duas últimas moveram também o **comportamento**, não só
comentário, então nelas os digests mudariam de qualquer maneira. Nenhum arquivo
versionado precisou mudar (o manifesto do modelo não carrega digest de arquivo do núcleo e
`benchmark/work/model-benchmark/` é ignorado pelo Git), mas a consequência é operacional:
**quem rodar a bancada tem de regenerar a paridade a partir desta árvore**, porque nenhuma
corrida anterior pareia com ela. Depois de G5 congelar a janela isso deixa de ser barato —
até lá, cada rodada que mexe em comentário do núcleo atualiza estes dois valores aqui.

Oito digests derivados sob `tests/fixtures/model-release/**` foram recomputados com
`computeCalibrationProfileDigest` / `computeCalibrationSetDigest` do próprio contrato.

**Registrado, não corrigido (fora do escopo de A5):** `src/model-smoke/main.ts` continua
sem normalizar e mantém o construtor privado de janelas que A2 registrou em F1 — é um
terceiro caminho divergente, e pertence a F1.

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

#### A6 — como foi executado (2026-07-27)

Concluída. O que divergiu do escrito acima está registrado aqui; o resto saiu como
planejado.

**Entregue**

- `benchmark/rebuild-v3-policy.json` materializa a tabela congelada em JSON canônico
  (chaves ordenadas, indentação de dois espaços, uma newline final — propriedade
  verificada por teste, não por convenção) e `benchmark/rebuild-v3-policy.ts` a valida
  fechando o conjunto de chaves em cada nível: chave ausente, chave desconhecida, tipo
  errado, valor fora do domínio e decisão congelada afrouxada são todos erro, com o
  caminho exato na mensagem. Não há default em nenhum ponto. Ambos entraram em
  `EVALUATOR_FILES`.
- Ficaram **fora** do JSON as linhas que são prosa sem consequência mecânica; entraram
  apenas os gatilhos por trás delas: `productTarget` +
  `infersAuthorship: false` (alvo do produto), `localization.authorizesVisualAction:
  false` (localização), `integralPositive` e `materialAssistance` (positivo integral e
  assistência material), `mixedBelowHalfAiRole` (misto < 50%). Também entraram os
  hiperparâmetros de treino da tabela e três números **pré-registrados que não são da
  tabela** mas que o gate precisa ler de algum lugar único: `calibrationGate`
  (15 bins, equal-mass, limite de bootstrap, teto 0,05) e `powerFloors` (os pisos §6.4
  de 300 negativos e 200 positivos, mais `samplingUnits: null` — ver "lacunas").
- Métrica: `ece equal-mass` com o número de bins da política, `logLoss`, reta de
  calibração (`intercept`/`slope`, ajuste logístico com backtracking; `NaN` quando o
  ajuste não é identificado, nunca um `1` fabricado), diagrama de confiabilidade,
  `predictiveValues` (PPV **e** NPV) e `tprAtOnePercentFpr`.
- Papéis nomeados em `EvaluationMetrics`: `release` (recall e FPR no limiar congelado,
  fim-a-fim) e `separability` (`auroc`, `prAuc`, `tprAtOnePercentFpr`, com
  `gates: false` literal). `rocAuc`, `prAuc` e `brier` **saíram do nível de topo** e
  agora só existem dentro do bloco do seu papel — é por isso que citar o número errado
  passou a exigir escrever o caminho errado. `ece15` (equal-width) ficou no topo porque
  é o que o perfil selado ainda publica.
- Toda métrica condicional carrega a taxa de erro da mesma população, e o relatório
  afirma no corpo — não em ressalva — que a família condicional é sensível a falha
  seletiva.
- `labelBasis` sai por base, com contagem, unidades amostrais, eixo da unidade,
  intervalo próprio, `powered` e `evidenceRole`. Base sem poder é
  `supplementary-diagnostic`: no tier de aviso ela não gateia, no tier de ação ela
  **reprova** (não eleva teto). O campo é lido com tolerância e **nunca inventado**:
  hoje todo registro cai em `unknown`, porque `labelBasis` só entra no schema em C1.
- Gate de ECE: passou a ler o **limite** (equal-mass, 15 bins) e não o ponto. Sem
  intervalo, reprova.
- Bonferroni: `metrics` publica `simultaneous` em cada estimativa quando o chamador
  declara `preRegisteredStatisticalGates` (`m`), e `gates` decide por esse limite. Os
  intervalos individuais de 95% seguem publicados e marcados `role: "descriptive"`.
  `m` **não** é derivado dos dados; célula sem poder continua em `m` e reprova; `m`
  declarado menor que os gates obrigatórios observados reprova tudo em vez de recalcular
  o alpha. Integridade e gates de ponto aprovados (cobertura, recall de misto, taxa de
  erro) ficam fora de `m` porque não leem intervalo.
- Evidência de reamostragem: `GateInput.resampling` é **obrigatório** (`ResamplingPlan |
  null`, nunca omitido). Sem entrada válida para o estimando — plano ausente, unidade
  fora de `hierarchical`/`multiway`, nenhum eixo declarado, réplicas abaixo do piso
  piloto — o gate **reprova por evidência ausente**. Nunca cai para linhas i.i.d.

**Divergências**

1. **Arquivos além da lista do plano.** `benchmark/intervals.ts` ganhou `oneSidedZ` e
   `wilsonOneSidedAtAlpha` (o caminho de 95% continua lendo o literal congelado, bit a
   bit); `benchmark/bootstrap.ts` ganhou `simultaneousAlpha` opcional, que lê as mesmas
   réplicas em percentis mais largos; `benchmark/commands/evaluate.ts` passou a declarar
   `resampling: null`. Sem isso não existiria limite simultâneo para o ECE nem para as
   proporções, e o gate de Bonferroni seria decorativo.
2. **A execução real passou a reprovar, e isso é o comportamento pedido.** Como não
   existe plano de C4 nem `m` pré-registrado (G5), todo gate de intervalo reprova por
   evidência ausente. Dois testes de integração de `consume-holdout` que esperavam
   `pass` e `indicator-only` foram reescritos: agora provam que a decisão continua
   delegada aos gates, que **nenhum** gate substantivo reprovou e que toda reprovação
   nomeia evidência ausente. É esse teste que volta a `pass`, e para chegar lá ele precisa
   de C4 (o plano), G5 (o `m` congelado) e — desde a rodada de correção, item 7 — C6 (a
   contagem de réplicas efetivamente executada).
3. **Gate novo, id novo.** `warning.ece15` virou `warning.calibration-ece`.
   `GateReport.schemaVersion` foi para `2` (o formato ganhou `multiplicity`, e cada gate
   ganhou `estimand`, `evidence`, `descriptive` e `simultaneous`).
4. **`unknown` como base de rótulo bloqueia o tier de ação.** Consequência direta de a
   base ser inelegível: até C1 nenhuma execução real pode autorizar ação visual. É
   fail-closed e está aqui declarado para que G2/H2 não o descubram como surpresa.

**Lacunas declaradas (não fechadas por A6)**

- `benchmark/bootstrap.ts` ainda executa **2000** réplicas fixas, enquanto a tabela
  congelada exige 10.000 no piloto e 100.000 no release. Elevar a contagem é de C6/G2.
  (Atualizado na rodada de correção, item 7: o gate confere o número **declarado no
  plano** e também o número **executado** contra o piso pré-registrado, então enquanto
  `bootstrap.ts` rodar 2000 o gate de ECE reprova por evidência ausente. O que **falta**
  é conciliar executado contra declarado por estimando.)
- `benchmark/slices.ts` mantém suas próprias cópias dos pisos 300/200
  (`DEFAULT_MINIMUM_FPR_NEGATIVES`/`DEFAULT_MINIMUM_RECALL_POSITIVES`), que agora também
  vivem em `powerFloors`. A6 não tocou `slices.ts` para não colidir com o item aberto de
  A3 sobre o denominador de FPR; apontar essas duas constantes para a política é de
  C4/G2.
- Nenhum piso de **unidades amostrais** foi pré-registrado. A política grava
  `powerFloors.samplingUnits: null` e o número é publicado sem virar critério — inventar
  um piso aqui seria inventar evidência (R4).
- O perfil selado (`profile-artifact.ts`) continua publicando `ece15` equal-width com
  `bins: 15`. Trocar o selo para a estatística equal-mass do gate é de G2.
- `calibration-pipeline.ts` / `cross-validation.ts` seguem com `ECE_MAXIMUM` e o
  desempate do calibrador como constantes locais; a política já traz `calibrator` e
  `calibrationGate.eceMax` para eles lerem.

**Rodada de correção de A6 (2026-07-27), depois da revisão de qualidade.** Dez achados;
os dez foram avaliados tecnicamente e nenhum foi refutado. Nada afrouxou (R3) e nenhum
número de gate se moveu.

5. **Formatação (bloqueante).** `npm run format:check` — primeiro passo de `npm run
   verify` — reprovava em 18 arquivos, 17 deles de A6. Duas causas independentes:
   violações reais de prettier e uma árvore de trabalho metade CRLF enquanto o resto do
   benchmark é LF. Um `prettier --write` resolve as duas (prettier escreve LF).
   `benchmark/rebuild-v3-policy.json` ficou **fora** do formatador, em `.prettierignore`:
   é membro de `EVALUATOR_FILES`, `computeEvaluatorDigest` hasheia seus bytes crus, e
   prettier inlina arrays curtos — duas autoridades de formatação sobre um arquivo
   hasheado moveriam o digest a cada `npm run format`, exatamente a deriva que o digest
   existe para pegar. A autoridade única é `JSON.stringify(canônico, null, 2)`, fixada
   byte a byte pelo teste, e um teste novo garante que a entrada em `.prettierignore`
   continue lá. (`benchmark/lab/build_governance.ts` já reprovava antes de A6 e não é de
   A6 reformatar.)
6. **A "taxa de erro da mesma população" não era da mesma população.** Todo bloco que
   dizia carregá-la recebia a taxa global, cujo denominador é o conjunto elegível
   inteiro. `decisionMetrics` descarta a linha que não é positivo de aviso nem negativo
   humano, e **misto < 50% é elegível e é exatamente isso** — a tabela congelada o mantém
   como fatia diagnóstica, então em corpus real os denominadores diferem, nas duas
   direções. Medido: com 3 negativos humanos, 3 positivos de IA errados e 100 mistos
   elegíveis em 0,3, o campo lia 0,0283 enquanto a taxa de falha da população do aviso era
   3/6. Agora existem três taxas nomeadas — `errorRate` (elegível inteiro; gate de
   integridade e tabelas de resolução), `decisionPopulationErrorRate` (positivos/negativos
   elegíveis; companheira das duas famílias e do bloco de release) e
   `binaryPopulationErrorRate` (toda linha positivo/negativo, elegibilidade à parte; é a
   população de `scoredBinary`, logo de AUROC, PR-AUC e da calibração) — e cada bloco
   publica `errorRatePopulation` ao lado do número (R7). As fatias de calibração passaram
   a decompor a mesma população binária do agregado e publicam os dois denominadores.
7. **Esforço de reamostragem do limite simultâneo.** Um percentil lido em
   `alpha_família/m` fica a `floor(alpha*(n-1))` estatísticas de ordem do extremo: com
   `m = 40` e as 2000 réplicas de hoje, **duas**. O limite agora carrega `replicates` e
   `tailReplicates` de `bootstrap.ts` até `MetricEstimate.simultaneous`, o relatório
   imprime os dois na seção de Multiplicidade, `clusterBootstrap` **não publica** limite
   quando a cauda não tem nem uma réplica (isso é definição, não política: naquele alpha o
   percentil É a réplica mais extrema), e o gate reprova com o código novo
   `insufficient-resampling-effort` quando o número **executado** fica abaixo das réplicas
   pré-registradas. Isto fecha metade da lacuna de réplicas acima: o executado passa a ser
   conferido contra o piso congelado; conciliar executado **contra o declarado** por
   estimando segue em C6/G2. A contagem de réplicas **não** foi elevada aqui.
8. **Testes que não viam a estatística mudar.** Trocar o peso de massa do ECE equal-mass
   por `1/bins` deixava 101 testes verdes (a fixture tinha 4 pontos em 2 bins, onde os
   dois pesos são 0,5); e remover a guarda `basis !== "unknown"` de `powered` deixava 89
   verdes (nenhuma fixture chegava ao piso de 300). Ambas as mutações foram executadas e
   agora matam um teste cada: o peso de massa está fixado em fixture de bins desiguais
   (2 | 3) e a base `unknown` tem fixture de 305 linhas nos dois lados — em `metrics` ela
   sai `powered: false`/`supplementary-diagnostic`, e em `gates` o bloco **real** de
   `labelBasis` reprova `action.fpr.labelBasis.unknown` e limita a decisão a
   `indicator-only`.
9. **Denominador do gate e diagnosticabilidade.** O gate de ECE publicava o n do conjunto
   elegível e os de `labelBasis` a contagem inteira da base, ambos maiores que o
   denominador da estatística; agora publicam o denominador, com `populationSize` ao lado
   quando os dois diferem, e a tabela de gates ganhou a coluna `n (denominador)`.
   `resamplingEntry` devolvia `null` em quatro situações distintas com uma única frase
   ("nenhum plano declara a unidade"), falsa para um plano que nomeia o estimando com 500
   réplicas; agora devolve rejeição discriminada e cada ramo tem sua frase, fixada em
   teste.
10. **A política não podia contradizer o código nem sub-entregar seu próprio contrato.**
    `calibrationGate.eceBound` dizia `bootstrap-upper95` enquanto o gate lê um percentil
    de Bonferroni: virou `bootstrap-simultaneous-upper`, e `gates.ts` deriva a direção do
    gate desse valor por `switch` exaustivo sobre `EceGateBound` — declaração diferente é
    erro de compilação, não divergência silenciosa. E as sete linhas cuja **ordem e
    conteúdo exatos** são a decisão (candidatos e desempate do calibrador, estratos core,
    famílias hard-negative, faixas de perfil, snapshots humanos, estágios de rollout)
    passaram a ser validadas por `frozenList`: antes `tieBreakOrder: ["isotonic"]` e
    `humanCoreStrata: ["foo"]` passavam pelo validador. O comentário do módulo agora diz
    quais linhas são fixadas exatamente e quais só têm forma verificada.

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

**Executado (2026-07-27).** Feito como escrito, com três precisões que o texto acima não
antecipava.

1. **O campo renomeado, e dois campos novos.** `ThresholdEvidence.fprUpper95` passou a
   `selectionFprUpper95Nominal`. Ao lado dele o artefato passou a carregar
   `certifiedFprUpper: null` — ausência registrada como ausência, **nunca** um número
   placeholder (R4 pela mesma lógica: uma cota que não foi medida não se inventa) — e um
   bloco `fprBound` com `estimator: "wilson-one-sided-upper"`,
   `nominalConfidence: 0.95`, `measuredOn: "threshold-selection-data"`,
   `postSelectionCorrection: "none"`, `role: "diagnostic"`, `vintage` e um
   `certification` que diz em prosa, dentro do artefato, que a cota vem de uma medição
   única no teste cego em H1. A procedência ficou no artefato e não em comentário de
   fonte porque `frozen-calibration.json` é citado sozinho.
2. **A matemática ficou intacta, literalmente.** `selectWarningThresholds` e
   `selectVisualThreshold` não têm **uma linha** de diff: as interfaces privadas
   `WarningCandidate`/`VisualCandidate` seguem com o campo `fprUpper95`, que é estado de
   busca e não forma de artefato, e o novo nome aparece só na fronteira do artefato, via
   o construtor único `selectionThresholdEvidence`. Um comentário acima de
   `WarningCandidate` diz isso, para que o nome antigo lá dentro não volte a ser lido
   como promessa. Um teste fixa `selectionFprUpper95Nominal ===
   wilsonOneSided(falsePositives, negatives, "upper").value` nos três blocos de evidência
   das duas fixtures reais, o que prova que o número não mudou.
3. **Legado: aceito ao ler, jamais reemitido.** Existe artefato de 2026-07-25 em disco
   (`benchmark/data/corpus-build/out/fit/frozen-calibration.json` e `fit-report.json`,
   ambos gitignored) com o nome antigo. `readThresholdEvidence` lê os dois vintages e
   marca `fprBound.vintage: "legacy-pre-a7"` no caso antigo; é **puro e não destrutivo**,
   porque `validateFrozenCalibrationArtifact` recomputa `artifactDigest` sobre o objeto
   como lido do disco — normalizar antes de validar reprovaria o selo de todo `fit`
   anterior. O único ponto onde a evidência de limiar de um artefato congelado é
   **emitida** para arquivo público é `fitSummary` em `evidence-sanitizer.ts`, e é ali que
   a normalização entra; `candidate-preflight.ts` também propaga o bloco, mas sempre a
   partir de um artefato recém-construído. Consequência registrada: republicar o `fit` de
   2026-07-25 produz um `fit-summary.json` com o nome novo, logo bytes diferentes dos que
   aquela execução teria produzido — nenhum bundle publicado existe no repo
   (`benchmark/evidence/tmr-ptbr-v1/` só tem `.gitkeep`), então nada foi invalidado.

Fora isso: `report.ts` ganhou, na seção **Métrica de release**, o parágrafo que diz que o
limite certificado é o daquela tabela — medido uma vez no teste cego — e que o
`selectionFprUpper95Nominal` do artefato é nominal e não certifica nada. `report.ts` não
lia o campo antigo (só `calibrationArtifactDigest`), então ali não houve renomeação, e sim
a prosa que faltava no lugar onde o leitor chega segurando o artefato. Cinco fixtures
(`consume-holdout`, `cli`, `candidate-preflight`, `profile-artifact`, `evidence`) passaram
a construir a evidência por `selectionThresholdEvidence`, em vez de repetir os dois
campos constantes. A nota de campo em `docs/detector-rebuild-assessment.md` §4.8 registra
o nome novo para quem chegar pelo diagnóstico.

Um teste de invariante varre **todas as chaves** do artefato em qualquer profundidade e
exige que as únicas que casam `/fprupper/i` sejam `certifiedFprUpper` e
`selectionFprUpper95Nominal` — reintroduzir o nome antigo em qualquer lugar do artefato
reprova, não só no bloco de aviso.

**Rodada de correção de A7 (2026-07-27), depois da revisão de qualidade.** Quatro achados;
os quatro foram verificados no código e nenhum foi refutado. Nenhum número se moveu (R3) e
a matemática seguiu intacta.

4. **O parágrafo novo do relatório apontava para "esta tabela", e a tabela tem duas
   cotas.** `frozenThresholdTable` publica `FPR (UCB95 descritivo)` **e**
   `FPR (limite simultâneo)` por linha, e só a segunda é lida por gate:
   `evaluateReleaseGates` lê `spec.estimate.simultaneous` e reprova com
   `missing-simultaneous-interval` em vez de cair na individual, conforme a decisão
   congelada de multiplicidade (IC individuais de 95% para descrição; unilaterais
   simultâneos por Bonferroni nos gates). Dizer "o limite certificado é o desta tabela"
   deixava o auditor escolher a coluna — e a primeira delas é declaradamente descritiva,
   isto é, o mesmo erro de ler cota nominal como garantia que A7 tirou do artefato,
   reintroduzido uma seção adiante num arquivo publicado (`EVIDENCE_FILE_NAMES`). O
   parágrafo agora **nomeia a célula**: certificado é `FPR (limite simultâneo)`, com
   `alpha_família/m` por Bonferroni, e `FPR (UCB95 descritivo)` é descritiva e não
   certifica nada (R7). Um teste isola **o parágrafo** (não a seção, cujo cabeçalho de
   tabela contém os dois nomes por construção) e exige os dois nomes com os dois papéis.
5. **A última frase do parágrafo prometia uma transição impossível.** "`certifiedFprUpper`
   é nulo justamente até que esta medição exista" descreve um artefato pós-H1 que não pode
   existir: o relatório é gerado **pela** consumação do teste cego, então a medição já está
   na tabela acima da frase, enquanto o artefato acompanhante segue com `certifiedFprUpper:
   null` e `certification.status: "pending"` para sempre — o campo é tipado como o literal
   `null` e o artefato é selado por `artifactDigest`. A frase agora diz onde a cota
   certificada mora de fato: nulo no artefato **por construção** (selado, imutável), e
   certificado aqui e no bundle de evidência.
6. **`readThresholdEvidence` tratava "nenhum dos dois nomes" como "nome novo".** O
   discriminador era `selectionFprUpper95Nominal === undefined && typeof fprUpper95 ===
   "number"`, então um bloco que não satisfizesse nenhum dos dois caía no ramo *current*:
   `selectionFprUpper95Nominal` virava `undefined`, `JSON.stringify` derrubava a chave, e
   saía um `fit-summary.json` **sem cota de FPR nenhuma**, estampado
   `vintage: "current"`, em silêncio (reproduzido com `fprUpper95: "0.03"`). Publicar
   ausência de cota calado é justamente o que a função existe para impedir, então agora ela
   **falha fechada** com o `fail()` que o módulo já tinha, nos dois resíduos: nenhum dos
   nomes, e **os dois** nomes (a forma de transição, em que o valor legado seria descartado
   sem uma palavra e nada garante que os dois concordem — não há vencedor defensável). Os
   dois `as Partial<…>` saíram: `if ("selectionFprUpper95Nominal" in evidence)` estreita a
   união corretamente. Com isso o `?? selectionFprBoundProvenance("current")` morto também
   saiu — a procedência passou a ser **derivada, nunca copiada do disco**, porque é o que
   *este* módulo afirma sobre o número que acabou de ler, e só o ramo tomado aqui sabe o
   `vintage` certo. Assim não existe mais bloco sem procedência nem `vintage` que contradiga
   o nome usado.
7. **A árvore de trabalho estava CRLF, e a culpa não era de A6.** `calibration-pipeline.ts`
   e `evidence-sanitizer.ts` reprovavam `prettier --check` no local (1035 e 432 bytes CR),
   embora os **bytes commitados** estejam LF (`git show` de HEAD e HEAD~1 dá CR=0). Causa:
   `core.autocrlf=true` sem `.gitattributes` — o `git checkout --` usado para reverter as
   mutações reescreveu os arquivos em CRLF. É a mesma causa dos avisos em `gates.ts`,
   `metrics.ts` e `rebuild-v3-policy.ts`, que o relatório de A7 atribuíra erradamente a
   deriva de A6: A6 commitou LF; a árvore local derivou depois. Importa além do cosmético
   porque `computeEvaluatorDigest` hasheia os bytes crus de `readFile`, então árvore com EOL
   misto produz digest de avaliador que nenhum checkout limpo reproduz. Normalizado por EOL
   nos cinco arquivos: `prettier --check .` passou a acusar só
   `benchmark/lab/build_governance.ts` (pré-existente, de 9b41c22), e `git diff --cached`
   mostra que os quatro arquivos que eu não editei entram no commit com **zero** byte —
   nenhum membro de `EVALUATOR_FILES` mudou. Nesta rodada as mutações foram revertidas por
   **cópia de backup**, não por `git checkout --`, para não reintroduzir o CRLF.

**Segunda rodada de correção de A7 (2026-07-27).** Três achados; os três foram
**reproduzidos** antes de qualquer edição e nenhum foi refutado. Nenhum número se moveu (R3)
e as seis funções de busca seguem byte-idênticas a HEAD.

8. **O nome da célula era string mágica duplicada à mão, e nada acoplava as duas pontas.**
   O item 4 acima resolveu o *conteúdo* do parágrafo, mas o rótulo
   `FPR (limite simultâneo)` ficou escrito duas vezes em `report.ts`: no parágrafo e, 365
   linhas adiante, no cabeçalho montado por `frozenThresholdTable`. Nenhum teste fixava o
   cabeçalho (`grep "Papel"` em `report.test.ts` não achava nada), e o único lugar que
   asseverava o literal era a regex **do parágrafo** — satisfeita pela prosa sozinha.
   Medido, não argumentado: renomeando **só** o cabeçalho para `FPR (limite conjunto)` a
   suíte inteira seguiu verde (`report.test.ts` 27/27), estado em que um
   `benchmark-report.md` publicado (membro de `EVIDENCE_FILE_NAMES`) aponta para uma coluna
   que não existe na tabela abaixo dele e deixa `FPR (UCB95 descritivo)` — justamente a que
   o parágrafo diz não certificar nada — como a única cota reconhecível. É a mesma
   desorientação de auditor do item 4, reabrível por um rename sem sinal de teste. Os dois
   rótulos passaram a ser **uma constante de módulo cada** (`SIMULTANEOUS_FPR_COLUMN`,
   `DESCRIPTIVE_FPR_COLUMN`), lidas pelo parágrafo **e** pelo cabeçalho, de modo que
   dessincronizar virou impossível estruturalmente. Além disso um teste novo afirma o
   acoplamento **sem** depender do literal: extrai toda coluna `` `FPR (...)` `` citada pelo
   parágrafo e exige que cada uma apareça no cabeçalho renderizado. Sob o rename do
   cabeçalho esse teste morre; sob rename **da constante** ele continua verde (as duas
   pontas andam juntas) e morre só o teste que fixa o nome atual — que é o comportamento
   certo, porque rename deliberado deve ser visível.
9. **O guard de leitura era assimétrico: só a cota era checada.** Os oito campos restantes
   eram copiados sem verificação de um valor que chega como
   `readJsonFile(...) as FrozenCalibrationArtifact` e cuja única validação
   (`validateFrozenCalibrationArtifact`) recomputa `artifactDigest` e **nada** de tipos.
   Reproduzido: `readThresholdEvidence({ selectionFprUpper95Nominal: 0.03 })` devolvia
   `{"certifiedFprUpper":null,"selectionFprUpper95Nominal":0.03,"fprBound":{…"vintage":"current"…}}`
   — as seis contagens e os dois limiares viravam `undefined`, `JSON.stringify` derrubava as
   chaves, `assertSanitized` não reclamava, e o `fit-summary.json` publicava uma cota de FPR
   **sem denominador**, estampada `vintage: "current"`, em silêncio. Uma cota sem `negatives`
   /`falsePositives` não é re-derivável por auditor, que é o mesmo defeito de não ter cota.
   A leitura agora é fail-closed sobre o **bloco inteiro**: `requireFiniteNumber` por campo,
   com o nome do campo na mensagem, e `localizedThreshold` aceitando `null` (estado real:
   caminho de aviso sem limiar localizado). A alcançabilidade é a mesma classe do item 6
   (artefato malformado mas consistente com o digest; nenhum comando do repo escreve um),
   por isso é resíduo menor — mas a mensagem do guard não cobre mais do que o código faz.
10. **Havia dois construtores da mesma forma, e eles discordavam na ordem das chaves.**
    `selectionThresholdEvidence` dizia ser o "single place that decides" a forma do bloco,
    enquanto `readThresholdEvidence` a remontava campo a campo. Medido sobre um bloco real:
    emissor `[…, selectionFprUpper95Nominal, certifiedFprUpper, fprBound, positives, …]`;
    leitor `[…, certifiedFprUpper, positives, …, selectionFprUpper95Nominal, fprBound]`, com
    `JSON.stringify(emitido) === JSON.stringify(lido)` **falso**. Isso é byte-visível, não
    cosmético: `evidence-sanitizer` escreve o resumo do fit com
    `JSON.stringify(value, null, 2)` e o sha256 desse arquivo entra no inventário de
    evidência e no `publicationDigest`, logo um bloco *current* era republicado com bytes
    diferentes dos que o artefato selado carrega e o bundle publicado se moveu entre e0bce69
    e 401ca25 para entradas idênticas. `toEqual` é cego a ordem e nenhum digest literal está
    fixado, então nenhum teste via. Agora existe **um** construtor privado,
    `thresholdEvidenceBlock(counts, vintage)`, por onde passam os dois vintages, e um teste
    exige sobrevivência **byte a byte** (`Object.keys` iguais e `JSON.stringify(…, null, 2)`
    idêntico), que é o que `toEqual` não sabe expressar.

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

**Como foi executado (2026-07-27):** a política virou superfície de código em
`benchmark/source-manifest.ts` — `CORPUS_USE_POLICY`
(`policyId: "noncommercial-v1"`, `commercialUse` **lido** de
`benchmark/rebuild-v3-policy.json`, `redistribution: "not-published"`),
`FROZEN_ARTIFACT_OBLIGATIONS` (derivado de `attributionRequired`,
`shareAlikeRequired` e `commercialUse` do mesmo arquivo),
`CORPUS_LICENSE_REGISTRY` (identificador
exato + cláusulas `attribution`/`nonCommercial`/`shareAlike`/`noDerivatives`, com
`derivedCorpus`/`blockedBy` **derivados** de `noDerivatives`, nunca digitados),
`corpusLicenseTerms`, `sourceAdmissibility`, `artifactLicenseObligations` e
`assertLicenseInventoryAdmissible`. É essa a superfície que C1 e C5 consomem para
"esta fonte é admissível, sob qual licença, com quais obrigações".

Quatro divergências do texto acima, deliberadas:

1. **`commercialUse` NÃO virou campo do manifesto.** Ele é constante congelada do
   módulo + campo do `license-review.json` + frase do `NOTICE.md`. Acrescentar
   chave à raiz do `ReviewedSourceManifestV1` mudaria o esquema fechado v1, o
   `sourceManifestDigest` e o `private/source-manifest.json` do operador, e o
   esquema é decisão de **C1** (v3), não de B1. Consequência registrada: o parser
   v1 recusa uma licença **registrada** cujos termos contradizem a política
   (fonte `ND` nunca entra num manifesto parseado), mas **tolera** um `licenseId`
   não registrado — os fixtures e o manifesto privado ainda usam ids opacos
   (`lic_ptbr_1`). Exigir registro de todo id é decisão de esquema (C1); um teste
   fixa essa tolerância explicitamente para que ela não passe por descuido.
   `assertLicenseInventoryAdmissible`, que é o guarda que C1/C5 chamam, **falha
   fechado** também no id não registrado (`license-not-registered`).
2. **`NC` e `ND` são recusas com códigos distintos:** `commercial-use`,
   `no-derivatives` e `license-not-registered`. `no-derivatives` é reportado
   ANTES de `commercial-use` de propósito — satisfazer `NC` não destrava `ND`, e
   nomear `NC` ali nomearia um motivo que não se pode remover.
3. **`scripts/package-own-model.mjs` entrou no escopo** (não estava na lista de
   arquivos). Ele reescrevia `NOTICE.md` e `license-review.json` a partir de
   literais próprios; mantido assim, um repackage reverteria B1 em silêncio. Agora
   ele **lê** os dois arquivos rastreados e só recalcula o cabeçalho do NOTICE, o
   `modelId` e o estado de revisão. A derivação é a função pura exportada
   `derivePackagedPolicyFiles` (contents, não caminhos), tipada em
   `scripts/package-own-model.d.mts` (padrão dos outros scripts) e coberta por
   `tests/unit/scripts/packaged-policy-files.test.ts` sem empacotar bundle
   nenhum, e o `main()` ganhou a guarda de entrada padrão do repositório
   (`argv[1] === fileURLToPath(import.meta.url)`) para que importar o módulo não
   empacote nada. **Pré-requisito novo, registrado no cabeçalho do próprio
   script:** empacotar QUALQUER modelo agora exige que
   `models/cleanfeed-ptbr-v1/` exista, porque é lá que a política é publicada.
4. **`docs/corpus-sources.md`: a versão do Carolina foi corrigida** de "Ada 1.1
   preferida" para o que está em disco, **Version 2.0 (Bea)**, e o corte por data
   do header TEI passou de "defesa em profundidade" a **load-bearing** (o pacote
   tem datas TEI de 2024 e 2025). A justificativa velha do rastreio por
   `licenseId` ("preserva a opcionalidade se a postura um dia mudar") foi
   removida: não há ramo comercial a preservar; o rastreio existe porque
   atribuição e share-alike propagam para o artefato e porque é por ele que uma
   fonte `ND` é recusada.

**Acordo entre os três lugares é testado, não prometido:**
`benchmark/tests/source-manifest.test.ts` lê `license-review.json` e `NOTICE.md`
do disco e exige que `sourceLicenses` seja **igual** a `CORPUS_LICENSE_REGISTRY`,
que `commercialUse`/`usePolicyId` sejam os da política, que a linha de cada
licença no NOTICE declare **exatamente** as obrigações que o registro lhe dá (via
`LICENSE_OBLIGATION_LABEL_PT`) e que `docs/corpus-sources.md` cite todo
identificador exato e registre o bloqueio como `ND`. Mutações medidas: trocar
`commercialUse` para `true` no review mata 1 teste; apagar `share-alike` da linha
do Carolina no NOTICE mata 1; remover a chamada do guarda no parser mata 1.
Nenhum recibo de revisão foi inventado — `status` segue `pending`, `reviewer`
`null` e `evidence` `[]` (R4).

**Rodada de correção (2026-07-27) — a autoridade do valor congelado era errada.**
A entrega anterior escreveu `commercialUse: false` como **constante solta** em
`benchmark/source-manifest.ts`, exatamente o que a seção **Contrato de execução
sem decisões pendentes** (no topo deste plano) proíbe — "código não pode
repeti-los como constantes soltas": o valor já estava materializado em
`benchmark/rebuild-v3-policy.json`
(com `attributionRequired` e `shareAlikeRequired`), validado por
`benchmark/rebuild-v3-policy.ts` e dentro de `EVALUATOR_FILES`. Duas grafias do
mesmo valor, cada uma presa por um literal próprio, sem nada afirmando que
concordam. Corrigido:

1. `CORPUS_USE_POLICY.commercialUse` agora é `REBUILD_V3_POLICY.commercialUse`, e
   `FROZEN_ARTIFACT_OBLIGATIONS` deriva as obrigações congeladas dos flags do
   mesmo arquivo. `policyId` e `redistribution` seguem locais — não são linhas da
   tabela congelada.
2. **A cadeia de autoridade está escrita onde antes se afirmava o contrário.** As
   três proses que diziam que `benchmark/source-manifest.ts` é a autoridade única
   da política (`docs/corpus-sources.md`, o cabeçalho do módulo,
   `scripts/package-own-model.mjs`) agora dizem a cadeia real: o JSON congelado
   decide `commercialUse`; `source-manifest.ts` **lê** e decide registro, veredito
   e obrigações; `license-review.json` e `NOTICE.md` publicam. Cada elo cita o
   teste que o prende, em vez de prometer que "os três não podem divergir".
3. **Mutações medidas.** Virar `commercialUse` para `true` no JSON congelado agora
   derruba `source-manifest.test.ts` também (falha de carga
   `REBUILD_V3_POLICY_INVALID: commercialUse is frozen at false`), não só
   `rebuild-v3-policy.test.ts`. Re-inlinear o literal em `source-manifest.ts` mata
   "derives the frozen flag in its source instead of restating it" — teste
   estrutural, porque depois da derivação existe **um** valor e nenhuma asserção
   de runtime distingue derivação de cópia que concorda. Tirar `shareAlike` só do
   Carolina **não** mata "imposes every obligation the frozen contract requires"
   (mata outros 4): a obrigação congelada é do **artefato**, e `cc-by-sa-4.0`
   ainda a impõe; tirar de ambas as licenças mata (6 testes).
4. `license-review.json` ganhou `sourceLicensesScope: "corpus-inventory"` e um
   `sourceLicensesNote`: `sourceLicenses` é o inventário revisado do corpus
   (inclui `cc-by-nc-nd-4.0`, `derivedCorpus: "blocked"`, nunca incorporada) e não
   as licenças do treino deste modelo — sem rótulo, a lista se lê como
   proveniência, ao lado da frase que declara as fontes reais. Lista por modelo é
   trabalho de C1/C5.
5. **Para C1 — RESPONDIDO, ver abaixo:** quando isto foi escrito,
   `benchmark/source-manifest.ts` **não** estava em `EVALUATOR_FILES`, mas
   `benchmark/commands/validate.ts` (que está) importava
   `parseReviewedSourceManifest`, e B1 adicionou ali
   `assertRegisteredLicensesAdmissible`. Ou seja: um byte de arquivo fora da
   identidade do avaliador decidia se `validate` aceita um manifesto. A lacuna é
   anterior a B1 (o parser já barrava `validate` antes), e alargá-la não criou
   arquivo novo.
   **FECHADA por C3 em `b4cf566`, com sim:** `benchmark/source-manifest.ts` está em
   `EVALUATOR_FILES`, porque `commands/split.ts` passou a alimentar a auditoria com as
   declarações reais de `V3_HUMAN_SOURCE_INVENTORY` — uma declaração alterada altera o
   veredito de um gate (item 8 de C3). O cabeçalho do módulo continuou afirmando o
   contrário até 2026-07-29 (item 25 de C3).

**Segunda rodada de correção (2026-07-28) — a prosa da dependência ficou falsa, e
o item 2 acima estava incompleto.** A rodada anterior ADICIONOU ao cabeçalho de
`benchmark/source-manifest.ts` um parágrafo dizendo que ler a política torna o
módulo Node-side, mas **não editou** as linhas 3-4, que continuavam
byte-idênticas a 8e37108: "it depends only on the Phase 1 canonical-json digest
helper shared through contracts/". Com o `import { REBUILD_V3_POLICY } from
"./rebuild-v3-policy.ts"` 50 linhas abaixo, o mesmo cabeçalho se contradizia — a
mesma classe de defeito (prosa declarando dependência/autoridade falsa) que a
rodada existia para consertar, e é esse cabeçalho que C1/C5 leem primeiro para
decidir se podem importar o módulo. Corrigido:

1. As linhas 1-7 declaram a dependência real (helper canonical-json de
   `contracts/` **mais** `benchmark/rebuild-v3-policy.ts`, que lê o arquivo
   congelado no load e torna o módulo Node-side), dizem que o módulo **não** é
   standalone e mantêm a proibição de importar de `src/`.
2. O elo passou a ser preso por teste, e não por revisão de prosa: **"declares in
   its header every module it imports at load"** extrai o bloco de comentário
   inicial e todos os `import` relativos do próprio arquivo, exige que o
   cabeçalho nomeie cada módulo importado e proíbe a frase "depends only on".
   Mutações medidas: (a) a frase antiga de volta → morre (foi o vermelho desta
   rodada); (b) importar um módulo novo (`./digests.ts`) sem citar no cabeçalho →
   morre em `expect(imported).toEqual([...])`; (c) o cabeçalho deixar de nomear
   `rebuild-v3-policy` → morre em `header must name rebuild-v3-policy`. As duas
   primeiras asserções já passavam antes do conserto (o parágrafo novo nomeava o
   módulo); o defeito residual era exatamente a frase "depends only on".

   > **ERRATA (terceira rodada).** Este item 2 alegava mais do que o teste
   > prendia, e a alegação central — "pins the header against the imports
   > instead of against a literal sentence" — era **falsa**. Medido: o teste
   > buscava o **basename** de cada import em 50 linhas de prosa, e
   > `rebuild-v3-policy` já aparecia no bullet de WHO OWNS WHICH VALUE como
   > *dono de valor congelado*, não como dependência — logo a asserção de nome
   > passava com ou sem a correção, e a mutação (c) só morreu porque renomeou
   > **todas** as ocorrências, WHO OWNS incluído. E a mutação (b) provava apenas
   > que `toEqual` é quebra-molas: atualizando também o array esperado (o que um
   > agente futuro faz quando a lista fica vermelha) a suíte voltava a 33/33 com
   > o cabeçalho sem citar dependência nenhuma, porque a palavra `digests` já
   > está na prosa da linha 11. Restava com dentes só a proibição de uma frase de
   > três palavras — que a reformulação "its sole dependency is" contorna. Veja o
   > item 4 abaixo para o que substituiu isto.
3. `docs/corpus-sources.md` dizia "os quatro testes de acordo" — contagem escrita
   pela própria rodada anterior e errada nas duas versões (eram cinco antes, são
   seis depois). Trocado por referência ao describe `licence policy agreement
   across manifest, review and NOTICE`, **sem contagem**: o documento é o mapa de
   quais elos estão enforçados, e um número em prosa envelhece a cada teste novo.

**Terceira rodada de correção (2026-07-28).** Dois achados `important` e dois
`minor`; **nenhum foi refutado**, e os dois `important` foram reproduzidos antes
de qualquer edição. Segue sem mudança de comportamento: o diff de
`benchmark/source-manifest.ts` é inteiramente dentro do comentário inicial.

4. **O teste de cabeçalho da rodada 2 não prendia a propriedade que dizia
   prender** (`benchmark/tests/source-manifest.test.ts`). Reproduzido: reescrevi
   as linhas 2-7 no defeito exato que a rodada existia para consertar, apenas
   reformulado — *"this module is standalone and MUST NOT import from the
   extension bundle (src/); its sole dependency is the Phase 1 canonical-json
   digest helper shared through contracts/"* — apagando o parágrafo de
   dependência. Resultado: **33/33 verde**. Duas causas, ambas do desenho do
   teste e não da prosa: a proibição de `/depends only on/` deixa de casar quando
   a mesma alegação falsa vira "its sole dependency is"; e a busca de basename
   era satisfeita por prosa não relacionada (WHO OWNS, `digests` na linha 11).
   **Corrigido pelo lado da estrutura:** o cabeçalho passou a carregar um bloco
   **delimitado** `DEPENDENCIES (BEGIN)`/`DEPENDENCIES (END)` que enumera os
   **especificadores completos** dos imports (`../contracts/canonical-json.ts`,
   `./rebuild-v3-policy.ts`) — strings que nenhuma outra prosa do arquivo contém
   — e o teste renomeado **"declares in its header exactly the specifiers it
   imports at load"** exige igualdade de conjunto entre o bloco e os `import`
   reais do módulo, mais a recusa de `/standalone/`, `/depends?\s+(only|solely)/`
   e `/\b(sole|only)\s+dependenc/`. A palavra `standalone` é banida inteira, não
   só a versão falsa: o bloco é a autoridade sobre o que carrega, então prosa
   restatando estado de dependência é errada ou redundante — e foi exatamente
   essa restatação que envelheceu duas vezes. Mutações re-medidas, as duas que a
   revisão usou para derrubar a rodada 2: (D) bloco apagado + frase reformulada →
   **morre** em `header must open "DEPENDENCIES (BEGIN)"`; (E) `./digests.ts`
   importado **e** o array esperado honestamente atualizado, sem tocar o
   cabeçalho → **morre** na linha 386, `expect([...declared].sort()).toEqual([...
   imported].sort())`, imprimindo `- "./digests.ts"`. O comentário do teste
   registra as duas versões fracas anteriores, para que a terceira não seja
   reinventada.
5. **`prettier --check .` estava reprovando com 4 arquivos, contra a baseline de
   1** (medida por A6: só `benchmark/lab/build_governance.ts`, de 9b41c22). Causa
   medida no byte: `benchmark/source-manifest.ts`, `NOTICE.md` e
   `license-review.json` estavam **inteiramente CRLF** em disco (CR=866/50/93
   contra LF idêntico), enquanto os outros 417 `.ts`/`.md`/`.json` versionados são
   LF puro. São exatamente os três arquivos que os commits de B1 tocaram por
   último. Normalizados com `prettier --write`; `--check .` volta a reportar só
   `build_governance.ts`. **Nenhum byte versionado se moveu:** `git hash-object`
   dos três é idêntico ao blob de HEAD (`ea805ba…`, `0f44ed5…`, `e521c1d…`) porque
   `core.autocrlf=true` normaliza no `add` — foi por isso que passou batido, já
   que `git status` mostrava árvore limpa. **Causa raiz fora do escopo de B1:**
   não existe `.gitattributes` fixando `text=auto eol=lf` contra um
   `core.autocrlf=true` global de máquina, então qualquer `git checkout` recria
   CRLF. **ERRATA (quarta rodada):** a consequência que este item atribuía ao
   CRLF era **falsa**. `NOTICE.md` é de facto lido **do disco** por
   `scripts/package-own-model.mjs`, mas é só **membro de conjunto** de
   `MATERIALIZED_INVENTORY` / `MATERIALIZED_METADATA`: `computeBundleDigest`
   (`scripts/verify-model-bundle.mjs:327`) digesta `manifest.artifacts`, e
   `artifacts` é `ASSET_PATHS` — os **seis** ativos fixados (`config.json`,
   `onnx/model_int8.onnx` e os quatro do tokenizer), medido em
   `models/cleanfeed-ptbr-v1/cleanfeed-model.json`. Nenhum byte de `NOTICE.md`
   pode mover `bundleDigest`. A metade genuína da preocupação continua de pé:
   sem `.gitattributes` fixando `text=auto eol=lf` contra o `core.autocrlf=true`
   global de máquina, `prettier --check .` reprova de novo depois de qualquer
   `git checkout`.
6. (minor) `docs/corpus-sources.md`: o parêntese inserido na rodada 2 deixou a
   linha 33 com 110 colunas num bloco de 66-84. As linhas 30-36 foram
   re-quebradas em 80; a maior do bloco agora tem 82.

**Quarta rodada de correção (2026-07-28).** Um achado `important` e três `minor`;
**nenhum foi refutado** — os quatro foram reproduzidos antes de qualquer edição,
inclusive os dois que dizem que o *relatório da rodada 3* estava errado. Sem
mudança de comportamento: `benchmark/source-manifest.ts` fica **byte-idêntico** a
HEAD (`git hash-object` = `ac06cee…`, igual a `git rev-parse HEAD:<arquivo>`), e a
entrega é teste + plano.

7. **A precedência documentada entre `ND` e `NC` não era prendida por teste
   nenhum.** O docstring de `sourceAdmissibility` afirma que `no-derivatives` é
   reportado ANTES de `commercial-use` de propósito, "porque nomear `NC` ali
   nomearia uma razão que satisfazê-la não removeria" — e nada verificava isso.
   Reproduzido: trocando a ordem dos dois guardas na função —
   `terms.nonCommercial && use.commercialUse` antes de `terms.noDerivatives` — o
   arquivo fica **33/33 verde**, e a suíte inteira também, porque `grep` confirma
   que só `benchmark/source-manifest.ts` e o seu próprio teste chamam a função.
   Sob o mutante, `sourceAdmissibility("cc-by-nc-nd-4.0", { commercialUse: true })`
   devolve `blockedBy: "commercial-use"` — exatamente o que o brief exclui ("o
   motivo registrado é `ND`, não 'NC', não 'licença restritiva'"): um chamador
   comercial que então satisfizesse `NC` acreditaria que o bloqueio de
   IberAuTexTification saiu, e ele não sai. A causa é que **toda** chamada do
   arquivo usava `{ commercialUse: false }` ou o default congelado, então
   `terms.nonCommercial && use.commercialUse` era falso em todas elas e as duas
   razões nunca competiam. Corrigido dentro do teste existente `blocks a
   no-derivatives licence by ND and never by NC`, **sem tocar produção**: o caso
   `{ commercialUse: true }` — o único em que as duas cláusulas poderiam disparar
   — agora é asserido ao lado do `{ commercialUse: false }`. Vermelho medido sob a
   mutação (`- "blockedBy": "no-derivatives"` / `+ "blockedBy": "commercial-use"`),
   verde depois de reverter.
8. (minor) **`declared` era lista bruta de matches comparada contra um `imported`
   naturalmente sem duplicata**, então uma segunda menção editorial a um
   especificador **já declarado**, dentro do bloco, quebrava a igualdade de
   conjunto. Reproduzido acrescentando "The exact shape it validates is documented
   inside `./rebuild-v3-policy.ts`." ao último bullet: `1 failed | 32 passed`, com
   o diff `+ "./rebuild-v3-policy.ts"` — mensagem que **lê como import não
   declarado** quando nada dos imports mudou, num bloco escrito de propósito como
   prosa com uma frase explicativa por bullet, onde essa é a próxima edição
   realista. Corrigido comparando conjuntos deduplicados nos **dois** lados
   (`[...new Set(declared)]` contra `[...new Set(imported)]`), com mensagem própria
   na asserção; o outro lado é deduplicado pela mesma razão, porque dois `import`
   podem legalmente nomear um especificador. Os dentes sobrevivem, re-medidos:
   (E) import de `./digests.ts` **e** array esperado honestamente atualizado →
   **morre** imprimindo `- "./digests.ts"`; (H) entrada do bloco que ninguém
   importa → **morre** imprimindo `+ "./digests.ts"`; (D) bloco apagado e frase
   falsa reformulada de volta → **morre** em `header must open "DEPENDENCIES
   (BEGIN)"`. Nenhum dos dois lados pode ser afrouxado para contenção.
9. (minor) **Duas alegações mensuráveis do relatório da rodada 3 eram falsas** e
   mandariam o próximo agente atrás de não-problema. (a) Eu escrevi que o teste de
   cabeçalho "só casa import de uma linha terminado em ponto e vírgula, então um
   `import` multilinha não seria visto, e a igualdade de conjunto compararia o
   bloco contra uma lista de imports incompleta". Medido com sonda em Node:
   `[^"']*` **casa newline**, então um `import { A, B, C } from "./digests.ts";`
   formatado pelo prettier em quatro linhas **é** capturado — a sonda devolveu
   `["../contracts/canonical-json.ts","./digests.ts","./rebuild-v3-policy.ts"]`. O
   residual descrito não existe, e "consertá-lo" arriscaria afrouxar um regex que
   já funciona. (b) A consequência de digest que atribuí ao CRLF era falsa;
   corrigida em errata dentro do item 5 acima.
10. (minor) **O `NOTICE.md` materializado divergiu do versionado, e nada no
    repositório detecta a divergência.** Medido: `diff
    models/cleanfeed-ptbr-v1/NOTICE.md public/models/cleanfeed-ptbr-v1/NOTICE.md`
    → 41 linhas substituídas por 5. A cópia em `public/` (não versionada, disco do
    operador) ainda tem a redação antiga de cinco linhas: **sem** o regime não
    comercial, **sem** as linhas de obrigação por licença e **sem** o parágrafo
    `ND`. O requisito 5 do brief proíbe reempacotar, então isto **não** foi
    consertado aqui — mas registre que nenhum gate vê a divergência:
    `verifyMaterializedBundle` checa só o **conjunto** de nove nomes de arquivo, e
    `verifyReleaseModelDirectory` compara byte a byte apenas `release.json` e
    `calibration-profiles.json` (`RELEASE_CANONICAL_METADATA`). Fica registrado
    como **obrigação pendente de reempacotamento** do modelo `cleanfeed-ptbr-v1`,
    para a tarefa de release ou para C1/C5: até ela, o artefato que efetivamente
    embarca não carrega o texto de atribuição e share-alike de CC BY-NC-SA que B1
    exigiu que ele carregasse, e o `prettier --ignore` de `public/models/` (bytes
    de terceiros, sha256 contra o upstream) não muda nada disso.

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

#### B2 — o que foi realmente executado

Cinco mecanismos, cada um substituindo uma frase de prosa por algo que falha:

1. **`mixture.generationMode` obrigatório e fechado.** `benchmark/schema.ts` valida
   `mechanistic | ecological` contra o vocabulário congelado
   (`materialAssistance.generationModes`) e recusa um mixture sem o campo, em vez de
   assumir uma coorte. `assemble_corpus.py` escreve `mechanistic` — que é fato, não
   default: `make_mixed.py` escolheu e executou as edições (R4 proíbe escrever
   `ecological` sem processo observado). A validação é a ÚLTIMA dentro de
   `validateMixture`, para os diagnósticos mais específicos (fração fora de faixa, span
   além do texto) continuarem disparando primeiro.
2. **Duas populações de positivo, nomeadas no artefato.**
   `DecisionMetrics.positivePopulation` diz de qual alvo vieram os positivos daquela
   matriz. `isWarningPositive` = integral **ou** assistência material *mecanística* com
   `aiFraction >= 0.50`; `isVisualActionPositive` = integral apenas. `ecological`
   acima do piso não é positivo de nenhuma das duas — é coorte separada.
3. **`EvaluationMetrics.actionAuthorization`.** O gate `action.recall.overall` passou a
   ler ESTE bloco (recall sobre positivos integrais) e não
   `visualAction.endToEnd.recall`. `visualAction` continua publicado e intocado — o FPR
   dele é o estatístico do orçamento de ação e não depende da definição de positivo
   (negativos são humanos) —, então `profile-artifact.ts`, `slices.ts` e `report.ts`
   não mudaram e nenhum número já publicado se moveu por causa disto. **Isto é mudança
   de estimando, não afrouxamento de limite (R3):** o piso 0,35 não foi tocado; o que
   mudou é QUAL população pode autorizar ação. A direção empírica do número num corpus
   real é **não medida** (não há holdout válido — R8), e o motivo da mudança não é o
   número: é que assistência material autoriza `indicator` e nada mais, então ela não
   pode entrar na estatística que levanta `actionCeiling`.
4. **Não agregação, por construção.** `mixed.atLeastHalfAi` é de UMA coorte e carrega
   `generationMode`; `mixed.byGenerationMode` publica cada coorte separada;
   `mixed.byFraction` passou a ser chaveado por `"<modo>/<faixa>"`. Não existe total
   entre coortes em lugar nenhum, e `localization` só tem `byGenerationMode` — um campo
   que não existe não pode ser citado.
5. **Métricas de span, diagnósticas.** `spanOverlap` + `LocalizationDiagnostics` com
   `role: "diagnostic"`, `gates: false`, `authorizesVisualAction: false` e
   `unit: "character-offset"`. **R7:** a tabela pede "precisão/recall de token", mas
   `mixture.spans` são offsets de caractere, então a unidade é declarada em todo bloco
   em vez de a palavra "token" alegar uma tokenização que não existe. O denominador do
   recall do caminho localizado inclui a linha que não emitiu span — silêncio é erro,
   não ausência de evidência.

**Política (o que foi para `rebuild-v3-policy.json`, e não para constante solta):**
`materialAssistance.minimumWarningRecall: 0.5`, `materialAssistance.cohortsAggregated:
false`, `materialAssistance.generationModes: ["mechanistic", "ecological"]`,
`integralPositive.visualActionRequiresDocumentGates: true`,
`localization.metricsRole: "diagnostic"`. O teto de ação de cada alvo fica no bloco do
seu próprio alvo (`materialAssistance.authorizes`,
`localization.authorizesVisualAction`, o novo campo em `integralPositive`), então nenhum
teto está escrito duas vezes.

**Sobre `warning.mixed-recall` e §4.5.** A FORMULAÇÃO mudou — o denominador agora é a
coorte `mechanistic` com `aiFraction >= 0.50`, o que §4.5 é o que autoriza — e por isso
o número saiu de `gates.ts` e virou linha da tabela congelada. O VALOR não mudou: 0,50
antes, 0,50 depois. Nenhum outro limite foi tocado.

**Copy.** A varredura não encontrou nenhuma afirmação de autoria na copy existente
(fases anteriores já a sanearam), então o entregável de copy é o mecanismo, não uma
correção: `userFacingCopy()` percorre a única árvore de que todos os exports de
`src/shared/classification-copy.ts` derivam, e `overclaimIn()` a filtra contra
`AUTHORSHIP_CLAIM_PATTERNS`. Uma string nova é varrida no momento em que é adicionada.
Os padrões olham CONSTRUÇÕES, não palavras: "autoria" e "gerado" precisam continuar
aparecendo na copy obrigatória, então cada padrão casa uma predicação sobre o texto
(particípio adjacente ao agente, "este texto é de IA", "a autoria deste texto é",
intenção atribuída a uma pessoa) e a forma hedged sobrevive. Limite conhecido: uma
string que chegue à UI **sem** passar por este módulo escapa da varredura — o que é
exatamente por que toda superfície importa a copy daqui e não guarda a sua.
`classification-copy.json` ganhou `productTarget`, espelhando o identificador congelado
(o benchmark é standalone e não pode ser importado do bundle, então os dois lados são
fixados por teste, não por import).

**Fora do escopo do brief, mas necessário como consequência:**
`benchmark/commands/fit.ts` tinha uma segunda cópia do predicado de positivo, com 0,5
hardcoded e sem coorte; passou a delegar a `isWarningPositive`. Sem isso, uma linha
`ecological` seria positivo em tempo de `fit` e não-positivo em tempo de avaliação —
a agregação entre coortes que esta tarefa proíbe, entrando pela porta de trás.

#### B2 — rodada de correção de conformidade

6. **ERRATA: "misto sub-piso não entra em denominador de gate" estava afirmado forte
   demais, e o teste que provava isso passava vazio.** O cabeçalho de `gates.ts` dizia
   que o ÚNICO gate cujo denominador contém tal linha é `integrity.error-rate`. É falso,
   e foi **medido**: `warning.coverage` lê `metrics.coverage`, que é
   `proportionEstimate(elegíveis scored, eligibleCount)` — o conjunto elegível inteiro.
   Sonda contra o pipeline real: 20 humanos + 10 IA dão coverage 1; somando uma linha
   `label: "mixed"`, `aiFraction: 0.25`, `status: "abstained"` (120 palavras, portanto
   elegível) dá `0.967741935483871`, com `abstentionRate` de 0 para `0.032258…`. Perto do
   piso 0,8, uma coorte sub-piso grande o bastante **vira** esse gate.
   O teste apresentado como prova filtrava só `tier !== "integrity"` — isto é, mantinha
   `warning.coverage` dentro do `toEqual` — mas a linha que ele somava era `scored`, então
   numerador e denominador subiam juntos e o valor era 1 nos dois lados: passava
   vazio exatamente para o gate que a prosa dizia não ser exceção.
   **Corrigido:** o cabeçalho nomeia os DOIS gates de denominador-conjunto-elegível
   (`integrity.error-rate` e `warning.coverage`), com a medição colada, e enuncia a
   afirmação na forma congelada — sub-piso **não é positivo nem negativo** de gate
   nenhum, o que não é a mesma coisa que "nenhum gate o observa". O bloco de teste virou
   três testes: (a) todo gate de aviso e de ação **exceto** `warning.coverage` é
   `toEqual` antes e depois; (b) `warning.coverage.observed` **move** de 1 para 600/602 e
   ainda passa, com o motivo escrito ao lado; (c) nenhuma população de classe se move
   (positivos, negativos, `actionAuthorization.positives`, `mixed.atLeastHalfAi`) nas
   duas famílias. As linhas somadas são `abstained` e `error` — as duas que separam um
   denominador de classe do denominador do conjunto elegível.
7. **Não agregação de coortes chegou ao `slices.ts`.** O eixo `mixedFraction` ainda
   chaveava por faixa nua, então uma linha `mechanistic` e uma `ecological` da mesma
   faixa caíam numa ÚNICA fatia publicada — e `mixedFraction` é eixo de RECALL, logo essa
   fatia alimenta o piso que declara uma fatia elegível a gate e, via
   `profile-artifact.ts`, o `criticalRecallSlices` publicado. Não é defeito pré-existente:
   `generationMode` não existia antes desta tarefa. Agora a chave é `"<modo>/<faixa>"`,
   **a mesma** de `MixedFractionSegment.key` e construída pela mesma função exportada
   (`mixedSegmentOf`), então as duas não podem divergir. Teste novo: as duas coortes na
   mesma faixa produzem `["ecological/75_100", "mechanistic/75_100"]`, e só a mecanística
   declara positivo.
8. **`split-audit.ts` perdeu o literal 0,5**, que agora vem de
   `materialAssistance.minimumAiFraction`. Aquele eixo continua **sem** coorte de
   propósito, e a razão está escrita no arquivo: ele audita a COBERTURA das duas faixas na
   partição cega e não é denominador de métrica nenhuma; dividi-lo por coorte hoje
   dividiria contagens de cobertura para descrever uma coorte que não existe (só
   `mechanistic` é produzível na v3). Os dois nomes de chave soletram o piso congelado, e
   mover o piso exige renomeá-los na mesma mudança.
9. **`?? 0` novos removidos.** `excludedEcologicalCohort` lia a fração num segundo acesso
   a `mixture`, com fallback 0 — que classificaria um mixture malformado como sub-piso, a
   direção favorável. Agora existe um único estreitamento (`mixedCohortOf`) que devolve
   coorte e fração juntas — e o mesmo acesso duplo estava numa TERCEIRA função,
   `mixedAtLeastHalfAi`, que é o denominador do gate `warning.mixed-recall`; as três
   passam pelo mesmo estreitamento. Em `gates.ts`, `action.recall.overall` deixou de usar
   `authorization?.positives ?? 0`: `action.available` passou a exigir os DOIS blocos
   (`visualAction` e `actionAuthorization`, que `computeEvaluationMetrics` publica
   juntos), então `actionIntervalSpecs` estreita o par e lê um denominador não-nulo, e um
   build de métricas que publicasse um sem o outro falha o tier de ação em vez de passar
   com o gate de recall silenciosamente ausente. Nada disso era violação de R5 (R5 é
   sobre escore ausente de inferência com erro), mas eram defaults silenciosos num módulo
   cujo estilo é falhar alto.
10. **`actionRecall` do perfil publicado: caveat registrado, renomeação diferida.**
    `profile-artifact.ts` continua construindo `overall.actionRecall` e o `actionRecall`
    por fatia a partir de `visualAction.endToEnd.recall` — população de positivos de
    AVISO — enquanto o gate homônimo lê `actionAuthorization` sobre positivos integrais.
    **Não foi repontado, e o motivo é medido, não estilístico:** a lista de eixos de
    recall inclui `mixedFraction`, cujas fatias não têm positivo integral nenhum, e
    `requireSampleSize` reprova zero (`GATE_EVIDENCE_INCOMPLETE`) — ler a população
    autorizadora por fatia recusaria publicar um corpus legítimo, e mandar esse zero para
    `null` soletraria "ação não autorizada", que é outra coisa. O caminho de autorização
    permanece seguro e isso foi verificado: `ceilingFor` exige `decision === "pass"` e
    `bucketAuthorizesAction` só olha gates de FPR de fatia do tier de ação. O que foi
    feito é declarar a população no CONTRATO (`contracts/calibration-profile.ts`), nos
    dois campos, dizendo que é evidência diagnóstica, que pode ser MAIOR que o número que
    o gate observou e que nunca autoriza ação. **Pendência nomeada:** renomear o campo
    (p.ex. `actionRecallWarningPositives`) é mudança de contrato publicado — atinge o
    parser do runtime, dois fixtures de release já commitados
    (`tests/fixtures/model-release/*/calibration-profiles.json`) e perfis com validade de
    180 dias — e pertence a quem for mexer no artefato de perfil, não a B2.

#### B2 — segunda rodada de correção de conformidade

11. **As métricas de localização violavam a regra do par (R5) e usavam a convenção
    favorável.** `localizationCohort` tinha UMA população — `isScoredItem(item) && coorte
    && spans observados > 0` — e nenhuma contraparte fim-a-fim em lugar nenhum. Logo uma
    linha `abstained`/`error` da coorte **saía** do denominador de `localizedPathRecall` e
    de todos os seis IoU/precisão/recall micro e macro, e uma falha de inferência só podia
    **subir** esses números: a mesma classe de defeito que A3 removeu das matrizes de
    decisão. **Medido** com sonda contra a árvore commitada em 5812cdf, antes de qualquer
    edição: somando uma linha `status: "error"` mecanística (`aiFraction 0.6`, um span de
    IA observado) a um fixture de uma linha, o bloco de localização ficou byte-idêntico
    (`population: 1, localizedEmitted: 1, localizedPathRecall: 1, microIou: 1`) enquanto
    `mixed.atLeastHalfAi` no MESMO artefato foi de `sampleSize 1` para `2` e de
    `warningRecall 1` para `0,5` — dois blocos de recall da mesma coorte com convenções de
    status opostas. A docstring afirmava só a propriedade fraca ("uma linha cujo caminho
    localizado não emitiu nada FICA aqui e conta como erro"), verdadeira para linha
    `scored` e silenciosamente falsa para linha com erro.
    **Corrigido:** `LocalizationCohort` agora publica `endToEnd` e `conditionalOnScored`,
    cada um um `LocalizationFamily` com `family`, `populationRule` (a regra do
    denominador em palavras), `population`, `undecidedRows` e `localizedEmitted`, então as
    duas famílias são reconciliáveis a partir do artefato. A seleção da coorte é uma só e
    o que difere é **apenas** a regra de status; uma linha indecisa emite `[]`, portanto
    entra com o comprimento observado inteiro na união e zero na interseção — erro
    integral, nunca remoção nem substituição. Teste novo prova a direção: somando a linha
    com erro, `endToEnd.localizedPathRecall` cai de 1 para 0,5, `undecidedRows` vai a 1 e
    `microIou` a 0,5, enquanto `conditionalOnScored` é `toEqual` antes e depois. Mutação
    (voltar `cohortRows` a `isScoredItem`) mata o teste com `expected 1 to be 2`.
12. **Ausência de produtor de span deixou de ser indistinguível de erro total.** Nenhum
    estágio da esteira selada escreve `localizedSpans`: `benchmark/prediction-schema.ts`
    não tem coluna de span (grep por `span` não devolve nada) e
    `benchmark/commands/evaluate.ts` só repassa `localizedRawScore` — o campo é populado
    apenas pelo fixture de teste, e o único chamador futuro é a cabeça de span de **D4**.
    Consequência antes da correção: em qualquer execução real toda coorte com span
    observado publicava `localizedEmitted: 0`, `localizedPathRecall.value: 0`,
    `microIou: 0`, `macroIou: 0` sobre `population` **não** zero — números que se leem
    como falha de localização medida do detector quando nada emitiu nada.
    **Corrigido:** cada coorte declara `spanProducer` (presente e
    vazio conta como presente: é produtor que não achou nada), e com produtor ausente —
    ou população zero, onde `proportionEstimate(0, 0)` devolvia `NaN` — `localizedPathRecall`
    e o bloco `overlap` inteiro saem `null`, nunca `0`. As **contagens** continuam
    publicadas, porque elas dizem quanta evidência de span está esperando produtor. Teste
    novo fixa o estado de produtor ausente; a mutação que remove a guarda morre com
    `expected { value: +0, … } to be null`.
    **ERRATA (itens 15 e 16):** este item foi entregue com dois defeitos. O par
    presente-e-vazio *versus* sem-produtor estava escrito mas **não** era alcançável por
    nenhuma asserção, e `spanProducer` era derivado **por coorte** — o que reintroduziu,
    dentro deste mesmo commit, a falha que o item 11 tinha acabado de remover. O estado
    passou a ter três valores e a ser derivado por **execução**; leia 15 e 16 antes de
    citar o parágrafo acima.
13. **ERRATA: a "curva v0–v8 completa" NÃO foi entregue como diagnóstico.** Nada na seção
    de execução registrava a lacuna: ela abre com "cinco mecanismos [que] implementam
    exatamente a tabela" e o item 4 fala de `mixed.byFraction` chaveado por
    `"<modo>/<faixa>"` sem dizer que a faixa não é nível; a §2.1 da spec repetia a linha
    da tabela congelada ("curva completa v0–v8 diagnóstica") sem ressalva. A metade do
    gate está entregue exatamente (`warning.mixed-recall >= 0,50`, piso lido de
    `materialAssistance.minimumWarningRecall`, denominador = coorte mecanística com
    `aiFraction >= 0,50`, §4.5 citada). A metade do diagnóstico **não é a curva**: o único
    diagnóstico por fração é o bucketing pré-existente de quatro faixas, e as nove
    coberturas congeladas em D4 (0%, 15%, 25%, 40%, 50%, 60%, 75%, 90%, 100%) colapsam
    duas a duas dentro delas — v0 com v1 em `0_24`, v2 com v3 em `25_49`, v4 com v5 em
    `50_74`, e v6/v7/v8 em `75_100`. Logo nenhum consumidor de `mixed.byFraction`, do eixo
    `mixedFraction` ou de `criticalRecallSlices` consegue ler curva por nível.
    **Por que B2 para aqui e não divide as faixas:** o nível é propriedade da OPERAÇÃO de
    mistura, não da `aiFraction` observada do registro-linha (D4 mira um nível e chega
    perto dele, então chavear pela fração obtida daria uma chave por registro-linha).
    Publicar a curva por nível exige campo de nível escrito pela pista de mistura, e essa
    pista é de **D4** (`benchmark/lab/make_mixed_v3.py`, que ainda não existe). O
    pooling está declarado na docstring de `MIXED_FRACTION_BUCKETS`, no campo
    `mixed.byFraction`, na §2.1 da spec e **fixado por teste** sobre os nove níveis
    congelados, para que a lacuna seja executável e não uma frase que alguém apaga.
    Quem fizer D4 tem de emitir a curva por nível **antes** de qualquer leitura de
    `byFraction` como curva.
14. **A errata do item 6 chegou à spec.** A §2.1 ainda dizia que misto sub-piso "não entra
    em denominador de gate nenhum" — exatamente a afirmação que o item 6 mediu falsa e
    retirou de `gates.ts` e deste plano na rodada anterior, deixada de pé no documento
    publicado. Agora a §2.1 traz a forma congelada (não é positivo nem negativo de gate
    nenhum), nomeia os dois gates de denominador-conjunto-elegível e cola a medição.
    Não foi pedido pela revisão desta rodada; é a mesma frase, e deixá-la seria publicar
    uma alegação sabidamente falsa num arquivo que o brief de B2 lista.

#### B2 — terceira rodada de correção de qualidade

15. **A distinção que justifica o `null` do item 12 não era alcançável por teste nenhum.**
    A base inteira daquela correção é a diferença entre "o produtor rodou e emitiu lista
    vazia" (erro total real, publica `0`) e "não existe produtor" (publica `null`). O
    código dizia isso deliberadamente (`!== undefined` e não `length > 0`), o item 12 e a
    §2.1 da spec repetiam — e **nenhuma asserção chegava lá**: a mesma classe de defeito
    marcada como IMPORTANT nas rodadas de A7 e B1. **Medido:** trocar
    `item.localizedSpans !== undefined` por `(item.localizedSpans ?? []).length > 0`
    deixava `npx vitest run benchmark/tests/metrics.test.ts` em **58/58 verde**, e nada
    fora de `metrics.ts` lê coorte de localização. E o efeito não é cosmético — sonda de
    duas linhas mecanísticas `scored` com `localizedSpans: []` sobre span observado
    `[0,10)`: na árvore commitada
    `{"spanProducer":"present","population":2,"recall":0,"overlapIsNull":false,"microIou":0}`;
    com a mutação
    `{"spanProducer":"absent","population":2,"recall":null,"overlapIsNull":true,"microIou":null}`.
    Ou seja, uma regressão ali converte falha de localização **medida e total** em "sem
    medição", em silêncio, num arquivo de `EVALUATOR_FILES`, na direção que esconde a
    falha. **Corrigido:** teste novo no bloco de localização de B2 fixa o caso
    presente-e-vazio (`spanProducer: "present"`, `localizedPathRecall.value: 0`,
    `overlap.microIou: 0`, e `not.toBeNull()` nos dois). Mutação D (`length > 0`) mata só
    esse teste, com `expected 'absent' to be 'present'`.
16. **`spanProducer` era derivado da coorte e anulava também a família fim-a-fim — o
    defeito do item 11 de volta, no mesmo commit.** O estado vinha de
    `cohortRows.some(item => isScoredItem(item) && …)`, isto é, **só** das linhas que
    produziram decisão, e então zerava as duas famílias. Logo uma coorte em que **toda**
    linha falhou inferência publicava `spanProducer: "absent"` e `localizedPathRecall:
    null` mesmo com produtor demonstravelmente existente na mesma execução: 100% de falha
    de inferência **apagava** o número em vez de lê-lo como `0`. **Medido** contra a árvore
    commitada em f513ac8, três linhas — uma mecanística `scored` com
    `localizedSpans: [{0,10}]` e duas ecológicas `status: "error"` com spans observados:
    `{"mode":"ecological","spanProducer":"absent","e2ePopulation":2,"e2eUndecided":2,`
    `"e2eRecall":null,"e2eOverlapNull":true}` ao lado de
    `{"mode":"mechanistic","spanProducer":"present","e2eRecall":1}`. Além de violar R5,
    o motivo publicado era **falso** (R7): o produtor não estava ausente naquela execução,
    emitiu span uma coorte ao lado — e contradizia a linha que este mesmo commit escreveu
    na spec ("falha de inferência nunca sobe IoU nem recall do caminho localizado"): não
    subia, **apagava**. **Corrigido:** `SpanProducerState` passa a ser derivado **uma vez
    por execução** (`spanProducerOfRun`, sobre `items` inteiro) e entregue a cada coorte,
    que só o repete ao lado dos números que ele explica. E ficou de **três valores**,
    porque `"absent"` é alegação que precisa de testemunha — uma linha que **recebeu**
    decisão e não trouxe o campo: `present` · `absent` · `undeterminable` (execução que
    não decidiu nada, logo nada poderia ter trazido o campo). Com produtor presente, uma
    família cujas linhas são todas indecisas **publica `0`** — erro integral medido, que
    era exatamente o que estava sendo apagado. Dois testes novos: o de coorte
    toda-indecisa com produtor na execução (vermelho antes com
    `expected 'absent' to be 'present'`) e o de execução sem decisão nenhuma (vermelho
    antes com `expected 'absent' to be 'undeterminable'`); mutação F (devolver `"absent"`
    no lugar de `"undeterminable"`) mata o segundo.
17. **`populationRule` deixou de ser parâmetro e passou a ser derivado de `family`.** Eram
    dois parâmetros independentes de `localizationFamily` que tinham de concordar, e nada
    além dos dois pontos de chamada os mantinha em passo: `localizationFamily(cohortRows,
    "end-to-end", "scored-cohort-rows-with-observed-spans", …)` compilava e publicava uma
    família cuja regra de denominador declarada era a **da outra**. É a forma que a rodada
    de A7 resolveu para os dois cabeçalhos de coluna de FPR, roteando ambos por um
    construtor só. Agora um `Record<MetricFamily, …>` congelado
    (`LOCALIZATION_POPULATION_RULES`) decide a regra dentro da função e o parâmetro
    sumiu, então o par não pode ser construído desemparelhado. Fixado por asserção que
    exige, para **as duas coortes e as duas famílias**, que a regra publicada concorde com
    o próprio rótulo de família; mutação G (trocar as duas entradas do `Record`) mata dois
    testes.
18. **Legibilidade de `localizationFamily`.** O parâmetro de array chamava-se `population`
    enquanto a função **também** devolve um campo numérico `population`, então o mesmo
    identificador nomeava as linhas do laço e a contagem do resultado (a variável `count`
    existia só porque o nome estava tomado). Renomeado para `rows`. E `isScoredItem(item)`
    era avaliado duas vezes em linhas adjacentes, na ordem inversa da leitura (primeiro
    `emitted`, depois a classificação que o decidiu); agora há um `const scored` só,
    antes dos dois usos. Sem mudança de comportamento — a suíte inteira continua verde.

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

**Como ficou na execução (2026-07-28).** Quatro divergências em relação ao texto acima,
todas deliberadas e medidas.

1. **Um quarto arquivo entrou: `docs/limitations.md`.** O requisito de documentar as três
   limitações definitivas de L1 pedia "`docs/corpus-sources.md` e/ou
   `docs/limitations.md`". Ficaram em `limitations.md` (seção **L1**, com as três
   consequências, as quatro respostas G2/E4/G3/H4 e a nota de R8 de que 0%–7,12% é
   diagnóstico da execução reprovada de **2026-07-25**), e `corpus-sources.md` aponta para
   lá em vez de repetir. Um teste exige cada um desses itens por busca.

2. **A exigência de base de rótulo foi imposta no nível da FONTE, não do registro-linha.**
   `HumanSourceRegistrationV1` em `benchmark/source-manifest.ts` declara
   `acquisition`, `licenseId`, `labelBasis` e o par `anchorDateField`/`anchorDateScope`;
   `humanSourceAdmissibility` recusa `label-basis-undeclared` — "não declarado" é estado,
   nunca padrão silencioso para `date-cutoff`. O laço no registro-linha continua sendo de
   **C1** (`labelBasis` obrigatório se e somente se `label === "human"`).

3. **ERRATA (corrigida em 2026-07-28, rodada de correção de spec). A rota v1 de
   consentimento ESTÁ fechada no caminho de admissão.** A primeira redação deste item
   dizia o contrário e o argumento estava errado; fica registrado para não voltar.

   O que a primeira rodada entregou foi `determinedHumanAcquisition` +
   `assertNoIndividualAcquisition` **sem nenhum chamador** — recusa que era código morto:
   `grep` pelos sete símbolos novos fora de `benchmark/source-manifest.ts` e
   `benchmark/tests/` não retornava nada. A justificativa ("a rota atravessa três
   contratos que se movem juntos; fechar um sem os outros produz manifesto que nenhum
   registro-linha pode referenciar") foi **refutada por medição**:

   - `benchmark/corpus-import.ts` cruza **apenas** `record.provenance.sourceId` contra o
     conjunto de ids do manifesto (`SOURCE_ENTRY_ABSENT`). Não existe verificação de par
     `sourceKind`/`legalBasis` em lugar algum, então registro-linha passa a referenciar
     fonte licenciada sem tocar `benchmark/schema.ts` nem
     `contracts/source-readiness.ts`.
   - Nenhum `ReviewedSourceManifestV1` em disco carrega entrada
     `sourceType: "linkedin-contribution"`, logo nenhum artefato selado ficou ilegível.
     `grep -l linkedin-contribution` sobre todo `*.json` do repo não retorna nada (saída 1,
     reconfirmado em 2026-07-28).

     **Precisão desta frase (corrigida em 2026-07-28):** a redação anterior — "nenhum
     `source-manifest.json` em disco tem entrada de consentimento" — era ampla demais.
     `benchmark/work/smoke/corpus/private/source-manifest.json` **tem**
     `{"id": "consent", "kind": "authorized-contribution"}`. É **outra forma de artefato**:
     chaves `id`/`kind` (mais `corpus`, `seed`, `note`), produzida por
     `benchmark/tests/helpers/generate-synthetic-release-corpus.ts`, lida por outro loader e
     nunca por `parseReviewedSourceManifest` — que a rejeitaria por chave desconhecida antes
     de chegar à varredura de aquisição. A conclusão operativa não muda (nada selado ficou
     ilegível), mas numa errata cujo propósito é impedir que uma afirmação errada volte, a
     afirmação medida é a que vale.
   - Os "14 testes vermelhos" eram **uma** fixture compartilhada, `CONSENT_SOURCE` em
     `benchmark/tests/corpus-import.test.ts`, e o contrato comum permite atualizar teste
     cujo comportamento correto mudou.

   O que ficou: `parseReviewedSourceManifest` chama `assertNoIndividualAcquisition`
   imediatamente após `assertRegisteredLicensesAdmissible`, e um manifesto com entrada de
   consentimento **falha** com `individual-acquisition`. Duas fixtures foram reparadas
   como fontes licenciadas (`corpus-import.test.ts` `LICENSED_HUMAN_SOURCE`,
   `corpus-source-audit.test.ts` `licensedHumanSource`), com os registros que as
   referenciam movidos para `licensed-corpus`/`license`.

   **O segundo caminho de admissão também foi fechado.** `isAuthorizedHumanSource`
   (`benchmark/corpus-source-audit.ts`) autorizava a entrada de consentimento por conta
   própria, e ele importa porque `benchmark/lab/audit_sources.ts` chega em
   `auditCorpusSources` com `JSON.parse` puro e um cast, sem passar pelo parser. O ramo de
   consentimento foi removido: a entrada agora é reportada como
   `LINKEDIN_SOURCE_NOT_AUTHORIZED`, com teste próprio. Custo medido: **1** teste vermelho
   ("returns a ready report for fully authorized sources"), reparado.

   O que sobra para **C1** é vocabulário do registro-linha, não brecha:
   `provenance.sourceKind: "authorized-contribution"`, `provenance.legalBasis: "consent"`
   e a chave obrigatória `acquisitionCounts.consent` continuam grafáveis. Nenhum dos três
   traz fonte que o manifesto recusa — registro cujo `sourceId` não está no manifesto é
   rejeitado como `SOURCE_ENTRY_ABSENT`.

3b. **`src_b2w_reviews` -> `src_b2w` (mesma rodada).** O `sourceId` da quarta entrada de
   `V3_HUMAN_SOURCE_INVENTORY` divergia dos manifestos em disco, que a chamam `src_b2w`
   (os outros três — `src_ptso`, `src_wikipedia_pt`, `src_carolina` — coincidiam). Um join
   por `sourceId` sairia vazio só para B2W, silenciosamente. Reconciliado no código e nas
   três linhas de `docs/corpus-sources.md`, e fixado por teste ("declares the sourceId a
   reviewed manifest joins on") como literal, porque aqueles manifestos são artefatos de
   build ignorados pelo Git e nenhum teste pode lê-los.

4. **Duas recusas distintas, de propósito, e a segunda não está em
   `humanSourceAdmissibility`.** `snapshot-not-frozen` (fonte fora de
   `humanSources.snapshots`, com `newDownloadsAllowed: false`) vive só em
   `assertV3HumanInventoryAdmissible`. Se estivesse na admissibilidade, uma base pública
   instrumentada — que não está na lista congelada — passaria a ser inadmissível, e o
   critério "bases instrumentadas públicas permanecem representáveis" cairia. É por isso
   que `src_atos_oficiais` é recusado por `snapshot-not-frozen`: são diagnósticos
   diferentes, não um único "fonte não admitida".

   **ERRATA (2026-07-28).** A redação anterior terminava dizendo que `src_empresa`/
   `src_proprio` eram recusados "por `individual-acquisition`". Era falso duas vezes.
   Primeiro de fato: naquela árvore **nada** os recusava — a licença de cada um passava por
   `sourceAdmissibility` com `admissible: true`, `determinedHumanAcquisition` devolvia
   `null` para toda entrada `licensed-corpus`, e um manifesto selado com as duas parseava
   limpo (medido: `PARSED OK — sources admitted: src_proprio:autoria-propria-v1,
   src_empresa:autorizacao-interna-v1`). A recusa existia só na prosa da tabela do piloto,
   que é exatamente o estado que o requisito 1 proíbe. Segundo de vocabulário: agora que
   estão fechados, os motivos são **dois e distintos** — `src_proprio` cai como
   `operator-authored-session` (aquisição), `src_empresa` como `non-public-base`
   (publicação) —, porque autorização interna não é aquisição individual. Ver item 5.

5. **A outra metade do requisito 1: `publicationRegime` (2026-07-28, segunda rodada de
   correção de spec).** Fechar `per-document-consent` fechou a rota que **nomeia** um doador
   individual e deixou duas licenças registradas passando — e ambas são base não pública.
   `autoria-propria-v1` **é** a rota `operator-authored-session` que a união deste módulo
   declara proibida, e o docstring de `determinedHumanAcquisition` já dizia, antes desta
   rodada, que "`autorizacao-interna-v1` e `autoria-propria-v1` são entradas
   licensed-corpus também, e nenhuma é base pública" — observação correta com **nenhuma
   consequência ligada a ela**. Mesma forma de defeito das rodadas anteriores: política em
   prosa, alcançável por nenhuma guarda.

   O veredito agora vem de **dado no registro**, não de lista de ids no código: cada licença
   declara `publicationRegime` ∈ {`published-base`, `operator-authorship`,
   `internal-authorization`}, e duas tabelas de decisão (`satisfies Record<...>`, então
   regime novo sem veredito é erro de tipo) dizem qual é base pública e qual **determina**
   rota. A distinção tinha de ser campo próprio porque é invisível nas cláusulas:
   `autoria-propria-v1`, `autorizacao-interna-v1` e `lei9610-art8` têm
   atribuição/NC/SA/ND todas falsas, e só as duas primeiras são recusadas — uma correção que
   se apoiasse em "sem obrigações" teria pegado atos oficiais junto.

   **Três caminhos de admissão fechados, cada um com teste e mutação próprios.**
   `parseReviewedSourceManifest` chama `assertNoIndividualAcquisition` (agora determinando
   rota pela licença) e depois `assertPublicBaseLicensesOnly`;
   `humanSourceAdmissibility` ganhou o passo 2, `non-public-base-license`, que é o que
   recusa registro declarando `acquisition: "public-dataset"` **e** nomeando
   `autoria-propria-v1` — contradição entre dois campos do próprio registro, e a brecha por
   onde `assertV3HumanInventoryAdmissible` podia estocar a v3 de base não publicada; e
   `isAuthorizedHumanSource` (`benchmark/corpus-source-audit.ts`) repete as duas recusas,
   porque `benchmark/lab/audit_sources.ts` chega em `auditCorpusSources` com `JSON.parse`
   puro.

   **A ordem das guardas é carregada e está fixada por teste.** Rota antes de publicação:
   publicar a própria sessão de escrita não destrava rota que B3 recusa, então nomear a
   publicação nomearia motivo que o chamador poderia satisfazer sem ficar admissível — mesma
   regra de precedência de ND sobre NC. `autorizacao-interna-v1` **não** recebeu rótulo de
   rota: existe terceiro real e autorização escrita real, nenhuma das três rotas proibidas a
   descreve com honestidade, e inventar uma seria inventar proveniência (R4); ela é recusada
   pelo eixo da publicação.

   **`licenseDescribesPublicBase` é de três valores, não booleana.** `null` = identificador
   não registrado, que **não** é o mesmo que "não é base pública": os manifestos privados e
   todas as fixtures ainda usam ids opacos (`lic_ptbr_1`), e exigir registro de todo
   identificador é decisão de schema (v3). Por isso as guardas testam `=== false`, nunca
   `!== true`, e há teste do contra-caso; a mutação para `=== true` mata dois testes.

   `models/cleanfeed-ptbr-v1/license-review.json` recebeu o campo nas sete linhas, porque o
   teste "the model licence review carries the registry's terms verbatim" exige igualdade
   com o registro. `NOTICE.md` **não** foi tocado de propósito: nenhum teste o exige, ele é
   materializado sob `public/models/` e já divergia (obrigação de repackage pendente,
   registrada por B1); editá-lo aprofundaria a divergência sem fechar nada.

**Verificado (rodada de 2026-07-28):** `source-manifest.test.ts` 71/71 ·
`corpus-source-audit.test.ts` 19/19 · suíte completa **158 arquivos / 1905 testes**
(de 158/1891: +14, exatamente os novos, zero regressão) · três projetos de `tsc` verdes ·
`npm run docs:check` OK. Vermelho antes de verde, e pela razão certa: os dois testes de
recusa falharam com `promise resolved "{ schemaVersion: 1, …(3) }" instead of rejecting`,
que é o defeito, não símbolo ausente. Seis mutações, cada uma morre no seu próprio teste:
parser sem `assertPublicBaseLicensesOnly`; `determinedHumanAcquisition` voltando a ignorar
a licença; `internal-authorization` declarada base pública; `humanSourceAdmissibility` sem
o passo 2; auditor sem ler o regime; guarda do auditor escrita `=== true`.

**O corte de data foi confirmado, não reimplementado.** `PRE_CHATGPT_CUTOFF_ISO` é
documentação; nenhuma função do TypeScript compara data. O teste extrai
`CHATGPT_CUTOFF = datetime(2022, 11, 30, tzinfo=timezone.utc)` e o padrão
`date_cutoff: datetime | None = CHATGPT_CUTOFF` de `benchmark/lab/common.py`, mais o ramo
`created_at is None` que descarta candidato sem data (falha fechada). Os quatro campos de
data foram lidos nos próprios extratores: `Posts.xml@CreationDate`,
`page/revision/timestamp`, `teiHeader//date[@type="Download"]` e `submission_date`.

**A tela de linguagem (`humanLabelOverclaimIn`) julga afirmação, não palavra**, porque
toda palavra proibida aparece em texto que o projeto precisa manter — "não pode ser
garantida em 100%", "não prova de autoria", e o parágrafo de PII que diz "garantido
estruturalmente pelo pipeline" sobre outro assunto. Uma violação exige três coisas na
mesma oração: sujeito (rótulo humano / autoria humana / corte de data), verbo de alegação
e ausência de negação nos 40 caracteres anteriores. A tela também **desfaz a quebra
mole de linha** e o marcador de citação antes de recortar orações: sem isso, "a autoria
humana está\ncomprovada" escapava — sujeito numa linha física, verbo na seguinte — que é
exatamente a redação que ela existe para pegar, invisível por motivo tipográfico.

**Verificado:** `source-manifest.test.ts` 56/56 · `corpus-source-audit.test.ts` 16/16 ·
`npm run docs:check` OK (179 links) · três projetos de `tsc` verdes · suíte completa
**158 arquivos / 1887 testes** (de 158/1864: +23, exatamente os novos, zero regressão).
Seis mutações rodadas, cada uma morre no seu próprio teste: ordem das guardas invertida;
base sem declaração virando `date-cutoff`; escopo `container` aceito; tela por linha
física sem desfazer a quebra; verificação de snapshot desligada; ponte devolvendo
`public-dataset` para a entrada de consentimento.

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

**Verificar:** `vitest run benchmark/tests/schema-v3.test.ts
benchmark/tests/schema.test.ts benchmark/tests/dataset-manifest.test.ts
benchmark/tests/source-manifest.test.ts benchmark/tests/rebuild-v3-policy.test.ts`.

> **ERRATA da linha acima (rodada de correção).** O texto original nomeava só
> `schema.test.ts`, que ficou **intocado** — a metade v3 foi para o arquivo novo
> `benchmark/tests/schema-v3.test.ts`. O comando como estava passava sem exercitar
> nenhuma das cinco recusas. `rebuild-v3-policy.test.ts` entrou porque a tabela de
> lanes que o schema lê vive lá.

#### C1 — como ficou (executado em 2026-07-28)

Entregue. As cinco recusas estão provadas em `benchmark/tests/schema-v3.test.ts`
(arquivo novo, 63 testes depois das duas rodadas de correção; 47 na primeira entrega); as
contagens do manifesto e o requisito de privacidade em
`benchmark/tests/dataset-manifest.test.ts`; a declaração de eixos por fonte em
`benchmark/tests/source-manifest.test.ts`; a tabela de lanes em
`benchmark/tests/rebuild-v3-policy.test.ts`.

**Divergências deliberadas em relação ao texto acima, com o motivo:**

1. **v2 e v3 coexistem; `schemaVersion` é discriminante.** O plano dizia "schema v3" sem
   dizer o que fazer com o corpus selado que já está em disco em v2. Reescrever o ramo v2
   tornaria ilegível um artefato que existe — e um corpus que ninguém lê não pode nem ser
   auditado. Então `BenchmarkRecord = BenchmarkRecordV2 | BenchmarkRecordV3`,
   `validateBenchmarkRecord` despacha, e `parseBenchmarkDataset` **recusa** um arquivo que
   mistura as duas versões (um corpus meio-migrado selado e depois lido como uniforme é o
   defeito v2 numa forma que nenhuma auditoria nomeia). O ramo v2 é byte-idêntico.
2. **`groups` virou objeto de três estados, e isso quebrou 14 leituras — de propósito.**
   Cada consumidor que lia `record.groups[eixo]` como string passou a falhar em
   compilação, o que é o comportamento desejado: a lista dos que precisavam saber da
   mudança saiu do compilador, não de uma busca textual. As migradas passam por
   `groupAxisIdentity`, que despacha pela FORMA do valor (string = identidade v2, objeto =
   eixo v3) e não por `schemaVersion` — assim o leitor é total sobre as duas versões e
   funciona num registro em construção (C2).

   > **ERRATA (rodada de correção, 2026-07-28).** A frase original dizia que **todas**
   > as leituras passaram a ir por `groupAxisIdentity`. Era falso, e o motivo é o mais
   > importante desta errata: **a rede do compilador não pega tudo.**
   > `record.groups.generatorFamily === family` **compila** na união, porque o ramo v2
   > do eixo É um `GeneratorFamily`, então duas comparações em
   > `dataset-manifest.ts:690/694` (bloco de cobertura de família reservada dentro de
   > `sealDataset`) ficaram sem migrar e são **sempre falsas** num registro v3, cujo
   > valor é `{ state, id }`. Consequências medidas num corpus v3 de release:
   > `positives` contava 0 para toda família reservada, logo um corpus completo era
   > recusado com `requires at least 200 eligible positives` estando os 200 presentes;
   > e `appearsInHuman` nunca podia ser verdadeiro, logo a checagem de vazamento estava
   > morta em silêncio. É a classe de defeito que A4 consertou (duas grafias que nunca
   > se encontram). Nada pegou porque
   > `benchmark/tests/helpers/generate-synthetic-release-corpus.ts` está fixado em
   > `BenchmarkRecordV2`, então **nenhum teste selava corpus v3 de release**. Corrigido:
   > as duas comparações vão por `generatorFamilyOf`, e há quatro testes novos em
   > `dataset-manifest.test.ts` (contagem com 200 positivos v3, o piso recusando 199,
   > o vazamento v2 ainda recusado, e o vazamento v3 recusado **antes**, na regra de
   > eixo). A mutação de volta para o `===` cru mata o primeiro.
   >
   > Uma nota honesta sobre a segunda comparação: a mutação dela **sobrevive** aos
   > testes e não há como matá-la, porque o único caminho onde ela é alcançável é v2 —
   > onde as duas grafias concordam — e em v3 `AXIS_STATE_RULE` só admite
   > `notApplicable` em `generatorFamily` de linha humana, então o registro é recusado
   > antes de `sealDataset` ver o corpus. Migrar as duas mesmo assim é o certo: deixar
   > uma leitura falsa-por-construção ao lado de uma correta é exatamente a armadilha
   > que esta errata descreve.
3. **`authorClusterKey` falha alto em corpus v3, e isso é o resultado correto.**
   `metrics.ts` e `commands/fit.ts` usavam `groups.author` como unidade de reamostragem.
   Em v3, `author` é `notApplicable` em **todo** registro gerado por regra (texto de IA
   não tem autor humano), logo o eixo `author` **não é** unidade de reamostragem de um
   corpus v3. As três alternativas foram consideradas e todas são piores: devolver
   `record.id` sintetiza um cluster por registro (é o defeito v2); devolver `undefined` e
   deixar o chamador pular a linha tira linhas do denominador em silêncio; cair para
   linhas independentes é proibido pelo próprio contrato congelado
   (`resampling.fallbackToIndependentRows: false`). Então a função lança, citando C4.
   **Consequência para C4:** o caminho `evaluate` de um corpus v3 não roda até C4 escolher
   a unidade por estimando. Isso é bloqueio real e está registrado como tal.
4. **`reason` é obrigatório em `notApplicable` e em `unknown`.** Não estava pedido. O modo
   de falha que R6 vigia é um produtor escrever `notApplicable` para escapar da
   inelegibilidade, e um estado cuja justificativa está escrita é um estado com que um
   revisor pode discordar. Mesma jogada de `decodingConfigurable`.
5. **Na lane de CLI, `harnessVersion` `unknown` é ACEITO e `notApplicable` é RECUSADO.** O
   brief tem as duas frases ("obrigatória quando é lane de CLI" e "desconhecida → registro
   inelegível") e só esta leitura satisfaz as duas. `notApplicable` é uma afirmação falsa
   sobre a lane; `unknown` é verdadeira e custa a elegibilidade. Recusar `unknown` também
   empurraria quem não capturou a versão do binário a escrever `notApplicable` para a
   linha passar — a substituição exata que o schema existe para impedir.
6. **`decoding` e `effort` são uniões discriminadas, não campos anuláveis.** Numa lane de
   CLI os campos de amostragem **não existem** no ramo, em vez de existirem nulos. Isso
   pegou um dado real: `generate_ai.py:766` escreve `"temperature": str(TEMPERATURE)` no
   `meta` de **todo** provedor, e `CLI_PROVIDERS = {"agy","codex","gemini_cli"}` são
   invocados como CLI sem nenhuma flag de amostragem (`agy` é `[AGY_BIN, "-p", prompt,
   "--mode", "plan", "--model", model]`). Os pools em disco carregam `temperature: "0.8"`
   em registros onde nenhuma temperatura foi aplicada. O schema recusa. `effort` carrega
   `scale` junto do `level` por construção — não há como gravar um sem o outro — e
   `compareEffortWithinScale` recusa comparação entre escalas.

   > **ERRATA (rodada de correção).** Na primeira entrega a frase acima não valia para
   > `temperature`: `topP` e `repetitionPenalty` estavam dentro do ramo
   > `configurable: true` e **obrigatórios-com-`null`**, mas `temperature` era opcional
   > **no topo de `generation`**, recusada por checagem entre campos. Duas consequências:
   > a promessa da união ("os campos de amostragem não existem naquele ramo") era falsa
   > justamente para o campo em que os pools carregam valor errado, e um registro de
   > `gemini-api` podia **omitir** a temperatura e validar — a ambiguidade que o item 8
   > do brief existe para remover ("em vez de deixar o leitor supor que ninguém os
   > registrou"). Corrigido: `temperature` entrou no ramo `configurable: true` via
   > `nullableFiniteNumber`, saiu de `V3_GENERATION_KEYS` e de `GenerationV3`, e a recusa
   > numa lane de CLI passou a ser **estrutural** (campo desconhecido contra objeto
   > fechado) nas duas grafias possíveis. `null` continua significando "o default do
   > provedor valeu", que é afirmação diferente de chave ausente. Um teste novo recusa
   > o registro `gemini-api` sem temperatura e morre com a mutação de volta para
   > `optionalFiniteNumber`. Efeito colateral necessário: `corpus-source-audit.ts` lia
   > `generation.temperature` cru — deixou de compilar, como devia — e agora usa o
   > acessor `recipeTemperature` de `schema.ts`, que despacha por versão do mesmo jeito
   > que `groupAxisIdentity`.
7. **`effortSources` de `agy` é `["model-id", "not-supported"]`, e uma versão anterior do
   parser recusava justamente isso.** Escrevi um guarda dizendo que `not-supported` não
   pode acompanhar outra fonte, e a linha congelada do `agy` falhou nele na hora. O guarda
   estava errado, não o dado: no `agy` o effort "ou é o próprio id do modelo, ou não
   existe" — `--effort` é recusado em `claude-sonnet-4-6` e em
   `claude-opus-4-6-thinking` —, logo uma lane produz registros sob as duas fontes e é o
   REGISTRO que diz qual se aplica a ele. Guarda removido; o motivo ficou escrito em
   `laneRow`.
8. **`humanSeed` e `derivationRoot` são eixos separados.** O plano lista "seed humano" e
   "raiz de derivação" na mesma frase; não são sinônimos. A receita `original` gera texto
   novo a partir de um prompt humano (seed conhecido, derivação `notApplicable`), enquanto
   `parafrase` reescreve aquele texto (os dois conhecidos). Colapsar os dois inventaria uma
   derivação ou perderia o seed. A recusa 5 é sobre `humanSeed`, com três falhas distintas
   (pai ausente do dataset, pai não humano, pai humano sem `labelBasis`).
9. **`generation` passou a ser obrigatório no misto MECANÍSTICO — e proibido no
   ecológico.** v2 deixava opcional, e por isso uma linha mista podia nomear
   `generatorFamily` sem receita atrás. Os trechos de IA de um misto **mecanístico**
   saíram de um gerador **nosso**; `mixed_from_pairs.jsonl` já grava `provider`, `model` e
   `generatedAt` por linha, então o dado sustenta a exigência **nessa coorte**.

   > **ERRATA (rodada de correção).** A primeira entrega exigiu `generation` em **toda**
   > linha `mixed` e, junto com `promptTemplate`/`generatorFamily`/`generatorVersion`/
   > `generationLane` = `mixed: ["known"]`, tornou uma linha **`ecological`**
   > irrepresentável. Medido com sondagem: sem receita ela é recusada com
   > `generation is required when label is mixed`; com os quatro eixos honestamente em
   > `notApplicable`/`unknown` é recusada com
   > `groups.promptTemplate of a mixed record must be known`; **só é aceita** carregando
   > a nossa receita `agy`, o nosso `pt_parafrase_v1` e a nossa lane. Ou seja: a única
   > forma escrevível de coautoria observada era uma que nomeia recipe que nunca rodamos
   > — proveniência inventada (**R4**), e exatamente a pressão de substituição que este
   > schema existe para eliminar. A evidência citada acima
   > (`mixed_from_pairs.jsonl` grava provider/model por linha) é sobre a coorte
   > mecanística e **não** se transfere. `ecological` está congelado no glossário do
   > contrato e em `materialAssistance.generationModes`, com caminhos vivos em
   > `metrics.ts:1120/1154/2712`, `slices.ts:173` e `commands/fit.ts:305`.
   >
   > Corrigido condicionando à **coorte** e não à classe. `AXIS_STATE_RULE` deixou de ser
   > indexada por `BenchmarkLabel` e passou a ser indexada por `V3AxisClass`
   > (`human` | `ai` | `mixed-mechanistic` | `mixed-ecological`), derivada por
   > `v3AxisClass(label, mixture?.generationMode)` — exportada porque C2 constrói a linha
   > e C3 audita, e duas cópias da derivação divergiriam. A `mixture` passou a ser
   > validada **antes** dos eixos, porque é ela que decide a coorte. Em
   > `mixed-ecological`: `generation` é **proibido** (nomear receita nossa seria inventar
   > proveniência) e os **cinco** eixos de geração admitem `notApplicable` (nenhuma
   > ferramenta nossa rodou) ou `unknown` (a ferramenta do coautor não foi registrada, ao
   > preço da elegibilidade), nunca `known`. **São cinco, não quatro** —
   > `promptTemplate`, `generatorFamily`, `generatorVersion`, `generationLane` e
   > `harnessVersion` (chaves de `AXIS_STATE_RULE` em `benchmark/schema.ts`; ponteiro **por
   > nome** de propósito — a versão anterior desta errata citava
   > `schema.ts:1420/1426/1432/1438/1444` e os cinco números estavam **errados**, na direção
   > que reproduz o próprio erro de contagem: as linhas reais são 1430/1436/1442/1448/1454, e
   > 1420/1426 caem dentro de `domainSource` e `humanSeed`, os **dois** eixos que esta mesma
   > errata diz estarem abertos em `mixed-ecological`. Terceira vez nesta entrega que um
   > ponteiro numérico envelheceu no próprio commit; A4 e A7 já converteram os deles para
   > ponteiro por nome, e este segue a mesma regra). Esta errata dizia "quatro",
   > e a mensagem de commit também; o docstring de `AXIS_STATE_RULE` dizia "quatro"
   > pendurado numa frase que nomeava **dois**. Corrigido nos três lugares na rodada de
   > qualidade abaixo (item 17). `humanSeed` e `derivationRoot` também
   > abriram nessa coorte, e por medida do mesmo problema: um documento coautorado
   > observado **não tem** linha precursora separada neste corpus, então exigir `known`
   > repetiria o defeito numa casa vizinha. `author` e `source` continuam abertos nas duas
   > coortes. As mensagens agora nomeiam a coorte ("of a mechanistic mixed record", "of an
   > ecological mixed record"). Cinco testes novos, incluindo a direção contrária (linha
   > mecanística sem receita continua recusada; eixo de geração `notApplicable` numa
   > mecanística continua recusado). Mutações que morrem: `mixed-ecological` de volta
   > para `["known"]`, e a exigência de receita de volta para `label === "mixed"`.
   >
   > Residual honesto: se algum dia uma amostra observada trouxer a ferramenta
   > **autodeclarada** pelo coautor, ela **não** cabe em `generation` — que exige
   > `promptSha256`, `promptTemplateDigest` e seed que nunca teremos. Registrar isso pede
   > campo próprio, e é emenda de esquema, não desta rodada.
10. **`generationLanes` foi para `benchmark/rebuild-v3-policy.json`,** como o item 8 do
    brief manda, com `channel`, `decodingConfigurable`, `effortConfigurable`,
    `effortScale`, `effortLevels` e `effortSources` por lane. `harnessVersionRequired`
    **não** é campo: é `channel !== "api"`, derivado em `laneRunsHarness`, um lugar só.
11. **`DatasetAudit.labelBasisCounts` é chave obrigatória, dentro do selo.** Publica
    `records`, `samplingUnits` (por base, por eixo, contagem de identidades `known`
    distintas) e `ineligible`. Um número só de "unidades amostrais" escolheria em silêncio
    o eixo que é a unidade, e essa escolha é de C4 por estimando; publicar todos permite a
    C4 escolher a partir do artefato e permite a um leitor ver que um intervalo "agrupado"
    num eixo com tantas unidades quantos registros é um intervalo i.i.d. com outro nome.
    Nada que sai de lá é identificador — as identidades entram num `Set` e só o `size`
    escapa. Um corpus v2 publica zeros, não bloco ausente: ausente leria como "não medido".
    Duas reconstruções manuais da identidade do audit
    (`calibration-pipeline.ts`, `candidate-preflight.ts`) tiveram de receber a chave; são
    duplicação pré-existente da forma do audit e ficam registradas aqui como risco.

    > **CONSEQUÊNCIA NÃO DECLARADA na primeira entrega, agora medida.** Chave obrigatória
    > nova **invalida todo audit já selado em disco**. Sondagem:
    > `parseDatasetAudit` sobre
    > `benchmark/data/corpus-build/out/validate/dataset-audit.json` devolve
    > `DATASET_SCHEMA_INVALID: dataset audit is missing key "labelBasisCounts"`, e o mesmo
    > para `benchmark/work/smoke/validate/dataset-audit.json`. Logo `split`, `fit` e
    > `publish-evidence` — os três chamadores de `parseDatasetAudit` — **falham** sobre
    > esses arquivos até que `validate` seja rodado de novo. Meu relatório anterior dizia
    > apenas que `publishLabelBasis` "devolve zeros para todo corpus real, que é o valor
    > honesto", o que lê como "sem impacto no dado existente" e omitia a quebra. Isso
    > contradiz em parte a justificativa escrita no cabeçalho de `schema.ts` para manter o
    > ramo v2 byte-idêntico ("um corpus que ninguém lê não pode nem ser auditado"): os
    > bytes do registro foram preservados, os do artefato de auditoria não.
    >
    > **Obrigação operacional:** rodar `validate` para regerar `dataset-audit.json`
    > **antes** de qualquer comando que o leia. Os dois arquivos são saída de build e
    > ignorados pelo Git (`.gitignore:25` e `:28`), então nada versionado se perde e a
    > regeneração é determinística a partir do corpus.
    >
    > **Por que NÃO aceitei um audit sem a chave** (a alternativa (b) da revisão):
    > medida, ela não funciona. Preenchendo a chave com `emptyLabelBasisPublication()`
    > dentro de `parseDatasetAudit`, o digest recomputado passa a incluir a chave e
    > **não** bate com o `auditDigest` gravado — medido:
    > armazenado `970f14c9…`, recomputado com bloco vazio `6973c98f…`, iguais? `false`.
    > Fazê-la funcionar exigiria uma "safra" de digest que recomputa **sem** a chave
    > quando ela vem ausente, e então apagar a chave passaria a ser um rebaixamento
    > silencioso do selo. Um selo com duas entradas canônicas é um selo mais fraco, então
    > a saída é declarar a consequência, não relaxar a verificação (**R3**).
12. **Novo motivo de recusa de fonte: `no-declared-group-axis`.** Cada fonte declara em
    `declaredGroupAxes` os eixos que consegue preencher (SO → thread e autor; Wikipédia →
    página; B2W → produto e avaliador; Carolina → arquivo-membro), e
    `assertDeclaredAxesResolved` (lado do registro) compara declaração contra
    preenchimento — é o que C3 chama. Uma fonte que declara eixo nenhum não sustenta split
    agrupado: é o estado em que o corpus v2 estava ao reportar `leakages: []`.

Itens acrescentados na rodada de correção de spec (2026-07-28):

13. **Três eixos só admitem `known`, e agora o argumento está escrito no código.**
    `domainSource`, `collectionBatch` e `nearDuplicate` recusam `unknown` em vez de aceitá-lo
    e marcar a linha inelegível, o que divergia do requisito 1 e de **R6** como escritos
    ("valor desconhecido → registro inelegível") e era o **oposto** do argumento que a
    própria entrega fez para `harnessVersion`. A assimetria é defensável e a defesa passou a
    viver ao lado de `AXIS_STATE_RULE`: as três identidades saem da **nossa própria**
    extração e poda — o domínio é decidido pelo extrator que leu a fonte, o batch é atribuído
    pelo montador que escreveu a linha, e o cluster de quase-duplicata sai de `near_dupes.py`
    sobre o próprio corpus —, logo `unknown` ali não é lacuna do mundo e sim defeito de um
    pipeline que controlamos, e aceitá-lo entregaria linha inelegível onde o resultado certo
    é build vermelho. O argumento **não** se transfere para `harnessVersion`, cujo valor vive
    num binário de terceiro que pode já ter sido atualizado além da recuperação quando a
    linha é montada: ali a lacuna é real, então `unknown` é aceito e cobrado em elegibilidade.
    **Correção de contagem:** o relatório anterior e este parágrafo diziam "dois eixos" e
    listavam três. São **três**.
14. **Os três guardas de nível de dataset não são chamados por nenhum caminho de produção,
    e isso agora está dito no código.** `assertDeclaredAxesResolved`,
    `assertLabelEvidenceResolves` e `assertDerivedParentsResolve` são exportados e testados,
    e nada em `benchmark/**/*.ts` fora de teste os chama. Logo as recusas 4 e 5 do brief
    estão provadas **contra a função exportada**, não sobre caminho de pipeline: um JSONL
    cujos derivados apontam para pai ausente ou não humano hoje é parseado sem reclamação, e
    nada resolve `labelEvidenceRef` contra o índice do manifesto privado. Cada guarda ganhou
    um bloco dizendo isso e nomeando o dono da fiação (**C3**, a tarefa que lê
    `private/source-manifest.json`) e **por que aqui não dá**: `parseBenchmarkDataset` recebe
    um arquivo que pode ser **uma partição**, e um pai legitimamente mora em outra, então
    chamar `assertDerivedParentsResolve` lá recusaria arquivo válido; e construir o índice de
    evidência dentro de `schema.ts` faria este módulo alcançar o manifesto privado, que é
    justamente o que a fronteira existe para impedir.

**Segunda rodada de correção de qualidade (2026-07-28) — itens 15 a 18.**

15. **O piso de positivos da família reservada prometia elegibilidade e não filtrava
    nada** (`benchmark/dataset-manifest.ts`). A mensagem diz `requires at least 200
    eligible positives` desde 31a4b8a, e o contador somava toda linha `ai`/`mixed` da
    família sem olhar `recordEligibility`. Era inofensivo em v2 (que não tem estado
    `unknown`) e **inalcançável** em v3 enquanto a comparação lia o eixo cru e contava 0 —
    ou seja, **consertar a contagem (item 2 desta seção) é o que abriu o buraco**, e a
    entrega que consertou a contagem pinou o piso por baixo (199) sem pinar a metade da
    elegibilidade. Medido com sondagem antes da correção: 200 linhas v3 da família
    reservada, cada uma com `humanSeed` em `unknown`, seladas com `releaseEligible: true`
    e `generatorFamilies[família] === 200`. O artefato público também não denuncia, porque
    `labelBasisCounts.ineligible` é indexado por base de rótulo — que só existe em linha
    humana — e imprimiu `{"date-cutoff":0,"observed-process":0}`. É a falha de gerador não
    visto vazio da §3.3 chegando **pelo** gate em vez de por fora dele.

    Corrigido **filtrando** (aperto, logo R3-limpo), com a população nomeada uma vez em
    `countsTowardHeldOutFloor` e a mensagem passando a publicar os dois números:
    `received N eligible of M positive rows`. "0 de 200" e "0 de 0" são diagnósticos
    diferentes — família estocada com eixo não recuperado versus família ausente — e a
    mensagem antiga não distinguia.

    **O filtro só é cobrado de linha v3, e isso não é brecha.** Em v2
    `recordEligibility` é constante `false` por razão **estrutural**, não por registro:
    `groups` é objeto fechado de nove chaves sem `humanSeed`, `generationLane` nem
    `harnessVersion`, então esses três leem `unknown` em **toda** linha v2 já escrita
    (medido: uma linha humana v2 reporta **seis** eixos `unknown`, porque a linha humana
    também omite os eixos de gerador). Filtrar sem condição não apertaria o piso — zeraria
    toda família de todo corpus v2 e recusaria o corpus selado em disco, que é
    `scientificUse: "release"` e v2. Seria o defeito do item 2 com as versões trocadas.
    Três testes: 200 positivos v3 inelegíveis recusados com `0 eligible of 200`; 199
    elegíveis + 1 inelegível recusados com `199 eligible of 200`; e um corpus **de
    release** v2 com 200 positivos da família reservada que continua selando. Mutação que
    mata os dois primeiros: tirar o filtro. Mutação que mata o terceiro: estender o filtro
    a toda versão. (A primeira versão do terceiro teste selava
    `infrastructure-only`, que **não entra** no bloco do piso, e deixou a mutação de
    alargamento sobreviver; corrigido antes de commitar.)

16. **O braço v3 de `recipeTemperature` não era pinado por teste nenhum**
    (`benchmark/schema.ts`, `benchmark/corpus-source-audit.ts`). O acessor nasceu na
    rodada anterior para substituir uma leitura v2 que funcionava, e vive dentro da
    comparação de identidade de receita da governança — mas
    `benchmark/tests/corpus-source-audit.test.ts` só tem registros `schemaVersion: 2`, e o
    nome não aparecia em nenhum teste. Medido: trocar todo o braço v3 por `return null`
    deixava a suíte de benchmark verde. O compilador conferiu a **forma**; nada conferia o
    **valor**.

    Três testes de consumidor (linha `gemini-api` v3, a única lane cujo row permite
    `decodingConfigurable: true`) mais cinco de unidade sobre os estados que o `null`
    colapsa. Duas mutações morrem: `return null` no braço v3 e `|| null` no lugar do valor
    do ramo (esta última é por que o caso `temperature: 0` é asserido separado — decode
    guloso deliberado não pode virar "sem temperatura").

    > **Refutação parcial da crítica, medida.** A crítica descrevia como falha concreta
    > uma batch revisada declarando `temperature: null`, contra a qual o mutante compararia
    > `null === null` e **admitiria** a divergência em silêncio. Pelo tipo isso é
    > impossível: `GenerationBatchV1.temperature` é `number` e
    > `parseReviewedSourceManifest` passa o campo por `finiteNumber`. Consequência real de
    > um braço morto é a **oposta** — falso `GENERATION_RECIPE_MISMATCH` em toda linha
    > gerada v3, que é ruidoso. Mas o caso **é** alcançável por outro caminho, e por isso
    > ficou no teste com o `null` lavado explicitamente pela fronteira de tipos (como
    > `tamperSource` já faz no mesmo arquivo): `benchmark/lab/audit_sources.ts:30` chega a
    > `auditCorpusSources` com `JSON.parse(...) as ...` e nunca toca no parser, então um
    > arquivo de manifesto com `"temperature": null` chega aqui sem validação. Recusar é a
    > resposta fail-closed e é o que o teste fixa.

    > **ERRATA (item 19).** A refutação acima estava certa sobre o tipo daquela árvore e
    > **errada** sobre o que aquilo significava. Uma batch declarando `temperature: null`
    > não era "impossível pelo tipo, logo caso lavado": era o **único** jeito honesto de uma
    > batch de lane de CLI existir, e o tipo é que estava errado. Aquela cobertura ficou
    > inteira em `gemini-api` justamente porque a leitura era essa. Corrigido no item 19: o
    > par `temperature`/`temperatureNullReason` existe, o caso deixou de ser lavado e passou
    > a ser estado legítimo do contrato, e o `agy` — a lane da fixture base — ganhou os dois
    > testes de consumidor que faltavam.

17. **A recusa de `known` na coorte ecológica era asserida em um eixo de cinco.** O teste
    de aceite iterava os cinco; o de recusa só `generationLane`. Medido: abrir
    `AXIS_STATE_RULE.generatorFamily["mixed-ecological"]` para `["known", …]` deixava a
    suíte verde, e nada mais pega — a regra de identidade de gerador é unidirecional
    (`generation` presente ⇒ família `known`), então uma família `known` **sem receita
    atrás** ficava sem restrição: um documento coautorado observado afirmando a **nossa**
    família geradora, que é a proveniência inventada (**R4**) que esta coorte existe para
    impedir. O teste virou laço sobre os cinco, e as cinco mutações morrem, uma por eixo.
    Junto: a contagem "quatro" foi corrigida para **cinco** no docstring de
    `AXIS_STATE_RULE`, na errata do item 9 e aqui; e o bullet de `harnessVersion` deixou de
    dizer só "decidido num lugar só" (a regra de lane), porque a tabela recusa `known` por
    conta própria nessa coorte — a regra de lane **nunca fala** ali, já que só dispara com
    `generationLane` em `known`, e uma versão de harness sem lane atrás é inatribuível.

18. **Os dois guardas de coorte disparavam em linha `ai` e a diagnosticavam errado**
    (`benchmark/schema.ts`). `mixture` era proibido só em `label: "human"`, e os guardas
    liam `mixture?.generationMode === …` em vez da coorte. Medido na árvore commitada:
    `ai` + `generationMode: "ecological"` era recusado com "the assistance came out of the
    coauthor's own tool" — frase sobre coorte à qual a linha não pertence, culpando a
    receita, enquanto `label: "ai"` **exige** receita; as duas recusas apontavam uma para a
    outra e nenhuma nomeava a contradição. E `ai` + `generationMode: "mechanistic"` era
    **aceito**: linha integralmente gerada carregando bloco de coautoria humana com
    `aiFraction: 0.5`. Essa metade não estava na crítica e é a mais grave; o único motivo
    de não ter contaminado coorte a jusante é que todo consumidor em `metrics.ts` filtra
    `label === "mixed"` primeiro.

    Corrigido nas duas frentes que a crítica pediu. `mixture` agora é proibido em
    **qualquer** rótulo que não seja `mixed`, com mensagem que nomeia a contradição em si
    (bloco descreve documento de origem dividida, rótulo afirma origem única) — razão que o
    produtor **não** pode satisfazer editando o bloco, mesma precedência do ND-sobre-NC em
    `source-manifest.ts` — e é a **primeira** pergunta feita sobre o bloco, antes das
    frações. A verificação de soma continua lendo `mixture !== undefined` de propósito
    (fração é propriedade do bloco), e ficou pinada numa linha `mixed` para não ser código
    morto. Os dois guardas de coorte passaram a ler `axisClass`.

    > **Honestidade sobre mutação.** Reverter **apenas** os guardas para
    > `mixture?.generationMode` é mutação que **nenhum teste mata**, e isso está medido
    > (93 testes verdes) e escrito no código: com `mixture` confinado a `mixed`, as duas
    > grafias concordam em toda entrada que o validador aceita. Ficaram escritos assim
    > para o leitor (C2–C6 constroem e auditam essas linhas) e para que o par não seja o
    > último lugar onde um modo é confiado sem o rótulo.

#### Segunda rodada de correção de qualidade (itens 19–22)

19. **A comparação de identidade de receita era INSATISFAZÍVEL em lane de CLI — três das
    quatro lanes congeladas** (`benchmark/source-manifest.ts`,
    `benchmark/corpus-source-audit.ts`). `recipeTemperature` devolve `null` sempre que
    `decoding.configurable` é falso, e `rebuild-v3-policy.json` põe
    `decodingConfigurable: false` em `agy`, `codex` e `gemini-cli` (só `gemini-api` é
    `true`), enquanto `GenerationBatchV1.temperature` era `number` obrigatório passado por
    `finiteNumber`. Logo `recipeTemperature(generation) === batch.temperature` era
    `null === <number>`: **sempre falso**. Medido em 7a4d610 com sondagem que apagou-se
    depois — linha `agy` alinhada campo a campo com a batch (mesmo
    provider/family/model/version/promptTemplateDigest/generatedAt/seed) devolveu
    `{recipeTemperature: null, batchTemperature: 0.7, codes: [GENERATION_RECIPE_MISMATCH],
    status: "blocked"}`. Não havia escapatória: `collectionBatch` tem de ser `known` em
    toda classe de eixo, então linha sem batch resolvível cai em
    `GENERATION_RECIPE_MISSING`, e `calibration-pipeline.ts` / `candidate-preflight.ts`
    falham duro fora de `ready`. A cobertura da rodada anterior estava inteira em
    `gemini-api`, a **única** lane onde a comparação pode fechar — a suíte documentava a
    lane satisfazível e deixava a lane majoritária quebrada e sem pino, o mesmo defeito que
    aquela rodada estava consertando, uma lane ao lado.

    Corrigido dando ao lado da batch como dizer que **nenhuma configuração de sampling se
    aplica**, na forma que o próprio arquivo já modela para o seed: `temperature` virou
    `number | null` com `temperatureNullReason: string | null` e **exatamente um** dos dois
    presente, checado por null/undefined e não por falsidade (`temperature: 0` é decode
    guloso deliberado, um dos valores do sweep congelado — tratá-lo como ausência
    transformaria receita real em "a lane não tem knob"). Nullable puro **não** bastava: um
    `null` cru é indistinguível de "ninguém anotou", que é exatamente a ambiguidade que
    `decodingConfigurable` existe para remover do lado do registro-linha. `generation-v1.md`
    e o snippet do runbook foram corrigidos junto, e `assemble_corpus.py` passou a emitir a
    chave (o braço nulo nunca é tomado por ele, porque `generate_ai.py` grava temperatura
    para **todo** provedor — inclusive as três lanes de CLI, onde o número não descreve
    nada; emitir uma batch de CLI honesta é C2).

    Testes: no parser, o trio espelhando o do seed (aceita null-com-razão, recusa os dois,
    recusa nenhum) mais `temperature: 0` como valor aplicado; no consumidor, uma linha `agy`
    que **casa** com a batch e uma que **não casa** contra batch declarando 0.7 numa lane
    que não aceita flag. Os dois testes de consumidor selam a batch **pelo parser** antes de
    auditar, e essa indireção é o ponto: `auditCorpusSources` nunca valida a entrada
    (`benchmark/lab/audit_sources.ts` faz `JSON.parse` e cast), então um literal escrito à
    mão com `temperature: null` compara `null === null` e reporta "ready" **até na árvore
    onde o contrato proibia tal batch** — a insatisfazibilidade morava no manifesto, não na
    auditoria. Sem passar pelo parser esses dois testes nasceriam verdes e provariam nada;
    com ele, nasceram vermelhos com `unknown key "temperatureNullReason"`.

    `temperatureNullReason` **não** entra na comparação, exatamente como `seedNullReason`
    não entra: a razão é a metade legível para auditoria, e identidade é pergunta sobre o
    valor aplicado. Residual honesto e escrito: a batch nula não distingue "a lane não tem
    knob" de "o default do provedor valeu" — quem distingue é o registro-linha, pela
    estrutura de `decoding.configurable`.

20. **A mensagem do piso chamava de "eligible" um número que o próprio módulo considera
    inelegível, em corpus v2** (`benchmark/dataset-manifest.ts`).
    `countsTowardHeldOutFloor` devolve `true` para toda linha não-v3, então em v2 o contado
    é igual ao total e a frase saía `received 5 eligible of 5 positive rows` — enquanto
    `recordEligibility` é constante `false` em v2 pela razão estrutural que o próprio
    docstring descreve, e um teste commitado assere `recordEligibility(ai).eligible ===
    false` numa linha exatamente dessas. Era a mesma sobre-alegação que o item 15 tinha ido
    remover, sobrevivendo no único lugar que um operador lê. A formulação honesta do
    docstring ("um corpus v2 é julgado pelo único critério que o schema dele sabe enunciar
    — presença") nunca chegou à frase.

    Corrigido com `heldOutFloorShortfall`, que nomeia a regra que aplicou. **Três** casos e
    não dois, porque array de versão mista é alcançável (`parseBenchmarkDataset` recusa
    JSONL misto, mas `sealDataset` recebe array e os caminhos de calibração e preflight
    montam o deles em memória): tudo v3 mantém `N eligible of M` byte a byte (os dois testes
    do item 15 continuam válidos sem reescrita); nada v3 imprime `N of M positive rows (no
    positive row states eligibility: schemaVersion 2 has no axis states, so the floor is
    judged on presence)`; misto imprime quantas linhas foram julgadas por cada regra. O piso
    200 virou `HELD_OUT_POSITIVES_FLOOR`, nomeado uma vez para que guarda e frase não possam
    discordar — **R3: não foi afrouxado, só enunciado num lugar**. Dois testes novos, e o do
    caso v2 assere as duas metades (o texto exato **e** `not.toThrow(/eligible positives/)`),
    porque cada uma sozinha é satisfazível por uma correção errada.

21. **Os cinco ponteiros de linha da errata do item 9 estavam errados no próprio commit.**
    Corrigido para ponteiro por nome; a errata registra o erro em vez de apagá-lo. Detalhe
    e medição no item 9.

22. **A linha `gemini-api` v3 estava construída à mão em dois arquivos.**
    `v3ApiRecordAtTemperature` (corpus-source-audit) e `v3ApiRow` (schema-v3) escreviam o
    mesmo `decoding`, o mesmo `effort` e a **mesma** string de razão de
    `notApplicable`, byte a byte, enquanto os dois arquivos já importavam
    `benchmark/tests/helpers/v3-record-fixture.ts`, cujo cabeçalho diz existir para que
    fixture v3 seja compartilhada. Virou `v3ApiAi(temperature)` ao lado de `v3Ai`/`v3Mixed`,
    com `API_LANE_NO_HARNESS` como constante única; ficou local só o que é local (o
    alinhamento com a batch, em corpus-source-audit). O `provider` passou a `"gemini"` na
    fixture compartilhada, porque a lane de API é o endpoint do Gemini e não o binário `agy`
    — nenhuma asserção existente lê esse campo.

**Não feito, e por quê:** métricas fatiadas por lane são de A6/E3 (o brief diz para
registrar em vez de implementar); o keyring HMAC é C3 — aqui só o contrato do campo exige a
forma pseudonimizada e recusa a crua; `assemble_corpus.py` continua emitindo v2, porque
repropagar é C2. **Não** foi publicada contagem de positivos inelegíveis por família no
`DatasetAudit`: seria chave nova dentro do selo, mexendo em `AUDIT_KEYS`, no digest
canônico e nas duas recomputações artesanais de `calibration-pipeline.ts:562` e
`candidate-preflight.ts:259` — blast radius de emenda de artefato, não de rodada de
qualidade. Hoje o operador só descobre o número pela mensagem de recusa do item 15; fica
registrado como lacuna de publicação. `assemble_corpus.py` **continua emitindo v2** e a
única mudança feita nele foi emitir a chave nova exigida pelo parser (item 19) — mudança de
contrato obriga o emissor a acompanhar, sob pena de quebrar o montador; repropagar segue
sendo C2.

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


#### C2 — execução (2026-07-28)

**Feito.** Commits `8a16c9e` (extratores + eixos), `2de570b` (montador v3), `b631123`,
`b977b19`, `c3362ca` (1ª rodada de correção) e o commit da 2ª rodada. Suíte: **95 testes**
em `benchmark/lab/test_extractors.py` (eram 33 antes de C2, 76 antes da 1ª rodada de
correção, 86 antes da 2ª), `npx vitest run` 159 arquivos / 2006 testes verde,
`npx tsc --noEmit --project tsconfig.benchmark.json` verde.

**1. `base_groups` saiu inteiro.** Os cinco tokens por registro (`a_`, `g_`, `ds_`, `cb_`,
`nd_` + id) não existem em nenhum caminho, e um teste (`test_no_module_mints_a_per_record_
group_token`) varre o arquivo pelos cinco literais — de modo que reintroduzi-los sob
qualquer nome falha. O comentário que explica o defeito descreve os tokens em prosa de
propósito: citá-los verbatim derrotaria a própria guarda. Os bytes originais estão em
`git show 04c2cd5:benchmark/lab/assemble_corpus.py`.

**2. Identidade real por fonte, emitida pelos extratores.** `pt.stackoverflow` emite
THREAD (`ParentId`, ou o próprio `Id` numa pergunta) e AUTOR; `ptwiki` a PÁGINA; `B2W` o
PRODUTO e o AVALIADOR; `Carolina` o ARQUIVO-MEMBRO. Os dois eixos de pessoa passam por
HMAC com segredo (`benchmark/lab/pseudonymize.py`), nunca hash simples: `OwnerUserId` é um
inteiro pequeno e o `reviewer_id` do B2W já vem digerido — e um digest de digest continua
sendo a mesma chave de junção contra o arquivo público. Sem o keyring de C3 os dois
extratores **falham fechado**, sem nenhum caminho alternativo.

**3. Os ids não se moveram.** As `natural_key` estão byte-idênticas; a identidade entrou em
`meta`, que nenhuma chave natural lê. Pinado **ponta a ponta nas quatro fontes**: cada teste
roda o extrator real sobre a fixture e assere o `candidateId` inteiro, de modo que renomear
qualquer `natural_key` falha na linha daquela fonte (as três mutações foram executadas e
morrem separadas). Mais um teste que troca o keyring e confirma que o pseudônimo muda
enquanto o `candidateId` não, e o teste dos quatro digests medidos em `eae6ce6`, que é
recibo histórico e **não** prova comportamento de extrator — a rodada de correção corrigiu
essa alegação.

**4. Re-extração real executada** sobre os quatro snapshots em
`C:\dev\meus\repositorios\snapshots\`, `--limit 400` cada. Tempos medidos: ptso 1,4 s
(739 linhas varridas), b2w 0,3 s (5.087), ptwiki 1,4 s (462), **Carolina 9 min 30 s**
(20.797 documentos TEI, `--per-typology-limit 100`). Carolina domina o custo por um fator
de ~400; uma passada de volume completo é a única que precisa de orçamento próprio.

Distribuição de cluster medida na re-extração (400 registros por fonte):

| fonte | eixo `source` | maior | eixo `author` | maior |
|---|---:|---|---:|---|
| pt.stackoverflow | 220 clusters | `ptso_thread_183` / 5 | 107 clusters | 32 |
| B2W | 353 clusters | `b2w_product_22562178` / 6 | 391 clusters | 5 |
| Carolina | 67 clusters | membro `SOCa.xml` / 100 | — | `notApplicable` |
| ptwiki | 400 clusters | página / 1 | — | `notApplicable` |

Isto **refuta a degeneração**: um autor com 32 registros e um membro Carolina com 100 são
dependências que `g_<recordId>` apagava. O 100 do Carolina é o teto de
`--per-typology-limit`, não o tamanho real do membro — numa passada completa é maior.
ptwiki é todo singleton porque tiramos uma lead por página, e isso é **correto**, não
degenerado.

**5. Nenhum critério de "eixo degenerado" foi adicionado**, conforme o plano manda. Um
teste assere que as palavras "degenerate"/"degenerado" não aparecem na saída do relatório.
`nearDuplicate` sai todo singleton porque é o que a poda faz.

**6. O relatório de clusters** (`group_axes.cluster_report`) publica contagem,
distribuição de tamanho, maior cluster e a contagem dos três estados, por eixo **e por
fatia** (`<partição>/<label>`), mais `ineligibleRecords`. Vai para
`<out-dir>/cluster-report.json` e para stdout.

#### O que a v3 **não consegue** dizer sobre os pools atuais — medido, não estimado

O montador agora **recusa e conta** a linha que não cabe no contrato, em vez de substituir
valor.

> **ERRATA (rodada de correção, 2026-07-28).** Esta seção publicava os números de uma
> montagem INTERMEDIÁRIA — "635 escritos (275 + 360 + 0 mistos), 265 recusados", com
> dívidas de 323 `harnessVersion`, 85 `MissingLabelEvidence` e 180 `MissingRecipe` — que a
> re-importação dos pares mistos superou. O plano afirmava dois resultados diferentes para o
> mesmo comando, e o leitor não tinha como saber qual descrevia a entrega. Os números abaixo
> são os da montagem ENTREGUE, re-medidos nesta rodada sobre
> `benchmark/out/rebuild-v3/C2/assembled/`. A corrida de 635 registros ficou registrada
> apenas aqui, como etapa anterior à re-importação dos pares.

Montagem entregue, `--sample 900` sobre a re-extração fresca: **786 escritos**
(246 humanos + 360 IA + 180 mistos), **114 recusados** — todos por
`MissingLabelEvidence`, nenhum outro motivo dispara. Todos os 786 passam
`validateBenchmarkRecordV3` (probe descartável, medido: `records=786 valid=786
eligible=283`), e **503 são inelegíveis** por eixo `unknown`.

As quatro dívidas, cada uma com o dono do conserto:

1. **`harnessVersion` — 503 registros inelegíveis** (`notApplicable` 283, `unknown` 503,
   `known` 0). As execuções de geração v2 nunca capturaram a versão do binário.
   `notApplicable` seria falso sobre a lane e uma string inventada seria falsa sobre o
   mundo, então o eixo é `unknown` e o registro paga com a elegibilidade. **Conserto:
   regeração** — `generate_ai.py` e as duas lanes de mistura agora leem `--version` do
   binário resolvido pelo mesmo `npm_entrypoint` que gera. Não existe atalho de linha de
   comando: `--assume-harness` chegou a existir em `make_mixed.py` e foi **removido** nesta
   rodada de correção (ver ERRATA 3 abaixo).
2. **`MissingLabelEvidence` — 114 humanos.** São as linhas de `reserved.jsonl`, que não
   carregam campo de data. **Conserto: re-extração** (já implementada; os 246 humanos
   re-extraídos passam). É o **único** motivo de recusa na montagem entregue.
3. **`MissingRecipe` — 0 na montagem entregue**, contra 180 (a classe mista inteira) antes
   da re-importação dos pares. Nenhuma linha dos pools de mistura ORIGINAIS registrou qual
   template a produziu, e isso **não é reconstruível**: nada na linha diz se o nudge retry
   disparou, então estampar `EDIT_PROMPT` seria atribuir uma receita que a linha não
   sustenta. `make_mixed.emit` agora persiste `promptTemplateId`/`promptTemplateDigest`
   entre os **três** templates (o nudge faz parte da receita) e `harnessVersion`, e os 1.318
   pares antigos entraram via `--assume-template mix_edit_v1` — afirmação do operador,
   checável contra `make_mixed_agy.py`/`make_mixed_codex.py`, e registrada como tal.
   `mixed_candidates.jsonl` (821 linhas do caminho `--generate`, que **nudgeia**) continua
   corretamente recusado.

   > **DÍVIDA DENTRO DESTA DÍVIDA (registrada na 2ª rodada de correção, 2026-07-28).** Os
   > **180 registros mistos entregues** carregam
   > `promptTemplateId: "mix_edit_v1"`/`promptTemplateDigest` que vieram de
   > `--assume-template`, e **a linha não diz isso**: nos bytes dela a receita afirmada
   > pelo operador é indistinguível de uma receita gravada pela execução. A afirmação
   > sobrevive só no histórico do shell e nesta seção do plano — prosa, o que R7 chama de
   > declarar a propriedade em vez do contrato. Não marquei a base na linha nesta rodada e a
   > razão é estrutural, não de conveniência: o eixo `promptTemplate` é `known`, e um estado
   > `known` carrega `id` e **nenhum campo de justificativa** (é `notApplicable`/`unknown`
   > que carregam razão), então não há onde a base caber no registro v3 sem abrir
   > `V3_RECORD_KEYS`, que é contrato selado de C1. Um campo só no pool, sem leitor nenhum,
   > seria o mesmo parâmetro inerte que o `representative` de `near_duplicate_axis` — morto
   > e com forma de vivo. **Quem re-derivar é quem regerar:** os pares mistos precisam ser
   > re-emitidos pelas lanes (`make_mixed_agy.py`/`make_mixed_codex.py`), que hoje já
   > persistem `promptTemplateId` de verdade, e aí a afirmação deixa de ser necessária.
   > **Dono: D3** (mesma regeração que resolve a dívida 1, `harnessVersion`). Enquanto
   > isso: nenhum consumidor deve ler o `promptTemplateId` desses 180 registros como
   > observação da execução.
4. **A lane `codex` não é escrevível em v3 hoje.** `generationLanes.codex.effortSources` é
   `["flag", "provider-default"]` e **nenhum** dos dois é `not-supported`, enquanto as duas
   variantes de `EffortConfig` com nível exigem `scale` **e** `level`. `generate_ai.py`
   nunca gravou nível. Logo toda linha codex é recusada. **Não afrouxei a política para
   admitir `not-supported` em codex**: seria relaxar contrato congelado para os dados
   caberem (R3). `generate_ai.py` ganhou `--effort` + `--effort-source`, que andam juntos e
   são gravados como observação, **nunca** derivados do sufixo do id do modelo — a
   precedência entre `model` e `--effort` no `agy` segue indeterminada e será medida por
   `--dry-run` antes de D3, exatamente como o brief manda. **Dono: D3.**

Um defeito adicional encontrado e consertado no caminho: `make_mixed_codex.py` gravava
`"provider": "openai"` enquanto o texto saía do CLI do codex, e `openai` não é uma das
quatro lanes congeladas — as 177 linhas que essa lane contribuiu para
`mixed_from_pairs.jsonl` eram recusadas como `UnmappableLane`. Agora grava
`generationLane: "codex"` explicitamente, sem renomear `provider` (que a auditoria de
governança compara byte a byte contra o lote declarado).

#### Decisões de projeto que merecem revisão

* **`labelEvidenceRef`**: o montador escreve `private/label-evidence.jsonl` com uma entrada
  por REGISTRO DE FONTE (base, snapshot, licença, campo de data, cutoff) e o registro
  carrega `entryId` + `entryDigest` sobre os bytes canônicos dela, mais a leitura por
  linha. É digest-consistente por construção, para que `assertLabelEvidenceResolves` de C3
  tenha o que resolver. **Não substitui o manifesto privado canônico de D1** e **não**
  grava os digests dos snapshots, que são de D1.
* **Keyring**: minteado localmente (`benchmark/data/private/cluster-exposure-keyring.v1.
  json`, gitignored, `keyringVersion: "c2-run-v1"`) porque C3 ainda não existe. Quando C3
  mintar o canônico, **todo pseudônimo de pessoa muda** — o que reparticiona os clusters de
  pessoa e exige re-extração. A interface está definida para C3 satisfazer.
* **`nearDuplicate` é o id da própria linha**, dito sem rodeio. A versão anterior desta
  seção dizia que ele "é lido do resultado da poda e colidiria no instante em que duas
  linhas compartilhassem cluster" — mecanismo que **não existia**: o parâmetro
  `representative` estava declarado nos três construtores e não era passado por ninguém, e
  `near_dupes.prune` devolve `(drop, stats)` sem mapa de representante algum. O parâmetro
  morto foi **removido** em vez de ligado, porque ligá-lo compraria nada: `main()` descarta
  todo não-representante ANTES de construir registro, então toda linha que chega ao
  construtor é o único membro do seu cluster e o mapa seria a função identidade. Nomear um
  cluster de um membro pelo seu único membro é descrição do resultado da poda; a diferença
  com `nd_<recordId>` está na JUSTIFICATIVA e não no valor, e o valor é genuinamente o
  mesmo. O token antigo era minteado PORQUE a unicidade fazia o split relatar
  `leakages: []`. Consequência a lembrar: este eixo não carrega informação que o id do
  registro já não carregue, logo **não** é ele que pega um par quase-duplicado vazado —
  quem pega é a poda. Se a poda algum dia passar a MANTER os dois membros de um cluster,
  `near_duplicate_axis` muda com ela, e o id compartilhado tem de vir de uma poda que o
  publique.
* **`collectionBatch` humano** é `extraction_<pool>` — a execução de extração, compartilhada
  por todas as candidatas de um arquivo. O prefixo `extraction_` torna estrutural (não
  incidental) que ela nunca nomeie um lote de geração `gb_*`, que a auditoria recusa numa
  linha não gerada.
* **Chave do lote** ganhou `decoding` e `effort` canonicalizados. Um `temperature` nu não
  distinguia uma lane de CLI sem botão de amostragem de uma lane de API que deixou o
  default — duas receitas diferentes colapsavam num lote declarado só.

#### BLOQUEADOR MEDIDO para C3: a semente do pai não está no corpus

O dado de linhagem está certo e testado — cada linha derivada nomeia o id real do pai
(`groups.humanSeed` e, numa reescrita, `groups.derivationRoot`) — mas **a co-presença no
corpus não existe**. Medido na montagem de 786 registros: das 783 referências a pai em
estado `known`, **1 resolve para uma linha do corpus e 782 não**; por classe, 359 linhas
`ai` e 180 `mixed` nomeiam uma semente ausente. `assertDerivedParentsResolve` (de C1, hoje
NOT WIRED) recusa exatamente isso:

```
BENCHMARK_RECORD_INVALID: groups.humanSeed "src_ptso_002da4494595" resolves to no
record in the dataset (id=src_ai_agy_14abd66f2433)
```

A causa é de **seleção**, não de proveniência: `balanced_humans` escolhe humanos por
registro linguístico, independentemente de quais humanos semearam as gerações mantidas, e
as sementes das lanes de IA vêm de extrações anteriores que a re-extração fresca não
reproduz. Não consertei isto aqui de propósito: mudar quem entra no corpus é política de
seleção, e o brief de C2 divide a responsabilidade explicitamente — "a **imposição** disso
é C3/E2, mas o **dado** que permite impor é seu". O dado está entregue e pinado por teste
(`DerivationLineageTests`); a seleção que garante a árvore inteira numa partição é de
C3/E2, e **sem ela o audit de C3 recusa o corpus assim que `assertDerivedParentsResolve`
for ligado**.

#### C2 — rodada de correção de spec (2026-07-28)

Doze achados de revisão, todos avaliados tecnicamente antes de qualquer edição. **Onze
procedem e estão consertados**; **um procede pela metade** e está consertado de forma
diferente da pedida, com a medição que justifica a diferença. Os artefatos de saída são
**byte-idênticos** antes e depois (`records.jsonl` e `cluster-report.json`, sha256[:16]
`216fbe5b958afc42` e `af4e68d73112a10b` nas duas montagens), então nenhuma mudança de
comportamento entrou junto.

1. **Estabilidade de `candidateId` só estava pinada em uma fonte de quatro.** O teste que o
   critério citava assere `sha1("ptwiki:99")[:12] == "ffb6a33e6516"` — afirmação sobre o
   `hashlib`, não sobre o que algum extrator constrói. Reproduzi: mutando as três
   `natural_key` restantes (`ptwiki:` → `ptwiki-page:`, `carolina:` → `carolina-x:`,
   `body[:80]` → `body[:60]`) a suíte ficava **verde**. Três testes ponta a ponta novos
   rodam o extrator REAL sobre a fixture e assertam o `candidateId` inteiro
   (`src_wiki_ffb6a33e6516`, `src_carolina_929963677b0d`+`3f8b653ef23c`,
   `src_b2w_c5d52edc9f7c`+`404f6fe8d385`); as três mutações agora morrem cada uma na sua
   linha. O teste de digests fica, redescrito como o **recibo histórico** que é.
2. **`nearDuplicate`**: parâmetro morto removido, alegação corrigida — ver o bullet acima.
3. **`--assume-harness` removido de `make_mixed.py`.** Era escopo extra contra instrução
   explícita: o requisito 6 do brief diz que versão não obtível deixa o registro
   **inelegível**, nunca "unknown preenchido na mão", e a flag existia exatamente para o
   caso proibido. A assimetria com `--assume-template` é o argumento: a afirmação de
   template é **checável** contra código que ainda existe (`make_mixed_agy.py` e
   `make_mixed_codex.py` mandam um template só, sem retry corretivo), enquanto a versão de
   um binário que rodou meses atrás não é recuperável de lugar nenhum — nem do arquivo de
   pares, nem dos scripts, nem da máquina. Um teste novo assere as duas metades: par sem
   versão → `harnessVersion: None` → eixo `unknown` → registro inelegível, **e** o `--help`
   do parser não oferece `--assume-harness` (com `--assume-template` como controle).
   Reintroduzir a flag mata o teste.
4. **Separação de propósito no HMAC estava alegada e não testada.** A alegação era que o
   propósito entra na mensagem do MAC "para que um valor cru em dois eixos não produza um
   pseudônimo só". Medido: o token é `<purpose>_<digest[:16]>`, então `assertNotEqual` sobre
   o token inteiro é satisfeito **pelo prefixo** — com a mensagem reduzida a `raw` os dois
   eixos devolvem a mesma metade de digest (`60cd07e428342f7d`) e a suíte seguia verde. Pior,
   a justificativa da docstring era falsa: os tokens seriam `a_…` e `b_…`, distintos. A
   propriedade real é **separação de domínio do MAC** — a metade do digest não ser chave de
   junção entre eixos — e é ela que o teste assere agora, morrendo sob a mutação.
5. **`parent_of_prompt` não era alcançado por teste algum.** `ai_record` lê
   `meta.pairedWith` primeiro, e a fixture das duas provas de linhagem carregava o campo, de
   modo que a função que o requisito 5 nomeia por formato
   (`original_src_b2w_00848b3bc692`) nunca era chamada: trocar `split("_", 1)` por
   `rsplit` — o defeito exato que o comentário dela adverte, devolvendo o fragmento
   `00848b3bc692` que resolve para nenhum registro — deixava a suíte verde. Dois testes
   novos: uma linha legada SEM `pairedWith` resolvendo o pai só pelo `promptId`, e o caso
   direto da função. Os comentários dos dois testes antigos, que atribuíam a resolução ao
   `promptId`, foram corrigidos para dizer que quem a fornece é `pairedWith`.
6. **`identity_of` colapsa `notApplicable` e `unknown` em `None`, e agora tem teste.**
   Relaxar a guarda para `state == UNKNOWN` fazia `str(axis_value.get("id"))` devolver a
   STRING `"None"` para todo eixo `notApplicable`, publicando um cluster inventado que junta
   474 linhas em `author` e 360 em `source` — a dependência fabricada que R6 proíbe, dentro
   do relatório que alimenta o gate de poder de E3. Dois testes cobrem as duas direções da
   guarda e cada um morre na sua mutação.
7. **`SOURCE_DECLARED_AXES` era descrita como contrato e não constrange nada.** O comentário
   dizia "é o contrato que C3 checa um registro contra (`assertDeclaredAxesResolved`)" —
   afirmação sobre um verificador que ainda não existe; `grep` acha só a definição e o teste
   que reassere o conteúdo. Reescrito para dizer o que é (declaração para C3 consumir) e o
   que constrange hoje (nada), com as **duas razões** de C2 não a ter transformado em recusa:
   recusar por `unknown` num eixo declarado contradiz R6 na cara (conta apagada do Stack
   Exchange é `unknown` legítimo, e há fixture assertando que a linha é escrita), e recusar
   por chave ausente descartaria os pools legados — mudança no que o corpus CONTÉM, que é
   política de seleção e não é de C2.
8. **`LAB_TEMPERATURE` deletada** (dois leitores em `eae6ce6`, zero depois de `decoding_config`
   passar a derivar a temperatura da lane) e **`CLASS_FRACTIONS` ligada**: `assign_partitions`
   lê o dicionário em vez de repetir `0.2`/`0.3` inline, então a decisão congelada 20/30/50
   tem uma grafia só. `test` segue sendo o RESTO, de propósito.
9. **`known("")`: o achado procede pela metade, e consertei a metade que existe.** A revisão
   pedia `assertRaises(ValueError): known("")` e "confirme que morre com a guarda removida".
   Medi: `PSEUDONYM` é `^[A-Za-z0-9_-]+$` e `+` não casa string vazia, então com a guarda
   dedicada trocada por `if False:` o ramo do regex **ainda levanta** `ValueError` — logo um
   `assertRaises` nu não pode morrer sob essa mutação, e a verificação pedida é impossível.
   O que a guarda dedicada contribui é o DIAGNÓSTICO, e ele importa porque as duas falhas
   mandam o autor fazer coisas opostas: "faça slug" conserta caractere inválido e é o
   conselho ERRADO para identificador vazio, onde não há identidade para sluggar e o
   problema real é que string vazia volta como `unknown` por `groupAxisState`. O teste assere
   a MENSAGEM (`assertRaisesRegex(..., "reads back as")`) e morre sob a mutação.

#### C2 — segunda rodada de correção de spec (2026-07-28)

Quatro achados. **Todos os quatro procedem** — reproduzi cada um com a sua própria mutação
antes de editar qualquer coisa — e todos os quatro estão consertados. `assemble_corpus.py`
fica **byte-idêntico** ao commit anterior (`git hash-object` == `git rev-parse
HEAD:benchmark/lab/assemble_corpus.py`, `e122df62…`), portanto o achado importante é
**fechado só com teste**, sem nenhuma mudança de comportamento.

10. **IMPORTANTE — o eixo `batch` não era alcançado por teste em língua nenhuma.** O eixo
    `batch` é um dos quatro que o requisito 2 fixa para a fonte IA ("IA: seed + prompt +
    batch + gerador"), e o primeiro critério de conclusão exige eixo aplicável provado por
    teste de fixture. `ai_record` e `mixed_record` escrevem
    `collectionBatch: unknown("the generation batch is derived after partitioning")`, e só
    `assign_generation_batches` — chamada uma vez, de `main()`, depois de
    `assign_partitions` — o torna `known`. `grep -rn assign_generation_batches` achava a
    definição, a chamada e uma linha deste plano; `collectionBatch` não aparecia em
    `test_extractors.py`. Medi as **duas** mutações da revisão e ambas deixavam a suíte em
    **86/86 OK**:

    * `return []` no topo de `assign_generation_batches`: os 540 registros gerados da
      montagem entregue ficam `unknown` no eixo, portanto **inescrevíveis** — e o eixo
      que alimenta o gate de poder de E3 cai dos **27** clusters que o
      `cluster-report.json` entregue publica (maior cluster `gb_mixed_0020`, 90
      linhas) para **4** clusters sobre 246 linhas agrupadas (maior
      `extraction_wikipedia_fresh`, 73);

      > **ERRATA (terceira rodada de qualidade, 2026-07-28).** Este item dizia
      > "portanto **inelegíveis**". Está errado, e a generalização vem de
      > `harnessVersion`, onde vale. `AXIS_STATE_RULE.collectionBatch` em
      > `benchmark/schema.ts` admite **só `known`** nas quatro classes de eixo, então
      > `validate` → `parseBenchmarkDataset` → `validateBenchmarkRecordV3` **recusa o
      > registro**. **Metade da frase original procede**: a bancada é silenciosa no
      > sentido de que nada levanta e nada falha — `assign_generation_batches`
      > retornando vazio não levanta erro nem imprime aviso, e `cluster_report` não
      > carrega veredito por decisão de projeto —, mas `validate` **não** é
      > silencioso. E mesmo do lado da bancada a elegibilidade mal se move:
      > `ineligibleRecords` iria de **503 para 540** (+37), porque 503 dos 540 gerados
      > já são inelegíveis por `harnessVersion` (débito 1). Consequência para quem lê
      > depois: o teste da bancada **não** é a única defesa, e a entrada do schema
      > **não** é redundante com ele.
      >
      > **ERRATA 2 (quarta rodada de qualidade, 2026-07-28) — corrige a errata acima,
      > não o texto original.** Três frases da errata anterior estavam erradas ou
      > largas demais, e as três agora estão medidas.
      >
      > 1. **O número de clusters.** A errata anterior dizia que os clusters do eixo
      >    "vão a 0" e que "o número que desaba é o de clusters". Rodei o
      >    `group_axes.cluster_report` real sobre o `records.jsonl` entregue (786
      >    linhas, sha256 `216fbe5b…`) com o efeito da mutação A aplicado — as 540
      >    linhas de geração controlada de volta para `unknown`, exatamente o conjunto
      >    que `assign_generation_batches` toca. A baseline reproduz o artefato
      >    entregue (clusters 27, maior `gb_mixed_0020`/90, `ineligibleRecords` 503) e
      >    o mutante reporta **4 clusters**, não 0: `registros_agrupados` 786 → 246,
      >    maior `extraction_wikipedia_fresh`/73, `estados` `{'known': 786}` →
      >    `{'known': 246, 'unknown': 540}`, `sizeDistribution` `{41:1, 59:1, 73:2}`.
      >    A causa está na própria docstring de `assign_generation_batches`, três
      >    linhas acima do ponto da mutação: "Human records are untouched here and
      >    keep the `extraction_<domainSource>` batch their builder assigned". As 246
      >    linhas humanas carregam 4 ids `extraction_*` distintos, já dentro dos 27
      >    entregues, e a mutação não as alcança. O erro corria na direção
      >    **lisonjeira**, e é por isso que importa: `clusters=0 /
      >    registros_agrupados=0` é alarme gritante em `render_cluster_report`,
      >    enquanto 4 clusters de 41–73 linhas sobre 246 agrupadas parecem um eixo
      >    saudável — ou seja, a regressão é **mais** escondida do que a errata
      >    anterior afirmava, não menos. **Onde o 0 é o número certo**, nomeando a
      >    estatística: nas **células por fatia**, não no agregado. Cada célula
      >    `<partição>/ai` e `<partição>/mixed` vai a `clusters=0` e `grouped=0`
      >    (medido por rótulo sobre o corpus entregue: 20 → 0 em ai e 3 → 0 em mixed,
      >    que é a soma das células geradas por partição do relatório entregue),
      >    enquanto as quatro células humanas ficam intactas. A coluna mais **alta**
      >    sob a mutação não é a de clusters e sim o mapa `estados`; a de clusters é a
      >    mais **baixa**.
      > 2. **"nas próprias fixtures desta classe"** era largo demais, e a linha `agy`
      >    citada não está no teste em questão. O teste
      >    `test_no_generated_record_is_left_unknown_on_the_batch_axis` monta **cinco**
      >    registros — três linhas ai `gemini-api`, uma mista mecanística e **uma
      >    humana** —; as linhas `agy` vivem em
      >    `test_the_effort_is_part_of_the_batch_key`. Medido com o eixo forçado de
      >    volta em cada uma: `BENCHMARK_RECORD_INVALID: groups.collectionBatch of an
      >    ai record must be known, received unknown (id=src_ai_gemini_aaaaaaaaaaaa)`,
      >    `... of a mechanistic mixed record ... (id=mix_src_ptso_0f89e00a4836)` e
      >    `... of a human record ... (id=src_ptso_aaa)`. A linha **humana** é recusada
      >    igual (a regra vale `["known"]` também para `human`), e é justamente a
      >    classe que sobrevive à mutação na bancada e mantém a contagem de clusters
      >    fora do zero — o fato que o item 1 acima corrige.
      > 3. **Elegibilidade.** A errata anterior dizia "o registro válido mede
      >    `{eligible: true, unknownAxes: []}`", no singular, o que vale para quatro
      >    das sete fixtures e é falso para as outras três; e "o preço não é
      >    elegibilidade" contradizia, seis linhas abaixo, o próprio "503 dos 540 já
      >    são inelegíveis". O enunciado correto é mais estreito: o `unknown` **deste
      >    eixo** custa o registro, não a elegibilidade — o registro pode muito bem
      >    ser inelegível por outro motivo (503 dos 540 entregues são, por
      >    `harnessVersion`), mas `recordEligibility` nunca é **alcançado** com
      >    `collectionBatch: unknown`, porque o parse levanta antes. Medido nas
      >    fixtures válidas: as três linhas api e a humana medem `{eligible: true,
      >    unknownAxes: []}`, a mista mede `{eligible: false, unknownAxes: ["author",
      >    "source"]}` e as duas `agy` medem `{eligible: false, unknownAxes:
      >    ["harnessVersion"]}` — as sete recusadas com as mensagens acima quando o
      >    eixo é forçado.
    * o fallback humano `f"extraction_{cand['domainSource']}"` reescrito para `"batch_x"`,
      apesar de a docstring da própria função chamar o prefixo `extraction_` de "structural
      rather than incidental" porque "cannot collide with a `gb_` id" — o audit de
      governança recusa registro não-gerado que nomeie batch de geração declarado.

    As duas falhas são opostas em espécie, e é por isso que as duas direções estão pinadas:
    a primeira **escreve em silêncio um corpus que o `validate` selado depois recusa
    registro por registro**, tendo esvaziado o eixo de poder sem levantar nada do lado
    onde o corpus foi construído (ver a ERRATA acima: em silêncio na bancada, não no
    schema); a segunda fabrica uma colisão que só aparece quando o audit selado roda,
    muito depois do corpus escrito.

    A classe nova `GenerationBatchAxisTests` (8 testes) fecha os quatro itens pedidos:
    duas linhas de uma receita → **um** batch declarado com `state: known` e `id ==
    batches[0]["batchId"]`; uma linha diferindo em **um** componente → dois batches, em
    `subTest` por componente; nenhum registro gerado fica `unknown` depois da passada;
    linha humana mantém `extraction_ptso_qa` e nunca um `gb_`; e um registro IA declara os
    doze eixos, espelhando `test_a_human_record_states_all_twelve_axes` (que não tinha
    contrapartida — nenhum teste enunciava o CONJUNTO de eixos da IA).

    **Todos os dez componentes da chave de batch morrem na sua própria linha**, medido um a
    um removendo a linha correspondente da tupla: `sourceId` (1 != 2 em
    `test_a_mixed_row_never_joins_a_generated_row_s_batch`, mais `'gemini' != 'src_ai'`),
    `provider`, `family`, `model`, `version`, `promptTemplateDigest`, `decoding` e `seed`
    (cada um no seu `subTest`), `effort` (na lane `agy`, a única onde effort é expressável —
    `gemini-api` só oferece `not-supported`) e `generatedAt` (em
    `test_a_batch_never_straddles_two_partitions`). Esse último pina a propriedade que faz
    um eixo COMPARTILHADO ser seguro para o split e que estava afirmada só em prosa: como
    `generatedAt` entra na chave e é o tempo do bloco, uma receita idêntica estampada em
    dois blocos rende **dois** batches, logo um batch nunca atravessa partição.
    `sourceId` também: o `batchId` embute `rec["label"]` mas a CHAVE não, então sem
    `sourceId` uma linha mista passaria a nomear um batch publicado como `gb_ai_…`.
11. **minor — o número medido no comentário do teste de HMAC estava errado.** O comentário
    dizia "measured: 3171c3888025f79c". Rodei a mutação e o teste imprime
    `'60cd07e428342f7d' == '60cd07e428342f7d'`; conferi independentemente que
    `hmac-sha256(bytes.fromhex("11"*32), b"40").hexdigest()[:16] == 60cd07e428342f7d`, e que
    `3171c3888025f79c` não corresponde a nada no caminho (nem à variante de chave ascii, nem
    a `sha256`/`sha1` do cru, nem à mensagem com propósito). `pseudonymize.py:117`, a
    mensagem do commit e o item 4 acima carregavam o valor certo, então a entrega afirmava
    **duas medições diferentes para uma medição** e a errada estava justamente no teste que
    existe para registrá-la. Corrigido, com a fórmula escrita ao lado do número.
12. **minor — o comentário de `generate_ai.py` ainda afirmava "323 de 635".** São os números
    da montagem INTERMEDIÁRIA que o item 10 da rodada anterior identificou como velhos e
    corrigiu em todo lugar menos ali: a entregue é 786 registros com 503 inelegíveis em
    `harnessVersion`. A ERRATA do plano dizia que os 635/323 ficavam "apenas aqui" enquanto
    `grep -rn 635 benchmark/lab/*.py` achava a mesma figura afirmada como fato corrente em
    código de produção. Tirei a **contagem** em vez de atualizá-la: contagem é propriedade de
    uma montagem, não deste writer, e atualizá-la só reagenda o mesmo defeito para a próxima
    corrida. O comentário agora afirma o que é permanente (toda linha de lane CLI dos pools
    v2 cai no ramo `unknown`) e aponta para a tabela de dívidas do plano.
13. **minor — dois resíduos do desenho "afirmação do operador".** (a) `emit` ainda tinha
    `template_id: str = "mix_edit_v1"`, o default silencioso cuja remoção é o **título** do
    commit `b977b19`. Os dois sítios de produção passam o valor explicitamente, então o
    default era inalcançável hoje e alcançável pelo PRÓXIMO chamador, que herdaria uma
    alegação de receita sem digitar nenhuma. Agora é parâmetro obrigatório, e um teste novo
    assere `TypeError` na omissão (reintroduzir o default mata o teste: "TypeError not
    raised"). O único sítio de teste que omitia passou a declarar `mix_edit_v1`.
    (b) A afirmação do operador não está marcada nas linhas emitidas — registrada como
    dívida na dívida 3 acima, com a razão estrutural de não a ter marcado e o dono.

#### Defeitos fora de escopo observados nesta rodada (não consertados)

* **`governance-inputs.json` declara uma família held-out que o projeto já retirou.** Em
  `assemble_corpus.py:1532` o campo é `sorted(held_out) or ["gemini-3_5-flash-lite"]`. Na
  montagem entregue `held_out` saiu **vazio** — `gemini-3_5-flash-low` tem 224 positivos mas
  o bloco de teste `ai` cabe 180, então foi declinada por "bloco de teste cheio" —, o
  fallback disparou, e o artefato publicado declara `heldOutGeneratorFamilies:
  ["gemini-3_5-flash-lite"]`. Essa é exatamente a família que `HELD_OUT_INELIGIBLE` nomeia
  como inreivindicável (vista no treino pelo alias `gemini-flash-lite-latest`) e que o
  commit `7eddeab` retirou; ela tem **37 linhas, todas em `calibration`**. `validate` recusaria
  isso com `DATASET_COVERAGE_INVALID` e o split recusaria o corpus. `thin_held_out_families`
  também não pega, porque é chamada com o `held_out` vazio e não com a lista realmente
  escrita no manifesto — a mesma forma "silencioso por construção" que A4 consertou.
  **O código é pré-existente e o fallback NÃO foi alterado aqui.** Consequência prática:
  nenhum consumidor deve confiar no `heldOutGeneratorFamilies` de
  `benchmark/out/rebuild-v3/C2/assembled/governance-inputs.json`. **Dono: a tarefa que ligar
  o gate de cobertura** (C3 no audit, E3 no gate de poder).
* **Os 786 registros carregam governança simulada, que R4 proíbe nomeadamente.**
  `ANNOTATION` (`assemble_corpus.py:225`) escreve `reviewerIds: ["reviewer_a",
  "reviewer_b"]` e `agreement: "agree"` em TODO registro, e `pii_audit` escreve
  `{status: "passed", method: "manual-and-automated", reviewerId: "reviewer_pii"}` — sem
  recibo nenhum atrás de nada disso. `private/review-ledger.jsonl` republica os mesmos
  valores por registro. R4 nomeia `annotation.reviewerIds` e `piiAudit.status = passed`
  como exatamente o que não se preenche sem recibo real, e governança constante é um dos
  cinco bloqueios P0 que a reconstrução existe para limpar (§3.7 do diagnóstico). O código é
  **byte-idêntico a `eae6ce6`**, então consertá-lo não é de C2 — mas C2 reescreveu os três
  construtores em volta dele e entregou 786 registros carregando isso, então fica registrado
  aqui e nos `concerns`. **Dono: a tarefa de governança real** (o bloco P0 §3.7); enquanto
  não houver revisão humana, o valor honesto é `automated/unreviewed`.

#### Pendente (não é de C2)

* Passada de **volume completo** sobre os snapshots: `not-verified`. Só Carolina custa
  ~9,5 min por 400 registros; o gargalo é a varredura de 20.797 documentos TEI, não a
  memória.
* **Poder suficiente por estrato** é o critério de aceitação e é avaliado em **E3**, contra
  os números que este relatório passa a publicar. C2 entrega os números, não o veredito.
* A árvore seed → geração → derivados carrega o dado que permite impor uma partição só
  (`humanSeed` + `derivationRoot` resolvem o pai); a **imposição** é C3/E2.

#### C2 — terceira rodada de correção de qualidade (2026-07-28)

Dois achados, **os dois procedem**, e os dois são **prosa**: nenhuma linha de
comportamento mudou, nenhum teste mudou de asserção, nenhum número de gate se moveu.
`assemble_corpus.py`, `group_axes.py`, `pseudonymize.py`, `make_mixed.py` e
`generate_ai.py` ficam byte-idênticos a `e53ec96`. O diff é `test_extractors.py`
(comentários e docstring) e este plano.

14. **IMPORTANTE — o comentário que justifica o teste novo enunciava um mecanismo falso.**
    Dizia que um eixo `unknown` "makes a record ineligible (R6), so a regression that
    skipped rows would not raise, would not print and would not fail validate". A
    generalização é importada de `harnessVersion`, onde vale, e **quebra em
    `collectionBatch`**. Medi em vez de raciocinar: passei fixtures desta classe pelo
    validador selado com o eixo forçado de volta para `unknown` e o resultado está na
    ERRATA do item 10 acima — `validate` **recusa o registro**, com a mensagem verbatim,
    em todas (a quarta rodada refez a medição sobre as **sete** fixtures, incluindo a
    linha humana que esta rodada omitiu; ver item 16). Então o `unknown` **deste eixo** custa o registro, e não a
    elegibilidade: `recordEligibility` nunca é alcançado para ele. A metade verdadeira
    da frase (bancada silenciosa: nada levanta, nada avisa, o `cluster_report` não tem
    veredito) está preservada e agora **separada** da metade falsa, com
    `AXIS_STATE_RULE` nomeado como a segunda defesa para que ninguém leia o teste da
    bancada como a única nem a entrada do schema como redundante. Corrigido nos **três**
    lugares que repetiam a mesma subestimação: o comentário de
    `test_no_generated_record_is_left_unknown_on_the_batch_axis`, a docstring de
    `GenerationBatchAxisTests` (dois trechos: o bullet da mutação e o parágrafo "opostas
    em espécie") e o item 10 deste plano — sempre como **errata em linha** e não como
    edição silenciosa (R7). Medição extra que o achado não pedia e que reforça o ponto:
    do lado da bancada `ineligibleRecords` iria de **503 para 540 (+37)** sob a mutação,
    porque 503 dos 540 gerados já são inelegíveis por `harnessVersion` — ou seja, mesmo
    na leitura da bancada a elegibilidade era o número **errado** para citar.
15. **minor — o único ponteiro por número de linha da árvore Python da bancada.**
    O comentário novo do teste de HMAC apontava `pseudonymize.py:117`. Estava exato, mas
    era o único `arquivo.py:linha` em `test_extractors.py`, `assemble_corpus.py`,
    `make_mixed.py`, `pseudonymize.py` e `group_axes.py` (confirmado por
    `grep -nE '\.py:[0-9]+|\.ts:[0-9]+'`, um único hit, introduzido por aquele diff), e
    reinstalava o estilo que as duas rodadas anteriores converteram para ponteiro por
    nome (minor 3 de C1 nas linhas de `AXIS_STATE_RULE`; a rodada de A7 em `slices.ts`).
    Pior, a linha alvo está dentro de uma docstring que aquele diff não tocou, então
    apodreceria em silêncio, e havia **dois** ponteiros para o mesmo lugar no mesmo
    comentário. Agora é `ClusterKeyring.pseudonym` por nome, uma vez, com a fórmula ao
    lado do número — nada se perde, porque o valor é re-derivável ali mesmo.

#### C2 — quarta rodada de correção de qualidade (2026-07-28)

Três achados, **os três procedem**, e os três são **prosa**: nenhuma linha de
comportamento mudou, nenhum teste mudou de asserção, nenhum número de gate se moveu.
Os cinco módulos Python de produção (`assemble_corpus.py`, `group_axes.py`,
`pseudonymize.py`, `make_mixed.py`, `generate_ai.py`) ficam byte-idênticos a `e53ec96`,
e os três artefatos entregues mantêm os digests. O diff é `test_extractors.py`
(comentários e docstring) e este plano.

O tema da rodada é o mesmo das anteriores, uma volta acima: a rodada 3 trocou uma
consequência **inferida** por uma **medida**, mas o número em que a versão corrigida
passou a se apoiar — "os clusters vão a 0" — também era inferido, e ninguém o mediu
antes de escrevê-lo em quatro lugares e na mensagem de commit. A lição registrada:
**errata não isenta de medição**; uma correção que herda um número não medido do texto
que corrige apenas move o defeito.

16. **IMPORTANTE — o número que a rodada 3 tornou a única prova era falso, e na
    direção lisonjeira.** Medição, causa, o lugar onde o `0` é certo e as quatro
    ocorrências corrigidas estão na **ERRATA 2 do item 10** acima, para não duplicar o
    número em dois lugares e criar de novo o problema que esta rodada conserta.
    Resumo: agregado 27 → **4** clusters (não 0), 786 → 246 linhas agrupadas, maior
    `gb_mixed_0020`/90 → `extraction_wikipedia_fresh`/73; o `0` é das células
    `<partição>/ai` e `<partição>/mixed` (20 → 0 e 3 → 0 por rótulo). Corrigido nos
    quatro lugares que repetiam o número — o comentário do teste, o bullet da mutação
    na docstring de `GenerationBatchAxisTests`, o item 10 e o item 14 —, e o parágrafo
    "opostas em espécie" da mesma docstring, que dizia "having emptied the power axis",
    passou a "having stripped the power axis of every GENERATED row — not of every row,
    which is what makes it look survivable on the bench side", porque "emptied" era a
    mesma alegação de 0 em prosa. O comentário do teste agora diz explicitamente que
    **4 clusters plausíveis é sinal mais fraco que 0**, que é o argumento que ele de
    fato faz, e que a coluna mais alta sob a mutação é o mapa `estados`, não a de
    clusters.
17. **minor — "measured on these very fixtures" era largo demais.** O teste monta
    cinco registros (três ai `gemini-api`, uma mista mecanística, **uma humana**) e não
    tem linha `agy` nenhuma; a `agy` vive em
    `test_the_effort_is_part_of_the_batch_key`. O comentário agora enumera as cinco,
    diz de onde vem a `agy`, e **acrescenta a recusa da linha humana**
    (`... of a human record must be known, received unknown (id=src_ptso_aaa)`), que
    faltava e é a mais relevante das três: `AXIS_STATE_RULE.collectionBatch.human`
    também é `["known"]`, e a classe humana é exatamente a que sobrevive à mutação na
    bancada e mantém a contagem em 4 em vez de 0. As mensagens estão em ERRATA 2.2 do
    item 10.
18. **minor — "não é inelegível, é inescrevível" contradizia a medição seis linhas
    acima.** As 503 linhas citadas **são** inelegíveis; o enunciado correto é mais
    estreito, e o `{eligible: true}` no singular valia para quatro das sete fixtures.
    Corrigido em ERRATA 2.3 do item 10 e no comentário do teste, que agora publica os
    três resultados de elegibilidade medidos por classe em vez de um exemplo.

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

#### C3 — o que a execução decidiu (2026-07-28)

Entregue, e depois corrigida por duas rodadas de revisão no mesmo dia (2026-07-28, itens 9 a
13 e 14 a 18). Os oito testes de aceitação nomeados estão em
`benchmark/tests/cluster-exposure-ledger.test.ts` (34 testes) e
`benchmark/tests/split-audit.test.ts` (17), com mais 2 em `benchmark/tests/split.test.ts`
sobre as listas de eixos que a auditoria e D0b leem. Nenhum evento real foi gravado: o
congelamento continua sendo E2. As decisões abaixo precisam ficar registradas porque a
execução foi além (ou ficou aquém) do que o texto acima diz.

1. **Um keyring só, e o ledger HMACa sobre o pseudônimo de C2 — não sobre o identificador
   cru.** O arquivo canônico deste plano é exatamente o que
   `benchmark/lab/pseudonymize.py` já nomeia como canônico, e C2 minted um ali com
   `keyringVersion: "c2-run-v1"` e `secrets.person`. Duas chaves em dois arquivos teriam
   produzido o pior modo de falha possível: o ledger indexaria identidades derivadas de uma
   chave e o corpus carregaria identidades derivadas de outra, a comparação nunca casaria, e
   o ledger responderia "nunca exposto" para tudo — a tautologia de `leakages: []`
   reintroduzida por outra porta. Então: `init` **preserva** `secrets` byte a byte e apenas
   **acrescenta** o array `keys` que é dele; a separação de domínio vem do PROPÓSITO
   misturado na mensagem do MAC (`cluster-exposure` + eixo), que é o mesmo mecanismo que o
   docstring de `pseudonymize.py` já mede e declara suficiente. `secrets.person` nunca é
   reescrito: rotacioná-lo renumeraria todo cluster de pessoa e exigiria re-extração.
   Consequência prática: na máquina do operador `init` **adota** o keyring de C2 em vez de
   recusar, e nenhum pseudônimo de pessoa muda — ao contrário do que a nota de C2 previa.
2. **A comparação de elegibilidade usa quatro eixos, não os doze** (`EXPOSURE_IDENTITY_AXES`
   = `author`, `source`, `humanSeed`, `derivationRoot`). O evento **registra** todos os eixos
   que a linha preenche, então alargar depois não exige re-derivar história. Mas comparar
   `domainSource` (um estrato) ou `collectionBatch` (uma execução) tornaria toda linha futura
   inelegível para teste no instante em que uma linha do estrato fosse exposta — isso é um
   desligamento, não um controle. `nearDuplicate` fica fora porque depois da poda ele é o id
   da própria linha (nota de C2) e não carrega nada que a impressão de conteúdo não carregue.
3. **R7 é aplicado como SCREEN, e o relatório diz isso.** O ledger guarda hash exato +
   assinatura MinHash de 128 permutações (`nearDuplicateFingerprint`, novo em
   `near-duplicates.ts`), porque guardar os shingles de 5 tokens seria guardar o documento
   num artefato que sobrevive ao corpus. Logo o que é medido é "hash exato OU Jaccard
   ESTIMADO ≥ 0,82", com erro padrão ≈ 0,034 no limiar — não "Jaccard ≥ 0,82". O passo de
   confirmação exata de `clusterNearDuplicates` continua sendo da poda, que tem os textos.
4. **Rotação é biblioteca, não CLI.** O conjunto de ações da CLI é fechado exatamente como
   escrito acima, e não inclui `rotate`; `rotateClusterExposureKey` é função exportada.
5. **Atomicidade, dita com honestidade no Windows.** `rename` do Node é `MoveFileExW` com
   `MOVEFILE_REPLACE_EXISTING`: atômico em relação a um leitor no mesmo volume, e **não** uma
   barreira de durabilidade — o Windows não expõe fsync de diretório. O que cobre esse
   resíduo é o backup autenticado tomado ANTES do rename e o `verify`, que recusa cadeia que
   não fecha. "Juntos ou nenhum dos dois" é implementado como transação com callback: o
   ledger novo é escrito e fsyncado num temporário, o `finalizeSplit` do chamador roda, e só
   então o rename publica o ledger; falha do chamador descarta o temporário.
6. **A auditoria falha em `unknown` e NÃO em `notApplicable`, divergindo de
   `assertDeclaredAxesResolved`.** A função de C1 recusa os dois (o `notApplicable`
   contradiz a declaração da fonte). O critério deste brief é explícito ao pedir só
   `unknown`, e as duas direções estão testadas. A regra mais estrita continua sendo do
   caminho de ingestão, onde a pergunta é se a linha entra no corpus; a da auditoria é se as
   partições merecem confiança, e um eixo legitimamente inaplicável não as compromete.
   `assertDeclaredAxesResolved` segue **não ligada**.
7. **`humanSeed` passou a colar a geração à sua semente** (`connectedComponentRoots` em
   `split.ts`). Medido: antes disso a linhagem mais comum da v3 — texto humano numa
   partição, a geração que ele semeou noutra — ficava colada por **nada**, porque a receita
   `original` deixa `derivationRoot` legitimamente `notApplicable` e as duas linhas não
   compartilham nenhum valor de eixo. O teste "glues the generation to its human seed"
   falhava com `connectedComponent` ausente das leakages e passa agora. Pai **ausente** dos
   registros continua ignorado de propósito (C2 mediu 782 de 783 referências sem
   co-presença): recusar linhagem não resolvida é questão de SELEÇÃO, de
   `assertDerivedParentsResolve` no caminho de corpus inteiro, não de conectividade. É a
   invariante 4 de E2 imposta onde a conectividade é definida.
8. **Escopo que cresceu, e por quê.** `commands/split.ts` passou a passar as declarações
   reais (de `V3_HUMAN_SOURCE_INVENTORY`, constante versionada — não do manifesto privado),
   então `benchmark/source-manifest.ts` entrou em `EVALUATOR_FILES` junto com
   `cluster-exposure-ledger.ts` e `commands/cluster-ledger.ts` (R1). `corpus-import.ts`
   passou a consumir `NEAR_DUPLICATE_V1_OPTIONS` em vez de manter uma segunda cópia literal
   dos parâmetros congelados. `SplitAudit` ganhou dois campos **obrigatórios**
   (`clusters`, `declaredAxisGaps`); opcionais deixariam a tautologia sobreviver. O campo de
   contagem se chama `recordLines` e não `records` porque `records` é chave **proibida** no
   sanitizador de evidência — e a auditoria é publicada.

##### Rodada de correção (revisão de 2026-07-28)

9. **A linhagem tem domínio de MAC próprio, porque a comparação por eixo era cega de um
   lado.** DEFEITO MEDIDO na primeira entrega: `buildIndex` alimentava o índice apenas com
   `record.groupDigests[eixo]`, e a comparação era digest-de-eixo contra digest-do-MESMO-eixo.
   Como `humanSeed` e `derivationRoot` carregam o **id de outra linha**, a metade
   semente→geração da linhagem não casava com nada: humano exposto em `dev`, e a geração que
   ele semeou entrava em `test` com `eligible: true` e zero recusas. Só a metade
   geração→geração (duas gerações com a mesma semente) funcionava. É a mesma cegueira que o
   item 7 acabara de consertar em `connectedComponentRoots`, entrando pela porta do ledger.
   Conserto: `LINEAGE_AXES` (`humanSeed`, `derivationRoot`) e o **id da própria linha** são
   MACados sob **um** domínio (`lineage`) em vez do nome do eixo, e cada registro do evento
   grava `lineageDigests` — o digest que um filho apresentaria ao nomear aquela linha. Assim
   as duas pontas da aresta caem na mesma consulta: pai exposto → filho recusado, filho
   exposto → pai recusado. Quatro testes novos, incluindo o par negativo (semente ausente do
   histórico não recusa nada). A separação de domínio dos eixos de valor é preservada:
   `author` e `source` continuam misturando o próprio nome do eixo.
10. **`connectivityAxis` deriva de `CONNECTIVITY_AXES`, não de `GROUP_KEYS`** — e este
    conserto estava **errado**, corrigido em definitivo no item 14. O item 7 fez o splitter
    unir por `humanSeed` como ligação de pai, mas `humanSeed` não está em `GROUP_KEYS` (não é
    eixo de valor), então a auditoria **publicada** afirmava `connectivityAxis: false` para um
    eixo que o splitter passou a seguir. A troca de `false` por `true`, porém, passou a
    afirmar coisa FALSA no sentido perigoso: ligação de pai só une quando a linha nomeada está
    presente, e C2 mediu 782 de 783 referências sem co-presença. `split.ts` exporta
    `PARENT_LINKAGE_AXES` (consumida pelo próprio `connectedComponentRoots`, para o par ser
    dito uma vez) e `CONNECTIVITY_AXES` = a união dos dois, **sem repetição** (ver item 15).
11. **O acoplamento C2↔C3 é testado rodando os dois lados, não conferindo forma.** A primeira
    entrega provou só a FORMA do pseudônimo (`<propósito>_<16 hex>`), o que não vê a falha que
    importa: `initClusterLedger` reescreve o arquivo que `pseudonymize.py` lê, e se os dois
    lados divergirem as duas suítes seguem verdes enquanto todo pseudônimo de pessoa muda e o
    ledger responde "nunca exposto" para quem já foi exposto. O teste agora roda Python por
    subprocesso contra o keyring que `init` acabou de escrever, indexa o pseudônimo devolvido
    e oferece a mesma conta a `test` sob id e tupla novos. Provado não-vacuoso por mutação:
    fazer `init` normalizar `keyringVersion` e re-mintar `secrets.person` reprova; apertar o
    loader Python para recusar campo desconhecido também reprova. Onde não há interpretador o
    teste é `skip` com aviso em `console.warn` — a máquina do operador tem Python, porque os
    extratores são Python, e é lá que a propriedade tem de valer.
12. **`reserveManifestDigest` e a tupla são validados como sha256.** Eram "string ou null" num
    módulo cuja premissa declarada é falhar fechado em todo campo. Aquele digest é o **único**
    traço que a reserva cega deixa no ledger: string vazia ou caminho de arquivo entraria num
    evento append-only, seguiria passando no `verify`, e a inutilidade apareceria exatamente
    quando a segunda tentativa de holdout precisasse provar de qual reserva veio. Agora
    `/^[0-9a-f]{64}$/` no caminho da CLI **e** no da biblioteca (`buildEvent`), porque E2
    chama a biblioteca direto.
13. **BLOQUEADOR PARA E2, fora do escopo de C3:** `benchmark/prediction-shards.ts:100` usa
    parameter property (`constructor(private readonly options: …)`), que o modo strip-only do
    Node recusa. Logo `node benchmark/cli.ts` — isto é, `npm run benchmark` — falha no import,
    antes de ler argumento, em **todo** subcomando; `npm run benchmark -- cluster-ledger
    commit-split …` morre ali. A linha é anterior a C3 (existe em `ef3c92b~1`) e o arquivo
    está em `EVALUATOR_FILES` e é entrega de outra tarefa, então C3 não a tocou e substituiu a
    verificação por testes que dirigem `runCli`. **E2 não começa antes de mover a atribuição
    para o corpo do construtor**, com um teste que execute `node benchmark/cli.ts --help` como
    processo real e afirme que `cluster-ledger` aparece no usage.

##### Segunda rodada de correção (revisão de 2026-07-28, mesma noite)

14. **Conectividade são DUAS relações, e um booleano sobre as duas publicava independência
    falsa.** DEFEITO MEDIDO: duas linhas de IA schema-válidas com `humanSeed: known("h_absent")`
    e `h_absent` ausente do corpus, split `development=[g_1]`, `test=[g_2]`. A auditoria
    publicava para o eixo `humanSeed` `{connectivityAxis: true, overall: {groups: 1,
    largest: 2, singletons: 0, recordLines: 2}}` e `leakages: []`, enquanto
    `connectedComponentRoots` devolvia dois componentes — ou seja, "um bloco indivisível de
    duas linhas num eixo em que o splitter une, sem leakage" sobre duas linhas em lados
    opostos do corte de teste. `GROUP_KEYS` significa "duas linhas com o mesmo VALOR são
    unidas"; `PARENT_LINKAGE_AXES` significa algo mais fraco, "une se `ids.has(pai)`".
    `derivationRoot` está nas duas listas, então `true` estava certo para ele; `humanSeed` é
    só ligação. O `false` anterior era impreciso no sentido conservador; o `true` era errado
    no sentido perigoso. Conserto: `split.ts` exporta `axisConnectivity(eixo)` →
    `{sharedValue, parentLinkage}` (a ÚNICA derivação; a auditoria e o `standInClusterReport`
    leem dela), `AxisClusterReport.connectivityAxis` foi **substituído** por
    `connectivity: {sharedValue, parentLinkage}`, e cada eixo de ligação passa a publicar
    `linkage: {references, joinedAnotherRecordLine, selfReference, absentFromRecordSet}` —
    a resolução MEDIDA das referências, pelo mesmo predicado que o splitter aplica, para que
    ninguém tenha de adivinhar quanto vale `parentLinkage: true` no corpus que tem na frente.
    O docstring de `leakages` passa a dizer o que a lista **não** cobre.
    **QUESTÃO ABERTA, DE E2/E3 E NÃO DE C3:** se `humanSeed` deve virar eixo de VALOR em
    `GROUP_KEYS` — duas gerações crescidas do mesmo prompt humano são dependentes, tenha a
    linha-semente sido montada ou não. C3 mede a oferta e deixa a decisão escrita aqui.
15. **`CONNECTIVITY_AXES` listava `derivationRoot` duas vezes** (está em `GROUP_KEYS` e em
    `PARENT_LINKAGE_AXES`; medido: `.filter(a => a === "derivationRoot").length === 2`).
    Inofensivo para `.includes()`, errado para quem contar ou serializar a lista exportada.
    Deduplicado na construção, com teste que reprova a concatenação (medido: 10 ≠ 9).
16. **O id do registro-linha tem checagem própria.** Reusar `assertLedgerIdentity` produzia
    `groups.id identity … is not a pseudonym token` — campo que registro nenhum tem — e
    importava um teto de 128 caracteres que o schema **não** impõe (`PSEUDONYM` é sem teto),
    de modo que um corpus schema-válido com id longo abortaria o congelamento de E2. Agora
    `assertLedgerRecordId` usa o alfabeto do próprio schema, sem teto, e roda **antes** de
    todo diagnóstico que cita o id. O teto de 128 dos eixos de grupo ficou nesta rodada, como
    limite que ESTE módulo escolheu — **e isso estava errado: o item 19 o removeu.** Meia
    correção não resolve, porque o mesmo id longo chega ao módulo por três campos.
17. **Formatação: o registro anterior estava errado.** A entrega anterior disse que a reprovação
    do prettier era inteiramente pré-existente; ela também **acrescentou** linhas que o
    prettier reflui (por exemplo `groupDigests[axis] = identityDigests(keyring,
    macDomainOf(axis), identity);`). Os quatro arquivos de C3 foram formatados nesta rodada e
    `prettier --check` passa nos seis arquivos tocados. O diff commitado é só de conteúdo:
    `core.autocrlf=true` faz o Git normalizar CRLF→LF, o que foi verificado rodando
    `prettier --write` num arquivo sem defeito real de formatação e conferindo `git diff` vazio.
    O resto do repositório continua com **12** arquivos reprovados, de outras tarefas
    (`npx prettier --check "benchmark/**/*.ts"` nesta checkout, em 9c2acea: `commands/split.ts`,
    `corpus-source-audit.ts`, `lab/build_governance.ts`, `near-duplicates.ts`, `tests/cli.test.ts`,
    `tests/consume-holdout.test.ts`, `tests/corpus-import.test.ts`, `tests/corpus-source-audit.test.ts`,
    `tests/fit.test.ts`, `tests/report.test.ts`, `tests/schema-v3.test.ts`,
    `tests/source-manifest.test.ts`). **A contagem depende da checkout e não deve ser tratada
    como estável:** com `core.autocrlf=true` o checkout escreve CRLF e o `endOfLine: lf` padrão
    do prettier reprova arquivos sem nenhuma violação de conteúdo — medido, `corpus-source-audit.ts`,
    `near-duplicates.ts` e `tests/schema-v3.test.ts` têm delta ZERO quando normalizados para LF.
18. **Cobertura de chave é por NOME, e isso está escrito onde o leitor está.**
    `assertLedgerConsistent` compara `keyVersion`; nada liga um segredo à história que ele
    produziu. Substituir o keyring por um segredo novo ainda chamado `v1` faz `verify` passar,
    todo HMAC ser recomputado sob o segredo novo e o ledger inteiro responder "nunca exposto" —
    a falha de verificação-vazia-em-silêncio que o módulo existe para evitar. Não é conserto
    de C3 (a lista de campos do evento é fechada e versionada): **E2 decide antes do
    congelamento** se o evento passa a carregar testemunha ligada à chave (por exemplo um MAC
    sobre `eventDigest` sob cada chave ativa) e sobe `schemaVersion` no mesmo movimento.

##### Terceira rodada de correção (revisão de 2026-07-28)

19. **O teto de 128 caracteres FOI REMOVIDO: há UMA regra de forma, e é a do schema.** O item
    16 destetou o id e **manteve** o teto nos eixos de grupo. Isso não conserta o defeito, ele
    o move: as duas pontas de uma aresta de linhagem são **a mesma string no mesmo domínio de
    MAC** (`LINEAGE_MAC_DOMAIN`) — o `id` do pai e o `groups.derivationRoot` do filho — então
    duas regras não podem estar certas nas duas direções. **Medido** em 9c2acea: um pai com
    `id = "r"×200` era ACEITO (evento com 1 registro) e o filho que o nomeava era RECUSADO com
    `CLUSTER_LEDGER_IDENTITY_INVALID`, um registro depois, por um valor que este mesmo módulo
    havia acabado de aceitar. Pior: capar "só os eixos de valor" também não bastaria, porque
    `assemble_corpus.near_duplicate_axis` escreve **o próprio id da linha** em
    `groups.nearDuplicate` (é o que o docstring de C2 diz: "THE ROW'S OWN ID"), de modo que um
    id longo chega ao módulo por **três** campos. E a justificativa do teto não se sustentava:
    identidade **não é persistida** — só o HMAC de 64 hex é — logo não existia estado
    ilimitado a defender, e um limite que o schema não tem só serve para reprovar corpus que o
    schema aceita. Agora `IDENTITY_SHAPE = /^[A-Za-z0-9_-]+$/` (o alfabeto do schema, sem
    teto) é usada por `assertLedgerRecordId` **e** por `assertLedgerIdentity`; a separação
    entre as duas funções sobrevive só para o diagnóstico dizer `id` em vez de `groups.id`. O
    que continua falhando fechado é FORMA que o módulo não consegue MACar coerentemente
    (caractere fora do alfabeto) e identificador cru em eixo de pessoa — propriedades do
    valor, não do comprimento. Teste novo indexa **as duas pontas da mesma aresta**
    ("holds both ends of one edge to one rule, however long the parent id is"): pai com id de
    200 caracteres, `nearDuplicate` igual ao id, e o filho que o nomeia em `derivationRoot` —
    afirmando que ambos são aceitos **e** que a aresta continua sendo pega
    (`cluster-exposed-previously`), para as duas checagens não poderem divergir de novo. O
    teste do id passou a construir o registro **em volta** do id longo (`record({ id: long })`),
    porque a versão anterior escapava do teto só por manter `nearDuplicate` curto.
20. **O tipo da conectividade mora junto da função que a deriva.** `axisConnectivity`
    devolvia um objeto anônimo inline em `split.ts` e `split-audit.ts` **restatava** a forma
    numa interface própria. Como a auditoria atribui uma variável (não um literal fresco), a
    checagem de propriedade excedente não se aplica: acrescentar uma terceira relação em
    `axisConnectivity` colocaria a flag nova no artefato publicado e selado por `splitDigest`
    em tempo de execução, enquanto o TIPO que o consumidor lê continuaria descrevendo duas — com
    typecheck verde. Agora `AxisConnectivity` é declarada e exportada em `split.ts`, anota o
    retorno da função, e `split-audit.ts` **re-exporta** (`export type { AxisConnectivity }`).
    Provado por mutação: acrescentar `thirdRelation: boolean` à interface reprova em dois
    lugares (`split.ts:248` e o helper do teste em `split-audit.test.ts:598`), onde antes
    reprovava em zero.
21. **`linkage` ficou atrás do próprio discriminante.** Era campo irmão tipado
    `LinkageResolution | null` cujo discriminante (`connectivity.parentLinkage`) morava um
    campo ao lado, e o TypeScript não estreita entre dois campos: quem checava a flag não
    ganhava estreitamento e quem esquecia usava `!` (o próprio teste desta tarefa usava três
    vezes). Agora `AxisConnectivityReport` é união discriminada — `parentLinkage: false` com
    `linkage: null`, ou `parentLinkage: true` com `linkage: LinkageResolution` — e as duas
    pernas espalham `Omit<AxisConnectivity, "parentLinkage">`, então uma terceira relação
    também aparece aqui. `null` foi mantido na perna falsa (em vez de campo ausente) porque o
    objeto é serializado no artefato selado, e ali "medido, e a pergunta não se aplica" e
    "escritor antigo que nunca mediu" precisam ser distinguíveis. `connectivityReport()` é o
    único construtor, com o cálculo passado como thunk para o eixo que não é de ligação não
    pagar por um número que sai `null`. Os três `linkage!` do teste sumiram: um helper
    `linkageOf()` estreita pela flag e compila **sem** cast — o que só é possível porque o
    discriminante agora é literal em cada perna.
22. **`CONNECTIVITY_AXES` não tem consumidor de produção, e o JSDoc diz isso.** Depois do item
    14 a auditoria passou a ler `axisConnectivity` e parou de importar a lista; medido por grep
    em `benchmark/`, `src/` e `contracts/`, restam a definição e as asserções do próprio
    `split.test.ts`. O texto que justificava a deduplicação por "um consumidor que conta ou
    serializa" foi corrigido: a dedup protege o PRIMEIRO consumidor, não um que exista hoje. A
    exportação fica porque é o único lugar que responde "quais eixos o splitter olha", que é o
    que D0b precisa ao escolher eixo de poder.

##### Quarta rodada de correção (revisão cruzada de 2026-07-29)

23. **O ledger falhava ABERTO pelo caminho do arquivo, e agora o keyring atesta a altura.**
    DEFEITO MEDIDO, reproduzido e não deduzido: `readClusterLedger` tratava `ENOENT` como
    ledger vazio, então com **o mesmo keyring** — apontar `--ledger` para um caminho novo,
    truncar o arquivo a zero bytes, ou apagar só a **última linha** — `preflight`,
    `record-pilot` e `commit-split` devolviam `eligible: true, refusals: []` para o cluster
    e o registro-linha que um `test` consumido já havia queimado, e `verify` passava **verde**
    por cima. O requisito 6 desta tarefa ("criar diretório ou ledger novo não reinicia
    elegibilidade") estava imposto **só** em `init` — a única ação que um operador com
    `--ledger` errado nunca roda. O teste que levava o nome do requisito só chamava
    `initClusterLedger`: requisito com teste de nome, não de conteúdo.
    A cadeia de `eventDigest` não podia cobrir isso: remover a **cauda** deixa um prefixo cujo
    `previousEventDigest` continua fechando, e um arquivo JSONL não afirma nada sobre o próprio
    comprimento. Conserto: o keyring — o artefato que `init` já recusa sobrescrever e que
    `restore` já exige — passa a carregar `ledgerWitness = {eventCount, lastEventDigest,
    updatedAt}`, e `assertLedgerConsistent` compara ledger contra testemunha em **todo**
    caminho que decide elegibilidade (`preflight`, `record-pilot`, `commit-split`, `verify`,
    `backup`, rotação). Códigos próprios: `CLUSTER_LEDGER_HISTORY_ABSENT` (arquivo ausente com
    altura atestada > 0), `CLUSTER_LEDGER_HISTORY_DIVERGED` (altura ou digest de cauda
    diferentes, nas duas direções) e `CLUSTER_LEDGER_WITNESS_ABSENT` (keyring com chave e sem
    atestado — nunca lido como zero). Ledger legitimamente novo continua aceito, porque
    `init` atesta altura zero.
    **A testemunha é escrita DENTRO da transação** e **antes** de publicar o ledger: assim o
    único resíduo que uma queda entre os dois renames pode deixar é "atestado N+1, ledger em
    N", que é a direção que **recusa**; o reparo é renomear o temporário já fsyncado, que o
    `verify` reporta como escrita interrompida. A ordem inversa deixaria exposição gravada que
    ninguém atesta, e o reparo seria editar à mão o arquivo que guarda `secrets.person`.
    O keyring é reescrito a partir dos **próprios bytes** (`reattestKeyringText`), não
    re-serializado a partir da forma parseada, porque o arquivo é de C2 também — o keyring do
    operador carrega um `_note` que uma re-serialização apagaria, e `secrets.person` não pode
    ser rotacionado sem re-extrair o corpus. Um teste roda o loader Python real contra o
    keyring depois de um evento e afirma que nenhum pseudônimo de pessoa muda.
    O que a testemunha **não** faz (R7): ela liga altura e digest de cauda, **não** o material
    secreto — o item 18 (segredo novo com o mesmo nome `v1`) segue exatamente como estava, e
    continua sendo decisão de E2 antes do congelamento.
    **Consequência para `restore`, medida:** o backup que uma mutação tira é tirado ANTES dela,
    logo carrega ledger **e** keyring na altura N enquanto o estado commitado é N+1. Restaurar
    esse par sobre um ledger perdido **passava** e rolava a história um evento para trás em
    silêncio — medido em `7b7fcbd` numa fixture temporária: com o estado commitado na altura 2,
    `restore` do backup pré-mutação devolveu `{ledger: "written", keyring: "identical"}` e
    deixou o ledger na altura 1. Agora o keyring em disco atesta N+1, o par divergiu, e é
    recusado. O par restaurável do estado atual é o que se tira **depois** da mutação (verificado:
    restaura sobre ledger ausente) — e o **item 28** passou a tirá-lo dentro da própria transação,
    em vez de deixar isso como rotina que E2 e H1 têm de lembrar.
24. **Duas limitações de `restore` reproduzidas, e NÃO consertadas nesta rodada.** A revisão as
    reportou sem confirmação; foram reproduzidas em fixture temporária, **as duas em `7b7fcbd`
    também** (isto é, são anteriores ao item 23 e não consequência dele), e ficam registradas
    porque são do mesmo modelo de confiança entre keyring e ledger:
    (a) **keyring ausente nunca pode ser restaurado.** `restoreClusterLedger` chama
    `requireKeyring` **antes** de autenticar o manifesto, e o MAC do manifesto só pode ser
    verificado com uma chave do keyring. Logo o backup autenticado não recupera o único
    artefato cuja perda é irrecuperável: com o keyring apagado, `restore` falha com
    `CLUSTER_LEDGER_KEYRING_ABSENT` mesmo tendo o keyring dentro do diretório de backup.
    Consertar isso é decidir se o backup pode se autenticar com o keyring que ele mesmo carrega
    (o que prova consistência interna, não procedência) — uma mudança de modelo de confiança,
    não um conserto local.
    (b) **depois de uma rotação, todo backup anterior fica irrestaurável.** O keyring em disco
    passa a ter `v1+v2` e o do backup só `v1`: o MAC ainda autentica (a chave que assinou
    continua presente), mas a divergência é julgada sobre os **dois** arquivos em conjunto, e o
    keyring diverge. Mesmo diagnóstico de (a) na prática: o par só é restaurável enquanto
    nenhum dos dois arquivos mudou.
    **Nenhuma das duas bloqueia E2**, desde que o `backup` posterior à mutação seja rotina.
    Decisão de qual das duas atacar, e como, é de E2 — junto com o item 18, que é da mesma
    família.
25. **A alegação do cabeçalho de `source-manifest.ts` era falsa desde `b4cf566`.** O módulo
    dizia "this module is **NOT** in `EVALUATOR_FILES` … editing them does not move
    `integrity.evaluator-digest`" enquanto o item 8 desta mesma tarefa o havia **colocado**
    lá — verificável por `git log 88f3ca8..9e50ab6 -- benchmark/source-manifest.ts` voltar
    vazio. Era R7 na forma mais direta, no arquivo que C3 acabou de tornar load-bearing para o
    gate de eixo declarado, e dizia ao próximo editor exatamente a crença cuja consequência é
    queimar a concessão do holdout (R1). Cabeçalho reescrito com a consequência real (reprova
    `integrity.evaluator-digest` se editado depois do `fit`; a janela que fecha é G5), e a
    afirmação agora tem teste: "says in its header that it IS part of the evaluator identity"
    fixa a pertinência a `EVALUATOR_FILES`, exige a frase afirmativa e proíbe a negação —
    medido vermelho antes do conserto. O limite está escrito no teste: negação reescrita com
    outras palavras passaria. Isso **fecha** a pergunta aberta de B1 ("C1 precisa decidir se
    `source-manifest.ts` entra na identidade do avaliador"), agora anotada lá.
26. **Para C4, sobre a assimetria das duas noções de cluster (item 14):** o `clusterAssignments`
    que C4 e C6 importam delega a `connectedComponentRoots`, isto é, à noção **mais fraca** —
    ligação de pai só une quando a linha nomeada está montada, e C2 mediu **782 de 783**
    referências de pai sem co-presença. O ledger de exposição usa a noção **mais forte** para
    `humanSeed`/`derivationRoot`: eixo de VALOR num domínio de MAC de linhagem, em que duas
    linhas que nomeiam a mesma semente ausente colidem de propósito. Consequência prática para
    C4: um cluster devolvido por `clusterAssignments` pode ser **menor** que o cluster de
    exposição, e nas caudas de linhagem quase sempre é. `clusterAssignments` **não** é a
    unidade de reamostragem (glossário) — a escolha é por estimando, e onde a unidade escolhida
    depende de linhagem C4 tem de decidir explicitamente qual das duas noções usa e registrar a
    escolha, em vez de herdar a mais fraca por ser a que já vem pronta. A revisão de C3 não
    classificou a assimetria como defeito e ela **não** deve ser "consertada" aqui.

##### Quinta rodada de correção (revisão de qualidade do item 23)

27. **A metade DIGEST da comparação de testemunha não tinha teste — o mesmo defeito do item 23
    um nível abaixo.** MEDIDO por mutação: apagando `lastEventDigest !== witness.lastEventDigest`
    de `assertAttestedHistory`, os 44 testes do arquivo continuavam **verdes**. Os testes de
    cauda entregues só **removiam** a última linha, e remoção de linha muda a altura — logo a
    comparação de altura sozinha já os satisfazia, e nada exercitava o digest. Era "requisito com
    teste de nome" outra vez, agora dentro do conserto que existia para eliminá-lo.
    O estado que passava: reescrever a última linha **no lugar** (`records: []`) e recomputar o
    seu próprio `eventDigest` — a altura continua 2, todo `previousEventDigest` continua
    fechando, `readClusterLedger` aceita, e o cluster que o `test` queimou volta a ser elegível.
    Dois testes novos: "refuses a tail REWRITTEN in place, at the very height the keyring
    attests" (os três caminhos de elegibilidade mais `verify` recusam com
    `CLUSTER_LEDGER_HISTORY_DIVERGED`) e o seu guarda, "hands the burned cluster back once the
    rewritten tail is itself attested", que re-atesta o keyring para a cauda reescrita e mede
    `eligible: true, refusals: []` — provando que a recusa do primeiro vem da comparação de
    digest e não de uma re-oferta que já era recusável. Com a mutação aplicada o primeiro fica
    **vermelho** com `promise resolved "{ eligible: true, refusals: [] }" instead of rejecting`.
    A metade ALTURA continua sem teste próprio e isso é aceito: ela é implicada pela metade
    digest (toda perda de altura muda a cauda), logo é defesa em profundidade, não lacuna.
28. **O item 23 deixava o estado commitado sem ponto de restauração, e agora a transação tira
    backup dos DOIS lados.** MEDIDO: `init` → `commitSplitFreeze` (uma linha de `test`) → apagar
    o ledger → `restore` contra o único backup em disco
    (`2026-07-28T10-00-00.000Z-e3b0c442`) falhava com `CLUSTER_LEDGER_RESTORE_DIVERGENT`. O
    `writeBackup` roda **antes** de publicar o evento, logo o par guardado está na altura N
    enquanto o commitado está em N+1 — e com a altura atestada no keyring, restaurar esse par é
    (corretamente) recusado. Antes do item 23 esse `restore` **passava**, rolando a história um
    evento para trás em silêncio; recusar é a direção certa, mas o efeito líquido era: logo
    depois do `commit-split` real (E2) ou do `holdout-consumed` (H1) **não existia backup
    restaurável nenhum**, e o passo compensatório ("rode `backup` depois") vivia só num docstring
    e nos itens 23-24. Isso é o mesmo defeito do item 23 — invariante que depende de o operador
    lembrar.
    Conserto: `appendEvent` tira um **segundo** `writeBackup` **depois** do `rename` do ledger,
    dentro da mesma transação. O nome do diretório já carrega o digest do ledger, então não
    colide com o do backup pré-mutação. As duas funções públicas passam a devolver
    `ClusterExposureCommit = {event, restorePoint}` e a CLI imprime `Restore this state from
    <dir>` em `record-pilot` e `commit-split`, para o ponto de restauração chegar ao operador no
    momento em que ele existe. Se esse backup falhar **depois** do evento publicado, o erro é
    `CLUSTER_LEDGER_COMMITTED_UNBACKED` e a mensagem diz que a exposição **está gravada** e que
    re-rodar o comando será recusado — um erro de filesystem cru faria o operador concluir que o
    split não foi congelado.
    O que continua **não** coberto (e é o resíduo do item 24): nenhum dos dois backups restaura
    sobre uma mutação **meio escrita**, cujos dois arquivos discordam; esse estado é recusado,
    nomeado, e reparado à mão. O cabeçalho do módulo foi corrigido: ele afirmava que o resíduo de
    queda estava "coberto pelo backup autenticado tirado ANTES do rename", o que deixou de ser
    verdade — o keyring em disco diverge do keyring do backup.
29. **Quatro correções menores do item 23, três delas de honestidade (R7).**
    (a) O comentário de ORDEM em `appendEvent` afirmava que "o único resíduo que uma queda entre
    as duas escritas pode deixar é atestado N+1, ledger em N — a direção que RECUSA". O cabeçalho
    do próprio módulo diz que o Windows não expõe fsync de diretório e que uma queda logo após um
    rename pode perder a atualização da entrada de diretório; nenhum dos dois renames tem
    barreira, logo o resíduo inverso ("atestado N, ledger N+1") é igualmente possível. Nada falha
    aberto — o inverso cai no ramo de eventos excedentes de `CLUSTER_LEDGER_HISTORY_DIVERGED` —
    mas a garantia estava mais forte do que o filesystem dá, no módulo que argumenta R7.
    Reescrito: a ordem **prefere** o resíduo reparável, os dois são recusados, e só o primeiro tem
    reparo (renomear o `.tmp`), que não é subcomando porque o conjunto de ações é congelado.
    (b) A mensagem de `HISTORY_DIVERGED` tinha só dois ramos (`<` e o resto), então o caso de
    **altura igual e cauda diferente** — precisamente o do item 27 — recebia o texto "o ledger
    tem eventos que o keyring nunca atestou", que é falso ali. Terceiro ramo escrito, com teste
    que exige a frase.
    (c) `parseWitness` validava a cauda por coerção (`SHA256_HEX.test(String(x))`), então
    `"lastEventDigest": ["<64 hex>"]` passava e era **castado** a `string`; falhava fechado a
    jusante, mas o diagnóstico culpava o LEDGER por um atestado malformado. Agora testa o tipo, e
    o caso entrou na lista de testemunhas inválidas (medido vermelho: aceitava e devolvia
    `HISTORY_DIVERGED`). O helper `invalid` ganhou anotação `(why: string) => never`, o que faz o
    TypeScript estreitar cada campo depois da sua checagem e elimina os três casts do fim da
    função; e `assertLedgerConsistent` passou a devolver a testemunha que validou, então
    `verifyClusterLedger` não castra mais `keyring.ledgerWitness`.
    (d) `strayTempFiles` filtrava só pelo nome do ledger, e a transação agora escreve o keyring
    também: um `cluster-exposure-keyring.v1.json.<pid>.<n>.tmp` — cópia integral de
    `secrets.person` e de toda chave de exposição — não era limpo nem reportado, e `verify` ainda
    dizia "0 interrupted write(s)". Agora varre os dois nomes, e `atomicWrite`/`writeTemp` apagam
    o próprio temporário quando a publicação falha. Medido vermelho: `expected [] to deeply equal
    [Array(1)]`.

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

#### O que foi entregue (2026-07-28) e onde divergiu do escrito

**A forma dos dados.** `review` é uma união discriminada de duas pernas no schema v3
(`benchmark/schema.ts`), e `annotation` **não existe mais** na v3. `provenance.piiAudit`
também saiu: o fato de PII é um ato de revisão, e o bloco antigo tinha tipo literal
(`status` só podia ser `passed`, `method` só podia nomear as duas etapas), então "não
auditado" era **inexprimível** — que é a razão pela qual 10.000 registros afirmaram uma
auditoria inexistente. A v2 ficou byte-a-byte intacta, porque o corpus selado em disco é
v2 e um corpus que nada lê não pode ser auditado.

- `automated/unreviewed` — estado **nomeado** (não campo ausente), com os filtros
  automáticos que rodaram (`automatedFilters`, vocabulário fechado) e o motivo de não ter
  havido auditoria humana. As chaves de recibo são recusadas nessa perna com frase
  própria, antes da checagem de objeto fechado, porque "campo desconhecido
  review.agreement" se lê como erro de digitação e o erro é um estado alegando conclusão.
- `human-reviewed` — recibo: revisores **declarados** (≥2, distintos), uma **decisão
  individual por revisor declarado**, `agreement` `agree`/`disagree`, `adjudication`
  (adjudicador independente, com `rationale`, e nunca anterior à última decisão que
  resolve), `pii` (protocolo + etapa automática nomeada + revisor humano pseudonimizado +
  instante real + tratamento + achado), `exclusionCode` por decisão de exclusão, e
  `blindToScore`/`blindToCandidateClass` por revisor **e pela adjudicação**
  (requisito 7 / D1).

**Cegueira da adjudicação — corrigido na rodada de qualidade.** `ReviewAdjudication`
carregava só `blindToScore`, e `reviewClaimSupport` dobrava o adjudicador no eixo do escore
mas **não** no eixo da classe (lia `decisions` apenas). O voto contra o qual o registro é
julgado é `adjudication?.decision ?? decisions[0].decision`, isto é, em todo desacordo é o
do adjudicador — então um adjudicador a quem se mostrou a classe candidata antes de decidir
**sustentava** a alegação de revisão, e o recibo não conseguia nem declarar que isso
aconteceu (`unknown field review.adjudication.blindToCandidateClass`, medido). A assimetria
corria na direção que esconde falha de governança, no único voto que decide. Agora o campo é
obrigatório nos dois blocos e os dois eixos dobram o adjudicador de forma simétrica. Três
testes (campo ausente é recusado; adjudicador não cego à classe → `reviewer-saw-candidate-class`;
cego nos dois eixos → `sustains: true`, asserido contra as duas flags do próprio fixture) e
a mutação "voltar a ler só `decisions`" mata o do meio.

**O downgrade da v2 é o mecanismo, não a prosa.** `reviewOf(record)` é o acessador
versão-ciente; para a v2 devolve um `automated/unreviewed` congelado cujo motivo diz por
quê, e **derruba o `agreement`** em vez de carregá-lo. §7 ("Descarte") pedia descartar
`annotation`/`piiAudit`: para um corpus já em disco, descartar é exatamente isto.

**O gate.** `sealDataset` recusa um corpus **de release** em que algum registro não
sustenta alegação de revisão (`DATASET_REVIEW_INVALID`, com a contagem e a razão por
registro). Isso **reprova** o corpus selado em disco (v2, `scientificUse: "release"`), que
é o resultado certo. Um selo `infrastructure-only` continua passando: `automated/unreviewed`
é honesto, existe no corpus e **não conta** para gate que exija revisão (R6/D5). Nenhum
limite foi afrouxado (R3) — a recusa é nova e o insumo que falta é revisão real (D1/D5).
A checagem é a **última** do bloco de release, porque nomeia uma contagem sobre o corpus
inteiro; as recusas que nomeiam **um** registro continuam disparando primeiro.

**Coerência, uma regra por incoerência**, toda com teste em
`benchmark/tests/review-receipt.test.ts` — **45 testes de coerência do recibo**, dos 59 do
arquivo (os outros 14 são do bloco de divergência descrito abaixo; medido por bloco:
4 + 5 + 16 + 4 + 5 + 7 + 4 fora da divergência. A contagem "42" que esta seção trazia
duas rodadas atrás descrevia o arquivo inteiro e ficou velha na mesma rodada em que o
bloco de divergência entrou): número de decisões vs. revisores
declarados (em ambas as direções, mais decisão de revisor não declarado e revisor votando
duas vezes); `agree` sobre decisões divergentes **e** `disagree` sobre decisões idênticas;
desacordo sem adjudicação **e** adjudicação sem desacordo; adjudicador que também votou;
PII sem etapa automática, sem revisor ou com data sintética; data fora da janela (abaixo
do instante do protocolo, no futuro, ou não inteira) e adjudicação anterior às decisões;
exclusão sem código e código sem exclusão; registro cuja revisão concluiu `exclude`.

**Uma regra que o brief não listou, foi adicionada, e teve de ser CORRIGIDA na rodada
seguinte:** a relação entre a conclusão do recibo e o `label`. Ground truth continua vindo
da proveniência — o revisor **corrobora**, não concede — logo um recibo que concluiu `ai`
num registro `human` são duas alegações contraditórias no mesmo registro, e preferir uma
delas em silêncio seria adivinhar. Isso está certo e continua valendo.

O que estava **errado** era a consequência. A primeira versão **lançava** nesse caso, e um
`throw` no validador significa que o registro não existe: um recibo em que dois revisores
cegos concluem `human` numa linha cuja proveniência diz `ai` passava a ser **inexprimível**
— o achado que um revisor mais existe para produzir era o único achado que o schema não
podia guardar. Sobravam ao operador dois caminhos, **editar o label** ou **descartar a
revisão**, e R4 proíbe os dois: o fato é que a revisão discordou. Além disso a regra
pré-decidia, por refutação, uma pergunta de D1/D5 (o que acontece quando revisão humana
contradiz proveniência).

**Forma atual — a divergência é registrável e não sustenta alegação.** O recibo ganhou
`labelDispute` (`benchmark/schema.ts`): `reviewedClass`, `recordLabel`, `state`
(`unresolved`, o único valor escrivível) e `rationale`. Quem recusa continua sendo o
validador, mas o que ele recusa é a divergência **silenciosa**: sem o bloco, a mensagem
manda declarar. Com o bloco, o registro parseia e `reviewClaimSupport` devolve
`{sustains: false, reason: "label-disputed"}` — quarta razão da rejeição discriminada — de
modo que a linha entra no corpus, entra na contagem de `sealDataset` **contra** a alegação
de release, e nunca conta para gate que exija revisão. Fail-closed continua fail-closed: o
que mudou é que ele falha **guardando** o dissenso em vez de apagá-lo.

**Quem resolve.** Não o registro, e por isso `unresolved` é o único estado: o label repousa
em `labelBasis`/`labelEvidenceRef`/`generation`/`mixture`, então resolver é mudar essa
evidência ou retirar a linha — **D1** (evidência de label) e **D5** (protocolo de revisão).
Um valor `resolved` no registro seria veredito sem autor, exatamente a forma do `agreement`
fabricado que C5 removeu.

**Ordem dentro de `reviewClaimSupport`** (é do operador, não estética): cegueira primeiro,
disputa depois. Dissenso levantado por quem viu o escore ou a classe não é disputa a
resolver, é revisão a refazer cega; só depois de cega a contradição com a proveniência é o
fato, e a ação dela não é nenhuma das outras duas.

**ERRATA da rodada de qualidade: essa ordem estava declarada em dois lugares e asseriada em
nenhum.** Medido: mover o bloco de `labelDispute` do fim da função para logo depois do
retorno de `automated/unreviewed` deixava `review-receipt.test.ts` em 54/54 **e**
`benchmark/tests/` em 721/721 — nada no repositório a prendia. O custo do relato errado é
concreto: `reviewer-saw-detector-score` manda refazer a revisão cega, `label-disputed` manda
para D1/D5 re-derivar `labelBasis`/`labelEvidenceRef`/`generation` (ou retirar a linha), e
relatar disputa numa revisão que nunca foi cega compra o ato caro para resolver um dissenso
que ainda não tem direito de existir. Mesma classe de defeito da precedência ND-sobre-NC de
B1. Dois testes novos constroem um recibo que é **ao mesmo tempo** disputado e não-cego (um
por eixo) e asserem a razão de cegueira; a mutação de reordenação mata os dois.

**Por que o bloco não pode inventar conflito:** ele declara os dois lados e cada um é
conferido contra um lado **diferente**, em escopo diferente — `reviewedClass` contra a
conclusão do próprio recibo (a adjudicação, quando há), dentro de
`validateHumanReviewReceipt`, que é o único escopo que tem as decisões; `recordLabel` contra o
`label` da linha, no chamador de nível-registro, que é o único escopo que tem o label — e
`reviewedClass === recordLabel` é recusado com frase própria. São **três** guardas em **dois**
escopos, mais a recusa da divergência silenciosa; a docstring do tipo dizia "os dois são
conferidos contra o registro" e o comentário do validador dizia "as duas conferências do
chamador", e ambos mandavam o leitor à função errada — corrigidos na rodada de qualidade.
Logo o bloco só é escrivível onde a divergência existe de verdade. Quatorze testes no bloco
"a divergence between receipt and label is recorded, not erased"; mutações rodadas: reverter
para o `throw` incondicional mata os dois testes de registro da divergência (3 no total),
remover o preço em `reviewClaimSupport` mata os dois, desligar a guarda de conflito inventado
mata o seu, e reordenar disputa antes de cegueira mata os dois de precedência.

**Por que os dois campos derivados ficam, apesar de serem recomputáveis.** A revisão de
qualidade propôs reduzir o bloco a `{state, rationale}` mais uma guarda, e o argumento é
correto quanto ao fato: `reviewedClass` e `recordLabel` são determinados por `concluded` e
por `label`. Ficam por uma razão que não é "para o bloco se ler sozinho" (não se lê: são as
guardas que o tornam confiável, e elas precisam do registro). Ficam porque um bloco
`{state, rationale}` não carrega **nada específico da linha** e portanto pode ser copiado de
um registro para qualquer outro que também tenha divergência real, sem detecção — que é
exatamente a falha que C5 existe para remover, uma forma de governança repetida em 10.000
linhas. Com as duas classes restatadas, a cópia cai numa linha cujo label ou cuja conclusão
difere e é recusada por nome (os dois testes de cross-check já existentes). O delta são duas
guardas, não três: a alternativa continua precisando da recusa de conflito inventado.

**ERRATA da 4ª rodada de qualidade — o alcance desse argumento, que eu tinha deixado
implícito (R7 pede o contrato medido, não a propriedade).** `(reviewedClass, recordLabel)` é
par ordenado sobre três labels, então o que as duas guardas recusam é a cópia numa linha cuja
**conclusão ou cujo label difere**. Elas **não** tornam o bloco específico da linha: dentro de
um mesmo par o bloco inteiro, `rationale` incluído, é copiável byte a byte por quantas linhas
se queira e nada aqui recusa — 10.000 linhas `ai` revisadas como `human` podem todas carregar
blocos idênticos e todas validam. As próprias fixtures desta entrega são exatamente essa
forma (`labelDispute("human", "ai")` com rationale fixo, estampado por `disputedV3AiRow(n)`
em linhas que diferem só em id e hash), e isso é deliberado. A propriedade forte — uma disputa
que só poderia ter sido escrita para **esta** linha — exige a vinculação por registro ao
digest do log de sessão, campo que o recibo ainda não tem, e é de **D1**; mesmo insumo
faltante que faz toda flag de cegueira ser autodeclarada. Escrito na docstring de
`ReviewLabelDispute`, não só aqui.

**ERRATA da mesma rodada — a mensagem de runtime carregava a justificativa que esta seção
acabara de desautorizar.** A rodada anterior trocou "para o bloco se ler sozinho" pelo
argumento da copiabilidade na docstring, e deixou intacta a frase que o operador de fato lê,
em `benchmark/schema.ts` (recusa de `review.labelDispute.recordLabel`): ela continuava dizendo
"so it can be read on its own". Quem copiasse um bloco para uma linha de label diferente
recebia a recusa certa com o motivo que a entrega tinha argumentado por escrito não ser o
motivo — a mesma classe de obsolescência que a rodada existia para fechar, no lugar de maior
visibilidade. Reescrita para o motivo verdadeiro: o restatement é o que faz uma disputa
copiada de outro registro ser recusada aqui em vez de descrever esta linha em silêncio.
Verificado que nenhum teste e nenhum doc prendiam a frase antiga (grep sem ocorrência).

**Data real, sem inventar relógio.** `REVIEW_RECEIPT_PROTOCOL_FROM` é
`2026-07-26T00:00:00.000Z` — a data deste plano, a mesma que a seed de split `20260726`
codifica. Nenhum recibo pode anteceder o protocolo que alega seguir, e o trabalho concreto
da constante é recusar os três *block times* do corpus (1.000.000/2.000.000/3.000.000 ms,
janeiro de 1970). O teto é `Date.now()`, lido dentro do validador e **não** injetado: um
validador que aceita relógio convida quem chama a passar um que faça a data impossível
passar. Nada aqui verifica que a revisão ocorreu no dia declarado; isso é o digest do log
de sessão, que é de D1.

**Cegueira é precificada, não recusada.** Uma revisão que viu o escore realmente
aconteceu se aconteceu (R4: registre a verdade); o que ela não pode é sustentar alegação.
`reviewClaimSupport` é uma rejeição discriminada, e a docstring dela **enumera a ação contra
o nome da razão em vez de contar razões** — contar foi exatamente o que ficou velho quando a
quarta entrou (o código dizia "three refusals" com quatro razões no tipo logo abaixo):

| razão | ação do operador |
|---|---|
| `automated-filter-only` | ninguém olhou: designar revisores (D1/D5) |
| `reviewer-saw-detector-score` | refazer a revisão cega ao escore |
| `reviewer-saw-candidate-class` | refazer a revisão cega à classe |
| `label-disputed` | nenhuma das acima: re-derivar a evidência do próprio label ou retirar a linha (D1/D5) |

**A mensagem de `DATASET_REVIEW_INVALID` agora anexa a ação à razão presente.** Ela fechava
sempre com a frase do filtro automático, verdadeira de **uma** das quatro razões e impressa
para as quatro: um corpus de release recusado só por `1 label-disputed` recebia diagnóstico
sobre um filtro que não tinha nada a ver com o caso, no único lugar que um operador lê.
`REVIEW_SHORTFALL_ACTION` é um `Record` sobre a união de razões com `satisfies`, então uma
quinta razão é erro de compilação ali. Corrigido também um engano do **meu** relatório
anterior: eu registrei o teste de nível-corpus como bloqueado pela migração do helper
sintético para v3, e isso é falso — `v3ReleaseCorpus` em
`benchmark/tests/dataset-manifest.test.ts` já sela um corpus de release v3 inteiramente
revisado, então o teste custou uma linha disputada. Ele afere os três lados: a contagem
(`1 of 201 … (1 label-disputed), first a_agy_0200`), a ação da disputa presente, e a **ausência**
da frase do filtro automático. Mutação: fixar a ação em `automated-filter-only` mata o teste.

**ERRATA da 4ª rodada de qualidade: eu prendi metade da promessa.** A docstring de
`REVIEW_SHORTFALL_ACTION` enuncia "a ação que responde **cada** razão presente — nunca as
ações das razões ausentes". Só a metade *ausente* estava asseriada (o teste acima afere a
ausência da frase do filtro). A metade *cada* estava presa por nada, medido: trocar
`reasons.map(...)` por `reasons.slice(0, 1).map(...)` **type-checa** (`tsc` exit 0) e deixou
`benchmark/tests/` em 35 arquivos / 727 testes verdes, porque as duas asserções existentes
sobre essa mensagem cobrem corpus com **uma** razão distinta — nem o `map` nem o `sort` sobre
mais de um elemento eram exercidos. O operador recusado por duas razões recebia a ação de
uma, em silêncio. Mesma forma dos três defeitos anteriores desta tarefa: propriedade
documentada, alcançável por nenhuma asserção.

E a renderização estava errada junto: as quatro ações não tinham pontuação terminal e eram
unidas por `" "`, então duas fundiam numa frase corrida. Medido, verbatim, no corpus de duas
razões: `… requires review A record whose blind reviewers …`. Corrigido terminando **cada
valor** com ponto (e não no `join`), para que cada ação seja frase inteira onde for lida.

O teste novo (`names the act of every reason present, in the breakdown's order`) sela um
corpus de release v3 de 201 linhas com **uma** linha `automated/unreviewed` e **uma** linha
disputada, e a disputada vem **primeiro** de propósito: assim a ordem de encontro é o inverso
da ordem ordenada, e a asserção prende três coisas independentes — a contagem, o breakdown
ordenado por **nome** de razão (`1 automated-filter-only, 1 label-disputed`) e o `first` em
ordem de **registro** (`a_agy_0199`, a disputada). Se as duas linhas já viessem ordenadas, tirar
o `sort` não mudaria nada e a asserção estaria prendendo a fixture, não o código. Mutações
rodadas: `slice(0, 1)` mata o teste (só ele), e remover o comparador do `sort` também
(breakdown sai `1 label-disputed, 1 automated-filter-only`).

**Mais dois acertos de forma na mesma rodada, ambos medidos e não argumentados.**

1. `REVIEW_SHORTFALL_ACTION` passou a `} as const satisfies Record<…>`, que é como as quatro
   tabelas irmãs desta forma já são escritas (`schema.ts:1802`, `source-manifest.ts:304`,
   `:645`, `:654`). Sem `as const` os valores tipavam como `string` e a tabela de módulo era
   **gravável** — meu relatório anterior a chamou de "frozen", o que era falso: não era `as
   const` nem `Object.freeze`. Sonda: escrever `REVIEW_SHORTFALL_ACTION["label-disputed"] =
   "probe"` dentro do módulo type-checava (exit 0) na versão anterior e agora é
   `TS2540: Cannot assign … read-only property`. A exaustividade do `satisfies` não muda.
2. `reviewClaimShortfall` passou a receber **tupla não-vazia**
   (`readonly [UnsustainedReview, ...UnsustainedReview[]]`), então a guarda
   `unsustained.length > 0` do chamador virou o **tipo**. Extrair o construtor de mensagem
   tinha alargado o contrato: com `readonly UnsustainedReview[]` e `unsustained[0]?.id`, perder
   ou mover essa guarda produziria a recusa `0 of 201 sustain no review claim (), first
   undefined.` — breakdown vazio, ação nenhuma e o literal `undefined` como id de registro,
   atirado num operador cujo corpus não tem nada de errado. Mesma regra fail-loudly que a
   rodada de A3 pôs em `item()`. O chamador **desestrutura** em vez de testar `length`, porque
   TypeScript não estreita array para tupla não-vazia por comprimento; sonda: remover a guarda
   agora é `TS2345 … Source provides no match for required element at position 0`, em vez de
   compilar e imprimir `undefined`.

**O montador parou de fabricar.** `benchmark/lab/assemble_corpus.py` não tem mais a
constante de anotação nem a função de auditoria de PII, `stamp_block` não estampa mais
verdadeiro nenhum, e `private/review-ledger.jsonl` grava o **estado** (nunca revisor nem
concordância) — era dali que o hash de `integrity.review-ledger-hash` certificava a
própria invenção. `test_the_assembler_mints_no_review_receipt` faz *grep* dos tokens
antigos no próprio arquivo, então o comentário histórico os **descreve** em prosa em vez
de colá-los (mesma disciplina do `base_groups` em C2). Medido: 48 registros escritos com
`--sample 120`, todos validam contra o schema v3 e todos com
`{"sustains":false,"reason":"automated-filter-only"}`.

**Filtro automático ≠ auditoria, no dado e não só no texto.**
`common.CandidateWriter.offer` passa a registrar os filtros que ele mesmo rodou
(`meta.automatedFilters`: `pii-pattern-scan` e `length-floor`, com o símbolo de
implementação), e o montador **lê** essa lista em vez de afirmá-la. Pool sem o campo →
lista **vazia**, que é a resposta honesta (é o caso de todo pool existente, e de todo
registro v2). Linha gerada não recebe a lista: `CandidateWriter` é o caminho humano, e
nenhum filtro nosso varreu texto gerado em busca de dado pessoal. `outcome: "excluded"` é
recusado num registro que existe — as duas afirmações se contradizem.

**Divergências do escrito, declaradas:**

1. **`benchmark/schema.ts` e `benchmark/dataset-manifest.ts` entraram** na lista de
   arquivos. O recibo é campo de registro e o gate de coerência é o DatasetAudit; a lista
   do plano nomeava só os três outros.
2. **`benchmark/corpus-source-audit.ts` mudou só o cabeçalho.** O próprio módulo declara
   que "annotation / adjudication" pertencem ao `DatasetAudit`, então pôr a regra ali seria
   uma segunda cópia capaz de discordar da primeira. O que o cabeçalho passa a dizer é o
   que o bloco `protocols` do relatório de readiness **não** diz: ele nomeia os protocolos
   contra os quais o corpus é julgado, não protocolos que todo registro passou. Residual
   registrado: `contracts/source-readiness.ts` tipa `protocols.annotation` e
   `protocols.pii` como **literais**, então um relatório `ready` continua imprimindo os
   dois nomes para um corpus sem revisor. Fechar isso pede um décimo código de bloqueio no
   contrato e é trabalho de D1/D5, não desta tarefa.
3. **`benchmark/source-manifest.ts` ganhou uma tela de sobre-alegação**
   (`reviewOverclaimIn`), não uma mudança de schema. Ela atende o **requisito 4** do brief
   ("não deixe o filtro automático poder se apresentar como revisão") um nível acima do
   registro: um documento que afirma que o corpus foi revisado apresenta o filtro como
   revisão para o leitor, ainda que nenhum campo o faça. Duas coisas ficam ditas em vez de
   presumidas, porque a rodada de revisão as cobrou: a tela **não tem chamador de produção**
   — é regra de lint sobre os documentos, aplicada pela varredura em
   `benchmark/tests/source-manifest.test.ts`, exatamente como `humanLabelOverclaimIn` de
   B3 — e `benchmark/source-manifest.ts` está **fora** de `EVALUATOR_FILES`, logo a tela não
   faz parte da identidade do avaliador. O módulo já hospeda
   `humanLabelOverclaimIn` e reusa os mesmos verbos de alegação e a mesma janela de
   negação; só o sujeito muda. A razão: C5 removeu a alegação do dado, e prosa é o outro
   lugar por onde ela volta. A tela recusa a asserção ("a revisão humana garante…", "todos
   os registros foram revisados") e **não** recusa a descrição do protocolo ("cada
   registro passa por revisão manual"), porque o projeto precisa continuar documentando o
   que exige. Os sete documentos de governança são varridos por teste.
4. **`benchmark/protocols/pii-review-v1.md` foi corrigido.** Ele afirmava que a auditoria
   de cada registro "is recorded in `provenance.piiAudit`" com status passado — a mesma
   fabricação em prosa. Agora diz o que exige, distingue as duas etapas, nomeia
   `automated/unreviewed` para quem só passou pela primeira, e diz que o documento não é
   alegação de que o protocolo rodou.
5. **Um teste existente afirmava o contrário e foi atualizado**, não apagado:
   "still clears the floor on a v2 release corpus" (`dataset-manifest.test.ts`) selava um
   corpus v2 de release com sucesso. Agora afirma a recusa por revisão simulada e prova,
   pela mensagem, que o **piso** de família reservada aceitou antes (o piso nomeia uma
   família e roda primeiro); um teste irmão novo lê a contagem de 200 positivos num selo
   `infrastructure-only`, que é a forma honesta para um corpus de linhas não revisadas.
6. **O critério "o gate que hoje passa sobre a fabricação passa a reprovar" NÃO foi
   atendido como está escrito, e isto é a redação honesta do que o diff sustenta.** Os dois
   gates que o brief nomeia — `integrity.review-ledger-hash` e
   `integrity.dataset-audit-sealed` — continuam **passando**, porque as duas evidências que
   eles leem (`gates.ts:429`, `gates.ts:439`) são literais `true` escritos em um único
   lugar, `benchmark/commands/evaluate.ts:184` e `:186`, e C5 **não** tocou nenhum dos dois
   arquivos. `evaluate` nunca carrega o DatasetAudit, então não há o que ele possa checar.
   O que passa a reprovar é **a montante**: `benchmark/commands/validate.ts:83` chama
   `sealDataset`, que agora lança `DATASET_REVIEW_INVALID` sobre o corpus selado (v2,
   `scientificUse: "release"`), de modo que um corpus com governança fabricada **não chega**
   a `evaluate` — resultado defensável e discutivelmente mais forte, mas outro. Cablear as
   nove evidências literais de integridade é de quem as possui (G5/C6); fazê-lo aqui também
   viraria dois testes de `consume-holdout` cujo assunto é evidência de reamostragem, não
   governança.

**Insumo que falta (não é defeito):** revisão humana real. O mecanismo está pronto e a
perna `human-reviewed` **não tem produtor** em `benchmark/lab/`: D1 e D5 são as tarefas
que trazem revisor. Até lá, todo corpus é `automated/unreviewed` e um selo de release é
recusado — que é preferir falhar fechado a alegar governança (R4).

#### Piloto de triagem por NER (2026-07-29): o custo da adjudicação, medido

**Por que este piloto existe:** o desenho de auditoria de PII para um revisor único é
triagem automática por NER + adjudicação humana de cada apontamento + amostra aleatória
entre os não apontados. O custo da adjudicação é a **taxa de apontamento** vezes o custo
por item, e a taxa nunca havia sido medida — o número em circulação ("3 a 6 h") era
estimativa sem base. `benchmark/lab/ner_pilot.py` a mede.

**Desenho, congelado antes de olhar qualquer texto.** Amostra estratificada de 500
registros-linha humanos, 125 por fonte, dos pools `*_fresh` de `benchmark/data/candidates/`
(pt.stackoverflow, ptwiki, B2W, Carolina), sorteados por ordem de digest da chave
`ner-pilot-20260729:candidateId`. Estratificar é obrigatório porque a densidade de PII é
propriedade do gênero. A partição `test` e `test-labels.jsonl` não foram tocadas (R2).

**O que a taxa significa (R7).** Os pools já passaram por `pii_hits`, que **descarta**.
Logo o que se mede é `P(o NER aponta pessoa | a varredura de regex disse limpo)` — a
população exata que uma adjudicação de estágio 2 receberia. **Não** é a prevalência de PII
nos dumps, e **não** é precisão do NER contra um padrão-ouro, que não existe aqui.

**Modelo primário: `jordyvl/bert-base-portuguese-cased_harem-selective-sm-first-ner`**
(BERTimbau + HAREM *selective*). Escolhido porque o HAREM é o corpus-ouro português de
**gênero misto** — não jurídico como o LeNER-Br, não notícia como o `ner_news_portuguese` —
e porque o backbone é o mesmo já congelado pelo projeto. Segundo modelo,
`Babelscape/wikineural-multilingual-ner` (mBERT, dado prateado de Wikipédia), rodado sobre
a **mesma** amostra para separar "o corpus tem nomes" de "este modelo diz que tem".
Janelas cortadas nos offsets do tokenizador, nunca truncamento; menções repetidas do mesmo
nome agrupadas, porque o revisor julga um nome **uma** vez.

**Taxa de apontamento medida (limiar 0,5; IC 95% de Wilson):**

| fonte | n | apontados | taxa | IC 95% | nomes distintos | nomes/registro apontado |
|---|---:|---:|---:|---|---:|---:|
| B2W (`social-media`) | 125 | 3 | **2,4%** | 0,8–6,8% | 3 | 1,0 |
| pt.stackoverflow (`qa-informal`) | 125 | 5 | **4,0%** | 1,7–9,0% | 7 | 1,4 |
| ptwiki (`encyclopedic`) | 125 | 73 | **58,4%** | 49,6–66,7% | 365 | 5,0 |
| Carolina (`university`/`institutional`) | 125 | 85 | **68,0%** | 59,4–75,5% | 1.858 | **21,9** |
| total (cota igual) | 500 | 166 | **33,2%** | 29,2–37,4% | 2.233 | 13,5 |

O segundo modelo mede **31,8%** (IC 27,9–36,0%) e concorda com o primeiro em **96,6%** dos
500 registros-linha (154 apontados por ambos, 12 só pelo HAREM, 5 só pelo WikiNEuRal). A
taxa é do **corpus**, não da escolha de modelo. Limiar não ajuda: subir de 0,5 para 0,95
leva a taxa de 33,2% para 32,2%.

**Adjudicação manual de 30 apontados** (sorteio determinístico entre os apontados; regra
por registro, ordenada por severidade): **8 pessoa privada (26,7%)**, **18 figura pública
(60,0%)**, **4 falso positivo (13,3%)**. Os 8 de pessoa privada são todos Carolina: sete
acórdãos do STF que nomeiam **parte, advogado e réu** (um deles um habeas corpus com
paciente e corréus identificados) e uma conversa interpessoal transcrita com prenomes. Os
falsos positivos são nome de navio, clubes de futebol, o termo de programação *Model* e uma
palavra de provérbio. **Existe PII real escapando do filtro de regex** — é exatamente o
ponto cego que `common.py:70-76` declara.

**Tempo.** 138 s de relógio medidos para os 30 registros-linha (4,6 s cada; 379 nomes
distintos exibidos, 0,364 s por nome), **do adjudicador desta rodada, que é uma máquina**.
O tempo de um revisor humano sobre o mesmo lote **não foi medido** e nenhum multiplicador é
inventado aqui. Da distribuição de dificuldade — **11 de 30 exigiram ler a prosa em volta**
(papel processual, agradecimento, cônjuge em verbete, pseudônimo de contribuidor) e 19 foram
decidíveis pelo próprio span — o que se sustenta é que **cerca de um terço dos itens é juízo
real**, não descarte à vista.

**Extrapolação para 9.000 registros-linha humanos**, propagando o IC da taxa:

| mistura de fontes | taxa | apontados / 9.000 | nomes distintos |
|---|---:|---:|---:|
| cota igual (a do piloto) | 33,2% | 2.629–3.370 | ~40.000 |
| proporcional aos pools `*_fresh` | 35,1% | ~3.155 | ~38.000 |
| cinco estratos core equilibrados | 40,2% | ~3.614 | ~59.000 |

Horas, como **função** do custo por registro-linha apontado (a coluna de 4,6 s é a única
medida; as outras são sensibilidade declarada, não medição):

| s por apontado | 4,6 | 10 | 20 | 30 | 45 | 60 |
|---|---:|---:|---:|---:|---:|---:|
| horas (cota igual) | 3,8 | 8,3 | 16,6 | 24,9 | 37,4 | 49,8 |
| horas (cinco estratos) | 4,6 | 10,0 | 20,1 | 30,1 | 45,2 | 60,2 |

**Conclusão: o desenho não fecha como orçado, e o piloto o refuta.** Com 30% a 40% dos
registros-linha apontados, a adjudicação de achados de NER **não** é a tarefa de 3–6 h da
tabela de trabalho humano: a qualquer ritmo humano plausível (10–30 s por registro-linha)
ela custa **8 a 30 h sozinha** e consome todo o orçamento de 9–13 h. Isso não invalida a
triagem — ela **funciona**, achou PII real que o regex não acha — invalida o
dimensionamento. Três saídas mecânicas, nenhuma delas afrouxando gate:

1. **Adjudicar por estrato, não por corpus.** B2W e pt.stackoverflow apontam 2,4% e 4,0%:
   um censo de adjudicação nesses dois estratos custa dezenas de itens, não milhares. O
   custo inteiro está em ptwiki e Carolina.
2. **Tratar Carolina judiciário como estrato de PII conhecida, não como fila de
   adjudicação.** Acórdão do STF nomeia parte por construção; adjudicar 21,9 nomes por
   documento para redescobrir isso é medir o óbvio. A decisão é de admissão do estrato
   (com tratamento) ou de exclusão, e é decisão de D1.
3. **Amostrar a adjudicação e publicar taxa residual**, como já se faz para os não
   apontados — com a mesma redação obrigatória de "isto não certifica registro não
   auditado".

Qual dessas três é de **D1**, com o volume de D0b em mãos. O que este piloto entrega é o
número que faltava para escolher.

**Ganho colateral medido:** os registros-linha **não apontados** têm média de **92
palavras** (mediana por fonte entre 53 e 129), contra 768 do lote apontado — nomes se
concentram em texto longo. A amostra aleatória de n=300 entre os não apontados é portanto
leitura curta; quanto tempo um humano leva nela **não foi medido**.

**Artefatos:** `benchmark/out/rebuild-v3/ner-pilot/` (gitignored) — `sample.json`,
`findings-<modelo>.jsonl`, `summary-<modelo>.json`, `adjudication-batch-<modelo>.json`,
`verdicts.json`, `adjudication-cost.json`. **Nenhum deles contém texto de entidade**: id,
categoria canônica e offsets. Os 30 ids de `adjudication-batch-*.json` foram **lidos pelo
desenvolvimento** e são material de exposição para o ledger de C3.

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

**A5 entregou a função que este item consome:** `originalSpanFromNormalized` em
`contracts/text-normalization.ts` traduz um span `[start, end)` do texto **normalizado**
para o span do texto **original** em que os `mixture.spans` do schema estão definidos,
arredondando **para fora** quando o trecho foi reescrito, de forma que o span devolvido
sempre CONTÉM os caracteres de origem. Hoje nenhum consumidor emite span, então quem
implementar D4 é o primeiro chamador; usar essa função em vez de assumir identidade de
offsets é a diferença entre a cabeça de span treinar alinhada ou deslocada.

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
