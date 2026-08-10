# Referências do projeto

Este arquivo existe para uma finalidade e carrega uma regra permanente.

**Finalidade.** Toda decisão metodológica deste projeto referencia a literatura que a
motiva — de **qualquer** área, não só detecção de texto gerado por máquina (MGT) —, e a
referência entra aqui **no mesmo commit que implementa a decisão**. Decisão sem referência
é uma de duas coisas: metodologia importada cuja origem não foi procurada, ou invenção não
declarada. Nenhuma das duas pode ficar silenciosa. Quando não há precedente, o correto é
escrever "sem precedente encontrado", datado — não omitir a linha.

**Hierarquia de alegação.** Toda entrada deste arquivo se classifica em um de três níveis, e
a ordem importa:

1. **Metodologia importada de outra área, com fonte revisada.** Cite a origem **e** a
   transferência: o que a fonte prova no domínio dela, e o que muda ao trazer para cá. É o
   nível onde a maior parte deste projeto vive, e é um nível confortável.
2. **Combinação nova de partes estabelecidas.** Cite **cada parte**. A novidade é de
   engenharia, não de teoria — dizer o contrário é alegar propriedade não medida (R7).
3. **Teoria genuinamente nova.** Este projeto **não tem** e **não deve ter** nada nesta
   categoria. Algo cair aqui é um risco a justificar, não um troféu: significa que uma
   garantia do produto depende de matemática que ninguém revisou. Se uma decisão só se
   sustentar no nível 3, a resposta certa é procurar mais, ou reduzir a alegação.

**Proveniência deste inventário.** Levantamento **retroativo de 2026-07-31**, cobrindo
prática já implementada e decisão de desenho já tomada. Ele reúne: auditoria de 10
benchmarks, 7 shared tasks e 12 repositórios de detector; 6 revisões adversariais; e uma
varredura do plano de reconstrução v3 e do código do benchmark. Retroativo significa que as
referências foram procuradas **depois** da implementação — para as decisões futuras, a regra
acima é que ela entre junto.

## Convenções

- **Formato de cada entrada:** autores e ano, título, veículo, link; depois a âncora (qual
  decisão ou regra a referência sustenta), onde a decisão vive no projeto, e o fato citado.
- **Caminhos de código** aparecem como código literal (`benchmark/metrics.ts:806`), não como
  link, para não acoplar este arquivo ao verificador de links relativos.
- **Abreviações de plano**, usadas em "Onde no projeto":
  - **plano v3** = `docs/superpowers/plans/2026-07-26-detector-v3-rebuild-implementation.md`
  - **plano v1** = `docs/superpowers/plans/2026-07-30-plano-v1-minima.md`
  - **estado** = `docs/superpowers/plans/2026-07-30-estado-do-projeto.md`
  - **auditorias** = `docs/superpowers/plans/2026-07-30-auditorias-externas.md`
  - **registro** = `docs/superpowers/plans/2026-07-30-registro-de-decisoes.md`
- **Nomes exatos das regras invioláveis** (plano v3, § "§0 Regras invioláveis"), citados ao
  longo do arquivo: **R1** — a janela `fit` → `consume-holdout` é congelada; **R2** — o bloco
  de teste é cego e de uso único, e a cegueira é informacional; **R3** — nenhum gate é
  afrouxado para passar; **R4** — governança nunca é simulada; **R5** — erro de inferência
  nunca vira escore; **R6** — grupo é `known`, `notApplicable` ou `unknown`, nunca sintético;
  **R7** — declare o contrato, não a propriedade; **R8** — nenhuma alegação de qualidade
  antes de H1; **R9** — licença verificada na fonte antes de qualquer download ou
  incorporação.
- **Ressalva de verificação** aparece na própria entrada quando o conteúdo da URL divergiu do
  que a entrada supunha. Link não verificado nunca é apresentado como verificado (R7 vale
  para bibliografia).

## 1. Reuso do bloco de teste, cegueira e alegação de qualidade (R1, R2, R8)

### 1.1 Reuso de holdout e cegueira informacional

- **Dwork, Feldman, Hardt, Pitassi, Reingold, Roth, 2015 — The reusable holdout: Preserving
  validity in adaptive data analysis** (Science 349(6248):636–638).
  [link](https://doi.org/10.1126/science.aaa9375)
  _Âncora:_ R2 — a cegueira que a concessão protege é **informacional**, não o identificador;
  uma tupla nova de digests não restaura cegueira. _Onde no projeto:_ plano v3 § "§0" R2;
  `benchmark/holdout-ledger.ts`. _Fato citado:_ o mecanismo de holdout reutilizável preserva
  validade sob reuso adaptativo repetido — o que mostra, por contraste, que a resposta
  canônica da teoria é reuso **controlado**, não uso único.
- **Dwork, Feldman, Hardt, Pitassi, Reingold, Roth, 2015 — The reusable holdout** (Science,
  página do editor). [link](https://www.science.org/doi/10.1126/science.aaa9375)
  _Âncora:_ mesma âncora de R2, citação alternativa. _Onde no projeto:_ plano v3 § "§0" R2.
  _Fato citado:_ Thresholdout — privacidade diferencial permite reusar o mesmo holdout muitas
  vezes preservando validade.
- **Blum & Hardt, 2015 — The Ladder: A Reliable Leaderboard for Machine Learning
  Competitions** (ICML 2015 / PMLR v37, pp. 1006–1014).
  [link](https://arxiv.org/abs/1502.04585)
  _Âncora:_ R2 e a **assimetria declarada** entre cluster exposto (perde só elegibilidade a
  `test`) e registro-linha de teste consumido (sai das cinco partições). _Onde no projeto:_
  plano v3 § "§0" R2 (tabela objeto/custo); `benchmark/cluster-exposure-ledger.ts`. _Fato
  citado:_ limita quantas consultas adaptativas a um leaderboard podem ser respondidas
  mantendo a acurácia reportada próxima da real, motivado por leaderboards privados estilo
  Kaggle.
- **Blum & Hardt, 2015 — The Ladder** (PMLR v37:1006-1014, PDF oficial).
  [link](https://proceedings.mlr.press/v37/blum15.pdf)
  _Âncora:_ por contraste, a singularidade de R2 — a resposta canônica da teoria é reuso
  controlado, não uso único. _Onde no projeto:_ plano v3 § "§0" R2. _Fato citado:_ o
  leaderboard só atualiza a melhor estimativa quando a perda cai significativamente; limite de
  erro de log(k)^(2/3)/n^(1/3).
- **Recht, Roelofs, Schmidt, Shankar, 2019 — Do ImageNet Classifiers Generalize to
  ImageNet?** (ICML 2019, pp. 5389–5400). [link](https://arxiv.org/abs/1902.10811)
  _Âncora:_ calibração de custo-benefício de R2 — reuso adaptativo infla **menos** do que o
  folclore sugere. _Onde no projeto:_ plano v3 § "§0" R2; auditorias (dosagem do orçamento de
  bloco cego). _Fato citado:_ queda de 11–14% em ImageNet e 3–15% em CIFAR-10 em teste novo,
  mas ganho no teste original rende mais de 1 ponto no teste novo — o oposto de overfitting
  adaptativo.
- **Roelofs, Shankar, Recht, Fridovich-Keil, Hardt, Miller, Schmidt, 2019 — A Meta-Analysis
  of Overfitting in Machine Learning** (NeurIPS 2019).
  [link](https://proceedings.neurips.cc/paper/2019/hash/ee39e503b6bedf0c98c388b7e8589aca-Abstract.html)
  _Âncora:_ calibração de custo-benefício de R1/R2 — evidência de que reuso de holdout público
  infla pouco, sugerindo redirecionar orçamento para deslocamento de distribuição. _Onde no
  projeto:_ plano v3 § "§0" R1–R2; auditorias. _Fato citado:_ ranking público vs. privado em
  mais de 100 competições Kaggle mostra "little evidence of substantial overfitting".
- **Kaggle — Competition public/private leaderboard** (kaggle.com/docs).
  [link](https://www.kaggle.com/docs/competitions-setup)
  _Âncora:_ por contraste, R2 — a analogia industrial mais próxima de uso único ainda permite
  múltiplas submissões finais. _Onde no projeto:_ plano v3 § "§0" R2. _Fato citado:_ o test set
  é dividido e o participante escolhe mais de uma submissão final.
- **Chollet, Knoop, Kamradt, Landers, Pinkard, 2025 — ARC-AGI-2: A New Challenge for
  Frontier AI Reasoning Systems** (arXiv 2505.11831).
  [link](https://arxiv.org/abs/2505.11831)
  _Âncora:_ R2 — o exemplo real mais próximo de cegueira de bloco com controle de exposição
  encontrado fora de benchmarks de MGT. _Onde no projeto:_ plano v3 § "§0" R2. _Fato citado:_
  avaliação privada nunca publicada; acurácia privada revelada só depois de abrir o código.
- **Cruz & Aji (MBZUAI), 2026 — LLM Olympiad: Why Model Evaluation Needs a Sealed Exam**
  (arXiv 2603.23292). [link](https://arxiv.org/html/2603.23292)
  _Âncora:_ R1 (avaliador congelado por digest) e R2 (bloco cego de uso único) — o análogo mais
  próximo fora da área. _Onde no projeto:_ plano v3 § "§0" R1 e R2; `benchmark/digests.ts`
  (`EVALUATOR_FILES`, `computeEvaluatorDigest`). _Fato citado:_ protocolo de "exame selado" com
  tarefas confidenciais até a pontuação, submissão congelada antes da revelação, harness único
  dos organizadores e liberação post-hoc obrigatória — mas nem ele trata pré-registro,
  multiplicidade ou intervalo de confiança.
- **Keita & Homan, 2026 — Computer Science Conferences Should Require Nonrepudiable
  Experimental Results** (arXiv 2605.08586, position paper).
  [link](https://arxiv.org/abs/2605.08586)
  _Âncora:_ R1/R2 — o projeto implementa o que este paper ainda propõe (avaliador congelado,
  testemunha de altura). _Onde no projeto:_ plano v3 § "§0" R1;
  `benchmark/cluster-exposure-ledger.ts`. _Fato citado:_ "the current system relies on
  self-reported checklists, optional code sharing, and author-controlled logging".
- **Besiroglu & Sevilla, 2025 — OpenAI and FrontierMath** (epoch.ai, 23/01/2025).
  [link](https://epoch.ai/latest/openai-and-frontiermath)
  _Âncora:_ R4 (governança nunca simulada) — valida o ledger de exposição e a exigência de
  identidade de bloco independente do candidato. _Onde no projeto:_ plano v3 § "§0" R4 e § C3;
  `benchmark/cluster-exposure-ledger.ts`. _Fato citado:_ a OpenAI financiou o benchmark e detém
  acesso a tudo exceto um holdout de 50; a Epoch admite que deveria ter negociado mais
  transparência.

### 1.2 O que os shared tasks da área realmente fazem com o bloco de teste

- **Dugan, Hwang, Trhlík, Ludan, Zhu, Xu, Ippolito, Callison-Burch, 2024 — RAID: A Shared
  Benchmark for Robust Evaluation of Machine-Generated Text Detectors** (ACL 2024, Vol. 1,
  pp. 12463–12492; ACL Anthology 2024.acl-long.674; arXiv 2405.07940).
  [link](https://arxiv.org/html/2405.07940v1)
  _Âncora:_ R2 — o benchmark mais rigoroso da área pratica cegueira de rótulo com **reuso
  ilimitado**, não uso único; justifica R2 como diferencial e explica por que comparação direta
  de FPR contra RAID é inválida por construção de protocolo (R7). _Onde no projeto:_ plano v3
  § "§0" R2; § H2 (o que o relatório pode e não pode comparar). _Fato citado:_ 6M+ gerações, 11
  modelos, 8 domínios, 11 ataques adversariais; rótulos do teste oficial retidos
  permanentemente, mas o README permite múltiplas submissões por PR sem limite documentado.
- **Dugan, Hwang, Trhlík, Zhu, Ludan, Xu, Ippolito, Callison-Burch, 2024 — RAID, repositório
  oficial (liamdugan/raid)** (GitHub; paper em ACL 2024).
  [link](https://github.com/liamdugan/raid)
  _Âncora:_ R2 — fonte primária que confirma ausência de ledger de exposição, de orçamento de
  submissão e de identidade de bloco independente do candidato no benchmark mais citado da
  área. _Onde no projeto:_ plano v3 § "§0" R2; `benchmark/cluster-exposure-ledger.ts`. _Fato
  citado:_ "Our GitHub bot will automatically run evaluations on the submitted predictions" e
  "You may submit multiple detectors in a single PR"; 467 caminhos no repositório, 0 contendo
  "test".
- **Uchendu, Ma, Le, Zhang, Lee, 2021 — TuringBench: A Benchmark Environment for Turing Test
  in the Age of Neural Text Generation** (Findings of EMNLP 2021; arXiv 2109.13296).
  [link](https://ar5iv.labs.arxiv.org/html/2109.13296)
  _Âncora:_ R2 por precedência histórica fraca — submissão controlada por organizador existe
  desde 2021 sem nunca evoluir para uso único. _Onde no projeto:_ plano v3 § "§0" R2. _Fato
  citado:_ split 70:10:20 reutilizável; exige submissão de código/pesos para "private testing"
  antes do leaderboard, sem cegueira nem limite de submissão.
- **Webis Group / PAN Lab — PAN Voight-Kampff / TIRA, visão geral da tarefa (CLEF
  2024/2025/2026)** (pan.webis.de).
  [link](https://pan.webis.de/clef25/pan25-web/generated-content-analysis.html)
  _Âncora:_ R2 por contraste — a única cegueira informacional real da área, mas mantida para
  **reuso permanente** entre edições, o oposto do uso único com ledger de exposição. _Onde no
  projeto:_ plano v3 § "§0" R2. _Fato citado:_ submissão de software em Docker no TIRA; mais de
  1.100 submissões desde 2012; "The test data will be kept confidential for future editions of
  the task". _Ressalva de verificação:_ entrada marcada como divergente na verificação de
  2026-07-31 — a página é institucional e sem autoria individual, e a correspondência exata das
  contagens ao ano-edição citado não foi confirmada; tratar as cifras como não verificadas.
- **pan-webis-de — PAN'25, repositório oficial de baselines e avaliador TIRA (Subtask 1,
  Voight-Kampff Generative AI Detection)** (GitHub).
  [link](https://github.com/pan-webis-de/pan25-generative-ai-authorship-verification)
  _Âncora:_ R1/R2 — confirma retenção de rótulo para reuso entre edições, sem ledger de
  exposição, identidade de bloco independente nem testemunha de altura. _Onde no projeto:_
  plano v3 § "§0" R1–R2. _Fato citado:_ "The test data will be kept confidential for future
  editions of the task."
- **pan.webis.de — PAN 2026, Voight-Kampff Generative AI Detection task (CLEF 2026)**
  (pan.webis.de/clef26).
  [link](https://pan.webis.de/clef26/pan26-web/generated-content-analysis.html)
  _Âncora:_ por contraste direto, R2 — cegueira permanente somada a reuso permanente. _Onde no
  projeto:_ plano v3 § "§0" R2. _Fato citado:_ "Texts with genre: news are sampled from last
  year's dataset... some texts will be duplicates!"
- **Bevendorff, Fröbe, Greiner-Petter, Jakoby, Mayerl, Nakov, Plutz, Potthast, Stein, Ta,
  Wang, Zangerle, 2026 — Overview of PAN 2026** (arXiv 2602.09147).
  [link](https://arxiv.org/abs/2602.09147)
  _Âncora:_ confirma que a área, ainda em 2026, não evoluiu o regime de governança do PAN —
  R1/R2 permanecem sem precedente mesmo no estado da arte mais recente. _Onde no projeto:_
  plano v3 § "§0" R1–R2. _Fato citado:_ cinco tarefas, incluindo Voight-Kampff em autoria
  mista/obfuscada; o overview não traz intervalo de confiança, teste de significância, correção
  de multiplicidade nem regra de consumo único.
- **NLP2CT Lab (University of Macau), Central China Normal University, Alibaba Cloud — NLPCC
  2026 Shared Task 6: Detection of LLM-Generated Text** (página oficial do shared task).
  [link](https://nlp2ct.github.io/NLPCC-2026-Task6-Detection/)
  _Âncora:_ R2 como diferencial — a proibição de reuso mais dura da área ainda permite 100
  submissões por equipe sem ledger contábil. _Onde no projeto:_ plano v3 § "§0" R2. _Fato
  citado:_ fase 2 cega quanto a score e proibição explícita de usar amostras do teste para
  desenvolver o detector, mas até 100 submissões por equipe com "Force Last".
- **Wang, Mansurov, Ivanov, Su, Shelmanov, Tsvigun, Afzal, Mahmoud, Puccetti, Arnold,
  Whitehouse, Aji, Habash, Gurevych, Nakov, 2024 — SemEval-2024 Task 8: Multidomain,
  Multimodel and Multilingual Machine-Generated Text Detection** (SemEval-2024; arXiv
  2404.14183). [link](https://ar5iv.labs.arxiv.org/html/2404.14183)
  _Âncora:_ por contraste direto, R2 — cegueira **temporária** e explicitamente revogada após a
  competição, o oposto do uso único permanente. _Onde no projeto:_ plano v3 § "§0" R2. _Fato
  citado:_ "After the competition concluded, we released the gold labels for both the
  development and test sets... kept the submission system open for the test dataset for
  post-shared task evaluations."
- **Wang, Mansurov, Ivanov, Su, Shelmanov, Tsvigun, Afzal, Mahmoud, Puccetti, Arnold, Aji,
  Habash, Gurevych, Nakov, 2024 — M4GT-Bench: Evaluation Benchmark for Black-Box
  Machine-Generated Text Detection** (ACL 2024, Vol. 1, pp. 3964–3992).
  [link](https://ar5iv.labs.arxiv.org/html/2402.11175)
  _Âncora:_ R2/R3 — mesmo o benchmark de avaliação mais recente da linhagem M4 não tem
  disciplina de uso único nem correção de multiplicidade. _Onde no projeto:_ plano v3 § "§0" R2
  e R3; § H2 "Multiplicidade declarada". _Fato citado:_ nove línguas, seis domínios, nove
  geradores; partições reutilizáveis sem teste oculto; intervalo apenas como desvio-padrão
  entre 5 seeds de treino.

### 1.3 Alegação de qualidade sem medição, e auditoria de terceiro (R8)

- **Weber-Wulff, Anohina-Naumeca, Bjelobaba, Foltýnek, Guerrero-Dib, Popoola, Šigut,
  Waddington, 2023 — Testing of detection tools for AI-generated text** (International Journal
  for Educational Integrity 19:26; arXiv 2306.15666).
  [link](https://arxiv.org/abs/2306.15666)
  _Âncora:_ R7 — nenhuma afirmação única de "o detector erra" é sustentável sem medição
  própria. _Onde no projeto:_ plano v3 § "§0" R7; `docs/limitations.md`. _Fato citado:_ 12
  ferramentas públicas mais Turnitin e PlagiarismCheck; todas as 14 abaixo de 80% de acurácia;
  o viés muda de direção por ferramenta e estrato.
- **Quach, 2023 — Plagiarism-sniffing Turnitin tries to find AI writing by students – with
  mixed grades** (The Register, 05/04/2023).
  [link](https://www.theregister.com/2023/04/05/turntin_plagiarism_ai/)
  _Âncora:_ R8 — nenhuma alegação de qualidade antes de medição cega, por exemplo negativo
  direto. _Onde no projeto:_ plano v3 § "§0" R8. _Fato citado:_ "98% de acurácia", "menos de 1%
  de FP", com base em teste em "controlled lab environment" sem metodologia divulgada.
- **Chechitelli (citada) / Inside Higher Ed, 2023 — Turnitin's AI detector:
  higher-than-expected false positives** (Inside Higher Ed, 01/06/2023).
  [link](https://www.insidehighered.com/news/quick-takes/2023/06/01/turnitins-ai-detector-higher-expected-false-positives)
  _Âncora:_ R3 — caso documentado de **re-escopo da alegação depois do lançamento**, que é
  exatamente o afrouxamento que R3 proíbe. _Onde no projeto:_ plano v3 § "§0" R3. _Fato
  citado:_ re-escopo para "<1% para documentos com 20% ou mais de escrita por IA"; FPR de
  sentença em torno de 4%.
- **Manupropria, Inc. — Turnitin AI false positives, compilação de citações diretas**
  (manupropria.app). [link](https://manupropria.app/turnitin-ai-false-positives)
  _Âncora:_ R3 — documenta o afrouxamento retroativo do gate: a faixa de FPR alta deixou de ser
  **reportada** em vez de medida. _Onde no projeto:_ plano v3 § "§0" R3. _Fato citado:_ release
  notes de jul/2024: "no score or highlights are attributed for AI detection scores in the 1%
  to 19% range".
- **Fowler, 2023 — We tested Turnitin's ChatGPT-detector for teachers. It got some wrong.**
  (Washington Post, 01/04/2023).
  [link](https://www.washingtonpost.com/technology/2023/04/01/chatgpt-cheating-detection-turnitin/)
  _Âncora:_ R8 — auditoria de terceiro contradiz a alegação de "98% de acurácia". _Onde no
  projeto:_ plano v3 § "§0" R8. _Fato citado:_ o detector acertou 6 de 16 amostras e marcou 8%
  de uma redação original de estudante como IA.
- **Vanderbilt Brightspace / Office of Digital Learning, 2023 — Guidance on AI Detection and
  Why We're Disabling Turnitin's AI Detector** (Vanderbilt University, 16/08/2023).
  [link](https://www.vanderbilt.edu/brightspace/2023/08/16/guidance-on-ai-detection-and-why-were-disabling-turnitins-ai-detector/)
  _Âncora:_ R7/R8 — raciocínio quantitativo que traduz FPR em impacto absoluto, o que o
  fornecedor não fez; é o mesmo cálculo que o projeto se obriga a publicar. _Onde no projeto:_
  plano v3 § "§0" R7–R8; `docs/uso-responsavel.md`. _Fato citado:_ com FPR de 1% e 75.000
  submissões de 2022, cerca de 750 trabalhos teriam sido marcados por erro.
- **Coffey, 2024 — Professors Cautious of Tools to Detect AI-Generated Writing** (Inside
  Higher Ed, 09/02/2024).
  [link](https://www.insidehighered.com/news/tech-innovation/artificial-intelligence/2024/02/09/professors-proceed-caution-using-ai)
  _Âncora:_ R7/R8 — padrão de evidência rejeitado pelo comprador institucional, não só por
  pesquisadores. _Onde no projeto:_ plano v3 § "§0" R7–R8. _Fato citado:_ 50+ instituições
  desabilitaram o detector de IA da Turnitin desde 2023. _Ressalva de verificação:_ entrada
  marcada como divergente em 2026-07-31 — a contagem "50+" não foi confirmada na página
  acessada; tratar o número como não verificado e a reportagem como corroboração qualitativa.
- **University of San Diego — Pardee Legal Research Center — The Problems with AI Detectors:
  False Positives and False Negatives** (guia institucional).
  [link](https://lawlibguides.sandiego.edu/c.php?g=1443311&p=10721367)
  _Âncora:_ R7 — o trade-off FN/FP é escolha deliberada do fornecedor, não acidente; por isso o
  contrato tem de dizer qual lado foi comprado. _Onde no projeto:_ plano v3 § "§0" R7; § A6
  (recall e FPR no limiar congelado). _Fato citado:_ a Turnitin reconhece deixar passar cerca de
  15% do texto de IA mantendo 1% de FP.
- **Federal Trade Commission, 2025 — FTC Order Requires Workado to Back Up Artificial
  Intelligence Detection Claims** (FTC, press release, abr/2025; ordem final em ago/2025).
  [link](https://www.ftc.gov/news-events/news/press-releases/2025/04/ftc-order-requires-workado-back-artificial-intelligence-detection-claims)
  _Âncora:_ R7/R8 — a única sanção regulatória existente sobre a manchete de detecção de IA.
  _Onde no projeto:_ plano v3 § "§0" R7–R8. _Fato citado:_ a Workado alegava 98% de acurácia;
  teste independente mediu 53%; a ordem final proíbe alegação sem "competent and reliable
  evidence".
- **Edwards, 2023 — OpenAI admits AI detectors don't work (FAQ para educadores)** (American
  Libraries Magazine, set/2023, republicando reportagem da Ars Technica).
  [link](https://americanlibrariesmagazine.org/latest-links/openai-admits-ai-detectors-dont-work/)
  _Âncora:_ R7/R8 — o fornecedor com melhor acesso ao gerador declara publicamente o problema
  **não** resolvido. _Onde no projeto:_ plano v3 § "§0" R7–R8; `docs/limitations.md`. _Fato
  citado:_ "In short, no... none of these have proven to reliably distinguish between
  AI-generated and human-generated content".
- **Coldewey, 2023 — OpenAI scuttles AI-written text detector over low rate of accuracy**
  (TechCrunch, 25/07/2023).
  [link](https://techcrunch.com/2023/07/25/openai-scuttles-ai-written-text-detector-over-low-rate-of-accuracy/)
  _Âncora:_ R8/R3 como exemplo positivo raro — o fornecedor publicou os dois números antes de
  vender a alegação, e o resultado foi retirar o produto. _Onde no projeto:_ plano v3 § "§0" R3
  e R8. _Fato citado:_ 26% de verdadeiros positivos e 9% de falsos positivos autodeclarados;
  retirado com "no longer available due to its low rate of accuracy". _Ressalva de
  verificação:_ entrada marcada como divergente em 2026-07-31 — a atribuição exata dos dois
  percentuais a esta reportagem não foi confirmada na página; os números vêm da própria nota da
  OpenAI e devem ser citados a partir dela, não desta matéria.
- **Gillham — We Have 99% Accuracy in Detecting AI: Originality.ai Study**
  (originality.ai/blog). [link](https://originality.ai/blog/ai-accuracy)
  _Âncora:_ R7/R8 — usa a mesma medição (RAID) que mostra colapso como prova de robustez; é o
  risco de citar benchmark sem contexto de protocolo. _Onde no projeto:_ plano v3 § "§0"
  R7–R8; § H2. _Fato citado:_ "99% de acurácia" com FPR de 0,5%–1,5%, com base em "Internal
  Benchmark" não disponibilizado.
- **Copyleaks — AI Content Detector, metodologia de teste** (copyleaks.com).
  [link](https://copyleaks.com/ai-content-detector/testing-methodology)
  _Âncora:_ R7/R8 — alegação contradita por auditoria de terceiro em uma a duas ordens de
  magnitude. _Onde no projeto:_ plano v3 § "§0" R7–R8. _Fato citado:_ ">99% de acurácia com FPR
  de 0,2%", contra 1%–2% de falsos positivos medidos pela apuração da Bloomberg.
- **Winston AI — página inicial** (gowinston.ai). [link](https://gowinston.ai/)
  _Âncora:_ R8 no extremo do padrão a evitar — a alegação mais forte do mercado com a menor
  evidência. _Onde no projeto:_ plano v3 § "§0" R8. _Fato citado:_ "The only AI detector with a
  99,98% accuracy rate", sem nenhuma metodologia divulgada.
- **Adam & Cui (GPTZero), 2026 — GPTZero AI Detection Benchmarking** (gptzero.me,
  05/02/2026).
  [link](https://gptzero.me/news/gptzero-ai-detection-benchmarking-the-industry-standard-in-accuracy-transparency-and-fairness/)
  _Âncora:_ R7 — publicação **parcial** como padrão de mercado, que o projeto evita ao publicar
  toda execução certificadora. _Onde no projeto:_ estado § "Decisão 1 — Regime 2". _Fato
  citado:_ "0,08% FPR, 99,60% recall" em benchmark próprio, com os conjuntos de creative
  writing e essays não publicados.
- **Robinson, 2025 (pesquisa de Jabarian & Imas) — Do AI Detectors Work Well Enough to
  Trust?** (Chicago Booth Review, dez/2025; BFI WP 2025-116 / NBER WP 34223).
  [link](https://www.chicagobooth.edu/review/do-ai-detectors-work-well-enough-trust)
  _Âncora:_ a decisão de estratificar por comprimento **e** declarar o que não está coberto —
  mesmo a melhor auditoria acadêmica só mede condição limpa. _Onde no projeto:_ plano v3 § G4
  (diagnóstico por comprimento) e § "§0" R7. _Fato citado:_ Pangram com acurácia próxima de
  100% e zero FP na maioria dos limiares; Originality com 10%–40% de falsos negativos; texto
  limpo, sem ataque adversarial.

## 2. Multiplicidade, seleção e pré-registro

### 2.1 Endpoint pré-especificado e gates congelados

- **ICH Expert Working Group, 1998 — ICH E9: Statistical Principles for Clinical Trials**
  (ICH Harmonised Tripartite Guideline E9, Step 5).
  [link](https://database.ich.org/sites/default/files/E9_Guideline.pdf)
  _Âncora:_ R3 (mudar limite exige evidência medida, justificativa escrita e registro), a
  separação confirmatório × exploratório e a exigência de cegueira do revisor. _Onde no
  projeto:_ plano v3 § "§0" R3, § E3 "Gates de composição do split" (o que **não** entra em
  `m`), § C5 e § D1 requisito 4. _Fato citado:_ endpoint pré-especificado como condição de
  validade; separação entre desenho confirmatório e exploratório; cegueira do avaliador.
- **Nosek, Ebersole, DeHaven, Mellor, 2018 — The preregistration revolution** (PNAS 115(11)).
  [link](https://doi.org/10.1073/pnas.1708274114)
  _Âncora:_ gates congelados com `m` pré-registrado, e R3. _Onde no projeto:_ plano v3 § "§0"
  R3; auditorias (linha de pré-registro); `benchmark/gates.ts:186-192`. _Fato citado:_
  observações anteriores geram hipóteses; dados novos testam previsões congeladas — essa é a
  sequência legítima de pré-registro.
- **Hofman, Chatzimparmpas, Sharma, Watts, Hullman, 2023 — Pre-registration for Predictive
  Modeling** (arXiv 2311.18807). [link](https://arxiv.org/abs/2311.18807)
  _Âncora:_ a decisão de pré-registrar, citando as barreiras documentadas que o projeto decidiu
  superar mesmo assim. _Onde no projeto:_ plano v3 § "Contrato de execução sem decisões
  pendentes"; `benchmark/rebuild-v3-policy.json`. _Fato citado:_ "pre-declaring important
  aspects of a predictive modeling pipeline is not common practice in predictive modeling, but
  should be".
- **PMLR v148, 2021 — NeurIPS 2020 Workshop on Pre-registration in Machine Learning**
  (publicado 08/07/2021). [link](https://proceedings.mlr.press/v148/)
  _Âncora:_ o pré-registro com schema fechado do projeto é prática **acima** da área. _Onde no
  projeto:_ `benchmark/rebuild-v3-policy.json`; plano v3 § "Contrato de execução…". _Fato
  citado:_ 23 propostas pré-registradas em uma única edição virtual (11/12/2020) — piloto
  pequeno, que nunca virou trilha de conferência.
- **PMLR v181, 2022 — NeurIPS 2021 Workshop on Pre-registration in Machine Learning**
  (workshop em 13/12/2021, proceedings em 05/10/2022).
  [link](https://proceedings.mlr.press/v181/)
  _Âncora:_ por encolhimento documentado, que pré-registro em ML é experimento encerrado, sem
  comunidade que o reconheça como critério de comparação — o projeto o mantém por razão
  própria, não por convenção. _Onde no projeto:_ plano v3 § "Contrato de execução…". _Fato
  citado:_ segunda edição com apenas 3 papers, contra 23 em 2020; sem edição em 2022 ou depois.
- **NeurIPS Communication Chairs, 2026 — MLRC 2026: Reproducibility as an Official Track at
  NeurIPS** (blog.neurips.cc, 04/05/2026).
  [link](https://blog.neurips.cc/2026/05/04/mlrc-2026-reproducibility-as-an-official-track-at-neurips/)
  _Âncora:_ contraste de escopo — o campo institucionalizou reprodução e resultado negativo,
  não pré-registro. _Onde no projeto:_ estado § "Decisão 1 — Regime 2". _Fato citado:_
  reprodutibilidade ganha trilha oficial pela primeira vez no NeurIPS.
- **NeurIPS 2026 — Evaluations & Datasets Track** (neurips.cc).
  [link](https://neurips.cc/Conferences/2026/CallForEvaluationsDatasets)
  _Âncora:_ a decisão de publicar toda execução certificadora, passe ou reprove — o análogo
  institucional mais próximo, mas o projeto vai além (obrigação, não convite). _Onde no
  projeto:_ estado § "Decisão 1 — Regime 2"; auditorias. _Fato citado:_ aceita explicitamente
  resultado negativo, auditoria empírica e análise metodológica.

### 2.2 Multiplicidade: quando corrigir e quando não

- **Dunn, 1961 — Multiple comparisons among means** (JASA 56(293):52–64).
  [link](https://doi.org/10.1080/01621459.1961.10482090)
  _Âncora:_ intervalos unilaterais simultâneos por Bonferroni com `alpha_familia = 0,05 / m`,
  `m` pré-registrado e congelado em G5; e a alocação de epsilon por caminho (0,025 + 0,025).
  _Onde no projeto:_ plano v3 § A6 e § H2 "Multiplicidade declarada";
  `benchmark/gates.ts:186-192`; `benchmark/rebuild-v3-policy.json` (`conformal`,
  `fprBudgets`). _Fato citado:_ formalização estatística padrão da correção de Bonferroni
  (intervalos simultâneos via desigualdade de Bonferroni), citada porque o artigo original de
  Bonferroni (1936) é em italiano e sem link estável verificável.
- **Holm, 1979 — A simple sequentially rejective multiple test procedure** (Scandinavian
  Journal of Statistics 6(2):65–70). [link](http://www.jstor.org/stable/4615733)
  _Âncora:_ alternativa canônica mais potente **dentro da mesma família** de controle de FWER —
  registrada para contraste, porque o repositório implementa Bonferroni simples, não o
  step-down de Holm. _Onde no projeto:_ plano v3 § A6 e § H2; `benchmark/gates.ts:186-192`.
  _Fato citado:_ procedimento step-down que controla FWER com mais poder que Bonferroni
  simples, sob a mesma correção por `m`.
- **Bender & Lange, 2001 — Adjusting for multiple testing — when and how?** (Journal of
  Clinical Epidemiology 54(4):343–349).
  [link](https://doi.org/10.1016/S0895-4356(00)00314-0)
  _Âncora:_ a regra decisiva para rejeitar a leitura de que a certificação "primeiro que passa"
  poderia ser apresentada como cota simultânea de 95% sem ajuste entre releases. _Onde no
  projeto:_ estado § "Decisão 1 — Regime 2"; auditorias § "Os quatro erros de dosagem". _Fato
  citado:_ quando testes são combinados numa conclusão confirmatória conjunta, é necessário
  tratar a multiplicidade.
- **Rothman, 1990 — No adjustments are needed for multiple comparisons** (Epidemiology
  1(1):43–46). [link](https://pubmed.ncbi.nlm.nih.gov/2081237/)
  _Âncora:_ reconhece o núcleo legítimo da posição contrária **antes** de a revisão argumentar
  que, quando os testes são combinados numa conclusão confirmatória conjunta, a correção passa
  a ser necessária. _Onde no projeto:_ auditorias § "Os quatro erros de dosagem". _Fato
  citado:_ crítica a ajustes indiscriminados de multiplicidade.
- **Perneger, 1998 — What's wrong with Bonferroni adjustments** (BMJ 316(7139):1236–1238).
  [link](https://pmc.ncbi.nlm.nih.gov/articles/PMC1112991/)
  _Âncora:_ mesmo papel de Rothman — delimita quando a correção múltipla não é obrigatória,
  antes de Bender & Lange cobrirem o caso em que os testes **são** combinados numa conclusão
  única. _Onde no projeto:_ auditorias § "Os quatro erros de dosagem". _Fato citado:_ crítica ao
  uso indiscriminado da correção de Bonferroni.
- **Rubin, 2021 — When to adjust alpha during multiple testing: A consideration of
  disjunction, conjunction, and individual testing** (Synthese 199:10969–11000).
  [link](https://doi.org/10.1007/s11229-021-03276-4)
  _Âncora:_ o contra-argumento usado no Regime 2 para sustentar validade "por versão" — com a
  ressalva registrada de que isso **não** cobre a versão selecionada por "continuar até
  passar". _Onde no projeto:_ estado § "Decisão 1 — Regime 2"; auditorias. _Fato citado:_ há
  precedente para não ajustar hipóteses verdadeiramente individuais.
- **Proschan & Follmann, 1995 — Multiple Comparisons with Control in a Single Experiment
  versus Separate Experiments: Why Do We Feel Differently?** (The American Statistician
  49(2):144–149). [link](https://doi.org/10.1080/00031305.1995.10476132)
  _Âncora:_ a discussão sobre se releases sucessivos formam uma família de testes sob a regra
  "publicar o primeiro que passar". _Onde no projeto:_ estado § "Decisão 1 — Regime 2". _Fato
  citado:_ tensão antiga entre tratar tentativas sucessivas como experimentos separados ou como
  família comum de hipóteses.
- **Simmons, Nelson & Simonsohn, 2011 — False-Positive Psychology: Undisclosed Flexibility in
  Data Collection and Analysis Allows Presenting Anything as Significant** (Psychological
  Science 22(11):1359–1366). [link](https://doi.org/10.1177/0956797611417632)
  _Âncora:_ "publicar o primeiro release que passa" é estruturalmente análogo a
  p-hacking/seleção, exigindo correção de multiplicidade mesmo entre releases nominalmente
  diferentes. _Onde no projeto:_ estado § "Decisão 1"; auditorias. _Fato citado:_ flexibilidade
  analítica e seleção pós-hoc elevam falsos positivos muito acima do alpha nominal.
- **Benjamini & Yekutieli, 2005 — False Discovery Rate–Adjusted Multiple Confidence Intervals
  for Selected Parameters** (JASA 100(469):71–81).
  [link](https://doi.org/10.1198/016214504000001907)
  _Âncora:_ núcleo da rejeição do Regime 2 na forma forte — o intervalo do release **selecionado**
  não mantém cobertura de 95% nominal sem ajuste por seleção. _Onde no projeto:_ estado
  § "Decisão 1 — Regime 2"; plano v3 § A7. _Fato citado:_ intervalos de confiança apresentados
  após seleção podem perder cobertura nominal.
- **Dror, Baumer, Shlomov & Reichart, 2018 — The Hitchhiker's Guide to Testing Statistical
  Significance in Natural Language Processing** (ACL 2018).
  [link](https://aclanthology.org/P18-1128/)
  _Âncora:_ aplicar Bonferroni com `m` congelado é prática **acima** da área. _Onde no
  projeto:_ plano v3 § A6 e § H2; `benchmark/gates.ts:186-192`. _Fato citado:_ "statistical
  significance testing is often ignored or misused" em papers de ACL/TACL 2017.
- **Dror, Baumer, Bogomolov & Reichart, 2017 — Replicability Analysis for Natural Language
  Processing** (TACL 5). [link](https://aclanthology.org/Q17-1033/)
  _Âncora:_ a decisão de multiplicidade **com nuance**: correção não é prática corrente na área,
  mas Bonferroni puro perde poder — deixa em aberto considerar Benjamini-Hochberg. _Onde no
  projeto:_ plano v3 § H2 "Multiplicidade declarada". _Fato citado:_ qualifica comparação em
  múltiplos datasets sem correção como "statistically unjustified" e recomenda métodos mais
  poderosos que Bonferroni.
- **Miller, 2024 — Adding Error Bars to Evals** (arXiv 2411.00640).
  [link](https://arxiv.org/abs/2411.00640)
  _Âncora:_ dimensionamento do `cal-B` por **cluster**, não por registro-linha. _Onde no
  projeto:_ plano v3 § D0b; `benchmark/rebuild-v3-policy.json` (`powerFloors`). _Fato citado:_
  "evaluations are experiments"; formaliza erro-padrão agrupado e inferência pareada.

### 2.2b Onde os números da Fase 0.2 passaram a viver (2026-07-31)

Esta subseção não traz fonte nova: as fontes de Bonferroni (§ 2.2), de pré-registro
(§ 2.1, Nosek et al. 2018) e da cota sob zero eventos (§ 3.2) já estavam aqui. O que faltava era a
**âncora** — a decisão que elas sustentam existia como faixa, e faixa não é pré-registro.

- **`m = 4`, com a família nomeada** — FPR do pior estrato core, recall no limiar, calibração
  global, integridade. _Onde no projeto:_ `benchmark/rebuild-v3-policy.json`
  (`multiplicity.primaryFamily`, `multiplicity.primaryFamilySize`); plano v1 § 0.2; registro § B3.
  _Por que a âncora importa:_ o plano carregou "m = 3–6", e nesse intervalo o α por hipótese anda
  de 0,0167 a 0,0083. Um `m = 61` anterior era pior que vago — α = 0,00082 dava cota de 2,8026 %
  em n=250, quando publicar perto de 1 % exigiria 707 registros por célula.
- **α por hipótese = 0,0125 e as cotas 1,7375 % (n=250) / 0,8522 % (n=512)** — recomputados no
  load a partir de `familyAlpha / m` e de `1 − α^(1/n)`, e não conferidos à mão. _Onde no
  projeto:_ `benchmark/rebuild-v3-policy.ts` (`derivedAlpha`, `zeroEventCeiling`);
  `preRegistration.zeroEventCeiling`. _Fato citado:_ a construção da cota sob zero eventos é a de
  § 3.2; o que este commit acrescenta é `n` explícito, sem o qual a cota não é pré-registro.
- **Unidade do inventário de poder = componentes conectados** — não linhas. _Onde no projeto:_
  `preRegistration.powerInventoryUnit`; `powerFloors.samplingUnits` (250, era `null`). A âncora de
  inferência cluster-robusta é a de § 4.1: `criticalFprHumanNegatives: 300` conta **linhas** e
  permanece, porque 300 linhas de um cluster são 300 linhas e uma unidade.

**Sem precedente encontrado (2026-07-31)**, duas práticas de engenharia deste commit:

1. **Valor derivado escrito E recomputado, com divergência fatal.** O α por hipótese e as duas
   cotas estão no arquivo porque quem audita a cota não deveria precisar dividir, e são derivados
   no load porque escrito-sem-derivar é o defeito que a auditoria externa encontrou: o α de
   família ficou 0,05 enquanto `m` se mexia. Não foi encontrada prática equivalente em
   pré-registro de ML — os registros da área são prosa ou formulário, sem validador.
2. **Fonte recusada por nome, não por ausência.** A1 mantém `pt-stackoverflow` em
   `humanSources.blockedSnapshots` com razão e condição de desbloqueio, e mantém a declaração da
   fonte em `A1_BLOCKED_HUMAN_SOURCES`, em vez de apagar as duas. O motivo é que a auditoria de
   vazamento que **não conhece** uma fonte fica quieta sobre os registros dela em vez de
   reprovar. Precedente parcial: revogação em transparência de certificados (§ 9), onde o
   certificado revogado permanece listado. Não foi encontrado análogo em governança de corpus.

### 2.2c O contrato de quase-duplicata, e o que ele não é (Fase 1, 2026-07-31)

As fontes do contrato — shingles de 5 tokens, MinHash como *screen* com erro padrão declarado —
já estão em "Técnicas de implementação" (Broder e seguintes). O que faltava aqui é a **âncora
negativa**: o que o contrato não sustenta.

- **Âncora:** `near_dupes.drop_seen()` prova, para todo id que ele não devolve, ausência de
  duplicata exata de conteúdo tokenizado e ausência de quase-duplicata sob Jaccard ≥ 0,82 sobre
  shingles de 5 tokens, medido contra `train.jsonl` + `dev.jsonl`. **Não** prova independência
  semântica entre corpus e treino, e a distinção é imposta por
  `trainingIndependenceOverclaimIn`, não confiada à prosa. _Onde no projeto:_
  `benchmark/lab/near_dupes.py` (`drop_seen`); `benchmark/lab/test_near_dupes.py`;
  `docs/corpus-collection-runbook.md`; plano v1 § Fase 1 item 1; registro § A3.

**Sem precedente encontrado (2026-07-31)** para uma prática vizinha, que vale declarar porque é
onde este projeto se afasta do que a literatura de deduplicação faz: **reportar o custo de recall
de um corte de candidatos junto com o resultado do gate.** A literatura de MinHash/LSH trata o
teto de bucket (ou o número de bandas) como parâmetro de custo e discute o *trade-off* de
recall em agregado; não foi encontrada prática de publicar, por execução, quantos buckets o teto
descartou — que é o número que torna auditável quanto o gate deixou de olhar. `drop_seen` deixou de
aplicar o teto (a justificativa quadrática do `prune()` não vale nesse caminho) e passou a reportar
`buckets_over_prune_cap` e `candidates_evaluated` para que a mudança seja mensurável e não uma
afirmação.

### 2.2d As cinco partições, e o que o mecanismo delas garante (E2, 2026-07-31)

As fontes já estão aqui: a colocalização por componente conexa é § 4.1, o `cal-B` conformal é
§ 3.1 e o pré-registro das frações é § 2.1. O que esta subseção acrescenta é a **âncora do que o
mecanismo entrega**, porque a promessa mais forte que o splitter de cinco partições sustenta é
mais fraca que a leitura natural de "cinco blocos temporais".

- **Âncora:** para o corpus entregue ao comando, `createBlockedSplit` atribui cada componente
  conexo inteiro a exatamente uma de `train/dev/cal-A/cal-B/test`, com toda família held-out
  declarada inteiramente em `test`, `earliest(test) > latest(cada uma das outras quatro)`, `dev`,
  `cal-A` e `cal-B` estritamente ordenados entre si, e `|fração − alvo| ≤ 0,02` para toda classe e
  toda partição sobre 45/5/10/20/20 — **ou lança sem escrever nenhuma SAÍDA**. Duas correções de
  alcance, ambas porque a forma universal era falsa: o comando abre as ENTRADAS antes de calcular,
  então a promessa é sobre saídas e não sobre todo acesso a arquivo; e a publicação renomeia
  `split-artifact.json` por último, então uma falha ao publicar pode deixar partições sem artefato,
  nunca artefato sem partições. _Onde no projeto:_ `benchmark/split.ts` (`PARTITIONS`, `assignPartition`),
  `benchmark/split-audit.ts` (a cadeia temporal e a checagem de frações); plano v1 § Fase 1 item 5;
  registro § "Unidade 3 — E2".
- **Âncora negativa, que é a que importa:** `train` **não integra a cadeia** das três partições
  médias. É o fallback e recebe todo componente que atravessa um corte, então um registro de `train`
  pode ser mais novo que um de `cal-B` por desenho. As três partições do MEIO (`dev`, `cal-A`,
  `cal-B`) são estritamente ordenadas `earliest` contra `latest`, porque cada uma só contém
  componentes inteiramente dentro da sua banda. **A separação estrita contra `test` vale para as
  quatro, `train` incluída** — precisamente porque, sendo o fallback, `train` alcançar o início de
  `test` é vazamento real. Publicar "cinco blocos estritamente ordenados" seria promessa universal
  falsa; omitir a exceção de `test` seria a promessa oposta, igualmente falsa. _Onde no projeto:_ `benchmark/split-audit.ts` (`middleIsOrdered` e
  `testIsStrictlyNewest`, com os comentários que dizem por quê).
- **`classTolerance` continua 0,02 ABSOLUTO para as cinco.** _Fato citado:_ nenhuma fonte desta
  bibliografia fixa tolerância de fração de classe; o número vem do desenho da Fase 2 e foi
  mantido. _Consequência declarada:_ o alvo de `dev` é 0,05, logo ±0,02 é ±40% relativo, e um
  `dev` com 3% ou 7% dos registros de uma classe é legal. Isso está escrito no tipo, em
  `BlockedSplitPolicy.classTolerance`.

**Sem precedente encontrado (2026-07-31)** para a prática de engenharia que a migração exigiu:

1. **Busca de cortes com grade de tamanho FIXO e poda admissível, num caminho selado.** A busca
   de dois cortes enumerava todo tempo distinto numa janela (O(k²)); com quatro cortes a mesma
   forma é O(k⁴) e não termina. A generalização usa uma grade de tamanho fixo por corte — então o
   número de folhas é limitado por construção e nenhum corpus é recusado por ser grande — mais
   duas cotas de infactibilidade que são admissíveis e não heurísticas: `train` só RECEBE massa
   (é o fallback), logo seu realizado é ≥ a banda; as partições do meio só PERDEM massa para
   `train`, logo o realizado é ≤ a banda. As duas valem sobre a fração agregada porque ela é média
   ponderada das frações por classe. A técnica de cota admissível é a de *branch and bound*
   (Land & Doig, 1960, Econometrica 28(3):497–520,
   [DOI](https://doi.org/10.2307/1910129)); o que não foi encontrado é o uso dela para tornar
   **auditável** um split de corpus — a literatura de detecção de MGT descreve splits como
   aleatórios ou por título e não publica o procedimento de busca. _Ressalva de verificação:_ a
   referência Land & Doig é citada de conhecimento estabelecido; o DOI **não** foi aberto nesta
   sessão, e a atribuição da técnica (não o seu uso aqui) permanece **não verificada em fonte**.
2. **Buscar heurístico e verificar o contrato inteiro depois.** O mecanismo de busca é heurístico
   e a promessa não é: o que a busca devolve é checado por inteiro pelo chamador e pela auditoria
   independente, e restrição não satisfeita vira recusa e não alegação publicada. O preço, dito
   porque é real: uma busca mais estreita recusa mais corpora **factíveis**. Não foi encontrada
   prática equivalente em montagem de corpus; a área publica o split, não a recusa.

### 2.2e Onde o piso de poder do split passou a viver (F1-5n, 2026-08-01)

Esta subseção não traz fonte nova: a cota sob zero eventos é § 3.2, a inferência cluster-robusta é
§ 4.1 e o pré-registro é § 2.1. O que faltava é a **âncora da unidade** — qual objeto o piso conta.

- **Âncora:** o piso que vincula o split conta **componentes conectados independentes por célula de
  cota, em cada partição** (`n ≥ 250`, para teto de 1,7375% sob zero eventos), e **não** linhas
  humanas agregadas no bloco cego. _Onde no projeto:_
  `benchmark/rebuild-v3-policy.json` (`preRegistration.powerInventoryUnit`,
  `preRegistration.zeroEventCeiling`); gate em `benchmark/commands/split.ts`
  (`COMPOSITION_FLOOR_NOT_APPLIED`, renomeado por F1-5o); registro § "Unidade 3 — E2", F1-5n e F1-5o.
  **Superado por § K14 (2026-08-04):** o piso vigente é 300 (não 250), vale por célula × `test` (não por
  partição), conta TRÊS quantidades, e o gate vive em `benchmark/composition-gate.ts` sob
  `COMPOSITION_BOUNDS_NOT_MET`. O 250 está em ESTADO.md § 6, NÃO APLICAR.
- **Âncora negativa, que é a razão da decisão:** uma contagem de linhas não sustenta a cota. Ela
  erra nas duas direções — recusa um corpus que TEM 250 componentes por célula, e aceita 2.000
  linhas colapsadas em poucos componentes ou concentradas numa única célula. É a mesma distinção que
  § 4.1 estabelece para o HC3 e o MGTBench, aplicada ao piso em vez de ao split.
  `powerFloors.criticalFprHumanNegatives: 300` permanece em LINHAS de propósito e continua publicado
  como elegibilidade de fatia, não como reprovação — 300 linhas de um cluster são 300 linhas e uma
  unidade, como § 2.2b já registrava.
- **A contagem de linhas continua publicada**, em `audit.testHumanNegatives`
  (`count`, `reportingThreshold`, `sufficientForReleaseFpr`). Publicar a oferta e não gatear nela é
  a mesma separação que `benchmark/split-audit.ts` já aplica às fatias críticas.

**Sem precedente encontrado (2026-08-01)** para a prática de engenharia da decisão: **um gate
deliberadamente insatisfazível, em código, no lugar de um gate mal dimensionado.** O congelamento de
corpus de `release` passa a ser recusado até existir o atestado de composição — então a
indisponibilidade do release é uma decisão explícita e testada, e não uma consequência silenciosa de
um número que ninguém conseguia satisfazer. A literatura de pré-registro descreve critérios de
parada e de exclusão; não foi encontrada prática de deixar o gate no repositório **falhando por
desenho** enquanto a evidência que ele exige não existe. A alternativa usual — afrouxar o número até
o corpus passar — é a cota frouxa que a regra 1 do bloco D deste projeto proíbe.

> **Emendado em 2026-08-01 por F1-5o (ver § 2.2f).** O parágrafo acima descrevia o atestado como
> evidência que "não existe". Isso valia enquanto o atestado era uma `string` fornecida pelo chamador
> — e era justamente o defeito: um gate satisfeito por qualquer texto não recusa nada. O atestado
> passou a ser **derivado** do corpus, logo é verificável hoje. O que continua fora desta unidade é o
> JULGAMENTO de suficiência do inventário, e é lá, não na existência do atestado, que a
> indisponibilidade do release se decide.

### 2.2f Atestado derivado e seed vinculada à pré-registração (F1-5o e F1-5p, 2026-08-01)

Duas decisões do mesmo diagnóstico: **um parâmetro que o chamador escolhe não é evidência de nada.**

- **F1-5o — o atestado de composição é DERIVADO, não fornecido.** _Âncora:_ o atestado é o digest
  canônico do inventário por partição e por classe de **linhas-registro e componentes conectados
  independentes**, recomputado dos registros e das atribuições; o validador o recalcula e recusa
  divergência. _Por que os dois números:_ é a mesma distinção de unidade de § 4.1 e § 2.2e — linhas
  dizem quanto texto existe, componentes dizem quantas observações independentes ele carrega, e as
  duas divergem por ordens de magnitude num corpus cujas linhas compartilham gerador, lote de coleta
  ou cadeia de derivação. _Onde no projeto:_ `benchmark/split-artifact.ts`
  (`compositionAttestationOf`, `SPLIT_ARTIFACT_COMPOSITION_ATTESTATION_MISMATCH`), e
  `benchmark/commands/publish-evidence.ts` para a metade decidível sem dataset (o pareamento
  `release` ⇒ atestado não-nulo). _Âncora negativa:_ a versão anterior aceitava qualquer string com
  `length > 0`, então `"x"` bastava — medido pelo cross-review.
- **F1-5p — a seed do split é vinculada à autoridade congelada, e deixa de ser apresentada como
  proveniência causal.** _Âncora:_ § 2.1 (pré-registro) — parâmetro fixado de antemão é lido do
  documento que o fixou, não aceito do chamador. `REBUILD_V3_POLICY.seeds.split` (20260726) passa a
  ser o único valor aceito pelo comando e pelo validador. _Fato medido que motiva a segunda metade:_
  o splitter **não consome aleatoriedade** — a colocação é função pura dos registros, das frações, da
  tolerância e da reserva, porque `assignPartition` decide por banda temporal e cortes e cada
  partição é reordenada por `id` no fim. A seed alimenta apenas o desempate de ordenação de
  componentes, que não altera `id → partição`. Publicá-la como proveniência causal seria alegação
  vazia; o que a torna verificável é a pré-registração nomear o valor. _Âncora negativa:_ os fixtures
  usavam `712019`, que é `seeds.publishableCheckpoint` — autoridade de outro propósito — e a
  documentação operacional mandava `--seed 1` e `--seed 712019` para o split.

**Sem precedente encontrado (2026-08-01)** para a prática de engenharia das duas: **derivar o
atestado do próprio objeto atestado** (em vez de recebê-lo de um produtor externo) e **recusar em
código qualquer seed que não seja a pré-registrada**. A literatura de pré-registro e de
reprodutibilidade trata a semente como algo a *declarar*; não foi encontrada prática de o artefato
verificar, contra o documento de pré-registro, que a semente declarada é a permitida — nem de
declarar explicitamente que a semente não seleciona entre resultados quando o algoritmo é
determinístico. A alternativa usual é publicar a semente e confiar, o que é exatamente a alegação
vazia que F1-5p remove.

### 2.2g Abandonar uma pré-inscrição inviável em vez de emendá-la (F1-5q, 2026-08-01)

A decisão não é sobre qual número usar; é sobre **quando é legítimo trocar o alvo**. Descobriu-se que a
estrutura de GRUPOS do corpus não admite o split pré-registrado, e havia duas formas de reagir: emendar
a proporção até caber, ou abandonar a pré-inscrição e publicar outra, prospectiva.

- **Âncora:** a distinção que sustenta a pré-inscrição é entre **predição e postdição** — o valor do
  documento é registrar o que foi decidido ANTES de ver os dados, e uma emenda feita depois de observar
  a estrutura converte predição em postdição sem deixar rastro. _Fonte:_ **Nosek, Ebersole, DeHaven &
  Mellor, 2018 — The preregistration revolution** (PNAS 115(11):2600–2606).
  [link](https://doi.org/10.1073/pnas.1708274114) _Fato citado:_ a pré-inscrição não é camisa de força e
  desvios são aceitáveis, mas têm de ser **transparentes**, porque o que ela protege é a possibilidade
  de distinguir hipótese de descoberta pós-hoc.
- **Âncora do formato:** o mecanismo de registrar o desenho antes da coleta e submetê-lo a revisão
  independente é o Registered Report. _Fonte:_ **Chambers, 2013 — Registered Reports: a new publishing
  initiative at Cortex** (Cortex 49(3):609–610).
  [link](https://doi.org/10.1016/j.cortex.2012.12.016) _Fato citado:_ o desenho e o plano analítico são
  fixados e avaliados antes de os resultados existirem.
- **O que a decisão explora, e é a razão de ela ser legítima:** a inviabilidade foi constatada sobre a
  estrutura de agrupamento — tamanhos de componentes conectados — e **não sobre resultados do bloco
  cego**, que não foi consultado. Trocar o alvo por causa dos resultados seria postdição; abandonar por
  causa da estrutura, antes de qualquer medição de desempenho, não é. _Onde no projeto:_ registro
  § "F1-5q"; a inviabilidade medida em § "Consenso sobre o garfo do `collectionBatch`".
- **Âncora da separação de eixos:** um eixo que é ao mesmo tempo unidade de dependência e estrato de
  relato impede que aquisições independentes ajudem o split. A distinção entre **unidade de
  amostragem** e **variável de estratificação** é a mesma de § 4.1, aplicada agora à identidade do
  material e não à inferência: `domainSource` fica como estrato, e a dependência passa a
  `sourceMaterialBatch`.

**Sem precedente encontrado (2026-08-01)** para a prática de engenharia específica: **preservar a
pré-inscrição abandonada como artefato imutável no repositório, marcada com o motivo e os números da
inviabilidade, e publicar a nova sob novo dataset ID** — em vez de editar o documento existente. A
literatura trata de desvio declarado e de retirada de estudo; não foi encontrada prática de manter as
duas versões coexistindo no mesmo repositório de código, com a antiga legível e explicitamente morta.
O motivo de fazer assim é o mesmo que vale para o resto deste projeto: uma autoridade editada em
silêncio é indistinguível de uma autoridade que sempre disse aquilo.

### 2.2h Um eixo por fato: lote de material, lote de geração e execução de extração (Commit A da Fase 1, 2026-08-04)

O esquema v3 tinha **um** eixo de lote (`collectionBatch`) e deixava a classe da linha decidir o que ele
significava: `gb_*` numa linha gerada (uma receita que o manifesto revisado publica), `extraction_*` numa
humana (uma execução de extrator), e o **material** de onde a linha humana veio não era registrado em
lugar nenhum. O v4 separa os três: `sourceMaterialBatch`, `generationBatch` e `extractionRun`.

- **Âncora da separação entre lote e execução:** o que conta como uma unidade independente é o **evento
  de aquisição**, não a execução que leu os bytes — reextrair o mesmo dump não produz material novo, e
  tratar duas execuções como duas unidades conta a mesma dependência duas vezes. É a distinção entre
  **unidade de amostragem** e operação de processamento, a mesma de § 4.1 aplicada à identidade do
  material. _Fonte:_ **Gebru et al., 2021 — Datasheets for Datasets** (Communications of the ACM
  64(12):86–92). [link](https://doi.org/10.1145/3458723) _Fato citado:_ o datasheet exige declarar
  **quando e como** cada porção foi coletada e a **versão/instantâneo** de onde veio, como fatos
  distintos do pipeline que os processou.
- **Âncora da rastreabilidade da execução:** um identificador de execução existe para que um defeito
  volte à corrida que o produziu, e é por isso que ele é **diagnóstico** e não unidade de dependência.
  _Fonte:_ **W3C PROV-DM, 2013 — The PROV Data Model** (W3C Recommendation).
  [link](https://www.w3.org/TR/prov-dm/) _Fato citado:_ o modelo distingue `Entity` (o material),
  `Activity` (a execução que o usou) e `Agent`, e a proveniência de uma entidade é dada pela atividade
  que a gerou — duas atividades sobre a mesma entidade não criam duas entidades.
- **Âncora do inventário obrigatório e coberto por digest:** o lote declarado no manifesto é o que torna
  a dependência conferível por terceiro; fora da projeção do digest, o inventário seria forjável.
  _Fonte:_ **Merkle, 1988 — A digital signature based on a conventional encryption function**
  (CRYPTO '87, LNCS 293:369–378). [link](https://doi.org/10.1007/3-540-48184-2_32) _Fato citado:_ a
  cobertura por digest é o que faz uma declaração ser verificável em vez de apenas afirmada; a chave
  fora da projeção não é coberta e a declaração volta a valer apenas pela palavra de quem escreveu.
- **O que a decisão explora:** a dependência de material de uma linha GERADA não é perdida ao marcar
  `sourceMaterialBatch: notApplicable` — ela viaja por `humanSeed`/`derivationRoot` até a linha humana
  que foi adquirida, e é ELA que nomeia o lote. Escrever um lote na linha gerada afirmaria que o texto
  foi adquirido, quando foi produzido. _Onde no projeto:_ `benchmark/schema.ts` (`V4_GROUP_AXES`,
  `AXIS_STATE_RULE`), `benchmark/source-manifest.ts` (`ReviewedSourceManifestV2`), e o vocabulário
  completo em `docs/superpowers/plans/2026-08-02-lotes-e-unidade-de-dependencia.md`.

**Sem precedente encontrado (2026-08-04)** para a regra de estado específica: **recusar o registro por
inteiro quando o eixo de lote de material não resolve, em vez de admitir `unknown` com custo de
elegibilidade**. A literatura de proveniência trata de campos ausentes como lacuna documentada; não foi
encontrada prática de tornar a linha *inescrevível*. O motivo de fazer assim é medido no próprio
projeto: um valor derivado do estrato (`extraction_<domainSource>`) faz toda verificação a jusante passar
e resolve contra nenhum lote declarado, então a alternativa a recusar é publicar um agrupamento que
ninguém pode conferir.

#### 2.2h-bis Quem nomeia o lote, e o que segurar a aquisição implica (cross-review do Commit A, 2026-08-04)

Três decisões que a revisão adversarial do Commit A forçou a escrever, todas ancoradas nas mesmas fontes
de 2.2h:

- **O EXTRATOR nomeia o evento de aquisição, e recusa a corrida sem ele.** O lote sai de
  `--snapshot-version` (a versão concreta do dump ou do pacote) no extrator, não do carregador nem do
  montador: só quem abriu o material sabe qual material abriu. Uma acquisição de um instantâneo é **um**
  lote, e as tipologias que o extrator recorta depois dele são partições daquele download, não aquisições
  separadas — é a mesma medição de G0.1-bis que manteve o eixo fora da união do split. _Fato citado
  (PROV-DM):_ a `Activity` que `used` a `Entity` é o único ponto do grafo que pode atestar qual entidade
  foi usada; uma etapa a jusante que batize a entidade está inventando a aresta. _Fato citado (Gebru et
  al.):_ o datasheet exige a **versão/instantâneo** de onde a porção veio, registrada por quem coletou.
  **Custo de reversão:** baixo — `--snapshot-version` volta a ser opcional e o campo volta a sair do
  carimbo do carregador; mas aí o lote passa a ser um por ARQUIVO DE POOL, que é um agrupamento inventado.
- **Segurar a aquisição implica que uma execução nossa a leu.** Na coorte `mixed-ecological` — a única em
  que a tabela admite as duas metades independentemente — `sourceMaterialBatch: known` com
  `extractionRun` não-`known` é uma contradição: ou detemos o evento de aquisição do documento e alguma
  execução nossa o leu, ou não detemos nenhum dos dois. _Fato citado (PROV-DM):_ `wasDerivedFrom` entre
  duas entidades pressupõe a atividade que fez a derivação; uma entidade nossa sem atividade nenhuma é
  uma aresta sem nó. **Custo de reversão:** baixo (uma condição e dois testes), e reverter volta a
  admitir o par que a revisão mediu no próprio fixture canônico.
- **A auditoria de governança é onde o cruzamento registro↔manifesto roda.** `auditCorpusSources` é a
  única etapa que tem os registros E o inventário revisado na mesma chamada, e o vocabulário fechado de
  `contracts/source-readiness.ts` já tem os dois códigos necessários — `SOURCE_REFERENCE_MISSING` para
  "a referência que o registro declara para dentro do manifesto não resolve" e
  `GENERATION_RECIPE_MISMATCH` para "uma linha não gerada nomeia um lote de geração", que é o mesmo fato
  que o ramo de linha humana já reporta com esse código. _Fato citado (Merkle):_ a declaração só vale
  como verificável enquanto está coberta pelo digest — e é por isso que o cruzamento tem de ser contra o
  inventário selado, não contra uma lista passada à parte. **Custo de reversão:** baixo (um sítio de
  chamada), e o custo de NÃO fiar é o medido pela revisão: a propriedade existiria numa função e em
  nenhum pipeline.

#### 2.2h-ter O PRODUTOR do inventário: declarado no writer, e recusa antes de escrever (Fase 3, item 1, 2026-08-06)

O consumidor do inventário existia desde o Commit A (`auditCorpusSources` cruza
`groups.sourceMaterialBatch` contra `materialBatches`); o **produtor** não. `build_governance.ts` passa a
escrever manifesto **v2** com um lote declarado, e a declaração vive no writer em vez de vir dos pools.

- **Âncora de quem declara:** dos cinco campos de um lote, três — `materialVersion`, `acquisitionWindow`
  e `evidence` — são fatos de um evento de aquisição que **nenhum código deste repositório observou**, e
  não são recuperáveis dos pools. Quem coletou declara; um pipeline que os sintetizasse publicaria
  proveniência que ninguém adquiriu. _Fonte:_ **Gebru et al., 2021 — Datasheets for Datasets**
  (Communications of the ACM 64(12):86–92). [link](https://doi.org/10.1145/3458723) _Fato citado:_ o
  datasheet é preenchido pela equipe que **coletou** a porção, e declara quando/como foi coletada e a
  versão do instantâneo — não é derivado do artefato processado.
- **Âncora da janela pontual e da evidência de terceiro:** uma aquisição instantânea é
  `startedAt === endedAt`, e o que a torna conferível é o par digest + tamanho do arquivo mais o
  endereço público do instantâneo. O `mtime` do arquivo em disco é **evidência**, não declaração: nada
  nele distingue "baixado então" de "copiado então", e é por isso que a janela foi ratificada em vez de
  computada. _Fonte:_ **W3C PROV-DM, 2013 — The PROV Data Model** (W3C Recommendation).
  [link](https://www.w3.org/TR/prov-dm/) _Fato citado:_ o modelo trata a atribuição temporal de uma
  `Activity` como asserção de um `Agent`, distinta de qualquer traço que a entidade carregue.
- **O que a decisão explora:** a declaração fica em código versionado e revisado, e não num JSON de
  `benchmark/data/` (gitignored) nem num campo de `governance-inputs.json`. As duas alternativas seriam
  forjáveis pelo próprio passo que consome o inventário, e o digest do manifesto cobriria a forja.
  _Onde no projeto:_ `benchmark/lab/build_governance.ts` (`DECLARED_MATERIAL_BATCHES`),
  `benchmark/tests/build-governance.test.ts`.

**Sem precedente encontrado (2026-08-06)** para a direção da recusa: **o PRODUTOR recusar escrever um
inventário vazio, em vez de escrevê-lo e deixar o consumidor bloquear linha por linha**. A literatura de
proveniência descreve o que documentar e quem documenta, e a de integridade descreve como cobrir a
declaração por digest; não foi encontrada prática de fail-closed no escritor. A razão é medida no próprio
projeto: um manifesto v2 com `materialBatches: []` é válido para o parser, tem digest correto e faz
`auditCorpusSources` bloquear **toda** linha humana com `SOURCE_REFERENCE_MISSING` — o operador recebe
4.000 recusas idênticas em vez de uma frase sobre o inventário, e o arquivo escrito parece revisado.

### 2.2i Eixo REPORTADO contra eixo de UNIÃO: a lista de conectividade v4 (Commit B da Fase 1, 2026-08-04)

`GROUP_KEYS` (`benchmark/split.ts`) passa a nomear sete eixos — `author`, `source`,
`generatorVersion`, `promptTemplate`, `generationBatch`, `nearDuplicate`, `derivationRoot`.
`domainSource` sai, `sourceMaterialBatch` não entra, `extractionRun` nunca entra. Os dois primeiros
viram eixos **reportados**: a auditoria publica o inventário deles por partição
(`REPORTED_GROUP_AXES` em `benchmark/split-audit.ts`) e nenhum é usado para unir componente.

Esta subseção não traz fonte nova: as âncoras são § 2.2g (unidade de amostragem contra variável de
estratificação), § 2.2h (um eixo por fato) e as entradas de inferência clusterizada de § 4.1.

- **Âncora do número de unidades, não de linhas:** o inventário real é **um evento de aquisição por
  fonte** — um download do dump da Wikipédia, um download do pacote da Carolina, cujas tipologias são
  partições daquele download e não aquisições separadas. Unir por qualquer dos dois eixos grossos faz
  cada célula de cota virar **um** componente indivisível: as frações humanas por partição passam a ser
  múltiplos de ~25 %, o alvo de `dev` (0,05) fica inalcançável por construção, e um piso contado em
  **unidades independentes** lê 1 por célula para sempre. _Fonte:_ **Cameron & Miller, 2015**
  (§ 4.1). [link](https://doi.org/10.3368/jhr.50.2.317) _Fato citado:_ a unidade de inferência é o
  cluster inteiro, e é o **número de clusters** — não o número de linhas — que governa o que se pode
  afirmar. _Fonte:_ **Kish, 1965** (§ 4.1).
  [link](https://www.wiley.com/en-us/Survey+Sampling-p-9780471109495) _Fato citado:_ efeito de desenho
  `1 + (m̄ − 1)·ICC`: com m̄ igual à célula inteira, o tamanho efetivo colapsa para a contagem de
  clusters.
- **O que a decisão explora:** a dependência que os dois eixos declaram **não é perdida**. Ela é
  registrada: `sourceMaterialBatch` é a unidade declarada de dependência ENTRE aquisições, resolve
  contra o inventário do manifesto revisado (§ 2.2h) e é declarado por toda fonte humana em
  `declaredGroupAxes`. O que essa declaração alcança é **estreito e vale dizer qual recusa é de quem**:
  numa linha humana `unknown` é erro do **validador** (a tabela de estados só admite `known` ali), e um
  lote que não resolve contra o inventário é recusado por `auditCorpusSources`; a lacuna declarada
  alcança a coorte `mixed-ecological`, cujo evento de aquisição pode legitimamente ser `unknown`, e a
  linha que não tem a chave. As duas passam pelo validador, e a auditoria é o único estágio que as
  reprova. A dependência INTRA-célula continua
  com `author`, `source` (o documento de origem), `nearDuplicate` e a linhagem. _Fonte:_ **Cochran,
  1977** (§ 4.1). [link](https://www.wiley.com/en-us/Sampling+Techniques,+3rd+Edition-p-9780471162407)
  _Fato citado:_ estrato e unidade de amostragem são papéis distintos do desenho; um estrato descreve a
  população e não é a unidade cuja variabilidade se estima. **Custo de reversão:** baixo em linhas (uma
  tupla em `split.ts` e o espelho em `benchmark/lab/assemble_corpus.py`) e alto em consequência:
  `benchmark/lab/test_connectivity_feasibility.py` mede as duas direções, e devolver qualquer dos dois
  eixos à união torna o corpo de lote-único-por-célula inviável — pelo MENOR componente com o estrato
  (quatro de 25 %), pelo MAIOR com o lote (um de 75 %, porque as três tipologias da Carolina saem do
  mesmo download).
- **`extractionRun` é diagnóstico e nunca une:** reextrair o mesmo dump não produz material novo, então
  tratar duas execuções como duas unidades conta a mesma dependência duas vezes — a mesma âncora de
  PROV-DM que § 2.2h usa para separar `Entity` de `Activity`.
  [link](https://www.w3.org/TR/prov-dm/)

**Sem precedente encontrado (2026-08-04)** para a prática específica: **publicar, no artefato de
auditoria selado, o inventário por partição de um eixo que o particionador deliberadamente NÃO usa para
agrupar, com a relação de união declarada por eixo (`sharedValue: false`) ao lado da contagem**. A
literatura de amostragem distingue estrato de cluster no desenho, e a de proveniência exige declarar os
campos; não foi encontrada prática de publicar as duas coisas na mesma linha de um relatório verificável.
O motivo de fazer assim é medido: um eixo com uma contagem alta ao lado de nenhuma declaração de relação
foi lido, neste projeto, como "um bloco indivisível" sobre linhas que o particionador havia acabado de
pôr em lados opostos do corte — e um eixo ausente do relatório é um eixo que ninguém a jusante pode
conferir.

### 2.2j Ratificar a regra de elegibilidade do bloco cego ANTES do primeiro evento (2026-08-05)

As fontes já estão aqui: o pré-registro das frações e dos gates é § 2.1, a cegueira informacional é § 1.1,
e o ledger encadeado é § "Integridade, custódia e falha fechada". O que esta subseção acrescenta é a âncora
do **INSTANTE**: o que foi ratificado não é qual partição barra cluster exposto — isso já estava
implementado e medido —, e sim que a regra fosse fixada enquanto o ledger que ela governa está **vazio**.

A regra é **de oferta**: decide o que uma requisição pode reivindicar agora e não reinterpreta evento já
gravado. Com zero eventos em disco ela se aplica uniformemente a toda a história do artefato; ratificada
depois do primeiro evento, o mesmo arquivo append-only fica governado por **duas** regras, e nenhuma
inspeção do artefato diz qual vale para qual linha sem datar cada evento contra a data da política.

- **Nosek, Ebersole, DeHaven & Mellor, 2018 — The preregistration revolution** (PNAS
  115(11):2600–2606). [link](https://doi.org/10.1073/pnas.1708274114)
  _Âncora:_ a assimetria entre predição e postdição — regra escrita antes do dado é desenho, escrita depois
  é descrição do que se viu. Aqui o "dado" é o evento de exposição, não a medida.
- **Haber & Stornetta, 1991 — How to Time-Stamp a Digital Document** (Journal of Cryptology
  3:99–111). [link](https://doi.org/10.1007/BF00196791)
  _Âncora:_ o encadeamento existe para tornar a ordem dos eventos verificável sem confiar em quem os
  escreveu; política que muda no meio da cadeia devolve ao leitor exatamente a pergunta que a cadeia
  responde.

**A transferência, e o que não se transfere:** nenhuma das duas fontes trata de elegibilidade de partição
cega. O que se transfere é a forma do argumento — regra fixada antes do primeiro dado, sobre um registro
cuja ordem é verificável. **Sem precedente encontrado (2026-08-05)** para o caso específico: escolher o
instante da ratificação de uma regra de admissão a bloco cego pelo estado do ledger de exposição (zero
eventos), para que a política não parta a história do próprio ledger em dois regimes.

### 2.3 Olhares repetidos nos dados e sequências sem teto

- **Pocock, 1977 — Group sequential methods in the design and analysis of clinical trials**
  (Biometrika 64(2):191–199). [link](https://doi.org/10.1093/biomet/64.2.191)
  _Âncora:_ Decisão 1 / Regime 2 — `FWER = 1 − (1 − 0,05)^K` sobre tentativas de release; é o
  segundo pilar clássico do desenho de grupo sequencial que trata do mesmo problema de
  múltiplos olhares nos dados que o projeto resolveu **por declaração** em vez de gasto de
  alfa espaçado. _Onde no projeto:_ estado § "Decisão 1". _Fato citado:_ divisão da entrada de
  pacientes em grupos com testes de significância repetidos para decidir parar ou continuar.
- **O'Brien & Fleming, 1979 — A multiple testing procedure for clinical trials** (Biometrics
  35(3):549–556). [link](https://doi.org/10.2307/2530245)
  _Âncora:_ o precedente clássico, buscado fora da área de MGT, para a mesma Decisão 1 /
  Regime 2 — o projeto declarou explicitamente **não** adotar controle de FWER entre
  tentativas, e o desenho de grupo sequencial é o ancestral do problema que essa declaração
  dissolve em vez de resolver. _Onde no projeto:_ estado § "Decisão 1". _Fato citado:_
  fronteiras de gasto de alfa para controlar o erro tipo I inflado por múltiplas análises
  interinas.
- **Lan & DeMets, 1983 — Discrete Sequential Boundaries for Clinical Trials** (Biometrika
  70(3):659–663). [link](https://doi.org/10.1093/biomet/70.3.659)
  _Âncora:_ refutação de que "não existe correção estatística" para sequências sem teto de
  tentativas de release. _Onde no projeto:_ auditorias (emenda de futilidade); estado
  § "Decisão 1". _Fato citado:_ alpha-spending permite gastar erro tipo I sequencialmente sem
  precisar de um teto fixo de looks.
- **Tian & Ramdas, 2021 — Online control of the familywise error rate** (Statistical Methods
  in Medical Research 30(4):976–993). [link](https://doi.org/10.1177/0962280220983381)
  _Âncora:_ refutação de que não há correção possível para retries sem número máximo definido
  de tentativas de release. _Onde no projeto:_ estado § "Decisão 1"; auditorias. _Fato citado:_
  tratam explicitamente sequências de testes sem teto via controle online de FWER.
- **Müller & Schäfer, 2004 — A general statistical principle for changing a design any time
  during the course of a trial** (Statistics in Medicine 23(16):2497–2508).
  [link](https://doi.org/10.1002/sim.1852)
  _Âncora:_ possibilidade de adaptação formal do desenho de release sem resetar alpha, contra a
  alegação de impossibilidade de correção. _Onde no projeto:_ auditorias (emenda de
  futilidade). _Fato citado:_ mudanças não planejadas de desenho podem preservar o erro tipo I
  via probabilidade de erro condicional. _Ressalva de verificação:_ entrada marcada como
  divergente em 2026-07-31 — o título real difere do originalmente suposto ("Adaptive group
  sequential designs for clinical trials"); o título acima é o confirmado.
- **Schüler, Kieser & Rauch, 2017 — Choice of futility boundaries for group sequential designs
  with two endpoints** (BMC Medical Research Methodology 17:119).
  [link](https://doi.org/10.1186/s12874-017-0387-4)
  _Âncora:_ delimita o núcleo estreito que a literatura de grupo sequencial realmente sustenta
  — aceita "parada por futilidade não infla alpha", mas rejeita "logo posso reiniciar a 5%".
  _Onde no projeto:_ auditorias (emenda de futilidade). _Fato citado:_ uma fronteira de
  futilidade que só elimina caminhos de rejeição não aumenta o erro tipo I do teste corrente.
- **Howard, Ramdas, McAuliffe & Sekhon, 2021 — Time-uniform, nonparametric, nonasymptotic
  confidence sequences** (The Annals of Statistics 49(2):1055–1080).
  [link](https://doi.org/10.1214/20-AOS1991)
  _Âncora:_ inferência anytime-valid declarada **fora de escopo** — a cota conformal é
  marginal, não simultânea sobre sequência adaptativa de releases. _Onde no projeto:_ plano v3
  § H3b ("QUESTÃO ABERTA"). _Fato citado:_ sequências de confiança time-uniform válidas em
  qualquer momento de parada, ao contrário de garantias marginais fixas.

### 2.4 Inferência pós-seleção

- **Berk, Brown, Buja, Zhang & Zhao, 2013 — Valid post-selection inference** (The Annals of
  Statistics 41(2):802–837). [link](https://doi.org/10.1214/12-AOS1077)
  _Âncora:_ o Wilson calculado nos dados que escolheram o limiar é **nominal** e não certifica —
  renomeado `selectionFprUpper95Nominal`, com `certifiedFprUpper: null`. _Onde no projeto:_
  plano v3 § A7 "O fprUpper95 do fit é diagnóstico, não garantia";
  `benchmark/calibration-pipeline.ts`. _Fato citado:_ inferência calculada nos mesmos dados que
  escolheram o modelo ou o limiar não tem as garantias nominais e exige alargamento simultâneo.
- **Taylor & Tibshirani, 2015 — Statistical learning and selective inference** (PNAS
  112(25):7629–7634). [link](https://doi.org/10.1073/pnas.1507583112)
  _Âncora:_ mesma âncora de Berk et al. — formulação mais recente e aplicada do mesmo problema.
  _Onde no projeto:_ plano v3 § A7; `benchmark/calibration-pipeline.ts`. _Fato citado:_
  ferramentas de inferência seletiva para lidar com o viés introduzido por buscar o melhor
  limiar/modelo nos próprios dados.
- **Cawley & Talbot, 2010 — On Over-fitting in Model Selection and Subsequent Selection Bias
  in Performance Evaluation** (JMLR 11:2079–2107).
  [link](https://www.jmlr.org/papers/v11/cawley10a.html)
  _Âncora:_ proibição de ajustar o calibrador nos dados que escolheram o limiar (separação
  `cal-A` × `cal-B`) e proibição de verificar cobertura conformal no próprio `cal-B`. _Onde no
  projeto:_ plano v3 § G1 ("Proibido") e § G3 (nota final). _Fato citado:_ reusar os mesmos
  dados para selecionar e para avaliar introduz viés otimista de sobreajuste do critério de
  seleção.

### 2.5 Práticas questionáveis, HARKing e viés de gaveta

- **Gencoglu, van Gils, Guldogan, Morikawa, Süzen, Gruber, Leinonen, Huttunen, 2019 — The
  HARK Side of Deep Learning — From Grad Student Descent to Automated Machine Learning**
  (arXiv 1904.07633). [link](https://arxiv.org/abs/1904.07633)
  _Âncora:_ R3 e a decisão de publicar as reprovações de gate, não só as aprovações. _Onde no
  projeto:_ plano v3 § "§0" R3; estado § "Decisão 1 — Regime 2". _Fato citado:_ documenta
  HARKing, a ênfase em métrica única e a tendência a não reportar resultado negativo.
- **Leech, Vazquez, Kupper, Yagudin & Aitchison, 2024 — Questionable practices in machine
  learning** (arXiv 2407.12220). [link](https://arxiv.org/abs/2407.12220)
  _Âncora:_ contexto geral de por que as nove regras invioláveis são necessárias. _Onde no
  projeto:_ plano v3 § "§0". _Fato citado:_ catálogo de 44 práticas problemáticas abaixo de
  fraude declarada em avaliação de ML/LLM.
- **Rosenthal, 1979 — The file drawer problem and tolerance for null results** (Psychological
  Bulletin 86(3):638–641). [link](https://doi.org/10.1037/0033-2909.86.3.638)
  _Âncora:_ publicação obrigatória de **toda** execução certificadora (Regime 2) como
  neutralização do viés de gaveta. _Onde no projeto:_ estado § "Decisão 1"; auditorias. _Fato
  citado:_ viés de gaveta — resultados nulos não publicados distorcem a literatura agregada.
- **110th United States Congress, 2007 — Public Law 110-85, FDA Amendments Act of 2007, Title
  VIII (FDAAA 801)** (U.S. Statutes at Large / govinfo.gov).
  [link](https://www.govinfo.gov/content/pkg/PLAW-110publ85/pdf/PLAW-110publ85.pdf)
  _Âncora:_ Regime 2 — validade por versão com publicação obrigatória de toda execução
  certificadora; é o precedente regulatório de **registro obrigatório** importado de fora da
  área de detecção de MGT. _Onde no projeto:_ estado § "Decisão 1 — Regime 2"; auditorias.
  _Fato citado:_ registro e publicação obrigatória de resultados de ensaios clínicos aplicáveis
  em ClinicalTrials.gov, com penalidades por omissão.

## 3. Predição conformal e cotas de erro

### 3.1 Fundamento e construção da cota

- **Vovk, Gammerman & Shafer, 2005 — Algorithmic Learning in a Random World** (Springer; 2ª
  ed. 2022). [link](https://doi.org/10.1007/b106715)
  _Âncora:_ split conformal unilateral com quantil `k = ceil((n + 1) * (1 - epsilon))` sobre os
  humanos de `cal-B`, e exchangeability declarada como **condição** da cota. _Onde no projeto:_
  plano v3 § G2 item 3 e § G3. _Fato citado:_ estabelece a validade marginal em amostra finita
  da predição conformal sob a hipótese de exchangeability — o texto fundacional para quantis
  conformais split/indutivos.
- **Papadopoulos, Proedrou, Vovk & Gammerman, 2002 — Inductive Confidence Machines for
  Regression** (ECML 2002, LNCS 2430, pp. 345–356).
  [link](https://doi.org/10.1007/3-540-36755-1_29)
  _Âncora:_ o método de construção do limiar conformal em `cal-B` (quantil sobre nonconformity
  scores). _Onde no projeto:_ plano v3 § G2 item 3. _Fato citado:_ introduz o conformal
  split/indutivo — treinar num conjunto próprio e calibrar os scores num conjunto retido,
  evitando retreino do conformal completo.
- **Lei, G'Sell, Rinaldo, Tibshirani & Wasserman, 2018 — Distribution-Free Predictive
  Inference for Regression** (JASA 113(523):1094–1111).
  [link](https://doi.org/10.1080/01621459.2017.1307116)
  _Âncora:_ mesma âncora do split conformal em `cal-B`. _Onde no projeto:_ plano v3 § G2 item 3.
  _Fato citado:_ formaliza e populariza o termo "split conformal inference", com cobertura
  marginal em amostra finita independente do modelo de regressão subjacente.
- **Barber, Candès, Ramdas & Tibshirani, 2021 — The limits of distribution-free conditional
  predictive inference** (Information and Inference 10(2):455–482).
  [link](https://doi.org/10.1093/imaiai/iaaa017)
  _Âncora:_ os limites declarados da garantia — cobertura marginal que **não** transfere entre
  estratos, não cobre recall e não cobre o uso que o leitor faz do sinal. _Onde no projeto:_
  plano v3 § G3 "Validar e selar o contrato conformal", limites (a)/(b)/(c). _Fato citado:_
  resultado de impossibilidade — nenhum método distribution-free garante cobertura condicional
  não trivial em grupos gerais sem hipóteses adicionais.
- **Ding, Angelopoulos, Bates, Jordan & Tibshirani, 2023 — Class-Conditional Conformal
  Prediction with Many Classes** (arXiv 2306.09335).
  [link](https://arxiv.org/abs/2306.09335)
  _Âncora:_ **nomeia** a cota por estrato com termo técnico consagrado, tornando o contrato
  legível a revisor. _Onde no projeto:_ plano v3 § G2 item 5 (máximo dos quantis por estrato).
  _Fato citado:_ condiciona a calibração a uma partição pré-definida, garantindo cobertura
  dentro de cada subgrupo. _Ressalva de verificação:_ entrada marcada como divergente em
  2026-07-31 — a URL **não** contém Vovk et al. 2005 sobre Mondrian conformal prediction, como
  constava na suposição original; autoria e título acima são os do conteúdo real da URL.

### 3.2 Cotas binomiais e sob zero eventos

- **Clopper & Pearson, 1934 — The use of confidence or fiducial limits illustrated in the case
  of the binomial** (Biometrika 26(4):404–413).
  [link](https://doi.org/10.1093/biomet/26.4.404)
  _Âncora:_ cota exata unilateral sob zero eventos, `1 − alpha^(1/n)`, congelada junto com o
  `n`. _Onde no projeto:_ plano v1 § "0.2 Selagem" (aritmética congelada); auditorias § "Os
  quatro erros de dosagem". _Fato citado:_ intervalo de confiança exato para proporção
  binomial, base da fórmula de cota sob zero eventos (1,7375% em n=250; 0,8522% em n=512).
- **Hanley & Lippman-Hand, 1983 — If nothing goes wrong, is everything all right?
  Interpreting zero numerators** (JAMA 249(13):1743–1745).
  [link](https://doi.org/10.1001/jama.1983.03330370053031)
  _Âncora:_ mesma âncora da cota exata sob zero eventos — é a formulação aplicada e didática
  que acompanha o exato de Clopper-Pearson. _Onde no projeto:_ plano v1 § "0.2 Selagem". _Fato
  citado:_ regra de três (3/n) como aproximação prática do limite superior exato de
  Clopper-Pearson sob zero eventos.

### 3.3 Conformal em produto e em detecção de MGT

- **Zhu, Ren, Cao, Lin, Fang & Li, 2025 — Reliably Bounding False Positives: A Zero-Shot MGT
  Detection Framework via Multiscaled Conformal Prediction (MCP)** (ACL 2025, Vol. 1, pp.
  12298–12319; DOI 10.18653/v1/2025.acl-long.601).
  [link](https://aclanthology.org/2025.acl-long.601/)
  _Âncora:_ **refuta** a alegação de originalidade da cota conformal por faixa de comprimento —
  força citação como baseline metodológico e reclassifica o desenho de "sem paralelo" para
  "padrão emergente com extensão"; a garantia por **pior estrato** continua sendo o diferencial
  real. _Onde no projeto:_ plano v3 § G2 (itens 3–5) e § G4; auditorias. _Fato citado:_ usa
  predição conformal para restringir o limite superior de FPR com calibração só-humana e
  binning por faixa de comprimento; introduz o RealDet.
- **Zhu, Ren, Cao, Lin, Fang & Li, 2025 — Reliably Bounding False Positives (preprint da
  versão ACL 2025)** (arXiv 2505.05084). [link](https://arxiv.org/abs/2505.05084)
  _Âncora:_ mesma refutação de originalidade, citação preprint em paralelo à versão ACL. _Onde
  no projeto:_ plano v3 § G2 e § G4. _Fato citado:_ idem — cota conformal com binning por
  comprimento e calibração só-humana.
- **Zhou, Zhu, Su, Ye, Yang, Gavioli-Akilagun & Shi, 2025 — AdaDetectGPT: Adaptive Detection
  of LLM-Generated Text with Statistical Guarantees** (arXiv 2510.01268; NeurIPS 2025).
  [link](https://arxiv.org/abs/2510.01268)
  _Âncora:_ modera a alegação de originalidade sobre controle formal de FPR — é linha ativa e
  publicada na própria área. _Onde no projeto:_ plano v3 § G2–G3; auditorias. _Fato citado:_
  detecção adaptativa com garantias estatísticas de controle de erro tipo I.
- **Zhou, Zhu, Yang & Shi, 2026 — Detecting LLM-Generated Text with Performance Guarantees**
  (arXiv 2601.06586). [link](https://arxiv.org/abs/2601.06586)
  _Âncora:_ viabilidade técnica de uma cota de FPR implantada localmente, em CPU. _Onde no
  projeto:_ plano v3 § F1/§ G2 (contrato de execução de runtime). _Fato citado:_ detector sem
  watermark com controle de erro tipo I, implantado em plataforma online baseada em CPU.
- **Arvidsson McShane, Norinder, Alvarsson, Ahlberg, Carlsson & Spjuth, 2024 — CPSign:
  conformal prediction for cheminformatics modeling** (Journal of Cheminformatics).
  [link](https://jcheminf.biomedcentral.com/articles/10.1186/s13321-024-00870-9)
  _Âncora:_ precedente de conformal embarcado em software de **produção**, com aceitação
  regulatória. _Onde no projeto:_ plano v3 § G2–G3. _Fato citado:_ conformal prediction em
  produção em múltiplas organizações, com precedente regulatório da OCDE.
- **Angelopoulos, Pomerantz, Do, Bates, Bridge, Elton, Lev, González, Jordan & Malik, 2024 —
  Conformal Triage for Medical Imaging AI Deployment** (medRxiv,
  doi:10.1101/2024.02.09.24302543).
  [link](https://www.medrxiv.org/content/10.1101/2024.02.09.24302543v1)
  _Âncora:_ precedente de cota conformal usada como **contrato operacional** em domínio de alto
  risco. _Onde no projeto:_ plano v3 § G3; `docs/uso-responsavel.md`. _Fato citado:_ falsos
  positivos caem de 233 (45%) para 8 (5%) abstendo-se em 14% dos pontos.
- **Nixtla — TimeGPT: prediction intervals** (nixtla.io/docs).
  [link](https://www.nixtla.io/docs/forecasting/probabilistic/prediction_intervals)
  _Âncora:_ viabilidade de produto — conformal já chegou a produto pago, mas sem publicar
  garantia de cobertura verificada. _Onde no projeto:_ plano v3 § G3. _Fato citado:_ intervalos
  construídos com conformal prediction em produto comercial de séries temporais.

## 4. Benchmarks de detecção de texto gerado por máquina

### 4.1 Agrupamento e vazamento de cluster nos benchmarks existentes

- **Guo, Zhang, Wang, Jiang, Nie, Ding, Yue & Wu, 2023 — How Close is ChatGPT to Human
  Experts? Comparison Corpus, Evaluation, and Detection (HC3)** (arXiv 2301.07597).
  [link](https://ar5iv.labs.arxiv.org/html/2301.07597)
  _Âncora:_ a unidade de reamostragem por **componente conexa** — o HC3 é o exemplo canônico do
  problema que essa unidade resolve. _Onde no projeto:_ `benchmark/split.ts:150`
  (`CONNECTIVITY_AXES`), `:351-414` (`connectedComponentRoots`); plano v3 § C3. _Fato citado:_
  "held-out test sets" sem holdout oculto, totalmente público; os autores reconhecem dependência
  por cluster de pergunta sem ajustar a análise para isso.
- **He, Shen, Chen, Backes & Zhang, 2024 — MGTBench: Benchmarking Machine-Generated Text
  Detection** (ACM CCS 2024). [link](https://ar5iv.labs.arxiv.org/html/2303.14822)
  _Âncora:_ o tratamento de autor como eixo de agrupamento — o MGTBench ignora um agrupamento
  óbvio no próprio dataset, exatamente o erro que o desenho por componente conexa evita. _Onde
  no projeto:_ `benchmark/split.ts:150`; plano v3 § "§0" R6 e § C3. _Fato citado:_ split 80/20
  aleatório reutilizável; 13 detectores × 6 LLMs × 3 datasets sem correção de multiplicidade;
  Reuters 50-50 tem 50 jornalistas como agrupamento óbvio não tratado.
- **Paes, Negrão, Silva, Junior, Luz & Silva (UFOP), 2025 — Detecção de textos gerados por LLM
  em português (PT-Detect)** (ENIAC 2025, DOI 10.5753/eniac.2025.13952).
  [link](https://sol.sbc.org.br/index.php/eniac/article/view/38755)
  _Âncora:_ a unidade de reamostragem por componente conexa — é o exemplo negativo exato de
  vazamento de cluster em pt-BR. _Onde no projeto:_ `benchmark/split.ts:351-414`; plano v3 § C3
  e § C6. _Fato citado:_ alega 98,18% de acurácia. _Ressalva de verificação:_ título, autoria,
  veículo, DOI e o índice de 98,18% foram confirmados no resumo; a metodologia exata do split
  (aleatório por exemplo em vez de por título, que causaria vazamento entre o trio
  humano/gerado/reescrito do mesmo título) **não** pôde ser confirmada porque o PDF não foi
  acessado — essa parte específica permanece **não verificada**.
- **Macko, Moro, Uchendu, Lucas, Yamashita, Pikuliak, Srba, Le, Lee, Simko & Bielikova, 2023 —
  MULTITuDE: Large-Scale Multilingual Machine-Generated Text Detection Benchmark** (EMNLP 2023
  Main, pp. 9960–9987). [link](https://ar5iv.labs.arxiv.org/html/2310.13606)
  _Âncora:_ a unidade de reamostragem por componente conexa e o uso de intervalo de 95% como
  piso; e, por **ausência** de correção de multiplicidade, a decisão de aplicar Bonferroni sobre
  gates pré-registrados. _Onde no projeto:_ `benchmark/split.ts`; plano v3 § C3 e § H2. _Fato
  citado:_ 74.081 textos em 11 línguas incluindo português; intervalo de 95% com ANOVA e p<0,05
  para todas as 11 línguas de teste; split por título evita vazamento; FPR de 0,2614
  (MDeBERTa-v3-base) no limiar default 0,5, sem cota por estrato.
- **Macko et al., 2023 — MULTITuDE** (EMNLP 2023, ACL Anthology).
  [link](https://aclanthology.org/2023.emnlp-main.616/)
  _Âncora:_ a decisão de **não** usar o MULTITuDE como cota do domínio de operação (publicação
  profissional pt-BR). _Onde no projeto:_ `docs/corpus-sources.md`; plano v3 § B1. _Fato
  citado:_ 74.081 textos em 11 idiomas incluindo pt; domínio notícia, e não distingue pt-BR de
  pt-PT.
- **Macko, Moro, Uchendu, Lucas, Yamashita, Pikuliak, Srba, Le, Lee, Simko & Bielikova, 2023 —
  MULTITuDE, Tabela 1 e Tabela 4 (degradação em português)** (arXiv 2310.13606).
  [link](https://arxiv.org/abs/2310.13606)
  _Âncora:_ dimensionamento da ambição — fornece o número concreto a superar para justificar
  treino específico em pt-BR. _Onde no projeto:_ plano v3 § B3; `docs/model-validation.md`.
  _Fato citado:_ treinado em en+es+ru, nunca em pt, chega a 0,9253 macro-F1 em pt.
- **Macko, Kopál, Moro & Srba (KInIT), 2024 — MultiSocial: Multilingual Benchmark of
  Machine-Generated Text Detection of Social-Media Texts** (arXiv 2406.12549).
  [link](https://arxiv.org/pdf/2406.12549)
  _Âncora:_ `labelBasis: date-cutoff` para pt-BR e a decisão de **não** simplesmente portar um
  detector treinado em inglês. _Onde no projeto:_ `benchmark/lab/common.py:27`
  (`CHATGPT_CUTOFF`); plano v3 § B3. _Fato citado:_ pt com 33.453 de treino e 11.725 de teste;
  RoBERTa-large-OpenAI-Detector cai de AUC 0,52 (en) para 0,23 (pt) — abaixo do acaso.

### 4.2 Desenho de pareamento, mudança de domínio e viés de comprimento

- **Sarvazyan, González, Franco-Salvador, Rangel, Chulvi & Rosso, 2023 — Overview of
  AuTexTification at IberLEF 2023: Detection and Attribution of Machine-Generated Text in
  Multiple Domains** (IberLEF 2023 / Procesamiento del Lenguaje Natural).
  [link](https://arxiv.org/abs/2309.11285)
  _Âncora:_ o desenho reusável de pareamento e remoção de viés de comprimento que o projeto pode
  copiar para o slate pt-BR. _Onde no projeto:_ plano v3 § D3 (slate de geração); `registro`
  § bloco D. _Fato citado:_ pareamento por prefixo comum e truncamento ao mínimo dos dois textos,
  removendo viés de comprimento.
- **Sarvazyan, González, Franco-Salvador, Rangel, Chulvi & Rosso, 2023 — Overview of
  AuTexTification at IberLEF 2023** (arXiv 2309.11285, versão ar5iv).
  [link](https://ar5iv.labs.arxiv.org/html/2309.11285)
  _Âncora:_ o desenho de **mudança de domínio por construção** e a remoção de viés de
  comprimento por truncamento — precedente românico mais próximo do desenho do projeto. _Onde no
  projeto:_ plano v3 § E2 (coorte OOD) e § D3. _Fato citado:_ split por domínio (treino em
  tweets/how-to/jurídico, teste em reviews/news não vistos); intervalo via bootstrap de 1.000
  reamostragens a α=0,95; máximo de 3 submissões por subtarefa e língua.
- **Silva, Amamou, Ferraz, Silva & Avila, 2025 — Fake News Detection in Portuguese Under Large
  Language Model-Generated Content** (Journal of the Brazilian Computer Society 31(1)).
  [link](https://journals-sol.sbc.org.br/index.php/jbcs/article/view/5525)
  _Âncora:_ o pareamento por construção como disciplina brasileira adjacente, e o risco de
  deslocamento de distribuição no corpus pt-BR. _Onde no projeto:_ plano v3 § D3;
  `docs/corpus-sources.md`. _Fato citado:_ degradação significativa de modelos de ML sob
  descasamento treino-teste, com dados pareados por contraparte verdadeira.
- **Qing, Wu, Liu, Qiu, Yu, Chen, Wu & Xia, 2026 — C-ReD: A Comprehensive Chinese Benchmark
  for AI-Generated Text Detection Derived from Real-World Prompts** (arXiv 2604.11796).
  [link](https://arxiv.org/pdf/2604.11796)
  _Âncora:_ exemplo concreto de protocolo leave-generator-out na área, comparável ao desenho
  pretendido para medir gerador não visto. _Onde no projeto:_ plano v3 § D3 (OpenAI inteiro
  reservado ao OOD) e § E2. _Fato citado:_ treina em 7 LLMs e avalia em 9, com 2 geradores
  held-out, medindo variância entre folds.
- **Pu, Cheng, Yuan, Wu & Bi, 2026 — Breaking the Generator Barrier: Disentangled
  Representation for Generalizable AI-Text Detection** (arXiv 2604.13692).
  [link](https://arxiv.org/html/2604.13692v1)
  _Âncora:_ nomear corretamente o protocolo **LOGO** (leave-one-generator-out) e declarar que
  reservar toda a família OpenAI ao OOD é uma dobra **degenerada** de LOGO com 1 fold, não
  generalização plena (R7). _Onde no projeto:_ plano v3 § D3; `registro` § bloco D. _Fato
  citado:_ protocolo padronizado leave-one-generator-out para medir generalização a geradores
  não vistos.
- **Pu, Cheng, Yuan, Wu & Bi, 2026 — Breaking the Generator Barrier** (ACL 2026, 64th Annual
  Meeting of the ACL). [link](https://aclanthology.org/2026.acl-long.120/)
  _Âncora:_ mesma âncora — renomeia a decisão de reservar "OpenAI inteiro" ao OOD como dobra
  degenerada de LOGO, a declarar assim sob R7. _Onde no projeto:_ plano v3 § D3. _Fato citado:_
  avaliar detectores deixando um gerador inteiro fora do treino, com múltiplos folds. _Ressalva
  de verificação:_ entrada marcada como divergente em 2026-07-31 — o paper nesta URL **não** tem
  o subtítulo "Naming and Formalizing LOGO" e **não** menciona LOGO em nenhum ponto do texto
  acessado; a formalização do termo deve ser citada a partir da versão arXiv 2604.13692, acima.

### 4.2b Faixa de comprimento PRÉ-INSCRITA como fatia diagnóstica, e o pareamento de comprimento (X1, 2026-08-06)

Duas decisões, uma âncora cada, e a segunda tem uma medição que refuta o instrumento óbvio.

**(1) Publicar o FPR por faixa de comprimento, com as faixas congeladas ANTES de medir.** A razão
é que texto curto provavelmente lisonjeia o FPR — pouco sinal, mais hesitação, menos disparo —,
então um teto honesto sobre a célula inteira pode não **transferir** para quem analisa 600
palavras. Publicar por faixa é o que torna visível o número que transfere.

- **Zhu, Ren, Cao, Lin, Fang & Li, 2025 — Reliably Bounding False Positives (MCP)** (ACL 2025,
  pp. 12298–12319). [link](https://aclanthology.org/2025.acl-long.601/)
  _Âncora:_ **há precedente** para cotar FPR por faixa de comprimento na própria área de detecção
  de MGT — a fatia por comprimento não é invenção local. O que este projeto acrescenta é o
  **papel**: lá o binning por comprimento entra na construção da cota, aqui a faixa é diagnóstico
  declarado que não gasta alpha e não move `m`. _Onde no projeto:_
  `benchmark/preregistration-v4.json` (`lengthBands`); `benchmark/metrics.ts`
  (`lengthBandDiagnostics`); `benchmark/report.ts` (§ "FPR por faixa de comprimento"). _Fato
  citado:_ cota de FPR com calibração só-humana e binning por faixa de comprimento.
- **Hugging Face team — RoBERTa OpenAI Detector, model card**
  [link](https://huggingface.co/openai-community/roberta-base-openai-detector)
  _Âncora:_ o precedente de **publicar** FPR por faixa de comprimento num model card, que é o
  destino desta tabela na Fase 6. _Onde no projeto:_ plano § Fase 6 (conteúdo do model card).
  _Fato citado:_ card com limitações preenchidas, escrito pela equipe do HF.
- **ICH Expert Working Group, 1998 — ICH E9, § 5.7 (*subgroups, interactions and covariates*)**
  [link](https://database.ich.org/sites/default/files/E9_Guideline.pdf)
  _Âncora:_ por que as faixas entram na pré-inscrição **agora**, antes de qualquer medição, mesmo
  sendo diagnóstico: uma análise de subgrupo pré-especificada é interpretável e uma escolhida
  depois de ver o resultado não é, **independentemente** de gastar ou não alpha. _Onde no
  projeto:_ `benchmark/preregistration-v4.ts` (o docblock de `lengthBands`). _Fato citado:_
  análises de subgrupo devem ser pré-especificadas no protocolo; as post-hoc valem como
  exploratórias e não sustentam conclusão.
- **Rothwell, 2005 — Subgroup analysis in randomised controlled trials** (The Lancet
  365(9454):176–186). [link](https://doi.org/10.1016/S0140-6736(05)17709-5)
  _Âncora:_ a razão de a tabela publicar o `n` **esperado** de cada faixa e o teto que ele implica
  ao lado do `n` realizado: reportar subgrupo exige poder por subgrupo, e a faixa longa fica com
  ~119 das 800 linhas do bloco cego (teto de 3,62 % contra 0,55 % da manchete). _Onde no projeto:_
  `lengthBands.bands[].expectedBlindBlockLines` e `.diagnosticCeilingAtExpectedLines`. _Fato
  citado:_ o risco de ler subgrupo sem poder adequado.

Os cortes escolhidos são **redondos** — 50, 80, 150, 300 — e não os percentis medidos (p25 = 72,
p50 = 120, p75 = 221). Sem precedente encontrado para a escolha entre as duas: a literatura
acima usa binning por comprimento sem se pronunciar sobre a origem das arestas. A razão local
está registrada — aresta derivada de percentil é função de UMA amostra e deixa de ser
restatável — e é decisão declarada, não prática citada.

**(2) Pedir ao gerador o comprimento do PRÓPRIO par humano, sem clamp.** Se o gerado sai com
200–400 palavras contra humano de mediana 120, o comprimento sozinho separa as classes e o
detector aprende a régua.

- **Sarvazyan et al., 2023 — Overview of AuTexTification at IberLEF 2023** (arXiv 2309.11285).
  [link](https://arxiv.org/abs/2309.11285)
  _Âncora:_ remover viés de comprimento entre as classes é prática estabelecida no desenho de
  benchmark de MGT — lá por truncamento ao mínimo dos dois textos, aqui pedindo ao gerador o
  comprimento do par. _Onde no projeto:_ `benchmark/lab/generate_ai.py`
  (`target_word_count`). _Fato citado:_ pareamento por prefixo comum e truncamento ao mínimo dos
  dois textos, removendo viés de comprimento.

**A medição que refuta o instrumento óbvio, e ela é nossa (2026-08-06).** Sobre a distribuição
humana medida, o clamp `max(60, min(n, 350))` que o gerador usava deixa a **AUC de comprimento em
0,504** — praticamente no acaso. Ele é invisível a uma AUC monótona porque prende a cauda curta
para CIMA e a longa para BAIXO, e as duas inversões de posto se cancelam. O que o clamp produz é
uma faixa que nenhuma linha gerada alcança (50–59 palavras: `aiShare` 0,0, rótulo de graça) e um
máximo gerado preso em 350 contra 1 774 do lado humano. **Conclusão registrada:** o critério de
reprovação da geração é a **tabela de faixas** da sonda e os extremos, não a AUC dela. Sem
precedente encontrado: a literatura acima trata do viés de comprimento, não da cegueira de uma
AUC monótona a truncamento bilateral. _Onde no projeto:_
`test_diagnostic_probes.py::MatchedGenerationLengthTests`.

**(3) O pareamento de comprimento tem de valer até o fim do transporte, e em TODA lane.** Pedir o
comprimento certo no prompt não basta: um **orçamento de saída fixo** é um clamp do outro lado do
transporte — 1 024 tokens não codificam 1 774 palavras de prosa pt-BR —, e uma resposta cortada
aceita como inteira põe na classe IA um teto que a classe humana não tem. Então o orçamento escala
com o alvo (`max_output_tokens`), uma resposta com `finishReason` diferente de `STOP` é **recusada**
na lane REST como já era na lane CLI, e as duas drivers de geração pedem o comprimento pela **mesma**
função (`codex_batch.chunk_prompt` chama `generate_ai.target_word_count`).
**Sem precedente encontrado**: a literatura de desenho de benchmark de MGT trata do viés de
comprimento entre as classes, e não do orçamento de tokens do provedor como fonte dele — a razão
local é aritmética (tokens por palavra) e está registrada. _Onde no projeto:_ `benchmark/lab/generate_ai.py`
(`max_output_tokens`, `COMPLETE_FINISH_REASONS`), `benchmark/lab/codex_batch.py`.

**(4) Agregar uma fatia diagnóstica de comprimento no teto de ação do bundle servido.**
`RUNTIME_BUCKET_CONSTITUENTS` é o único lugar em que a faixa pré-inscrita e a banda de perfil do
runtime se encontram, e a cobertura das faixas passou a ser **imposta**: faixa pré-inscrita fora do
mapa, ou gate de ação de faixa que o mapa não conhece, **recusa a publicação**
(`LENGTH_BAND_UNMAPPED`) em vez de ser filtrada. Filtrar é fail-OPEN — a faixa não mapeada não capa
nada enquanto as mapeadas seguem autorizando `hide`. **Sem precedente encontrado**: a literatura
acima publica taxa por faixa e não autoriza ação de produto por faixa, então a direção fail-closed
aqui é decisão declarada. _Onde no projeto:_ `benchmark/profile-artifact.ts`
(`assertLengthBandsAreMapped`).

#### 4.2b-bis Um PREFIXO do dump não é amostra da população (Fase 3, item 1, 2026-08-06)

As frações que a pré-inscrição congelou por faixa (238/239/204/119 linhas do bloco cego) foram derivadas
de uma varredura das **primeiras 60.000 páginas** do dump. A extração real, com a amostragem
determinística de 1 em 40 sobre 394.414 artigos, realiza **271/269/192/68** — e a faixa `[300,+∞)` cai de
14,89 % para 8,53 % da população, o que muda o teto diagnóstico dela de 3,62 % para 6,24 %.

- **Âncora do desenho:** um dump do MediaWiki é ordenado por `page_id`, que é ordem de **criação**, e
  artigo antigo é artigo maduro — lede mais longa, mais seções, mais parênteses. Um prefixo é uma amostra
  de conveniência correlacionada com a própria variável medida; a amostragem sistemática por hash estável
  da chave natural (`common.keep_sample`) não é. _Fonte:_ **Cochran, 1977 — Sampling Techniques** (3ª ed.,
  Wiley), cap. 8 sobre amostragem sistemática. [link](https://archive.org/details/samplingtechniques_202006)
  _Fato citado:_ a amostragem sistemática só é equivalente à aleatória simples quando a ordem do quadro é
  independente da variável de interesse; ordem correlacionada com a variável enviesa a estimativa.
- **O que a decisão explora:** a estimativa da população é lida do POOL que a coleta realmente escreveu,
  não de uma varredura auxiliar — o pool é o que o corpus contém, e a varredura auxiliar mediu outra coisa.
  _Onde no projeto:_ `wikipedia_fresh.stats.json` e `ESTADO.md` § 5.1b.

**Sem precedente encontrado (2026-08-06)** para a consequência de governança: **uma faixa DIAGNÓSTICA
congelada cuja fração a população refuta, num regime em que o parser confere a aritmética interna e nunca
a fração**. A literatura de pré-registro trata de mudar hipótese depois de ver resultado; aqui não há
resultado — há estrutura da população —, e a distinção é a de § 3.4 do ESTADO. A escolha registrada é
medir, publicar a divergência e deixar a emenda para a unidade que a possui, porque corrigir a política
move `evaluatorDigest` e a faixa não decide nada.

#### 4.2b-ter As duas convenções que decidem número publicado: o quantil e o rateio da cadeira (Fase 3, item 1, 2026-08-06)

Dois valores de § 5.1b do ESTADO não são determinados pela regra que os acompanhava, e a revisão cruzada
os pegou. O `p90 = 282` das 4.000 linhas do corpo: medido, os vizinhos do índice 3.600 são
`[280, 281, 281, 281, 282, 282, 282]`, então `w[⌊q·n⌋]` dá **282**, o *nearest-rank* dá **281** e a
interpolação linear dá **281,1** — e só p90 depende da escolha, porque os outros quatro quantis coincidem
nas três. E o `n` que cada faixa recebe do bloco cego de 800: as parcelas exatas são 271,0 / 269,4 / 191,4
/ 68,2, os pisos somam 799 e sobra **uma** cadeira, com **empate** de resto (0,4) entre `[80,149]` e
`[150,299]`.

- **Âncora do quantil:** não existe "o" quantil amostral — existe uma família de definições que discordam
  em amostras finitas, e publicar um percentil sem nomear a definição é publicar um número que outro
  software não reproduz. _Fonte:_ **Hyndman & Fan, 1996 — Sample Quantiles in Statistical Packages** (The
  American Statistician 50(4):361–365). [link](https://doi.org/10.1080/00031305.1996.10473566) _Fato
  citado:_ o artigo enumera **nove** definições em uso nos pacotes estatísticos e mostra que elas dão
  valores diferentes para o mesmo `q` e a mesma amostra.
- **Âncora do rateio:** distribuir 800 linhas em quatro faixas por proporção é o problema de
  apportionment, e o método do **maior resto** (quota de Hare) só é uma regra completa com um critério de
  desempate declarado. _Fonte:_ **Pukelsheim, 2014 — Proportional Representation: Apportionment Methods and
  Their Applications** (Springer). [link](https://doi.org/10.1007/978-3-319-03856-8) _Fato citado:_ os
  métodos de quota exigem regra de desempate explícita, e o resultado depende dela quando dois restos
  coincidem.
- **O que a decisão escolhe:** a cadeira que sobra vai para a faixa de **maior limite inferior** — a de
  menor população e, portanto, de **pior poder** —, porque é a faixa cujo teto diagnóstico o model card
  publicaria mais alto e um `n` a mais só o aperta. Empatar em favor da faixa larga seria escolher o número
  mais bonito. _Onde no projeto:_ `docs/ESTADO.md` § 5.1b.

**Sem precedente encontrado (2026-08-06)** para o desempate por **pior poder** num rateio de bloco cego
diagnóstico: a literatura de apportionment discute neutralidade e paradoxos de população, não "desempate a
favor do estrato cuja estimativa é mais frágil". A escolha é declarada, e é conservadora na direção que
importa aqui — a de não afrouxar o teto que o relatório imprime.

### 4.3 Cobertura multilíngue e o que existe (ou não) em português

- **Wang et al., 2024 — M4: Multi-generator, Multi-domain, and Multi-lingual Black-Box
  Machine-Generated Text Detection** (EACL 2024, Resource Paper Award, Vol. 1, pp. 1369–1407).
  [link](https://ar5iv.labs.arxiv.org/html/2305.14902)
  _Âncora:_ a decisão de **não** usar o M4 como comparador de pt-BR (português não incluído) e,
  por ausência, a necessidade do corte de data por rótulo (R4/R9). _Onde no projeto:_
  `docs/corpus-sources.md`; plano v3 § B1. _Fato citado:_ corpus multi-gerador, multi-domínio e
  multilíngue (inglês, chinês, russo, urdu, indonésio, árabe — **sem** português); split
  estático público, sem holdout oculto e sem corte pré-ChatGPT.
- **Wang, Shelmanov, Mansurov, Tsvigun, Mikhailov, Xing, Xie, Geng, Puccetti, Artemova, Su, Ta,
  Abassy, Elozeiri, El Etter, Goloburda, Mahmoud, Tomar, Laiyk, Afzal, Koike, Kaneko, Aji,
  Habash, Gurevych & Nakov, 2025 — GenAI Content Detection Task 1** (1st Workshop on GenAI
  Content Detection, COLING 2025; arXiv 2501.11012).
  [link](https://arxiv.org/html/2501.11012v2)
  _Âncora:_ não existe, na linhagem SemEval/COLING, resultado publicado de detecção **avaliado**
  em português — justifica construir avaliação própria pt-BR. _Onde no projeto:_
  `docs/corpus-sources.md`; plano v3 § B1 e § B3. _Fato citado:_ subtarefa multilíngue com 15
  idiomas de treino/dev incluindo português, mas português **não** aparece no teste; melhor
  time: chinês 94,2%, hindi (inédita) 51,8%.
- **Candido, Barbosa, Martins & Costa (IFAL), 2025 — Análise de Ferramentas de Detecção de IA
  para Textos Científicos em Português Gerados por ChatGPT, Gemini e DeepSeek** (VI WICS/SBC
  2025). [link](https://sol.sbc.org.br/index.php/wics/article/view/35937)
  _Âncora:_ reforça a constatação de que não existe benchmark acadêmico com corpus licenciado no
  domínio de publicação profissional pt-BR — sustenta declarar esse domínio como **não medido**.
  _Onde no projeto:_ plano v3 § B1 e § L1; `docs/limitations.md`. _Fato citado:_ 5 ferramentas
  comerciais sobre 50 manuscritos, com MAE/RMSE; sem FPR numérica, sem intervalo, sem corpus
  liberado e sem partição declarada.

### 4.4 O que as métricas de benchmark escondem

- **Stowe & Patil (Pindrop), 2026 — Spotlights and Blindspots: Evaluating Machine-Generated
  Text Detection** (arXiv 2604.16607). [link](https://arxiv.org/html/2604.16607v2)
  _Âncora:_ a recusa a manchete média ou agregada, e o dimensionamento de `n` por estrato em
  `cal-B`. _Onde no projeto:_ plano v3 § A6, § D0b e § G2 item 5. _Fato citado:_ a variância de
  posição no ranking entre oito métricas comuns vai de 0,77 a 15,25 sobre 15 modelos; TPR@FPR
  tem variância significativamente maior que AUROC quando a classe positiva domina.
- **Pudasaini, Miralles-Pechuán, Lillis & Llorens Salvador, 2026 — Why AI-Generated Text
  Detection Fails: Evidence from Explainable AI Beyond Benchmark Accuracy** (arXiv 2603.23146,
  preprint não arbitrado). [link](https://arxiv.org/html/2603.23146)
  _Âncora:_ validade estritamente **por versão** — detectores memorizam padrões de dataset, não
  autoria; reforça a recusa a alegar propriedade além do medido em `cal-B`. _Onde no projeto:_
  estado § "Decisão 1 — Regime 2"; plano v3 § "§0" R7. _Fato citado:_ modelo treinado no
  PAN-CLEF 2025 despenca de 96,94 para 67,23 F1 no COLING 2025 (queda de 29 pontos); SHAP mostra
  que os modelos aprendem a distinguir **datasets**, não autoria.

## 5. Detectores e artefatos de referência

- **Mitchell, Lee, Khazatsky, Manning & Finn, 2023 — DetectGPT, código-fonte** (GitHub; ICML
  2023). [link](https://github.com/eric-mitchell/detect-gpt)
  _Âncora:_ mede o **piso de governança da área** que as nove regras invioláveis superam. _Onde
  no projeto:_ plano v3 § "§0". _Fato citado:_ repositório de 11 arquivos — código mais licença
  MIT, sem model card, datasheet, checklist ou teste (0 linhas, 0 CI).
- **Gehrmann, Strobelt & Rush — GLTR: Giant Language model Test Room, código-fonte** (ACL 2019
  System Demonstrations; arXiv 1906.04043).
  [link](https://github.com/HendrikStrobelt/detecting-fake-text)
  _Âncora:_ por contraste, a decisão de **emitir decisão binária** e, portanto, precisar de cota
  de FPR. _Onde no projeto:_ plano v3 § G2–G3; `docs/uso-responsavel.md`. _Fato citado:_
  ferramenta forense visual, não classificador: não publica limiar, acurácia nem FPR porque não
  emite decisão binária.
- **Verma, Fleisig, Tomlin & Klein, 2024 — Ghostbuster, código-fonte (classify.py)** (GitHub;
  NAACL 2024). [link](https://github.com/vivek3141/ghostbuster/blob/master/classify.py)
  _Âncora:_ a decisão de rodar 100% local e offline (WASM) — o Ghostbuster é exemplo direto de
  detector quebrado por descontinuação de API externa. _Onde no projeto:_ `docs/architecture.md`;
  `docs/inference-pipeline.md`. _Fato citado:_ único detector que embarca pesos no repositório;
  `classify.py` chama modelos OpenAI descontinuados em 2024-01-04 — não reproduzível hoje.
- **Hans, Schwarzschild, Cherepanova, Kazemi, Wen, Goldblum, Geiping & Goldstein — Binoculars,
  código-fonte (detector.py)** (GitHub; ICML 2024).
  [link](https://github.com/ahans30/Binoculars/blob/main/binoculars/detector.py)
  _Âncora:_ publicar limiar com critério declarado (R7) — é o único detector open-source a fazer
  isso, mas seu FPR autodeclarado colapsa sob medição independente. _Onde no projeto:_ plano v3
  § G2 item 6 e § "§0" R7. _Fato citado:_ `BINOCULARS_FPR_THRESHOLD` com o comentário "optimized
  for low-fpr [chosen at 0.01%]"; a reavaliação independente do RAID a 5% de FPR dá 79,6% de
  acurácia.
- **Bao et al., 2024 — Fast-DetectGPT, script de calibração (local_infer.py)** (GitHub; ICLR
  2024).
  [link](https://github.com/baoguangsheng/fast-detect-gpt/blob/main/scripts/local_infer.py)
  _Âncora:_ a decisão de usar predição conformal em vez de calibração paramétrica ajustada à mão
  sem garantia de cobertura. _Onde no projeto:_ plano v3 § G1–G2; `benchmark/calibrators.ts`.
  _Fato citado:_ calibração paramétrica ad-hoc com 4 conjuntos hardcoded de
  (mu0,sigma0,mu1,sigma1) ajustados à mão; a medição independente do RAID a 5% de FPR dá 73,6%
  de acurácia.
- **Hugging Face team — RoBERTa OpenAI Detector, model card e repositório** (Hugging Face;
  dataset openai/gpt-2-output-dataset).
  [link](https://huggingface.co/openai-community/roberta-base-openai-detector)
  _Âncora:_ o modelo de model card com **limitações preenchidas** — informa a decisão de escrever
  um card próprio com FPR por faixa de comprimento. _Onde no projeto:_ plano v3 § H2 (conteúdo
  obrigatório do relatório); `docs/model-integration.md`. _Fato citado:_ detector mais baixado do
  HF (133.675/mês); o card, escrito pela equipe do HF e não pelos autores, declara "~95% ... is
  not high enough accuracy for standalone detection".
- **SuperAnnotate AI Inc. — ai-detector-low-fpr, model card** (Hugging Face).
  [link](https://huggingface.co/SuperAnnotate/ai-detector-low-fpr)
  _Âncora:_ R8 — alegação de propriedade sem medição correspondente. _Onde no projeto:_ plano v3
  § "§0" R8. _Fato citado:_ o nome alega "minimizing the False Positive Rate", mas o card **não**
  publica o FPR alcançado nem o limiar.
- **Detecting-ai — pt-ai-detector-sent, model card** (Hugging Face).
  [link](https://huggingface.co/Detecting-ai/pt-ai-detector-sent)
  _Âncora:_ o comparador direto de pt-BR — mesma família de licença, mas sem manchete no pior
  estrato nem teste cego de uso único. _Onde no projeto:_ plano v3 § B3; `docs/corpus-sources.md`.
  _Fato citado:_ macro F1 de 0,989 em 20.000 sentenças retidas; licença CC-BY-NC 4.0; sem FPR
  estratificada por comprimento.
- **Detecting-ai — pt-ai-detector, model card** (Hugging Face; base
  `neuralmind/bert-base-portuguese-cased`).
  [link](https://huggingface.co/Detecting-ai/pt-ai-detector)
  _Âncora:_ R8 — único detector "pt" publicado como artefato, e com card internamente
  inconsistente. _Onde no projeto:_ plano v3 § "§0" R8 e § B3. _Fato citado:_ alega ~99% de
  acurácia; o card declara 434M parâmetros para um bert-base de ~110M.
- **Hugging Face — detectores de IA mais baixados** (listagem dinâmica; contagem sujeita a
  mudança).
  [link](https://huggingface.co/models?pipeline_tag=text-classification&search=ai+detector&sort=downloads)
  _Âncora:_ a governança cai a quase zero conforme sobe a adoção — justifica publicar model card
  mesmo em escala pequena. _Onde no projeto:_ plano v3 § H2. _Fato citado:_
  PirateXX/AI-Content-Detector com 81.510 downloads/mês sem modelo base, treino, métrica ou
  limiar declarado.
- **hohoda-ai — substack-ai-detector, extensão de Chrome** (GitHub).
  [link](https://github.com/hohoda-ai/substack-ai-detector)
  _Âncora:_ a comparação arquitetural direta (o projeto roda ~106 MB em WASM) — é o único análogo
  real de extensão com inferência local. _Onde no projeto:_ `docs/architecture.md`;
  `docs/platform-adapters.md`. _Fato citado:_ RoBERTa via ONNX Runtime Web (~120 MB, inferência
  local); abstenção rudimentar com cortes configuráveis pelo **usuário**; 0 teste, 0 métrica
  medida.
- **Yuanfan Li & Qi Zhou (Xi'an Jiaotong University) — MGT-Eval, plataforma de avaliação de
  detectores** (GitHub, 2026; associada a ACL 2026 Demo e ICLR 2026).
  [link](https://github.com/Liyuuuu111/MGT-Eval)
  _Âncora:_ o conjunto de métricas de calibração e abstenção obrigatório — confirma que essa
  fronteira existe só em bancada acadêmica, não em detector entregue. _Onde no projeto:_ plano v3
  § A6; `benchmark/metrics.ts`. _Fato citado:_ único projeto que reporta Accuracy, F1, AUROC,
  ECE, Brier, TPR@FPR, risk-coverage e intervalo por bootstrap — mas é bancada, não detector
  entregue.
- **Hu, Chen & Ho — RADAR-Vicuna-7B, model card e pesos** (Hugging Face; NeurIPS 2023; paper
  arXiv 2307.03838). [link](https://huggingface.co/TrustSafeAI/RADAR-Vicuna-7B)
  _Âncora:_ o arranjo open-weights-non-commercial do projeto — precedente de licença só
  descoberta verificando a fonte (R9). _Onde no projeto:_ plano v3 § "§0" R9;
  `benchmark/source-manifest.ts` (`CORPUS_LICENSE_REGISTRY`). _Fato citado:_ o card declara
  "Non-commercial license (inherited from Vicuna-7B-v1.1)" — licença de peso herdada por
  proveniência do gerador.
- **Emi & Spero, 2024 — Pangram Text, relatório técnico** (arXiv 2402.14873).
  [link](https://arxiv.org/abs/2402.14873)
  _Âncora:_ a decisão de escopo de competir em **governança**, não em número bruto, contra
  fornecedores fechados. _Onde no projeto:_ estado § "Decisão 1"; plano v1 § 0.2. _Fato citado:_
  "over 38 times lower error rates"; a página do arXiv não indica disponibilidade de pesos,
  código ou modelo.
- **Emi, 2025 — All About False Positives in AI Detectors** (pangram.com/blog, 27/03/2025).
  [link](https://www.pangram.com/blog/all-about-false-positives-in-ai-detectors)
  _Âncora:_ a comparação com o fornecedor mais próximo de um **contrato** — e o espaço em que o
  projeto se diferencia. _Onde no projeto:_ plano v3 § G3; plano v1 § 0.2. _Fato citado:_ FPR
  global de cerca de 1 em 10.000 (0,01%), estratificada por domínio; **não** publica dataset nem
  estratificação por comprimento. _Nota de autoria:_ byline único confirmado na página; Max Spero
  não aparece nesta postagem específica.
- **Spero & Aerts, 2026 — Introducing Pangram 4** (pangram.com/blog, 29/07/2026).
  [link](https://www.pangram.com/blog/introducing-pangram-4)
  _Âncora:_ a exigência de uma frase explicando a diferença entre **teto** (cota conformal
  unilateral, o que o projeto publica) e **ponto estimado em benchmark próprio** (o que a Pangram
  publica), para evitar a leitura enganosa de "500x pior". _Onde no projeto:_ plano v3 § G3;
  plano v1 § 0.2 (redação da cota). _Fato citado:_ "a false positive rate of just 0.0041%, or
  roughly one false positive for every 24,000 documents".

## 6. Contaminação, robustez e ataques

### 6.1 Contaminação e atalho lexical

- **Dingfelder & Riess (FAU Erlangen-Nürnberg), 2025 — Contamination in Generated Text
  Detection Benchmarks** (arXiv 2511.09200). [link](https://arxiv.org/html/2511.09200)
  _Âncora:_ o gate antiartefato pré-treino — evidência quantitativa primária de que acurácia
  alta em teste limpo **não** detecta contaminação por atalho lexical. _Onde no projeto:_ plano
  v3 § C3 (poda) e § D1; `benchmark/near-duplicates.ts`. _Fato citado:_ 20.325 de 56.000
  amostras do DetectRL contaminadas (36,3%); "Here is..." em 94,7% do texto do Claude; RoBERTa
  cai de 99,9% para 12,1% de acurácia quando a frase-artefato é anexada a texto **humano**.
- **Dugan, Zhu, Alam, Nakov, Apidianaki & Callison-Burch, 2025 — GenAI Content Detection Task
  3: Cross-Domain Machine-Generated Text Detection Challenge** (1st Workshop on GenAI Content
  Detection, COLING 2025; arXiv 2501.08913). [link](https://arxiv.org/html/2501.08913v1)
  _Âncora:_ o gate antiartefato pré-treino — os próprios organizadores confessam contaminação
  inflando o número, exatamente o risco que o gate de poda ataca. _Onde no projeto:_ plano v3
  § C3 item 3 e § D3. _Fato citado:_ métrica "domain-adjusted TPR@FPR=5%"; inspeção manual achou
  confundidor (lista numerada em receitas geradas) e retreinar com dado limpo derrubou o
  desempenho de 92,67% para 89,67%.

### 6.2 Paráfrase, humanização e limites teóricos

- **Sadasivan, Kumar, Balasubramanian, Wang & Feizi, 2023 — Can AI-Generated Text be Reliably
  Detected?** (TMLR; arXiv 2303.11156). [link](https://arxiv.org/abs/2303.11156)
  _Âncora:_ R7 — limite teórico sobre a **afirmação** de detecção; reforça declarar contrato
  condicional por versão em vez de propriedade permanente. _Onde no projeto:_ plano v3 § "§0"
  R7; estado § "Decisão 1 — Regime 2". _Fato citado:_ paráfrase recursiva derruba TPR@1%FPR de
  watermarking de 99,8% para 9,7%; resultado teórico — conforme os LLMs melhoram, o teto de
  qualquer detector cai.
- **Cheng, Sadasivan, Saberi, Saha & Feizi, 2025 — Adversarial Paraphrasing: A Universal Attack
  for Humanizing AI-Generated Text** (arXiv 2506.07001; NeurIPS 2025).
  [link](https://arxiv.org/abs/2506.07001)
  _Âncora:_ a exigência de declarar, na lista de evasões conhecidas (R7), que **peso aberto
  habilita ataque guiado pelo gradiente do próprio detector**. _Onde no projeto:_ plano v3 § "§0"
  R7; `docs/limitations.md`; `docs/risks.md`. _Fato citado:_ redução média de TPR@1%FPR de
  87,88% entre detectores diversos, com ataque training-free guiado pelo próprio detector.
- **Gu, Li & Hu, 2026 — MASH: Evading Black-Box AI-Generated Text Detectors via Style
  Humanization** (arXiv 2601.08564). [link](https://arxiv.org/pdf/2601.08564)
  _Âncora:_ a lacuna adversarial do lado **black-box**, a listar como evasão conhecida não
  coberta (R7). _Onde no projeto:_ plano v3 § "§0" R7; `docs/limitations.md`. _Fato citado:_
  técnica de humanização de texto gerado por IA sem acesso aos pesos do detector.
- **Zha, Min & Sushmita, 2025 — PADBen: A Comprehensive Benchmark for Evaluating AI Text
  Detectors Against Paraphrase Attacks** (arXiv 2511.00416).
  [link](https://arxiv.org/pdf/2511.00416)
  _Âncora:_ referência adicional de robustez adversarial a incluir na lista de evasões conhecidas
  não cobertas. _Onde no projeto:_ plano v3 § "§0" R7; `docs/limitations.md`. _Fato citado:_
  benchmark dedicado a medir robustez de detectores sob ataque de parafraseio.
- **Galat & Rizoiu (UTS), 2026 — UTS at ELOQUENT 2026 Voight-Kampff: structural shifts in AI
  writing bypass state-of-the-art detectors** (arXiv 2607.13565).
  [link](https://arxiv.org/html/2607.13565v1)
  _Âncora:_ a decisão de **abandonar** a alegação de erro familiar ao longo da história do
  produto e adotar validade estritamente por versão. _Onde no projeto:_ estado § "Decisão 1 —
  Regime 2". _Fato citado:_ ataque de registro cross-década alcança taxa de engano de 0,798
  mesmo contra classificadores ajustados adversarialmente; a previsão de fechamento do ataque
  novo foi falsificada em 0,846.

### 6.3 Colapso sob ataque no benchmark de referência

- **Dugan, Hwang, Trhlík, Zhu, Ludan, Xu, Ippolito & Callison-Burch, 2024 — RAID** (ACL 2024).
  [link](https://aclanthology.org/2024.acl-long.674/)
  _Âncora:_ recall e FPR **no limiar congelado** como métrica primária de release; TPR@1%FPR e
  AUROC rebaixados a diagnóstico de separabilidade (`gates: false`). _Onde no projeto:_ plano v3
  § A6 e § H2; `benchmark/metrics.ts:759` (`tprAtOnePercentFpr`). _Fato citado:_ calibrados a
  FPR=5%, o Originality perde 75,7 pontos sob homoglifos; "not yet robust enough for widespread
  deployment or high-stakes use".
- **Dugan, Hwang, Trhlík, Ludan, Zhu, Xu, Ippolito & Callison-Burch, 2024 — RAID (ângulo
  metodologia)** (ACL 2024; arXiv 2405.07940). [link](https://arxiv.org/abs/2405.07940)
  _Âncora:_ FPR fixo como prática corrente que o projeto segue e **refina por estrato**, e a
  lacuna adversarial a declarar sob R7. _Onde no projeto:_ plano v3 § G2 item 5; § "§0" R7.
  _Fato citado:_ ponto de operação por FPR fixo em 5%; detectores "easily fooled by adversarial
  attacks... and unseen generative models".

## 7. Danos, viés e ética

### 7.1 Viés por registro e a manchete no pior estrato

- **Liang, Yuksekgonul, Mao, Wu & Zou, 2023 — GPT detectors are biased against non-native
  English writers** (Patterns/Cell Press 4(7):100779).
  [link](https://www.sciencedirect.com/science/article/pii/S2666389923001307)
  _Âncora:_ a manchete no **pior estrato core** em vez da média — prova de mecanismo de que o FPR
  é propriedade do **estrato**, não do detector. _Onde no projeto:_ plano v3 § G2 item 5, § B3
  "Consequência de engenharia"; `benchmark/slices.ts`. _Fato citado:_ 7 detectores comerciais com
  FPR média de 61,22% em 91 redações TOEFL de não nativos, contra cerca de 5,19% em 88 redações
  de nativos de 8ª série; enriquecer o vocabulário derruba a FPR para 11,77%.
- **Liang, Yuksekgonul, Mao, Wu & Zou, 2023 — GPT detectors are biased against non-native
  English writers (ângulo comercial)** (Patterns/Cell Press).
  [link](https://www.cell.com/patterns/fulltext/S2666-3899(23)00130-7)
  _Âncora:_ R6 e a manchete no pior estrato — é o dano canônico citado no próprio enunciado da
  tarefa de reconstrução. _Onde no projeto:_ plano v3 § "§0" R6; § G2 item 5. _Fato citado:_ 7
  detectores comerciais; FPR média de 61,22% em TOEFL contra ~5,19% em nativos; 97,80% das
  redações marcadas por ao menos um detector.
- **Liang, Yuksekgonul, Mao, Wu & Zou, 2023 — GPT detectors are biased against non-native
  English writers** (arXiv 2304.02819, preprint da versão em Patterns).
  [link](https://arxiv.org/abs/2304.02819)
  _Âncora:_ a exigência de estratificação por registro/formalidade e a proibição de uso decisório
  do indicador, dado viés documentado. _Onde no projeto:_ plano v1 § 0.2 (`actionCeiling`);
  `docs/uso-responsavel.md`. _Fato citado:_ detectores de IA têm viés sistemático contra
  escritores não nativos (redações TOEFL).
- **Liang, Yuksekgonul, Mao, Wu & Zou, 2023 — GPT detectors are biased against non-native
  English writers** (arXiv 2304.02819, PDF). [link](https://arxiv.org/pdf/2304.02819)
  _Âncora:_ fundamenta com estatística específica a exigência de estratificação da cota por
  registro e formalidade. _Onde no projeto:_ plano v3 § G2 item 5; `benchmark/slices.ts`. _Fato
  citado:_ 61,3% de FPR médio em redações TOEFL de não nativos contra quase 100% de acurácia em
  redações de nativos, atribuído a previsibilidade lexical e uniformidade sintática.
- **Liang, Yuksekgonul, Mao, Wu & Zou, 2023 — GPT detectors are biased against non-native
  English writers** (Patterns 4(7):100779; indexação PubMed, PMID 37521038).
  [link](https://pubmed.ncbi.nlm.nih.gov/37521038/)
  _Âncora:_ citação alternativa do mesmo achado usado para justificar a estratificação por
  registro. _Onde no projeto:_ plano v3 § G2 item 5. _Fato citado:_ idem — achado de viés contra
  não nativos.
- **Sagawa, Koh, Hashimoto & Liang, 2020 — Distributionally Robust Neural Networks for Group
  Shifts: On the Importance of Regularization for Worst-Case Generalization** (ICLR 2020).
  [link](https://arxiv.org/abs/1911.08731)
  _Âncora:_ limiar escolhido pelo **pior estrato calibrado** (máximo dos quantis por estrato),
  nunca a média. _Onde no projeto:_ plano v3 § G2 item 5, § L1 resposta 1, § B3 "Consequência de
  engenharia". _Fato citado:_ minimizar a perda do pior grupo (não a média) sob deslocamento de
  grupo, com regularização adequada, é necessário para generalização robusta entre estratos — o
  framework de group DRO.
- **Koh, Sagawa, Marklund et al., 2021 — WILDS: A Benchmark of in-the-Wild Distribution
  Shifts** (ICML 2021, PMLR v139). [link](https://proceedings.mlr.press/v139/koh21a.html)
  _Âncora:_ legitima pior-grupo-como-manchete como prática **aceita**, não excentricidade do
  projeto. _Onde no projeto:_ plano v3 § G2 item 5; § E2 (coorte OOD). _Fato citado:_ usa
  worst-group accuracy como métrica OOD.
- **Rothwell, 2005 — Treating individuals 2. Subgroup analysis in randomised controlled trials:
  importance, indications, and interpretation** (The Lancet 365(9454):176–186).
  [link](https://doi.org/10.1016/S0140-6736(05)17709-5)
  _Âncora:_ o ancestral do lado de **ensaios clínicos** para a mesma prática de manchete no pior
  estrato — e o alerta de que reportar o pior subgrupo exige controle de multiplicidade e poder
  adequado, que é por que o piso de poder por fatia existe. _Onde no projeto:_ plano v3 § G2
  item 5, § D0b (`powerFloors`); `benchmark/slices.ts:106-107`. _Fato citado:_ riscos de reportar
  o subgrupo de pior desempenho sem controle de multiplicidade e sem poder estatístico adequado.
- **Basu, Zhang & Raheja (Superhuman), 2025 — BAID: A Benchmark for Bias Assessment of AI
  Detectors** (arXiv 2512.11505). [link](https://arxiv.org/html/2512.11505v1)
  _Âncora:_ inverte a conclusão anterior de cortar a medição de viés — recomenda medir viés por
  grupo **linguístico** (registro/formalidade), não só demográfico, porque esse eixo não resolve
  para `unknown` e é onde o dano é maior. _Onde no projeto:_ plano v3 § "§0" R6; § D5 (fatias
  operacionais); `benchmark/slices.ts`. _Fato citado:_ o Desklib cai de precisão 0,97–0,99 em
  demografia para 0,16 em conteúdo GenZ; benchmark English-only.
- **Xin, Hooker & Huang, 2026 — How Proxy Race Distorts Regression-Based Fairness Audits**
  (arXiv 2603.17106). [link](https://arxiv.org/abs/2603.17106)
  _Âncora:_ R6 (nunca sintetizar grupo demográfico) como decisão **tecnicamente correta**, não
  conservadorismo. _Onde no projeto:_ plano v3 § "§0" R6; `benchmark/schema.ts`
  (`groupAxisIdentity`, `groupAxisDeclaredState`). _Fato citado:_ proxy inferido encolhe
  sistematicamente a disparidade estimada em direção ao grupo majoritário, mesmo com boa acurácia
  global.
- **Common Sense Media (pesquisa) / Education Week, 2024 — Black Students Are More Likely to Be
  Falsely Accused of Using AI to Cheat** (Education Week, set/2024).
  [link](https://www.edweek.org/technology/black-students-are-more-likely-to-be-falsely-accused-of-using-ai-to-cheat/2024/09)
  _Âncora:_ R6 (`known`/`notApplicable`/`unknown`) — dano distribuído **autorrelatado**, não FPR
  por grupo verificada; a distinção é a razão de o eixo demográfico não virar métrica. _Onde no
  projeto:_ plano v3 § "§0" R6. _Fato citado:_ 20% dos adolescentes negros relatam trabalho
  marcado por erro como IA, contra 10% latinos e 7% brancos — survey de autorrelato.

### 7.2 Erro de inferência tratado como veredito

- **Ofgang, 2023 — He Was Falsely Accused of Using AI. Here's What He Wishes His Professor Did
  Instead** (Tech & Learning, 04/12/2023).
  [link](https://www.techlearning.com/news/he-was-falsely-accused-of-using-ai-heres-what-he-wishes-his-professor-did-instead)
  _Âncora:_ R5 — erro de inferência tratado como veredito. _Onde no projeto:_ plano v3 § "§0" R5;
  `docs/uso-responsavel.md`. _Fato citado:_ estudante zerado depois de um detector marcar a
  redação como "muito genérica"; o mesmo detector marcava "I Have a Dream" como IA.
- **Edwards (Ars Technica, fonte primária) — Incidente 3228: GPTZero classifica a Constituição
  dos EUA como gerada por IA** (AI Incident Database, Report 3228).
  [link](https://incidentdatabase.ai/reports/3228/)
  _Âncora:_ R5 na prática — erro de inferência nunca vira escore. _Onde no projeto:_ plano v3
  § "§0" R5; `benchmark/metrics.ts` (DecisionFamilies). _Fato citado:_ Constituição classificada
  como "likely to be written entirely by AI" por baixa perplexidade (memorização de treino).
  _Nota de autoria:_ Edward Tian, criador do GPTZero, é a fonte citada no artigo, não o autor.
- **Klee, 2023 — She Was Falsely Accused of Cheating With AI — And She Won't Be the Last (caso
  Louise Stivers, UC Davis)** (Rolling Stone, 06/06/2023).
  [link](https://www.rollingstone.com/culture/culture-features/student-accused-ai-cheating-turnitin-1234747351/)
  _Âncora:_ R5 e a **assimetria de custo do erro** — motiva a UI nunca emitir rótulo binário
  sobre autoria de terceiro. _Onde no projeto:_ plano v1 § 0.2 (`actionCeiling = indicator`);
  `docs/uso-responsavel.md`. _Fato citado:_ a estudante teve um brief marcado como IA e continua
  obrigada a autodeclarar a acusação em candidaturas a faculdades de Direito.
- **D. Mass. 1:24-cv-12437 (Harris as next friend of RNH v. Adams) — Judge Rebuffs Family's Bid
  to Change Grade in AI Cheating Case** (The 74).
  [link](https://www.the74million.org/article/judge-rebuffs-familys-bid-to-change-grade-in-ai-cheating-case/)
  _Âncora:_ R7 — a via judicial **não** corrige o padrão de evidência; o contrato tem de ser
  declarado pelo fornecedor. _Onde no projeto:_ plano v3 § "§0" R7; `docs/uso-responsavel.md`.
  _Fato citado:_ o tribunal negou o pedido preliminar, e a decisão não julgou a confiabilidade do
  detector em si. _Nota de autoria:_ byline não recuperável nesta verificação (paywall).

### 7.3 Limites éticos do que o produto pode licenciar

- **Weber-Wulff, Anohina-Naumeca, Bjelobaba, Foltýnek, Guerrero-Dib, Popoola, Šigut &
  Waddington, 2023 — Testing of detection tools for AI-generated text (auditoria de 14
  ferramentas)** (International Journal for Educational Integrity 19:26).
  [link](https://link.springer.com/article/10.1007/s40979-023-00146-z)
  _Âncora:_ a exigência ética de que a v1 **não licencie** suspeita disciplinar ou acadêmica com
  base no sinal do detector — base para proibir uso decisório do indicador. _Onde no projeto:_
  plano v1 § 0.2 (`actionCeiling = indicator`); `docs/uso-responsavel.md`;
  `docs/limitations.md`. _Fato citado:_ 14 ferramentas, todas abaixo de 80% de acurácia;
  obfuscação degrada a detecção.
- **Turnitin, LLC — What should I do if the AI Writing score is high?** (Turnitin Guides).
  [link](https://guides.turnitin.com/hc/en-us/articles/27139113024269-What-should-I-do-if-the-AI-Writing-score-is-high)
  _Âncora:_ o padrão mínimo de uso responsável que o projeto deve seguir e superar ao definir
  `actionCeiling = indicator`. _Onde no projeto:_ plano v1 § 0.2; `docs/uso-responsavel.md`.
  _Fato citado:_ o próprio fornecedor orienta o score de IA como gatilho de conversa, não como
  punição ou veredito.
- **Quinn Emanuel Urquhart & Sullivan — Defamation in the AI Era, client alert** (Quinn
  Emanuel).
  [link](https://www.quinnemanuel.com/the-firm/publications/client-alert-defamation-in-the-ai-era/)
  _Âncora:_ a exigência de que a UI nunca emita rótulo binário sobre autoria de terceiro
  identificável — risco de difamação ao classificar texto de autor não consentido. _Onde no
  projeto:_ plano v1 § 0.2; `docs/uso-responsavel.md`; `docs/risks.md`. _Fato citado:_ "anyone
  who uses generative AI to produce information about a person... will be treated as publishers
  even though something else created it". _Ressalva de verificação:_ entrada marcada como
  divergente em 2026-07-31 — a citação literal não foi localizada na página acessada; tratar a
  frase como **não verificada** e a peça como orientação geral de escritório, não como fonte
  citável dessa sentença.
- **Copyleaks — extensão de navegador para detecção de IA** (copyleaks.com).
  [link](https://copyleaks.com/ai-detector/extension)
  _Âncora:_ evidência de que o mercado já assume o risco de difamação **sem** mitigá-lo — contexto
  comparativo, não justificativa para replicar. _Onde no projeto:_ `docs/risks.md`;
  `docs/uso-responsavel.md`. _Fato citado:_ extensão concorrente alegando "99%+ / 0,2% FP" sobre
  texto de terceiros sem mitigação de risco de difamação. _Nota de verificação:_ fetch direto
  bloqueado por proteção anti-bot; conteúdo confirmado via cache de busca indexado, com texto
  idêntico ao reivindicado.

## 8. Rótulo humano por corte de data

- **Wu, Zhan, Wong, Yang, Yang, Yuan & Chao (NLP2CT), 2024 — DetectRL: Benchmarking
  LLM-Generated Text Detection in Real-World Scenarios** (NeurIPS 2024 Datasets & Benchmarks;
  arXiv 2410.23746). [link](https://arxiv.org/html/2410.23746v1)
  _Âncora:_ `labelBasis: date-cutoff` — o precedente mais forte e citável para o corte
  pré-2022-11-30. _Onde no projeto:_ `benchmark/lab/common.py:27` (`CHATGPT_CUTOFF`), `:184`
  (`date_cutoff`); plano v3 § B3, § L1, § D1; `docs/corpus-sources.md`. _Fato citado:_ "To avoid
  the potential contamination from text generated by LLMs, all selected data was released prior
  to the advent of ChatGPT"; 100.800 amostras humanas e 134.400 geradas.
- **Wu, Zhan, Wong, Yang, Yang, Yuan & Chao, 2024 — DetectRL** (NeurIPS 2024 Datasets &
  Benchmarks Track). [link](https://arxiv.org/abs/2410.23746)
  _Âncora:_ um dos **dois** precedentes que o projeto cita para usar corte de data explícito
  pré-LLM como base de evidência do rótulo humano, declarado **mitigação** temporal e nunca prova
  de autoria. _Onde no projeto:_ `benchmark/lab/common.py:27`, `:184`; plano v3 § B3, § L1,
  § D1; `docs/corpus-sources.md`. _Fato citado:_ benchmark de detecção de MGT em cenário real com
  corte de data pré-LLM declarado.
- **Macko, Kopál, Moro & Srba (KInIT), 2024 — MultiSocial: Multilingual Benchmark for
  Machine-Generated Text Detection on Social Media** (arXiv 2406.12549v1; versão expandida em ACL
  2025). [link](https://arxiv.org/html/2406.12549v1)
  _Âncora:_ `labelBasis: date-cutoff` — um dos dois únicos benchmarks (com o DetectRL) com corte
  de data pré-LLM explícito e justificado. _Onde no projeto:_ `benchmark/lab/common.py:27`;
  `docs/corpus-sources.md`. _Fato citado:_ "these datasets have been deliberately selected due to
  containing older data (before 2022, most of them before 2020)"; português com 33.453 de treino
  e 11.725 de teste; limiar calibrado a 5% de FPR no treino.
- **Macko, Kopál, Moro & Srba, 2025 — MultiSocial: Multilingual Benchmark of Machine-Generated
  Text Detection of Social-Media Texts** (ACL 2025 Main, Viena).
  [link](https://aclanthology.org/2025.acl-long.36/)
  _Âncora:_ mesmo anchor do corte pré-ChatGPT — o segundo dos dois precedentes de corte de data
  explícito citados no inventário. _Onde no projeto:_ `benchmark/lab/common.py`;
  `docs/corpus-sources.md`. _Fato citado:_ benchmark multilíngue (22 línguas) e multiplataforma de
  detecção de MGT em redes sociais.
- **Liang, Zhang, Codreanu, Wang, Cao & Zou, 2025 — The widespread adoption of large language
  model-assisted writing across society** (Patterns/Cell Press 6(12):101366, 02/10/2025).
  [link](https://www.cell.com/patterns/fulltext/S2666-3899(25)00214-4)
  _Âncora:_ ancora **quantitativamente** `labelBasis: date-cutoff` — é o único dado medido de que
  texto humano coletado depois de 2022-11-30 tem rótulo contaminado numa fração de dois dígitos.
  _Onde no projeto:_ `benchmark/lab/common.py:27`; plano v3 § B3 e § L1; `docs/corpus-sources.md`.
  _Fato citado:_ cerca de 18% do texto de reclamações de consumidor, até 24% de press releases
  corporativos e cerca de 14% de press releases da ONU estimados como assistidos por LLM até o
  fim de 2024 (jan/2022–set/2024).
- **Bloomberg Businessweek, 2024 — Do AI Detectors Work? Students Face False Cheating
  Accusations** (Bloomberg Businessweek, 18/10/2024).
  [link](https://www.bloomberg.com/news/features/2024-10-18/do-ai-detectors-work-students-face-false-cheating-accusations)
  _Âncora:_ `labelBasis: date-cutoff` — o **mesmo desenho** do projeto aplicado por jornalismo
  investigativo. _Onde no projeto:_ `benchmark/lab/common.py:184`; plano v3 § B3. _Fato citado:_
  500 redações pré-ChatGPT obtidas via pedido de acesso à informação; 1%–2% de falsos positivos
  contra 0,2% e 0,03% alegados. _Nota de autoria:_ byline não recuperável nesta verificação
  (paywall).

## 9. Artefatos de governança

### 9.1 Model card, datasheet e proveniência

- **Mitchell, Wu, Zaldivar, Barnes, Vasserman, Hutchinson, Spitzer, Raji & Gebru, 2019 — Model
  Cards for Model Reporting** (FAT\* 2019). [link](https://arxiv.org/abs/1810.03993)
  _Âncora:_ a origem de R7 — declarar o **contrato** (intended use, out-of-scope use), não a
  propriedade. _Onde no projeto:_ plano v3 § "§0" R7 e § H2; `docs/model-integration.md`. _Fato
  citado:_ documento de avaliação em condições variadas para esclarecer uso pretendido e
  minimizar uso inadequado.
- **Gebru, Morgenstern, Vecchione, Vaughan, Wallach, Daumé III & Crawford, 2021 — Datasheets
  for Datasets** (Communications of the ACM 64(12); arXiv 1803.09010).
  [link](https://dl.acm.org/doi/10.1145/3458723)
  _Âncora:_ a decisão de produzir datasheet **mesmo sem redistribuir** o corpus. _Onde no
  projeto:_ plano v3 § B1 ("Acoplamento de `redistribution`") e § H2;
  `benchmark/source-manifest.ts` (`CORPUS_USE_POLICY`); `docs/corpus-sources.md`. _Fato citado:_
  todo dataset deve vir com ficha documentando motivação, composição, coleta e manutenção.
- **Moreau & Missier (eds.), 2013 — PROV-DM: The PROV Data Model** (W3C Recommendation,
  30/04/2013). [link](https://www.w3.org/TR/prov-dm/)
  _Âncora:_ R4 (governança nunca simulada) — os recibos de revisão são estruturalmente uma tripla
  Entity(rótulo)/Activity(revisão)/Agent(revisor), e "recibo fabricado é falsificação de
  proveniência" nomeia proveniência explicitamente. _Onde no projeto:_ plano v3 § "§0" R4 e § C5;
  `benchmark/schema.ts` (união `review` v3, com `automated/unreviewed` | `human-reviewed` |
  revisor único). _Fato citado:_ modelo abstrato de proveniência como tripla
  Entity/Activity/Agent, para registrar quem ou o quê produziu ou influenciou um dado. _Nota de
  escopo:_ ancoragem **por analogia de modelo de dados**, não confirmação de uso direto no código
  — é o modelo canônico para o conceito, não uma citação que o repositório já invoca.
- **Pangram Labs (Emi, Thai, Masrour & Spero), 2026 — Pangram 3.1, model card**
  (pangram.com/research, 16/01/2026).
  [link](https://www.pangram.com/research/model-card/pangram-3-1)
  _Âncora:_ a paridade mínima a alcançar — model card versionado com FPR já é **piso** do
  concorrente mais próximo. _Onde no projeto:_ plano v3 § H2; `docs/model-integration.md`. _Fato
  citado:_ model card público e versionado, com FPR reportada para a versão 3.1.
- **Pangram Labs, 2026 — Pangram 3.2, model card** (pangram.com/research, 27/02/2026).
  [link](https://www.pangram.com/research/model-card/pangram-3-2)
  _Âncora:_ confirma o padrão de **versionamento continuado** de model card com FPR no comparador
  comercial mais próximo. _Onde no projeto:_ plano v3 § H2. _Fato citado:_ segunda versão do model
  card público e versionado da Pangram.

### 9.2 Checklists, metadados obrigatórios e auditoria

- **ACL Rolling Review — Responsible NLP Research Checklist** (aclrollingreview.org; política de
  desk rejection vigente desde dez/2024).
  [link](http://aclrollingreview.org/responsibleNLPresearch/)
  _Âncora:_ o checklist de artefato é **obrigatório** na área — informa tratar o checklist do
  projeto como exigência, não cortesia. _Onde no projeto:_ plano v3 § H2;
  `docs/release-checklist.md`. _Fato citado:_ desk rejection para filing incorreto ou incompleto
  do checklist desde dez/2024.
- **ACL Rolling Review — EMNLP 2025: checklist como apêndice do paper**
  (aclrollingreview.org). [link](http://aclrollingreview.org/responsible-nlp-checklist-appendices)
  _Âncora:_ o modelo de publicar checklist e manifesto de reconstrução **junto** da evidência
  certificadora. _Onde no projeto:_ plano v3 § H2; `docs/release-checklist.md`. _Fato citado:_ o
  checklist passa a ser publicado como apêndice do paper.
- **NeurIPS — Datasets & Benchmarks Track (metadado obrigatório Croissant)** (neurips.cc).
  [link](https://neurips.cc/Conferences/2025/CallForDatasetsBenchmarks)
  _Âncora:_ a priorização entre checklist e metadado (exigidos) e model card/datasheet
  (recomendados). _Onde no projeto:_ plano v3 § H2; `benchmark/dataset-manifest.ts`. _Fato
  citado:_ exige Croissant legível por máquina; Model Cards e Datasheets são **encorajados**, não
  exigidos.
- **Raji, Smart, White, Mitchell, Gebru, Hutchinson, Smith-Loud, Theron & Barnes, 2020 —
  Closing the AI Accountability Gap (SMACTR)** (ACM FAT\*/FAccT 2020).
  [link](https://arxiv.org/abs/2001.00973)
  _Âncora:_ por contraste, a limitação **declarada** do projeto: revisão cruzada por agente não é
  auditoria de terceiro nem tem fase de reflexão formal. _Onde no projeto:_ plano v3 § L4;
  `docs/limitations.md`. _Fato citado:_ framework de auditoria interna em cinco fases, executado
  **antes** do deploy.
- **NIST — AI Risk Management Framework, funções Measure e Manage** (NIST AI RMF).
  [link](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)
  _Âncora:_ a decisão (a declarar sob R7) de **abandonar a alegação por versão** em vez de manter
  monitoramento contínuo — desvio explícito de framework de referência. _Onde no projeto:_ estado
  § "Decisão 1 — Regime 2"; `docs/limitations.md`. _Fato citado:_ exige rastreamento contínuo de
  risco, inclusive em monitoramento pós-deploy.
- **União Europeia — Regulamento (UE) 2024/1689 (AI Act), Artigo 53** (documentação técnica e
  sumário de dados de treino; obrigação vigente desde 02/08/2025).
  [link](https://artificialintelligenceact.eu/article/53/)
  _Âncora:_ a documentação de proveniência do projeto como referência de **forma legal**. _Onde no
  projeto:_ `benchmark/source-manifest.ts`; `docs/corpus-sources.md`; `docs/privacy.md`. _Fato
  citado:_ provedores de GPAI devem publicar sumário do conteúdo de treino em template
  obrigatório, vigente desde 02/08/2025.

### 9.3 Qualidade e transparência de anotação

- **Klie, Eckart de Castilho & Gurevych, 2023 (v3: 2024) — Analyzing Dataset Annotation Quality
  Management in the Wild** (arXiv 2307.08153). [link](https://arxiv.org/html/2307.08153v3)
  _Âncora:_ o padrão de **interpretar** (não só reportar) o número de concordância. _Onde no
  projeto:_ plano v3 § C5; `benchmark/schema.ts` (`agreement`). _Fato citado:_ 591 publicações
  analisadas, 30% julgadas subpar em gestão de qualidade de anotação.
- **Kunilovskaya, Bhatia, Albertelli, Chen, Greisinger, Kiefer, Leiter, Roy, Achamaleh,
  Manzoor, Pohl, Hou & Eger, 2026 — Who Annotates in NLP? A Large-scale Assessment of Human
  Annotation Reporting between 2018 and 2025** (arXiv 2606.02255).
  [link](https://arxiv.org/abs/2606.02255)
  _Âncora:_ a decisão barata de **publicar a diretriz de anotação**, colocando o projeto no terço
  superior da área. _Onde no projeto:_ plano v3 § C5 e § D5. _Fato citado:_ diretrizes de anotação
  liberadas em apenas 34,1% de 2.667 tarefas analisadas.
- **Abercrombie, Dinkar, Cercas Curry, Rieser & Hovy, 2023 — Consistency is Key: Disentangling
  Label Variation in Natural Language Processing with Intra-Annotator Agreement** (arXiv
  2301.10684). [link](https://arxiv.org/html/2301.10684)
  _Âncora:_ **ancora e limita** a reanotação por revisor único: é medição legítima de estabilidade,
  mas sem precedente como **substituto** de dois anotadores. _Onde no projeto:_ plano v3 § L4
  consequência 1 e § C5 "Recibo de revisor único: tipo próprio". _Fato citado:_ intra-anotador
  aparece em menos de 0,07% da ACL Anthology; inter e intra são **complementares**, não
  substitutos.

## 10. Licenças, termos de acesso e dados

### 10.1 O estado do licenciamento na área

- **Longpre, Mahari, Hooker et al., 2024 — A large-scale audit of dataset licensing and
  attribution in AI (Data Provenance Initiative)** (Nature Machine Intelligence, 30/08/2024).
  [link](https://www.nature.com/articles/s42256-024-00878-8)
  _Âncora:_ ancora **quantitativamente** R9 como prática acima da área — falha de licenciamento é
  norma do campo, não exceção. _Onde no projeto:_ plano v3 § "§0" R9;
  `benchmark/source-manifest.ts` (`CORPUS_LICENSE_REGISTRY`). _Fato citado:_ auditoria de mais de
  1.800 datasets, com omissão de licença acima de 70% e taxa de erro acima de 50% nos sites
  populares.
- **Sarvazyan, González, Rangel, Rosso & Franco-Salvador, 2024 — IberAuTexTification 2024,
  dataset com download e licença** (IberLEF 2024; Procesamiento del Lenguaje Natural
  73:421–434). [link](https://portal.odesia.uned.es/en/dataset/iberautextification-2024)
  _Âncora:_ R9 (licença verificada na fonte, não no agregador) e a correção da premissa de
  ausência de dado pt-BR disponível. _Onde no projeto:_ plano v3 § "§0" R9 e § D2;
  `docs/corpus-sources.md`. _Fato citado:_ cerca de 168.128 textos em 6 línguas incluindo
  português (~32.450 instâncias pt); **discrepância**: o portal declara CC-BY-4.0 e o Hugging Face
  declara cc-by-nc-nd-4.0.
- **Macko, Kopál, Moro & Srba (KInIT), 2024 — MultiSocial** (arXiv 2406.12549v2).
  [link](https://arxiv.org/html/2406.12549v2)
  _Âncora:_ R9 e a decisão de **não redistribuir** corpus. _Onde no projeto:_ plano v3 § "§0" R9 e
  § B1; `benchmark/source-manifest.ts` (`CORPUS_USE_POLICY`, `redistribution:
  "not-published"`). _Fato citado:_ o MultiSocial enumera proveniência por fonte e libera dados
  "for non-commercial research purpose only"; o HC3 herda a licença mais restritiva da fonte.
  _Nota de verificação:_ o comportamento de licença do HC3 foi confirmado no README do próprio
  repositório HC3 (github.com/Hello-SimpleAI/chatgpt-comparison-detection), **não** no corpo deste
  arXiv, que cita o HC3 apenas em trabalhos relacionados sem detalhar sua licença.

### 10.2 Compatibilidade de licença de saída (ShareAlike, NC, ND)

- **Real, Oshiro & Mafra (STIL 2019); repo mantido por americanas-tech — B2W-Reviews01,
  repositório oficial** (GitHub; arquivado 31/05/2022).
  [link](https://github.com/americanas-tech/b2w-reviews01)
  _Âncora:_ junto com a orientação da Creative Commons, o **conflito de licença de saída**: CC
  BY-NC-SA exige licença de saída idêntica. _Onde no projeto:_ plano v3 § "§0" R9 e § D2;
  `benchmark/source-manifest.ts`; `docs/corpus-sources.md`. _Fato citado:_ confirma o
  licenciamento CC BY-NC-SA 4.0 do corpus de avaliações do Americanas.com.
- **Real, Oshiro & Mafra; fórum mantido por L. Real & I. Meza — B2W-Reviews01, página de
  licença** (opencor.gitlab.io).
  [link](https://opencor.gitlab.io/corpora/real19b2wreviews01/)
  _Âncora:_ o conflito de licença identificado — B2W exige ShareAlike **idêntico**, incompatível
  com uma licença de pesos bespoke; força R9 a cobrir compatibilidade de **saída**, não só
  verificação na fonte. _Onde no projeto:_ plano v3 § "§0" R9 e § D2; `docs/corpus-sources.md`.
  _Fato citado:_ mais de 130 mil avaliações (jan–mai/2018), licença CC BY-NC-SA 4.0, dentro do
  corte pré-ChatGPT.
- **Creative Commons — Using CC-Licensed Works for AI Training, orientação oficial** (Creative
  Commons). [link](https://creativecommons.org/using-cc-licensed-works-for-ai-training-2/)
  _Âncora:_ ancora tanto a posição de risco adotada no plano v1 (pesos não herdam obrigações da
  fonte) quanto a crítica de que essa posição **não** é conclusão da CC e que BY-SA (Wikipédia pt)
  proibiria adicionar NC à adaptação. _Onde no projeto:_ plano v1 § 0.2 (licença de pesos);
  auditorias; `docs/corpus-sources.md`. _Fato citado:_ "If AI models or outputs are based on
  ShareAlike content and they will be shared publicly... would require AI developers to use the
  same CC license".
- **USP — Corpus Carolina, página oficial de download e licenças por documento**
  (sites.usp.br/corpuscarolina). [link](https://sites.usp.br/corpuscarolina/corpus/)
  _Âncora:_ a exigência de verificação de licença **por documento** (não por corpus inteiro) e o
  estado `unknown` de licença no schema — risco de proveniência fabricada (R4) se a licença do
  agregador for usada em vez da do documento. _Onde no projeto:_ plano v3 § "§0" R4 e R9;
  `benchmark/source-manifest.ts`; `docs/corpus-sources.md`. _Fato citado:_ header CC BY-NC-SA
  4.0, mas documentos individuais têm licenças heterogêneas que devem ser observadas.
- **Brasil — Lei 9.610/1998 (Lei de Direitos Autorais), art. 8º, IV**
  (planalto.gov.br / camara.leg.br).
  [link](https://www2.camara.leg.br/legin/fed/lei/1998/lei-9610-19-fevereiro-1998-365399-publicacaooriginal-1-pl.html)
  _Âncora:_ a correção de que comunicação institucional profissional em pt-BR está **fora** do
  direito autoral por lei, o que torna "não medido" uma escolha de esforço (R7), não
  impossibilidade de licença. _Onde no projeto:_ plano v3 § B1 e § L1; `docs/corpus-sources.md`;
  `docs/limitations.md`. _Fato citado:_ "Não são objeto de proteção como direitos autorais [...]
  decisões judiciais e demais atos oficiais."

### 10.3 Termo de acesso, não só licença

- **Stack Exchange, Inc., 2024 — Announcing a change to the data dump process** (Meta Stack
  Exchange, 12/07/2024).
  [link](https://meta.stackexchange.com/questions/401324/announcing-a-change-to-the-data-dump-process)
  _Âncora:_ a exigência de registrar data e mecanismo de aquisição do dump do Stack Overflow e
  obter disposição jurídica explícita **antes** de incorporar a fonte ao corpus. _Onde no
  projeto:_ plano v3 § "§0" R9 e § D2; `docs/corpus-sources.md`;
  `docs/corpus-collection-runbook.md`. _Fato citado:_ o anúncio oficial do dump de 2024
  introduziu condição específica restringindo uso do dump em projetos de treino de modelos.
- **Anderson, 2024 — Stack Exchange restricts access to dump of user-contributed data, critics
  complain this contradicts license** (devclass.com, 30/07/2024).
  [link](https://devclass.com/2024/07/30/stack-exchange-restricts-access-to-dump-of-user-contributed-data-as-critics-complain-license-permits-reuse-for-any-purpose/)
  _Âncora:_ corrobora jornalisticamente a mudança de termo de acesso — base para estender R9 de
  "licença" para "licença **mais** termo de acesso". _Onde no projeto:_ plano v3 § "§0" R9;
  `docs/corpus-sources.md`. _Fato citado:_ o termo de acesso exclui "projects that do not include
  training a large language model (LLM)".
- **devclass.com, 2024 — Stack Exchange restricts access to dump of user-contributed data**
  (devclass.com, 30/07/2024).
  [link](https://www.devclass.com/development/2024/07/30/stack-exchange-restricts-access-to-dump-of-user-contributed-data-critics-complain-this-contradicts-license/1625192)
  _Âncora:_ a extensão de R9 de "licença do conteúdo" para "licença mais termo de acesso" na
  obtenção do corpus Stack Overflow pt. _Onde no projeto:_ plano v3 § "§0" R9;
  `docs/corpus-sources.md`. _Fato citado:_ desde 12/07/2024 os dumps exigem login com termo que
  exclui "training a large language model (LLM)"; o conteúdo permanece CC BY-SA 4.0.
- **blog feep.dev, 2025 — State of Stack Exchange dumps (fev/2025)** (search.feep.dev/blog).
  [link](https://search.feep.dev/blog/post/2025-02-20-state-of-stackexchange)
  _Âncora:_ a conclusão de que o **manifesto de reconstrução** (verificabilidade por terceiro) é
  inexequível para a fonte Stack Overflow — deve ser declarado, não descoberto por quem tentar
  reproduzir. _Onde no projeto:_ plano v3 § H2 (manifesto de reconstrução); § "§0" R7 e R9;
  `docs/corpus-sources.md`. _Fato citado:_ confirma que os dumps saíram do archive.org em
  jul/2024 e ficam atrás de login com termo que exclui treino de LLM. _Nota de autoria:_ autor não
  identificado por nome.

### 10.4 Licença por artefato e uso comportamental (Fase 0.1 da v1.0)

Nível de alegação: **(i) metodologia importada com fonte revisada**. A família de licença
existe, é publicada e é usada em produção por terceiros; o que é do projeto é a escolha de
aplicá-la aos pesos e **não** ao código, e essa escolha é engenharia, não teoria.

- **Contractor, McDuff, Haines, Lee, Hines, Hecht, Vincent & Li, 2022 — Behavioral Use
  Licensing for Responsible AI** (ACM FAccT 2022).
  [link](https://arxiv.org/abs/2011.03116)
  _Âncora:_ a decisão B2 — os pesos saem sob licença própria com **restrição de uso**, e não sob
  licença permissiva mais um parágrafo de recomendação. _Onde no projeto:_ plano v1 § 0.1;
  registro § B2; `models/cleanfeed-ptbr-v1/LICENSE` (`cleanfeed-weights-nc-1.0`);
  `benchmark/source-manifest.ts` (`WEIGHT_USE_POLICY`). _Fato citado:_ defende "the use of
  licensing to enable legally enforceable behavioral use conditions on software and code".
  _Ressalva de verificação:_ o resumo **não** afirma que a restrição vincula usuários a jusante de
  derivados — essa parte é ancorada pela entrada seguinte, não por esta. A versão publicada em
  FAccT tem o título acima; um preprint anterior circulou como "…for Deep Learning Models".
- **BigScience / licenses.ai, 2022 — The BigScience OpenRAIL-M License** (licenses.ai,
  26/08/2022).
  [link](https://www.licenses.ai/blog/2022/8/26/bigscience-open-rail-m-license)
  _Âncora:_ a seção 4 de `cleanfeed-weights-nc-1.0` — as restrições acompanham o artefato e
  alcançam qualquer derivado. É o mecanismo que responde ao achado do codex de que a cópia da
  extensão não viaja com pesos extraídos do pacote. _Onde no projeto:_
  `models/cleanfeed-ptbr-v1/LICENSE` § 4; `WEIGHT_USE_POLICY.restrictionsTravelWithArtifact`.
  _Fato citado:_ "permit free and open access, re-use, and downstream distribution of derivatives
  of AI artifacts as long as the behavioral-use restrictions always apply (including to derivative
  works)".
- **Creative Commons — Attribution 4.0 International (CC BY 4.0), texto legal**
  (creativecommons.org). [link](https://creativecommons.org/licenses/by/4.0/legalcode)
  _Âncora:_ a licença da documentação e da evidência. Escolhida **acima** de CC BY-NC porque a
  evidência existe para ser checada, citada e republicada com correção, e acima de CC0 porque a
  atribuição é o que liga um número desta bancada às ressalvas que o qualificam. _Onde no
  projeto:_ `docs/LICENSE-DOCS.md`; `LICENSES.md`. _Fato citado:_ exige apenas atribuição, sem
  restrição de campo de uso nem cláusula share-alike.

Sobre a **posição (a)** propriamente — os pesos não herdam as obrigações das licenças das fontes
— a referência é a orientação da Creative Commons já registrada em § 10.2, que a ancora nos dois
sentidos: sustenta a leitura adotada **e** registra que ela não é conclusão da CC. Não há entrada
nova aqui porque não há fonte nova: a posição é decisão de risco do operador, e o que a literatura
oferece é o enquadramento, não a conclusão.

**Sem precedente encontrado (2026-07-31):** a *tela de over-claim sobre documento de governança* —
uma função sem chamador de produção, aplicada por teste a uma lista de arquivos, que recusa uma
FRASE proibida em vez de um valor de campo. São **quatro**: `humanLabelOverclaimIn` (o rótulo
humano), `reviewOverclaimIn` (a revisão que não houve), `weightInheritanceOverclaimIn` (a licença
dos pesos) e `trainingIndependenceOverclaimIn` (independência corpus↔treino, acrescentada na Fase 1
porque o plano diz que essa alegação **nunca** pode ser feita, e prosa correta hoje está a uma
edição descuidada de virar alegação). O ancestral mais próximo dentro do próprio repositório é
`src/shared/classification-copy.ts`, que faz o mesmo com a copy da interface. Fora dele não foi
encontrada prática equivalente: lint de prosa existe (Vale, alex, write-good) mas sobre estilo e
viés de linguagem, não sobre uma alegação técnica que o projeto se proibiu de fazer. Quem conhecer
precedente, abra issue.

### 10.5 Backlog de corpora pt-BR

- **ajdavidl (curador) — Portuguese-NLP: índice curado de recursos** (GitHub, índice vivo).
  [link](https://github.com/ajdavidl/Portuguese-NLP)
  _Âncora:_ o backlog de corpora pt-BR **pré-corte** deixados de fora do escopo atual. _Onde no
  projeto:_ `docs/corpus-sources.md`; `docs/coleta-doacoes.md`. _Fato citado:_ lista BrWaC,
  CETENFolha, LegalPT (11,9M documentos) e PortugueseNewsDataset, entre outros recursos pt-BR
  pré-2022.

## Técnicas de implementação

Cada entrada aqui corresponde a um mecanismo que existe no código. A ordem é a do pipeline:
poda de duplicata, formação de cluster, intervalo, reamostragem, dimensionamento, calibração,
integridade e, por fim, texto e modelo.

### Deduplicação por quase-duplicata

- **Broder, 1997 — On the resemblance and containment of documents** (Proceedings of Compression
  and Complexity of Sequences 1997, pp. 21–29).
  [link](https://doi.org/10.1109/SEQUEN.1997.666900)
  _Âncora:_ deduplicação por quase-duplicata — shingles contíguos de 5 tokens, MinHash de 128
  permutações; e o Jaccard **estimado** por assinatura declarado como screen, com erro padrão de
  cerca de 0,034 no limiar. _Onde no projeto:_ `benchmark/near-duplicates.ts:35-52`; plano v3
  § C3 item 3 ("R7 é aplicado como SCREEN"). _Fato citado:_ define estimação de
  resemblance/containment via permutações min-wise independentes sobre conjuntos de shingles
  (MinHash), incluindo a variância conhecida do estimador.
- **Broder, 1997 — On the Resemblance and Containment of Documents** (SEQUENCES 1997, IEEE,
  DOI 10.1109/SEQUEN.1997.666900; página IEEE Xplore).
  [link](https://ieeexplore.ieee.org/document/666900/)
  _Âncora:_ o erro padrão declarado do screen — o Jaccard nunca é apresentado como "Jaccard ≥
  0,82" exato. _Onde no projeto:_ plano v3 § C3 item 3; `benchmark/near-duplicates.ts:35-52`.
  _Fato citado:_ a resemblance r(A,B) estimada por assinatura MinHash tem variância conhecida em
  função do número de permutações — base do erro padrão declarado.
- **Broder, Glassman, Manasse & Zweig, 1997 — Syntactic Clustering of the Web** (SRC Technical
  Note 1997-015; também Computer Networks and ISDN Systems 29(8-13):1157-1166 / WWW6).
  [link](https://www.microsoft.com/en-us/research/wp-content/uploads/1997/01/src-tn-1997-015.pdf)
  _Âncora:_ a técnica em si de shingles contíguos de 5 tokens com deduplicação por assinatura — é
  o paper que introduz o shingling aplicado a documentos, do qual a resemblance de Broder 1997 é
  a base teórica. _Onde no projeto:_ `benchmark/near-duplicates.ts:35-52`. _Fato citado:_ shingles
  de w tokens contíguos mais assinatura mínima de hashes (min-wise sketch) para detectar
  quase-duplicatas em escala.
- **Indyk & Motwani, 1998 — Approximate Nearest Neighbors: Towards Removing the Curse of
  Dimensionality** (STOC 1998, pp. 604–613). [link](https://doi.org/10.1145/276698.276876)
  _Âncora:_ LSH em 32 bandas sobre as assinaturas MinHash, com Jaccard ≥ 0,82, e união
  obrigatória por hash exato de conteúdo. _Onde no projeto:_
  `benchmark/near-duplicates.ts:35-52` (`shingleSize: 5`, `bands: 32`, `jaccardThreshold:
  0.82`); plano v3 § C3 item 3. _Fato citado:_ introduz locality-sensitive hashing (LSH) para
  busca aproximada de vizinhos em tempo sublinear via banding de assinaturas de hash.
- **Indyk & Motwani, 1998 — Approximate Nearest Neighbors** (STOC 1998, pp. 604–613; página ACM
  DL). [link](https://dl.acm.org/doi/10.1145/276698.276876)
  _Âncora:_ o mecanismo que evita comparar todos os pares ao aplicar o limiar de Jaccard
  estimado. _Onde no projeto:_ `benchmark/near-duplicates.ts:35-52`; plano v3 § C3 item 3. _Fato
  citado:_ hashing sensível à localidade particiona o espaço em bandas para achar vizinhos
  aproximados sem comparação O(n²).

### Chave composta: codificação injetiva e delimitador escrito como escape

Duas chaves deste repositório juntam campos numa string e depois usam a string como identidade: a chave
de par de candidatos e a chave de permutação do MinHash em `near-duplicates.ts`, e as chaves de nível de
`bootstrap.ts`. A exigência é a mesma nas duas — a junção tem de ser **injetiva** — e o mecanismo
escolhido é um delimitador que o alfabeto das partes não contém, não um prefixo de comprimento.

- **Kelsey, Chang & Perlner, 2016 — NIST SP 800-185: SHA-3 Derived Functions: cSHAKE, KMAC, TupleHash,
  and ParallelHash** (NIST Special Publication 800-185).
  [link](https://doi.org/10.6028/NIST.SP.800-185)
  _Âncora:_ a exigência de que hashear uma **tupla** de strings seja inequívoco — concatenar partes de
  comprimento variável colide, e é por isso que existe uma função dedicada a isso. _Onde no projeto:_
  `benchmark/near-duplicates.ts` (`KEY_FIELD_SEPARATOR`, na chave de par e na chave de permutação);
  `benchmark/bootstrap.ts` (`KEY_FIELD_SEPARATOR`, `KEY_PAIR_SEPARATOR`). _Fato citado:_ "TupleHash is a
  variable-length hash function designed to hash tuples of input strings unambiguously". _Divergência de
  mecanismo, declarada:_ a SP 800-185 obtém a injetividade por **codificação de comprimento**
  (`encode_string`); aqui ela vem de **delimitador reservado**, que só é válido porque o alfabeto das
  partes exclui o delimitador.
- **IEEE / The Open Group, 2017 — Base Definitions § 3.170 "Filename" e § 3.271 "Pathname",
  POSIX.1-2017** (The Open Group Base Specifications Issue 7).
  [link](https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/V1_chap03.html)
  _Âncora:_ o precedente de escolher **U+0000** como delimitador de campo: é o byte que o payload não
  pode conter, que é a condição para o delimitador não ser forjável dentro de uma parte. _Onde no
  projeto:_ `KEY_FIELD_SEPARATOR` nos dois módulos acima. _Fato citado:_ um filename "shall not contain
  the <NUL> or <slash> characters", e no contexto de um pathname cada filename é seguido por `<slash>` ou
  `<NUL>` — o NUL é terminador e nunca conteúdo. _Ressalva:_ o análogo é do domínio de pathnames, e um id
  de registro deste corpus é string JSON, onde U+0000 é representável. O que sustenta a escolha aqui é o
  **alfabeto medido** das partes — id de registro e shingle de 5 tokens de letra/número —, não uma
  proibição de formato.
- **Boucher & Anderson, 2021 — Trojan Source: Invisible Vulnerabilities** (arXiv 2111.00169; publicado
  depois no 32nd USENIX Security Symposium, 2023). [link](https://arxiv.org/abs/2111.00169)
  _Âncora:_ a outra metade da regra — escrito como **escape**, nunca como byte cru: um code point sem
  representação visual faz o fonte que a revisão humana lê divergir do fonte que a máquina executa.
  _Onde no projeto:_ o comentário de `KEY_FIELD_SEPARATOR` nos dois módulos, e o teste `carry no raw
  control byte, so no code-search tool can skip an evaluator file`. _Fato citado:_ tokens logicamente
  codificados em ordem diferente da exibida tornam a vulnerabilidade invisível ao revisor, e a defesa
  recomendada é de nível de compilador — recusar o code point no fonte, em vez de confiar na revisão.
  _Divergência declarada:_ o ataque do paper é reordenação bidi; aqui o code point não reordena nada, ele
  é **sem glifo**. A classe é a mesma — o fonte exibido não é o fonte real —, o mecanismo não.
- **ripgrep — GUIDE.md, seção "Binary data"** (documentação do projeto, BurntSushi/ripgrep).
  [link](https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md)
  _Âncora:_ o custo medido de um byte NUL cru num fonte — a busca de código deixa de ver o arquivo.
  _Onde no projeto:_ `benchmark/near-duplicates.ts`. _Fato citado:_ "a file is considered 'binary' if and
  only if it contains a `NUL` byte somewhere in its contents", e o modo padrão "is to attempt to remove
  binary files from a search completely"; a filtragem vale para arquivo descoberto por travessia
  recursiva de diretório, não para arquivo passado diretamente. _Medido neste repositório (2026-08-06):_
  com o byte cru presente, busca recursiva por `clusterNearDuplicates` sob `benchmark/` devolvia
  `corpus-import.ts` e o arquivo de teste e **omitia o módulo que define a função**, enquanto `git grep` o
  listava. E `git diff` troca o diff inteiro por "Binary files … differ" quando o NUL cai nos primeiros
  8000 bytes, medido com dois pares de arquivos que diferem só na posição do byte — o arquivo escapava
  disso por acidente de offset (11.283 de 13.822).
- **Git — gitattributes(5), o atributo `text` e a decisão texto/binário** (documentação do projeto Git).
  [link](https://git-scm.com/docs/gitattributes)
  _Âncora:_ por que a varredura de byte de controle cru da árvore **não** pode isentar pelo que o git
  classifica como binário. _Onde no projeto:_ `tests/unit/repo/line-endings.test.ts`, teste "leaves no raw
  control byte in a tracked path the repo calls text". _Fato citado:_ 'When `text` is set to "auto", Git
  decides by itself whether the file is text or binary'; um caminho cujo atributo `diff` não está
  especificado "first gets its contents inspected, and if it looks like text … Otherwise it would generate
  `Binary files differ`"; e o git "usually guesses correctly whether a blob contains text or binary data by
  examining the beginning of the contents". _O que a documentação não fixa, e foi medido aqui (2026-08-06):_
  que são **duas** classificações com janelas diferentes. A do `diff` olha o começo do conteúdo — com o NUL
  no offset 3 o `git diff` imprime "Binary files … differ" e nenhuma linha, com o NUL no offset 20.003 diffa
  como texto. A da conversão, que é a coluna `i/` de `git ls-files --eol`, não usa janela: medido num índice
  temporário sobre o HEAD, os dois arquivos com byte cru saem `i/-text`, inclusive o que tinha o NUL no
  offset 11.283 **de** 13.822 e cujo diff era de texto. _Consequência de desenho:_ a classificação é
  **causada** pelo byte procurado, então a isenção da varredura é a extensão declarada `binary` em
  `.gitattributes` (nenhuma rastreada hoje) e nunca `i/-text` — filtrar por ela é o que fez os quatro
  guardas de EOL do mesmo arquivo pularem os dois infratores sem ficar vermelhos.

### Cluster como átomo: componente conexo e validação cruzada

- **Tarjan, 1975 — Efficiency of a Good But Not Linear Set Union Algorithm** (Journal of the ACM
  22(2):215–225). [link](https://dl.acm.org/doi/10.1145/321879.321884)
  _Âncora:_ cluster de split e de exposição como **componente conexo** (union-find) sobre a união
  dos eixos de agrupamento aplicáveis. _Onde no projeto:_ `benchmark/split.ts:150`
  (`CONNECTIVITY_AXES`), `:351-414` (`connectedComponentRoots`); plano v3 § C3. _Fato citado:_
  union-find com union-by-rank e path compression tem custo quase-linear (função de Ackermann
  inversa).
- **Kohavi, 1995 — A Study of Cross-Validation and Bootstrap for Accuracy Estimation and Model
  Selection** (IJCAI 1995, vol. 2, pp. 1137–1145).
  [link](https://dl.acm.org/doi/10.5555/1643031.1643047)
  _Âncora:_ validação cruzada agrupada — 5 folds estratificados por classe com o cluster como
  átomo indivisível, seed de CV própria congelada (20260727); e os pesos iguais por cluster na
  agregação out-of-fold. _Onde no projeto:_ plano v3 § C6; `benchmark/cross-validation.ts`
  (`aggregateOutOfFold`). _Fato citado:_ estudo comparativo que estabelece a CV estratificada em
  k folds como de menor variância e mais confiável que CV simples ou leave-one-out para seleção
  de modelo. _Nota de escopo:_ o GroupKFold em si (cluster como átomo, via union-find) é recurso
  de engenharia sem paper de origem único; Kohavi é o precedente formal mais próximo.

### Intervalo, quantil e comparador de runtime

- **Wilson, 1927 — Probable inference, the law of succession, and statistical inference** (JASA
  22(158):209–212). [link](https://doi.org/10.1080/01621459.1927.10502953)
  _Âncora:_ intervalo de Wilson unilateral (score interval) com valor crítico literal `z =
  1.6448536269514722`, fixado para reprodutibilidade byte a byte. _Onde no projeto:_
  `benchmark/intervals.ts:24` (`wilsonOneSided`), `:50` (`wilsonOneSidedAtAlpha`), `:109`
  (`oneSidedZ`); `docs/model-validation.md` § "Estatística do benchmark". _Fato citado:_ intervalo
  de score (Wilson) para proporção binomial; valor crítico unilateral z = 1.6448536269514722.
- **IEEE Standards Association, 2008 — IEEE Standard for Floating-Point Arithmetic (IEEE Std
  754-2008)** (IEEE Std 754-2008; IEEE Xplore doc 4610935).
  [link](https://doi.org/10.1109/IEEESTD.2008.4610935)
  _Âncora:_ comparador de runtime `score >= nextUp(quantil)` serializado, para que empates no
  quantil fiquem do lado **não acusado**. _Onde no projeto:_ plano v3 § "Contrato de execução…"
  (comparador de runtime) e § G2 item 6. _Fato citado:_ define formalmente nextUp(x)/nextDown(x)
  como o menor/maior valor representável estritamente maior/menor que x — a fonte normativa para
  um comparador que precisa passar estritamente de um valor de fronteira. _Nota de verificação:_
  referência normativa confirmada por busca (DOI verificado), não pela memória do modelo.

### Reamostragem: unidade, hierarquia e fatores cruzados

- **Efron, 1979 — Bootstrap methods: another look at the jackknife** (The Annals of Statistics
  7(1):1–26). [link](https://doi.org/10.1214/aos/1176344552)
  _Âncora:_ fonte primária do método para o bootstrap por cluster (unidade de reamostragem =
  cluster inteiro, nunca registro-linha), com seed registrada. _Onde no projeto:_
  `benchmark/bootstrap.ts`; `docs/model-validation.md` § "Bootstrap clusterizado por autor".
  _Fato citado:_ introdução do método de bootstrap por reamostragem com reposição.
- **Cameron & Miller, 2015 — A Practitioner's Guide to Cluster-Robust Inference** (Journal of
  Human Resources 50(2):317–372). [link](https://doi.org/10.3368/jhr.50.2.317)
  _Âncora:_ bootstrap por cluster e a escolha da unidade de reamostragem **por estimando** (FPR
  humano = fonte ⊃ autor; recall de IA = gerador ⊃ prompt ⊃ seed/batch; misto = pai-humano ×
  operação; calibração herda do estrato). _Onde no projeto:_ `benchmark/bootstrap.ts`; plano v3
  § C4; `benchmark/rebuild-v3-policy.json` (`resampling.estimandClasses`,
  `resampling.estimands`); `docs/model-validation.md`. _Fato citado:_ a unidade de reamostragem e
  de inferência deve ser o cluster inteiro, não a linha, sob dependência intra-cluster.
- **Field & Welsh, 2007 — Bootstrapping clustered data** (JRSS Series B 69(3):369–390).
  [link](https://doi.org/10.1111/j.1467-9868.2007.00593.x)
  _Âncora:_ mesma âncora do bootstrap por cluster e do bootstrap hierárquico multistage. _Onde no
  projeto:_ `benchmark/bootstrap.ts:98` (`method: "hierarchical"`); plano v3 § C4. _Fato citado:_
  métodos de bootstrap especificamente desenhados para dados com estrutura de cluster ou
  hierárquica.
- **Davison & Hinkley, 1997 — Bootstrap Methods and Their Application** (Cambridge University
  Press). [link](https://statwww.epfl.ch/davison/BMA)
  _Âncora:_ bootstrap hierárquico (multistage/nested) — sorteio com reposição no nível externo e,
  para cada ocorrência, no nível imediatamente interno. _Onde no projeto:_
  `benchmark/bootstrap.ts:98`, `:489`, `:615`; plano v3 § C4. _Fato citado:_ tratamento
  sistemático de bootstrap hierárquico/multiestágio para dados agrupados em múltiplos níveis.
  _Nota de verificação:_ o TLS do servidor legado impediu o fetch direto nesta sessão;
  existência e indexação confirmadas via busca.
- **Efron & Tibshirani, 1993 — An Introduction to the Bootstrap** (Chapman & Hall/CRC).
  [link](https://doi.org/10.1201/9780429246593)
  _Âncora:_ companheiro de Davison & Hinkley na mesma âncora do bootstrap hierárquico, e a
  contagem de réplicas pré-registrada (10.000 no piloto, 100.000 no release, seed 20260728) com
  publicação de `replicates`/`tailReplicates` porque o percentil de Bonferroni vive na cauda.
  _Onde no projeto:_ `benchmark/bootstrap.ts`; plano v3 § C4 e § A6 item 7
  (`insufficient-resampling-effort`); `benchmark/rebuild-v3-policy.json`
  (`bootstrapReplicates`). _Fato citado:_ referência-texto padrão para contagem de réplicas de
  bootstrap e comportamento na cauda da distribuição de réplicas.
- **Owen, 2007 — The pigeonhole bootstrap** (The Annals of Applied Statistics 1(2):386–411).
  [link](https://doi.org/10.1214/07-AOAS122)
  _Âncora:_ bootstrap multiway/pigeonhole para fatores cruzados **não aninhados** (pesos
  multinomiais independentes por fator, multiplicados por célula) — aninhar o que é cruzado
  subestima a variância. _Onde no projeto:_ `benchmark/bootstrap.ts:105`, `:444` (recusa multiway
  com menos de 2 fatores), `:666`; plano v3 § C4. _Fato citado:_ bootstrap que reamostra
  separadamente linhas e colunas para dados com efeitos aleatórios cruzados e desbalanceados.
- **Owen & Eckles, 2012 — Bootstrapping data arrays of arbitrary order** (The Annals of Applied
  Statistics 6(3):895–927). [link](https://doi.org/10.1214/12-AOAS547)
  _Âncora:_ mesma âncora do bootstrap multiway — é a generalização formal do método de Owen 2007
  para mais de dois fatores cruzados. _Onde no projeto:_ `benchmark/bootstrap.ts:105`, `:444`,
  `:666`; plano v3 § C4. _Fato citado:_ generalização do pigeonhole bootstrap para arrays de
  fatores cruzados de ordem arbitrária.

### Dimensionamento, amostragem e estados de dado faltante

- **Shrout & Fleiss, 1979 — Intraclass correlations: uses in assessing rater reliability**
  (Psychological Bulletin 86(2):420–428). [link](https://doi.org/10.1037/0033-2909.86.2.420)
  _Âncora:_ ICC estimada por fonte a partir de coleta piloto; **e** a concordância
  intra-avaliador/teste-reteste declarada **não mensurável** sob revisor único. _Onde no projeto:_
  plano v3 § D0 "Coleta piloto para estimar ICC e efeito de desenho"; § L4 consequência 1; § C5
  "Recibo de revisor único". _Fato citado:_ formas ICC1/ICC2/ICC3 e sua relação com
  confiabilidade teste-reteste entre avaliadores.
- **Donner & Klar, 2000 — Design and Analysis of Cluster Randomization Trials in Health
  Research** (Arnold, Londres; ISBN 0-340-69153-0; edição atual pela Wiley).
  [link](https://www.wiley.com/en-us/Design+and+Analysis+of+Cluster+Randomization+Trials+in+Health+Research-p-9780470711002)
  _Âncora:_ companheiro de Shrout & Fleiss na mesma âncora, trazendo a perspectiva de ensaios
  clínicos por cluster (vs. a perspectiva psicométrica) para a mesma prática. _Onde no projeto:_
  plano v3 § D0. _Fato citado:_ tratamento sistemático de ICC e efeito de desenho no contexto de
  ensaios clínicos randomizados por cluster.
- **Kish, 1965 — Survey Sampling** (John Wiley & Sons; ISBN 9780471109495 corresponde à
  reimpressão Wiley-Interscience de 1995).
  [link](https://www.wiley.com/en-us/Survey+Sampling-p-9780471109495)
  _Âncora:_ efeito de desenho `1 + (m̄ − 1)·ICC` como fator de inflação do tamanho em linhas para
  dar poder em clusters. _Onde no projeto:_ plano v3 § D0 e § D0b ("efeito de desenho por
  célula"). _Fato citado:_ origem do conceito de efeito de desenho (design effect, deff) para
  amostragem complexa e agrupada. _Nota de verificação:_ fetch direto bloqueado por proteção
  anti-bot; confirmado via OpenLibrary.
- **Cochran, 1977 — Sampling Techniques, 3rd Edition** (John Wiley & Sons; ISBN
  978-0471162407).
  [link](https://www.wiley.com/en-us/Sampling+Techniques,+3rd+Edition-p-9780471162407)
  _Âncora:_ amostragem estratificada por fonte com desenho congelado **antes** de olhar qualquer
  texto (piloto de PII: 500 registros-linha, 125 por fonte, em ordem de digest), e a amostra
  aleatória simples obrigatória para a cota de PII — é proibido ponderar a alocação e citar o
  limite de AAS na mesma frase. _Onde no projeto:_ plano v3 § "Piloto de triagem por NER
  (2026-07-29)" e § D1 passo 4. _Fato citado:_ fundamentos de amostragem estratificada e de
  amostra aleatória simples com desenho fixado antes da coleta.
- **Neyman, 1938 — Contribution to the theory of sampling human populations** (JASA
  33(201):101–116). [link](https://doi.org/10.1080/01621459.1938.10503378)
  _Âncora:_ auditoria em duas fases — censo automático (regex) → triagem por NER → adjudicação
  humana de todo apontamento → amostra de verificação entre os **não** apontados. _Onde no
  projeto:_ plano v3 § D1 ("PII: amostragem, não censo", passos 1–5); § C5 (piloto de NER). _Fato
  citado:_ formalização da amostragem em duas fases (double sampling) para verificação com custo
  desigual entre estágios.
- **Rubin, 1976 — Inference and missing data** (Biometrika 63(3):581–592).
  [link](https://doi.org/10.1093/biomet/63.3.581)
  _Âncora:_ R6 — os três estados epistêmicos `known` | `notApplicable` | `unknown`, com
  identificador sintético proibido. _Onde no projeto:_ plano v3 § "§0" R6; `benchmark/schema.ts`
  (`groupAxisIdentity`, `groupAxisDeclaredState`). _Fato citado:_ taxonomia MCAR/MAR/MNAR de
  mecanismos de dados faltantes.

### Reta de calibração

- **Cox, 1958 — Two further applications of a model for binary regression** (Biometrika
  45(3-4):562–565). [link](https://doi.org/10.1093/biomet/45.3-4.562)
  _Âncora:_ fonte primária do modelo estatístico de onde deriva a reta de calibração
  (intercept/slope). _Onde no projeto:_ `benchmark/metrics.ts:806-807`; plano v3 § A6
  ("Métrica"). _Fato citado:_ origem do modelo de regressão binária usado para estimar a reta de
  calibração ("Cox calibration").
- **Van Calster, McLernon, van Smeden, Wynants & Steyerberg, 2019 — Calibration: the Achilles
  heel of predictive analytics** (BMC Medicine 17:230).
  [link](https://doi.org/10.1186/s12916-019-1466-7)
  _Âncora:_ reta de calibração (intercept e slope) como **diagnóstico**, com `NaN` quando o ajuste
  não é identificado — nunca um `1` fabricado. _Onde no projeto:_ `benchmark/metrics.ts:806-807`;
  plano v3 § A6. _Fato citado:_ hierarquia de calibração (calibration-in-the-large,
  slope/intercept) como diagnóstico obrigatório além de ECE e Brier.

### Integridade, custódia e falha fechada

- **Krawczyk, Bellare & Canetti, 1997 — RFC 2104: HMAC: Keyed-Hashing for Message
  Authentication** (IETF RFC). [link](https://www.rfc-editor.org/rfc/rfc2104)
  _Âncora:_ pseudonimização por HMAC-SHA256 com segredo, keyring versionado, rotação que
  **adiciona** chave sem reescrever história, e separação de domínio pela mensagem do MAC. _Onde
  no projeto:_ `benchmark/cluster-exposure-ledger.ts:722` (`hmacHex`);
  `benchmark/lab/pseudonymize.py`; plano v3 § C3 item 1 e § D1 requisito 5. _Fato citado:_
  construção HMAC(K,m) = H((K'⊕opad) || H((K'⊕ipad) || m)) com segredo compartilhado.
- **Laurie, Langley & Kasper, 2013 — RFC 6962: Certificate Transparency** (IETF RFC,
  Experimental; obsoletada pela RFC 9162, mas é a formulação canônica citada no repositório).
  [link](https://www.rfc-editor.org/rfc/rfc6962)
  _Âncora:_ ledger append-only de exposição com cadeia de digests de evento (`previousEventDigest`
  → `eventDigest`), schema de evento fechado e versionado. _Onde no projeto:_
  `benchmark/cluster-exposure-ledger.ts`; plano v3 § C3. _Fato citado:_ log append-only de árvore
  Merkle com Signed Tree Head/witness, auditável publicamente.
- **Haber & Stornetta, 1991 — How to Time-Stamp a Digital Document** (Journal of Cryptology
  3:99–111). [link](https://doi.org/10.1007/BF00196791)
  _Âncora:_ ancestral direto do encadeamento `previousEventDigest` → `eventDigest`. _Onde no
  projeto:_ `benchmark/cluster-exposure-ledger.ts`; plano v3 § C3. _Fato citado:_ cadeia de hashes
  encadeados (cada timestamp inclui o hash do anterior) prova ordem e integridade sem autoridade
  confiável.
- **Schneier & Kelsey, 1999 — Secure Audit Logs to Support Computer Forensics** (ACM TISSEC
  2(2):159–176). [link](https://dl.acm.org/doi/10.1145/317087.317089)
  _Âncora:_ o mesmo ledger append-only pelo lado de **tamper-evidence** — por que a cadeia de
  digests detecta adulteração retroativa, não só prova ordem. _Onde no projeto:_
  `benchmark/cluster-exposure-ledger.ts`; plano v3 § C3. _Fato citado:_ entradas de log encadeadas
  por MAC/hash de modo que o comprometimento da máquina não permite alterar ou apagar entradas
  anteriores sem detecção.
- **ISO/IEC, 2012 — ISO/IEC 27037:2012: Guidelines for identification, collection, acquisition
  and preservation of digital evidence** (ISO/IEC, página oficial de normas).
  [link](https://www.iso.org/standard/44381.html)
  _Âncora:_ framing forense complementar à RFC 6962 e a Schneier & Kelsey — a combinação do ledger
  de exposição com o `labelEvidenceRef` digestado como **cadeia de custódia** da evidência de
  rótulo. _Onde no projeto:_ `benchmark/cluster-exposure-ledger.ts`; plano v3 § C1 e § C3. _Fato
  citado:_ custódia lógica de evidência digital via valores de hash, selos eletrônicos e
  timestamps qualificados, mantida ao longo de todo o ciclo de vida. _Ressalva de verificação:_
  **não verificado em texto integral** — a norma é paga e só resumo e normas de terceiros foram
  lidos; a correspondência exata dos termos é tratada como não confirmada.
- **IEEE / The Open Group, 2017 — rename(): System Interfaces, POSIX.1-2017 (IEEE Std
  1003.1-2017)** (The Open Group Base Specifications Issue 7).
  [link](https://pubs.opengroup.org/onlinepubs/9699919799/functions/rename.html)
  _Âncora:_ escrita transacional do estado selado — lock, backup autenticado antes do rename,
  temporário mais `fsync` mais substituição atômica, com `restore` fail-closed sob divergência.
  _Onde no projeto:_ plano v3 § C3 (bullets de mutação) e § C3 item 5 ("honestidade sobre
  atomicidade no Windows"). _Fato citado:_ `rename()` é atômico do ponto de vista de outros
  processos no mesmo host — o novo nome sempre resolve para o arquivo antigo ou o novo, nunca para
  um estado intermediário ou ausente; o item 5 do plano reconhece precisamente que essa garantia
  POSIX **não** se estende ao NTFS.
- **Saltzer & Schroeder, 1975 — The Protection of Information in Computer Systems** (Proceedings
  of the IEEE 63(9):1278–1308). [link](https://doi.org/10.1109/PROC.1975.9939)
  _Âncora:_ as duas práticas de **falha fechada**: falha por evidência de reamostragem ausente
  (`resampling.fallbackToIndependentRows: false`) e falha estrutural na validação cruzada. _Onde
  no projeto:_ plano v3 § A6 (`GateInput.resampling` obrigatório), § C4 e § C6 item 5
  (`CLUSTERS_BELOW_FOLDS`, `CLASS_CLUSTERS_BELOW_FOLDS`, `FOLD_HALF_EMPTY`,
  `TRAIN_MISSING_LABEL`); `benchmark/rebuild-v3-policy.json`. _Fato citado:_ princípio de projeto
  "fail-safe defaults" — o sistema deve falhar para o estado de maior segurança/negação quando um
  erro é detectado, nunca para o estado permissivo.

### Normalização de texto, backbone e sinal

- **Unicode Consortium — UAX #15: Unicode Normalization Forms** (Unicode Technical Reports;
  versão corrente 17.0.0). [link](https://unicode.org/reports/tr15/)
  _Âncora:_ normalização NFKC por grafema com lista fechada de exceções. _Onde no projeto:_
  `contracts/text-normalization.ts` linhas 8-30, 187-220, 349-386, 430-450
  (`NFKC_PROTECTED_CHARACTERS`, `addsWhitespace`, `SUPERSCRIPT_OR_SUBSCRIPT`); e o NFKC do
  montador de corpus em `benchmark/lab/near_dupes.py`. _Fato citado:_ define as quatro formas de
  normalização Unicode, incluindo NFKC, e exatamente quais code points ela dobra (ligaduras,
  sobrescritos/subscritos, indicadores ordinais, elipse, formas de largura plena).
- **Souza, Nogueira & Lotufo, 2020 — BERTimbau: Pretrained BERT Models for Brazilian
  Portuguese** (BRACIS 2020, LNCS 12319). [link](https://doi.org/10.1007/978-3-030-61377-8_28)
  _Âncora:_ o backbone selado da v1 (`neuralmind/bert-base-portuguese-cased`, `backboneBakeOff:
  false`), e o tokenizer WordPiece cujo comportamento (`[UNK]` por ideograma CJK isolado, porque o
  vocabulário não tem ideograma nu) o derivador de offsets do runtime contorna explicitamente.
  _Onde no projeto:_ `benchmark/preregistration-v4.json` (`backbone`) e o pin do parser em
  `benchmark/preregistration-v4.ts`; `src/inference/model-runtime.ts` linhas 208-210 e 505-507, e o mesmo
  comportamento no fake de teste em `tests/helpers/wordpiece-tokenizer.ts` linhas 1-14;
  `benchmark/lab/train_detector.py` (`assert_model_is_the_sealed_backbone`);
  `benchmark/lab/export_onnx.py` (`BACKBONE_CONFIG_SHAPE`, onde o vocabulário de 29 794 é o que
  identifica o checkpoint); `models/cleanfeed-ptbr-v1/NOTICE.md`. _Fato citado:_ pré-treina BERT base/large para português do
  Brasil no corpus BrWaC (2,68B tokens), com estado da arte à época em NER, STS e RTE para pt-BR.
- **Conneau, Khandelwal, Goyal, Chaudhary, Wenzek, Guzmán, Grave, Ott, Zettlemoyer & Stoyanov,
  2020 — Unsupervised Cross-lingual Representation Learning at Scale (XLM-R)** (ACL 2020).
  [link](https://aclanthology.org/2020.acl-main.747/)
  _Âncora:_ candidato de backbone **descartado** — o bake-off não roda na v3, e a emenda W1 abdica
  de propósito da única vantagem não medida que o XLM-R teria (encoder pré-treinado em corpus muito
  maior). As contagens do artigo são também a aritmética que o teto de bytes usa para recusar a
  família RoBERTa. _Onde no projeto:_ `benchmark/lab/export_onnx.py`
  (`BACKBONE_CONFIG_MODEL_TYPE`, que o nomeia para recusá-lo);
  `benchmark/tests/preregistration-v4.test.ts` ("refuses the discarded bake-off candidate");
  registro § "A emenda do backbone (W1)". _Fato citado:_ apresenta o XLM-R, um RoBERTa multilíngue
  pré-treinado em CommonCrawl filtrado sobre 100 línguas, com vocabulário de 250k.
- **Szegedy, Vanhoucke, Ioffe, Shlens & Wojna, 2016 — Rethinking the Inception Architecture for
  Computer Vision** (CVPR 2016, seção 7 "Model Regularization via Label Smoothing").
  [link](https://arxiv.org/abs/1512.00567)
  _Âncora:_ a ablação cross-entropy × label smoothing 0,05 na grade de F3 (3 seeds cada), tratada
  como **ablação, não causa confirmada**. _Onde no projeto:_ plano v3 linhas 53 e 7943;
  `docs/detector-rebuild-critical-review.md` § P1 ("Label smoothing não é uma causa
  demonstrada"). _Fato citado:_ introduz label smoothing como regularizador de tempo de treino
  para a distribuição-alvo do classificador.
- **Dietterich, Lathrop & Lozano-Pérez, 1997 — Solving the multiple instance problem with
  axis-parallel rectangles** (Artificial Intelligence 89(1-2):31–71).
  [link](https://doi.org/10.1016/S0004-3702(96)00034-3)
  _Âncora:_ rótulo de documento (bag: `mixed` / `atLeastHalfAi`) conhecido e atribuição por trecho
  (instância) **latente e não produzida** — é o ancestral canônico para essa arquitetura
  bag-label/instance-latent. _Onde no projeto:_ `benchmark/metrics.ts` (`LocalizationCohort`,
  `SpanProducerState = "absent" | "undeterminable"`, comentário "NO PRODUCER YET",
  `localization.role: "diagnostic"`); plano v3 (`materialAssistance.generationModes`,
  "mechanistic"/"ecological"). _Fato citado:_ formaliza o problema de multiple-instance learning
  (MIL) — uma bag é positiva se e somente se ao menos uma de suas instâncias satisfaz a
  propriedade-alvo, enquanto os rótulos por instância permanecem latentes.
- **Spärck Jones, 1972 — A Statistical Interpretation of Term Specificity and Its Application in
  Retrieval** (Journal of Documentation 28(1):11–21). [link](https://doi.org/10.1108/eb026526)
  _Âncora:_ baseline TF-IDF com regressão logística, e o controle TF-IDF restrito a palavras
  funcionais e pontuação (149 features) usado para separar sinal distribucional-estilístico de
  sinal lexical. _Onde no projeto:_ `benchmark/lab/baseline_tfidf.py`;
  `docs/detector-rebuild-assessment.md`. _Fato citado:_ formalização estatística da
  especificidade inversa de termo/documento — a metade "IDF" da ponderação TF-IDF; no projeto, AUC
  0,772 no controle de palavras funcionais contra 0,474 do TF-IDF lexical completo.

### Sondas diagnósticas: validação adversarial, estilometria e viés medido (W3)

- **Lopez-Paz & Oquab, 2017 — Revisiting Classifier Two-Sample Tests** (ICLR 2017).
  [link](https://openreview.net/forum?id=SJkXfE5xx)
  _Âncora:_ a sonda 1 inteira. O desempenho de um classificador treinado para distinguir duas
  amostras **é** a estatística de um teste de duas amostras, e "no nível do acaso" é a hipótese
  nula desse teste — não uma expectativa informal. _Onde no projeto:_
  `benchmark/lab/diagnostic_probes.py` (`probe_partitions`,
  `assert_partitions_are_exchangeable`, `PARTITION_PREDICTABILITY_AUC_FLOOR`);
  `test_diagnostic_probes.py::PartitionProbeTests`. _Fato citado:_ formaliza o C2ST — treinar um
  classificador para separar duas amostras e usar sua acurácia de teste como estatística, com a
  nula em 1/2.
- **Ben-David, Blitzer, Crammer, Kulesza, Pereira & Vaughan, 2010 — A theory of learning from
  different domains** (Machine Learning 79(1-2):151–175).
  [link](https://doi.org/10.1007/s10994-009-5152-4)
  _Âncora:_ o que a AUC da sonda 1 estima, e por que ela recusa a montagem em vez de descrevê-la:
  a divergência entre duas distribuições limita o erro de transferir de uma para a outra, e o
  estimador empírico dessa divergência é exatamente um classificador de domínio. Uma partição
  `dev` que um classificador nomeia é uma `dev` cujo número não limita nada sobre `train`. _Onde no
  projeto:_ `diagnostic_probes.probe_partitions`; o parágrafo "THE THREE OPEN PARTITIONS" do módulo.
  _Fato citado:_ limite de erro em adaptação de domínio em função da H-divergência entre as duas
  distribuições, estimada empiricamente por um discriminador entre as duas amostras.
- **Rabanser, Günnemann & Lipton, 2019 — Failing Loudly: An Empirical Study of Methods for
  Detecting Dataset Shift** (NeurIPS 2019). [link](https://arxiv.org/abs/1810.11953)
  _Âncora:_ escolher o classificador de domínio como detector de deslocamento em vez de um teste
  univariado por feature, e ler o resultado como teste de hipótese com p-valor. _Onde no projeto:_
  `diagnostic_probes.auc_p_value`; `PARTITION_PREDICTABILITY_SIGNIFICANCE`. _Fato citado:_ compara
  empiricamente famílias de detectores de deslocamento de dados, incluindo o classificador de
  domínio, e reporta cada um como teste estatístico com p-valor.
- **Bamber, 1975 — The area above the ordinal dominance graph and the area below the receiver
  operating characteristic graph** (Journal of Mathematical Psychology 12(4):387–415).
  [link](https://doi.org/10.1016/0022-2496%2875%2990001-2)
  _Âncora:_ a AUC deste módulo é calculada como estatística de postos, e não pela regra do
  trapézio, porque o p-valor precisa do **mesmo** U. _Onde no projeto:_
  `diagnostic_probes.rank_auc` (empates por posto médio, conferido contra `roc_auc_score`).
  _Fato citado:_ identidade entre a área sob a curva ROC e P(X > Y) + ½P(X = Y), isto é, a
  estatística de Mann-Whitney normalizada.
- **Mann & Whitney, 1947 — On a Test of Whether one of Two Random Variables is Stochastically
  Larger than the Other** (Annals of Mathematical Statistics 18(1):50–60).
  [link](https://doi.org/10.1214/aoms/1177730491)
  _Âncora:_ a nula que a sonda 1 usa — média `n1·n2/2` e variância `n1·n2·(n1+n2+1)/12` —, e a
  declaração de que **não** corrigir empates encolhe a variância na direção que recusa MENOS.
  _Onde no projeto:_ `diagnostic_probes.auc_p_value`;
  `test_the_null_p_value_is_one_sided_and_uncorrected_for_ties`. _Fato citado:_ distribuição de U
  sob a hipótese de igualdade das duas distribuições, com média e variância explícitas.
- **Hanley & McNeil, 1982 — The meaning and use of the area under a receiver operating
  characteristic (ROC) curve** (Radiology 143(1):29–36).
  [link](https://doi.org/10.1148/radiology.143.1.7063747)
  _Âncora:_ a leitura da AUC como probabilidade de ordenação correta de um par, que é o que
  sustenta reportar uma AUC por partição em um-contra-resto em vez de acurácia — a acurácia de uma
  partição que é 45 % de três é enganosa por prevalência, a AUC não. _Onde no projeto:_ a escolha
  de AUC OvR em `probe_partitions` e `probe_lanes`. _Fato citado:_ interpretação da AUC como a
  probabilidade de o classificador ordenar corretamente um par positivo/negativo escolhido ao azar.
- **Ojala & Garriga, 2010 — Permutation Tests for Studying Classifier Performance** (JMLR
  11:1833–1863). [link](https://www.jmlr.org/papers/v11/ojala10a.html)
  _Âncora:_ a alternativa **declarada e não implementada**. O p-valor por permutação não precisa do
  argumento de que as dobras não carregam informação de rótulo sob a nula; custa o número de
  permutações vezes o custo do ajuste, para uma camada que só precisa separar "no acaso" de "não".
  _Onde no projeto:_ o docstring de `diagnostic_probes.auc_p_value`. _Fato citado:_ define dois
  testes de permutação para desempenho de classificador e mostra que o teste analítico assume
  independência que validação cruzada não garante.
- **Forman & Scholz, 2010 — Apples-to-Apples in Cross-Validation Studies: Pitfalls in Classifier
  Performance Measurement** (SIGKDD Explorations 12(1):49–57).
  [link](https://doi.org/10.1145/1882471.1882479)
  _Âncora:_ a correção de que a AUC **agrupada** das predições fora de dobra e a AUC de um modelo
  único **não são a mesma quantidade**. A primeira redação desta unidade alegava que a AUC ajustada
  da sonda 2 coincide com o rank AUC da contagem crua "porque uma logística de uma feature é
  monótona nela"; a monotonia vale DENTRO de uma dobra, e a AUC publicada agrupa as predições de
  cinco modelos com cinco interceptos, cuja união não é monótona. _Onde no projeto:_ o docstring de
  `diagnostic_probes.probe_length`, `coefficientPerFold`;
  `test_the_two_auc_columns_are_different_quantities_and_diverge` e
  `test_a_perfectly_separated_fixture_makes_the_two_columns_degenerate`. _Fato citado:_ distingue
  explicitamente as duas maneiras de compor uma métrica sob validação cruzada — agrupar as predições
  de todas as dobras num só cálculo contra calcular por dobra e mediar — e mostra que as duas dão
  números diferentes, tratando a escolha como parte do protocolo e não como detalhe.
- **Airola, Pahikkala, Waegeman, De Baets & Salakoski, 2011 — An experimental comparison of
  cross-validation techniques for estimating the area under the ROC curve** (Computational
  Statistics & Data Analysis 55(4):1828–1844). [link](https://doi.org/10.1016/j.csda.2010.11.018)
  _Âncora:_ a razão de a divergência entre as duas colunas **não** ser diagnóstico de ajuste
  falhado, que é o que o docstring anterior mandava o leitor caçar. _Onde no projeto:_ o mesmo
  docstring, e a declaração de que divergência com um sinal só é ruído de amostragem enquanto
  divergência com dois sinais são dobras que discordam. _Fato citado:_ compara empiricamente os
  estimadores de AUC por validação cruzada, incluindo o agrupado ("pooling") e o mediado, e mede a
  diferença de viés e variância entre eles em amostras pequenas.
- **Gebru, Morgenstern, Vecchione, Vaughan, Wallach, Daumé III & Crawford, 2021 — Datasheets for
  Datasets** (Communications of the ACM 64(12):86–92). [link](https://doi.org/10.1145/3458723)
  _Âncora:_ o campo `inputs.rowsPerFile` no relatório das sondas. A receita registrada em prosa
  (`--pools`) lia 67.934 linhas e não as 9.707 em moldura, e um relatório que não nomeia sua entrada
  é indistinguível de um rodado fora da moldura para quem só tem o artefato. _Onde no projeto:_
  `diagnostic_probes.input_provenance`, `IN_FRAME_POOLS`, `--in-frame-pools`;
  `test_the_report_names_the_material_it_was_computed_over`. _Fato citado:_ o datasheet exige
  declarar de qual versão/instantâneo a porção usada veio, registrada por quem a coletou — aqui
  transposto de "o dataset declara sua procedência" para "o RELATÓRIO declara a procedência do
  material que produziu cada taxa".
- **McCarthy & Jarvis, 2010 — MTLD, vocd-D, and HD-D: A validation study of sophisticated
  approaches to lexical diversity assessment** (Behavior Research Methods 42(2):381–392).
  [link](https://doi.org/10.3758/BRM.42.2.381)
  _Âncora:_ publicar TTR **e** MTLD, e não só TTR: a TTR é dependente do comprimento, e comprimento
  é justamente o que a sonda 2 diz que pode diferir entre as classes. _Onde no projeto:_
  `diagnostic_probes.mtld` (limiar 0,72, contagem de fatores bidirecional), `MTLD_THRESHOLD`;
  `test_mtld_survives_a_length_difference_that_ttr_does_not`. _Fato citado:_ MTLD como número médio
  de palavras até a TFF cair a 0,72, calculado nos dois sentidos, com validação de invariância a
  comprimento contra TTR, vocd-D e HD-D.
- **Flesch, 1948 — A new readability yardstick** (Journal of Applied Psychology 32(3):221–233).
  [link](https://doi.org/10.1037/h0057532)
  _Âncora:_ a forma do índice de legibilidade que a sonda 4 usa — constante menos um termo por
  palavras/frase menos um termo por sílabas/palavra. _Onde no projeto:_
  `diagnostic_probes.flesch_pt`. _Fato citado:_ define o Reading Ease como
  `206.835 − 1.015·(palavras/frases) − 84.6·(sílabas/palavras)`, com os coeficientes do inglês.
- **Martins, Ghiraldelo, Nunes & Oliveira Jr., 1996 — Readability formulas applied to textbooks in
  Brazilian Portuguese** (Notas do ICMSC-USP, N.º 28, São Carlos).
  _Âncora:_ os coeficientes **pt-BR** do índice — a constante 248,835 em lugar de 206,835 —, e a
  razão de não usar os do inglês: a palavra portuguesa carrega mais sílabas que a inglesa, então a
  constante inglesa lê todo texto em português como mais difícil do que é. _Onde no projeto:_
  `diagnostic_probes.flesch_pt` (docstring e literais). _Fato citado:_ adaptação do Flesch Reading
  Ease ao português do Brasil, com a constante recalibrada para 248,835.
  _Ressalva de verificação:_ nota técnica sem DOI e **sem link estável conferido nesta sessão**; a
  fórmula do inglês está ancorada em Flesch (1948), acima, e o que esta entrada sustenta é
  exclusivamente a troca de constante.
- **Mosteller & Wallace, 1963 — Inference in an Authorship Problem** (Journal of the American
  Statistical Association 58(302):275–309).
  [link](https://doi.org/10.1080/01621459.1963.10500849)
  _Âncora:_ palavra funcional como marcador de estilo — por que `FUNCTION_WORDS` é uma lista
  **gramatical fechada** e não um corte de frequência, e por que a estilometria não precisa do
  vocabulário de conteúdo (que é tópico, não autoria). _Onde no projeto:_
  `diagnostic_probes.FUNCTION_WORDS`, `function_word_rate`. _Fato citado:_ atribuição de autoria
  dos Federalist Papers a partir das taxas de palavras funcionais, escolhidas exatamente por serem
  independentes do assunto.
- **Stamatatos, 2009 — A survey of modern authorship attribution methods** (JASIST
  60(3):538–556). [link](https://doi.org/10.1002/asi.21001)
  _Âncora:_ o inventário de features baratas e robustas que a sonda 4 implementa (comprimento de
  frase e de palavra, diversidade lexical, pontuação, palavras funcionais, legibilidade) e a
  fronteira que ela **não** cruza na v1: nada de POS tagging, que exigiria tagger e download que um
  diagnóstico não paga. _Onde no projeto:_ `diagnostic_probes.STYLOMETRIC_FEATURES` (19 features).
  _Fato citado:_ taxonomia de features de atribuição de autoria — lexicais, de caractere,
  sintáticas, semânticas e específicas de aplicação — com o custo de extração de cada nível.
- **Stamatatos, 2013 — On the Robustness of Authorship Attribution Based on Character N-gram
  Features** (Journal of Law and Policy 21(2):421–439).
  [link](https://brooklynworks.brooklaw.edu/jlp/vol21/iss2/8/)
  _Âncora:_ a melhoria de D19 — acrescentar n-grama de **caractere** (3-6) ao baseline como
  vetorização paralela. A razão não é desempenho: n-grama de caractere captura idiossincrasia
  ortográfica e tipográfica, que é exactamente o que a W2 mediu nas lanes e o que n-grama de palavra
  atravessa sem ver. _Onde no projeto:_ `benchmark/lab/baseline_tfidf.py` (`char_pipeline`,
  `CHAR_NGRAMS`, `analyzer="char"`); `test_diagnostic_probes.py::CharacterNgramBaselineTests`.
  _Fato citado:_ n-gramas de caractere capturam informação lexical, sintática e **ortográfica** ao
  mesmo tempo, e são a representação mais robusta a ruído e a texto curto em atribuição de autoria.
- **Sapkota, Bethard, Montes-y-Gómez & Solorio, 2015 — Not All Character N-grams Are Created
  Equal: A Study in Authorship Attribution** (NAACL-HLT 2015).
  [link](https://aclanthology.org/N15-1010/)
  _Âncora:_ `analyzer="char"` e **não** `char_wb`. O `char_wb` do sklearn confina os n-gramas ao
  interior das palavras, e as marcas que a W2 mediu — `** ` entre palavras, espaço antes de quebra,
  ` | ` de tabela — vivem **atravessando** a fronteira. _Onde no projeto:_ `baseline_tfidf`
  (docstring e `char_pipeline`); `test_the_character_analyzer_crosses_word_boundaries`. _Fato
  citado:_ decompõe n-gramas de caractere em categorias (prefixo, sufixo, palavra inteira,
  multi-palavra, pontuação, ...) e mede que as de **pontuação e fronteira** carregam parte
  substancial do sinal de autoria.
- **Rudin, 2019 — Stop explaining black box machine learning models for high stakes decisions and
  use interpretable models instead** (Nature Machine Intelligence 1:206–215).
  [link](https://doi.org/10.1038/s42256-019-0048-x)
  _Âncora:_ por que a sonda 4 é **regressão logística com coeficientes publicados** e não floresta
  nem boosting com importância. A pergunta é "em que sinal o modelo se apoia, e em que direção", e
  um ranking de importância não diz direção. _Onde no projeto:_
  `diagnostic_probes.fit_on_feature_matrix` (docstring), `probe_stylometry` (`coefficients`
  ordenados por módulo). _Fato citado:_ para decisões de alto risco, um modelo interpretável por
  construção é preferível a explicação post-hoc de caixa-preta, que pode discordar do modelo que
  explica.
- **Fisher, Rudin & Dominici, 2019 — All Models are Wrong, but Many are Useful: Learning a
  Variable's Importance by Studying an Entire Class of Prediction Models** (JMLR 20(177):1–81).
  [link](https://www.jmlr.org/papers/v20/18-760.html)
  _Âncora:_ importância por permutação **ao lado** dos coeficientes, como leitura de robustez —
  necessária aqui porque as features estão correlacionadas (taxa de hapax e TTR medem o mesmo eixo)
  e a colinearidade divide um coeficiente entre dois sinais opostos. _Onde no projeto:_
  `probe_stylometry(permutation_repeats=...)`, campo `permutationImportance`. _Fato citado:_
  formaliza a dependência de modelo por permutação como perda esperada sob quebra da associação
  entre a variável e o alvo.
- **Baayen, 2001 — Word Frequency Distributions** (Kluwer, Text, Speech and Language Technology
  18). [link](https://doi.org/10.1007/978-94-010-0844-0)
  _Âncora:_ hapax legomena **dentro do documento** como proxy de raridade, no lugar de uma lista de
  frequência de referência — que é um download que este diagnóstico não paga. _Onde no projeto:_
  `diagnostic_probes.hapax_rate` (com `long_word_rate` publicado ao lado, para que os dois
  discordem visivelmente quando um deles estiver sendo dirigido por outra coisa). _Fato citado:_
  trata a contagem de hapax legomena como estatística central da distribuição de frequência de um
  texto e da sua taxa de crescimento de vocabulário.
- **Liang, Yuksekgonul, Mao, Wu & Zou, 2023 — GPT detectors are biased against non-native English
  writers** (Patterns 4(7):100779). [link](https://doi.org/10.1016/j.patter.2023.100779)
  _Âncora:_ a taxa de erro ortográfico é **sonda de viés e nunca feature de modelo**. Erro
  ortográfico correlaciona com escrita não nativa e vocabulário limitado, que são as populações cuja
  taxa de falso positivo este projeto se comprometeu a vigiar: medir para saber protege, alimentar o
  modelo constrói o viés dentro dele, onde nenhuma fatia o encontra depois. _Onde no projeto:_
  `diagnostic_probes.SPELLING_BIAS_MEASURES`, `spelling_error_rate`,
  `assert_no_bias_measure_reaches_the_features` (recusa por nome **e** por callable, chamada dentro
  de `feature_row` e `feature_matrix`);
  `test_diagnostic_probes.py::SpellingBiasIsolationTests`. _Fato citado:_ detectores de GPT
  classificam erroneamente texto de escritores não nativos como gerado, com o viés atribuído a
  marcadores de proficiência e registro — não de autoria.
- **Dugan, Ippolito, Kirubarajan, Shi & Callison-Burch, 2023 — Real or Fake Text?: Investigating
  Human Ability to Detect Boundaries Between Human-Written and Machine-Generated Text** (AAAI
  2023). [link](https://arxiv.org/abs/2212.12672)
  _Âncora:_ a dispersão entre janelas como sinal **natural** de autoria mista, e por isso publicada
  como diagnóstico e não como escore: um documento escrito metade por pessoa carrega janelas dos
  dois lados do corte. _Onde no projeto:_ `diagnostic_probes.window_dispersion`,
  `probe_window_dispersion`; o papel `diagnostic-curve-only` da linha mista abaixo de 50 %
  (`mixedBelowHalfAiRole` na pré-inscrição). _Fato citado:_ formula a detecção de FRONTEIRA em texto
  parcialmente gerado como tarefa própria, com material humano-máquina concatenado por prefixo.
- **Wang, Li, Ren, Jiang, Zhang & Qiu, 2023 — SeqXGPT: Sentence-Level AI-Generated Text
  Detection** (EMNLP 2023). [link](https://aclanthology.org/2023.emnlp-main.73/)
  _Âncora:_ escore por trecho agregado em documento é a arquitetura da área, e a **variação** entre
  os trechos é a quantidade que a agregação joga fora. O módulo espelha a regra de janelamento
  selada (`contentTokens`/`overlapTokens`/`maxWindows` LIDOS de
  `models/cleanfeed-ptbr-v1/cleanfeed-model.json`) para que a dispersão seja de janelas reais.
  _Onde no projeto:_ `diagnostic_probes.content_windows` e `distributed_indices` (espelhos de
  `src/inference/chunker.ts`), `sealed_window_plan`;
  `test_diagnostic_probes.py::WindowDispersionTests`. _Fato citado:_ detecção em nível de sentença
  com escores por sentença dentro de um documento, mostrando que documentos mistos exibem escores
  heterogêneos entre sentenças.

**Sem precedente encontrado (2026-08-05)**, três vezes, e as três são de governança e não de método:

1. **usar o C2ST como gate de MONTAGEM de corpus, com recusa nomeando partição e métrica.** A
   literatura usa o classificador de domínio para diagnosticar deslocamento e para reponderar
   (Ben-David, Rabanser); nenhuma das fontes o coloca como condição de aceitação de um corpus antes
   do treino, com um piso de efeito **e** um nível de significância congelados em código;
2. **manter uma medida de viés em registro separado que o caminho de escore RECUSA a ler.** Liang et
   al. mostram o viés; a prática da área é documentá-lo. Não se encontrou precedente para a
   construção — dois registros, uma guarda que compara nome e callable, e a chamada dessa guarda
   dentro da função que constrói a matriz de features, para que ligar a feature reprove antes de
   qualquer ajuste;
3. **declarar que uma sonda diagnóstica não pode ter veredito, e impor isso pela FORMA do
   relatório.** O relatório das sondas 2, 3 e 4 não tem campo de veredito, então nenhum chamador
   pode lê-lo como recusa; é a mesma disciplina que `artifact_gate` aplica ao omitir o
   identificador da linha, aplicada à camada `diagnostic` de `benchmark/gates.ts`.

## Metodologia importada — sem precedente na detecção de MGT, com ancestral em outra área

Cada item abaixo é uma prática que a auditoria de 2026-07-31 **não encontrou** na literatura de
detecção de texto gerado por máquina, e para a qual existe ancestral fora dela. Todos são do
nível (i) da hierarquia de alegação: metodologia importada com fonte revisada. Nenhum é do nível
(iii). O que é novo, quando é novo, é a **combinação** e a engenharia — nunca a teoria.

- **R1 — congelamento criptográfico do avaliador antes do desmascaramento.** Digest sobre a lista
  exportada por `digests.ts`; editar qualquer arquivo dela depois do `fit` reprova
  `integrity.evaluator-digest` e queima a concessão do holdout.
  _Onde no projeto:_ plano v3 § "§0" R1; `benchmark/digests.ts` (`EVALUATOR_FILES`,
  `computeEvaluatorDigest`).
  _Campo de origem:_ ensaios clínicos (análise pré-especificada) e transparência de certificados.
  _Ancestrais:_ [ICH E9, 1998](https://database.ich.org/sites/default/files/E9_Guideline.pdf);
  [RFC 6962, Certificate Transparency](https://www.rfc-editor.org/rfc/rfc6962);
  [Cruz & Aji, 2026 — LLM Olympiad](https://arxiv.org/html/2603.23292);
  [Keita & Homan, 2026](https://arxiv.org/abs/2605.08586).

- **R2 — bloco de teste cego de uso único, com cegueira informacional.** Uma tupla nova de digests
  **não** restaura cegueira; o cluster exposto perde elegibilidade a `test`, e o registro-linha de
  teste consumido sai das cinco partições.
  _Onde no projeto:_ plano v3 § "§0" R2 (tabela objeto/custo); `benchmark/holdout-ledger.ts`;
  `benchmark/cluster-exposure-ledger.ts`.
  _Campo de origem:_ análise adaptativa de dados e teoria de leaderboards.
  _Ancestrais:_ [Dwork et al., 2015 — The reusable
  holdout](https://doi.org/10.1126/science.aaa9375); [Blum & Hardt, 2015 — The
  Ladder](https://arxiv.org/abs/1502.04585); [Kaggle — public/private
  leaderboard](https://www.kaggle.com/docs/competitions-setup); [Chollet et al., 2025 —
  ARC-AGI-2](https://arxiv.org/abs/2505.11831).
  _Transferência:_ ambos os ancestrais respondem ao mesmo problema com reuso **controlado**; o uso
  único é a escolha mais conservadora, e o custo dela (inventário para duas tentativas completas)
  é declarado, não escondido.

- **R3 — nenhum gate é afrouxado para passar; gates congelados com `m` pré-registrado.** Mudar um
  limite exige evidência medida, justificativa escrita no plano e registro no relatório.
  _Onde no projeto:_ plano v3 § "§0" R3; § E3 (o que **não** entra em `m`);
  `benchmark/gates.ts:186-192`.
  _Campo de origem:_ ensaios clínicos confirmatórios e metaciência de pré-registro.
  _Ancestrais:_ [ICH E9, 1998](https://database.ich.org/sites/default/files/E9_Guideline.pdf);
  [Nosek et al., 2018 — The preregistration
  revolution](https://doi.org/10.1073/pnas.1708274114); [Gencoglu et al., 2019 — HARK
  side](https://arxiv.org/abs/1904.07633).

- **R4 — governança nunca é simulada.** `automated/unreviewed` é estado **nomeado**, não campo
  ausente; recibo fabricado é falsificação de proveniência.
  _Onde no projeto:_ plano v3 § "§0" R4 e § C5; `benchmark/schema.ts` (união `review` v3).
  _Campo de origem:_ proveniência de dados (W3C) e documentação de dataset.
  _Ancestrais:_ [PROV-DM, W3C, 2013](https://www.w3.org/TR/prov-dm/); [Gebru et al., 2021 —
  Datasheets for Datasets](https://dl.acm.org/doi/10.1145/3458723); [Besiroglu & Sevilla, 2025 —
  FrontierMath](https://epoch.ai/latest/openai-and-frontiermath) (exemplo negativo).
  _Transferência:_ a ancoragem em PROV-DM é **por analogia de modelo de dados**, não confirmação
  de que o repositório invoque o vocabulário W3C.

- **R5 — erro de inferência nunca vira escore.** `status = "error"` é ramo explícito; proibido `??
  0` ou `?? 0.5`; métricas saem em par fim-a-fim × condicional a `status = "scored"`, com célula
  própria `undecidedPositives`/`undecidedNegatives`.
  _Onde no projeto:_ plano v3 § "§0" R5 e § A3; `benchmark/metrics.ts` (DecisionFamilies).
  _Campo de origem:_ estatística de ensaios clínicos — framework de estimands e eventos
  intercorrentes.
  _Ancestral, entrada completa:_
  - **ICH Expert Working Group, 2019 — ICH E9(R1): Addendum on Estimands and Sensitivity Analysis
    in Clinical Trials** (ICH official guideline, Step 4 adotado em 20/11/2019).
    [link](https://database.ich.org/sites/default/files/E9-R1_Step4_Guideline_2019_1203.pdf)
    _Âncora:_ R5 — é o framework formal de eventos intercorrentes que justifica uma célula própria
    para o indeciso em vez de imputar erro como escore. _Onde no projeto:_ plano v3 § "§0" R5 e
    § A3; `benchmark/metrics.ts` (DecisionFamilies). _Fato citado:_ framework de estimands, com 5
    atributos incluindo estratégias para eventos intercorrentes.

- **R6 — três estados epistêmicos por eixo de agrupamento (`known` | `notApplicable` |
  `unknown`), identificador sintético proibido.**
  _Onde no projeto:_ plano v3 § "§0" R6; `benchmark/schema.ts` (`groupAxisIdentity`,
  `groupAxisDeclaredState`).
  _Campo de origem:_ estatística de dados faltantes, e auditoria de fairness.
  _Ancestrais:_ [Rubin, 1976 — Inference and missing
  data](https://doi.org/10.1093/biomet/63.3.581); [Xin, Hooker & Huang, 2026 — How Proxy Race
  Distorts Regression-Based Fairness Audits](https://arxiv.org/abs/2603.17106); [Basu et al., 2025
  — BAID](https://arxiv.org/html/2512.11505v1).

- **Manchete no PIOR estrato calibrado (máximo dos quantis por estrato), nunca a média.**
  _Onde no projeto:_ plano v3 § G2 item 5, § L1 resposta 1, § B3 "Consequência de engenharia";
  `benchmark/slices.ts:106-107`.
  _Campo de origem:_ robustez distribucional em ML, e análise de subgrupos em ensaios clínicos.
  _Ancestrais:_ [Sagawa et al., 2020 — group DRO](https://arxiv.org/abs/1911.08731); [Koh et al.,
  2021 — WILDS](https://proceedings.mlr.press/v139/koh21a.html); [Rothwell, 2005 — Subgroup
  analysis in RCTs](https://doi.org/10.1016/S0140-6736(05)17709-5).
  _Transferência:_ o lado clínico traz o alerta que o lado ML não traz — reportar o pior subgrupo
  exige poder adequado por subgrupo, que é a razão de existirem pisos de poder por fatia
  (`powerFloors`) em vez de apenas o máximo dos quantis.

- **Publicação obrigatória de TODA execução certificadora (Regime 2), com abandono explícito da
  alegação de FWER ao longo da história do produto.**
  _Onde no projeto:_ estado § "Decisão 1 — Regime 2"; auditorias.
  _Campo de origem:_ regulação de ensaios clínicos e metaciência do viés de publicação.
  _Ancestrais:_ [FDAAA 801 (Public Law
  110-85)](https://www.govinfo.gov/content/pkg/PLAW-110publ85/pdf/PLAW-110publ85.pdf);
  [Rosenthal, 1979 — The file drawer problem](https://doi.org/10.1037/0033-2909.86.3.638);
  [NeurIPS 2026 — Evaluations & Datasets
  Track](https://neurips.cc/Conferences/2026/CallForEvaluationsDatasets).
  _Transferência:_ no ensaio clínico a publicação é **obrigação legal**; aqui é obrigação
  autoimposta, e a diferença tem de ser dita — nada externo a força.

- **Ledger append-only de exposição com cadeia de digests e testemunha de altura.**
  _Onde no projeto:_ `benchmark/cluster-exposure-ledger.ts`; plano v3 § C3.
  _Campo de origem:_ criptografia aplicada e forense de logs.
  _Ancestrais:_ [RFC 6962 — Certificate Transparency](https://www.rfc-editor.org/rfc/rfc6962);
  [Schneier & Kelsey, 1999 — Secure Audit Logs](https://dl.acm.org/doi/10.1145/317087.317089);
  [Haber & Stornetta, 1991](https://doi.org/10.1007/BF00196791); [ISO/IEC
  27037:2012](https://www.iso.org/standard/44381.html).

- **Cota distribution-free por estrato como contrato do produto, com exchangeability declarada
  como condição e limites explícitos da garantia.**
  _Onde no projeto:_ plano v3 § G2 item 3 e § G3 (limites (a)/(b)/(c)).
  _Campo de origem:_ predição conformal.
  _Ancestrais:_ [Vovk, Gammerman & Shafer, 2005](https://doi.org/10.1007/b106715);
  [Papadopoulos et al., 2002](https://doi.org/10.1007/3-540-36755-1_29); [Lei et al.,
  2018](https://doi.org/10.1080/01621459.2017.1307116); [Barber et al.,
  2021](https://doi.org/10.1093/imaiai/iaaa017).
  _Ressalva obrigatória:_ **este item não é sem precedente na própria área.** [Zhu et al., 2025 —
  MCP (ACL 2025)](https://aclanthology.org/2025.acl-long.601/) já faz cota conformal de FPR com
  binning por comprimento e calibração só-humana. O que resta como diferencial é a garantia pelo
  **pior estrato**, não a cota conformal em si.

- **Multiplicidade declarada com `m` pré-registrado e congelado, célula sem poder permanecendo em
  `m`.**
  _Onde no projeto:_ plano v3 § A6 e § H2; `benchmark/gates.ts:186-192`.
  _Campo de origem:_ estatística de comparações múltiplas e epidemiologia clínica.
  _Ancestrais:_ [Dunn, 1961](https://doi.org/10.1080/01621459.1961.10482090); [Holm,
  1979](http://www.jstor.org/stable/4615733); [Bender & Lange,
  2001](https://doi.org/10.1016/S0895-4356(00)00314-0); [ICH E9,
  1998](https://database.ich.org/sites/default/files/E9_Guideline.pdf).

- **Inferência pós-seleção reconhecida em vez de escondida: `selectionFprUpper95Nominal` com
  `certifiedFprUpper: null`.**
  _Onde no projeto:_ plano v3 § A7; `benchmark/calibration-pipeline.ts`.
  _Campo de origem:_ inferência seletiva.
  _Ancestrais:_ [Berk et al., 2013](https://doi.org/10.1214/12-AOS1077); [Taylor & Tibshirani,
  2015](https://doi.org/10.1073/pnas.1507583112); [Cawley & Talbot,
  2010](https://www.jmlr.org/papers/v11/cawley10a.html); [Benjamini & Yekutieli,
  2005](https://doi.org/10.1198/016214504000001907).

- **Unidade de reamostragem escolhida POR ESTIMANDO, com bootstrap hierárquico e multiway.**
  _Onde no projeto:_ `benchmark/bootstrap.ts`; plano v3 § C4;
  `benchmark/rebuild-v3-policy.json` (`resampling.estimands`).
  _Campo de origem:_ econometria (inferência cluster-robusta) e estatística de reamostragem.
  _Ancestrais:_ [Cameron & Miller, 2015](https://doi.org/10.3368/jhr.50.2.317); [Owen,
  2007](https://doi.org/10.1214/07-AOAS122); [Owen & Eckles,
  2012](https://doi.org/10.1214/12-AOAS547); [Field & Welsh,
  2007](https://doi.org/10.1111/j.1467-9868.2007.00593.x).

- **Dimensionamento por ICC e efeito de desenho, em unidades de cluster.**
  _Onde no projeto:_ plano v3 § D0 e § D0b; `benchmark/rebuild-v3-policy.json` (`powerFloors`).
  _Campo de origem:_ psicometria, ensaios randomizados por cluster e teoria de amostragem.
  _Ancestrais:_ [Shrout & Fleiss, 1979](https://doi.org/10.1037/0033-2909.86.2.420); [Donner &
  Klar,
  2000](https://www.wiley.com/en-us/Design+and+Analysis+of+Cluster+Randomization+Trials+in+Health+Research-p-9780470711002);
  [Kish, 1965](https://www.wiley.com/en-us/Survey+Sampling-p-9780471109495); [Miller, 2024 —
  Adding Error Bars to Evals](https://arxiv.org/abs/2411.00640).

- **Auditoria de PII em duas fases, com desenho congelado antes de olhar texto e regra de parada
  que anula a cota sob qualquer achado.**
  _Onde no projeto:_ plano v3 § D1 (passos 1–6) e § "Piloto de triagem por NER (2026-07-29)".
  _Campo de origem:_ teoria de amostragem (double sampling e amostragem estratificada).
  _Ancestrais:_ [Neyman, 1938](https://doi.org/10.1080/01621459.1938.10503378); [Cochran,
  1977](https://www.wiley.com/en-us/Sampling+Techniques,+3rd+Edition-p-9780471162407);
  [Clopper & Pearson, 1934](https://doi.org/10.1093/biomet/26.4.404); [Hanley & Lippman-Hand,
  1983](https://doi.org/10.1001/jama.1983.03330370053031).

- **Falha fechada como padrão de projeto: sem evidência de reamostragem o gate reprova, e nenhum
  fold degenerado é pulado.**
  _Onde no projeto:_ plano v3 § A6, § C4 e § C6 item 5; `benchmark/rebuild-v3-policy.json`
  (`resampling.fallbackToIndependentRows: false`).
  _Campo de origem:_ engenharia de sistemas seguros.
  _Ancestrais:_ [Saltzer & Schroeder, 1975](https://doi.org/10.1109/PROC.1975.9939); [POSIX
  rename()](https://pubs.opengroup.org/onlinepubs/9699919799/functions/rename.html).

- **Inferência anytime-valid declarada FORA DE ESCOPO, em vez de assumida.**
  _Onde no projeto:_ plano v3 § H3b ("QUESTÃO ABERTA").
  _Campo de origem:_ estatística sequencial.
  _Ancestrais:_ [Howard et al., 2021](https://doi.org/10.1214/20-AOS1991); [Pocock,
  1977](https://doi.org/10.1093/biomet/64.2.191); [O'Brien & Fleming,
  1979](https://doi.org/10.2307/2530245); [Lan & DeMets,
  1983](https://doi.org/10.1093/biomet/70.3.659); [Tian & Ramdas,
  2021](https://doi.org/10.1177/0962280220983381).

- **Rótulo de documento conhecido com atribuição por trecho declarada latente e não produzida.**
  _Onde no projeto:_ `benchmark/metrics.ts` (`LocalizationCohort`, `SpanProducerState`,
  `localization.role: "diagnostic"`); plano v3 (`materialAssistance.generationModes`).
  _Campo de origem:_ aprendizado com supervisão fraca (multiple-instance learning).
  _Ancestral:_ [Dietterich, Lathrop & Lozano-Pérez,
  1997](https://doi.org/10.1016/S0004-3702(96)00034-3).

### Nota honesta sobre "sem precedente"

"Sem precedente na área" **não é uma propriedade do mundo**: é um achado da auditoria de
2026-07-31, com escopo declarado (10 benchmarks, 7 shared tasks, 12 repositórios, 6 revisões
adversariais) e, portanto, datado e corrigível. Uma busca é sempre incompleta, e o custo de
errar aqui é assimétrico: alegar ineditismo onde havia precedente é exatamente o tipo de
alegação não medida que R7 proíbe. Já aconteceu uma vez neste arquivo — a cota conformal por
faixa de comprimento foi reclassificada de "sem paralelo" para "padrão emergente com extensão"
depois que o MCP (ACL 2025) apareceu.

**Quem conhecer precedente na própria área de detecção de MGT para qualquer item desta seção,
abra issue.** A correção é bem-vinda e o item será rebaixado sem defesa.

### Links não resolvidos na verificação de 2026-07-31

Nenhum. Na verificação de 2026-07-31, **0 das 217 URLs** deste arquivo voltou morta
(HTTP 404/410, domínio extinto ou conteúdo removido).

Isso **não** significa que as 217 estejam todas confirmadas no mesmo grau, e a distinção importa
por R7. Três estados aparecem no arquivo, sempre na própria entrada:

- **Verificado** — conteúdo lido e correspondente ao que a entrada afirma.
- **Verificado com ressalva de divergência** — a URL resolve, mas o conteúdo divergiu do que a
  entrada supunha; título, autoria ou afirmação foram corrigidos na entrada, e a parte não
  confirmada é marcada como não verificada. São 8 entradas: PAN Voight-Kampff/TIRA (clef25),
  Inside Higher Ed "Professors Cautious", TechCrunch "OpenAI scuttles", Müller & Schäfer 2004,
  Ding et al. 2023 (arXiv 2306.09335), Pu et al. 2026 (ACL Anthology 2026.acl-long.120),
  Quinn Emanuel "Defamation in the AI Era" e PT-Detect (ENIAC 2025).
- **Não verificado em texto integral** — acesso bloqueado por paywall, proteção anti-bot, TLS
  legado ou norma paga; o que foi possível confirmar está dito, e o resto está marcado. Casos:
  ISO/IEC 27037:2012, Kish 1965, Davison & Hinkley 1997, Copyleaks (extensão), Bloomberg
  Businessweek e The 74 (bylines não recuperáveis).

Link não verificado nunca é apresentado como verificado, e afirmação sem fonte é descartada em
vez de suavizada.

## Práticas ainda sem referência neste arquivo — trabalho aberto

O levantamento retroativo de 2026-07-31 encontrou práticas em uso no projeto que **nenhuma entrada
verificada acima cobre**. Registrá-las é obrigação de R7: a alternativa seria o silêncio, que se lê
como cobertura completa. Elas são de duas naturezas, e só a primeira é trabalho de busca.

### (a) Técnica com literatura conhecida — a referência falta e deve ser buscada

Para cada uma, a obra canônica foi identificada mas **não** foi verificada nem incluída acima. São as
buscas mais imediatas.

- **Platt scaling** — `benchmark/calibrators.ts:48,:122`. Buscar Platt, 1999.
- **Beta calibration** — `calibrators.ts:128-152`. Buscar Kull, Silva Filho & Flach, 2017.
- **Regressão isotônica** — `fitIsotonic`. Buscar Zadrozny & Elkan, 2002.
- **ECE com bins de massa igual (15 bins) e diagrama de confiabilidade.** Buscar Naeini et al., 2015;
  DeGroot & Fienberg, 1983; Nixon et al., 2019.
- **Brier score como critério de seleção de calibrador.** Buscar Brier, 1950.
- **PPV/NPV em prevalências plausíveis** — a leitura bayesiana do valor preditivo.
- **Coorte temporal por quartis de `createdAt` real.** Buscar TRIPOD; Riley et al.
- **Dois revisores distintos com adjudicação por terceiro** — desenho original de C5, hoje substituído
  por um revisor com amostragem. Buscar Cochrane Handbook.
- **Escrita transacional pelo lado de write-ahead logging.** Buscar Mohan et al., ARIES, 1992.
  Parcialmente coberta acima por POSIX `rename()` e Saltzer & Schroeder.

### (b) Escolha de parâmetro ou composição própria — não há o que citar além do método

Aqui o **método** já está referenciado acima (Bonferroni, conformal, bootstrap por cluster, taxonomia
de dados faltantes); o que não tem citação é o **valor** ou a **combinação**, que são decisão do
projeto. A justificativa vive no registro de decisões, não na literatura — e é exatamente o nível (ii)
da hierarquia de alegação: a novidade é de engenharia, não de teoria. Não gaste tempo procurando
citação para estas.

- Separação entre `epsilon` (risco preditivo) e `alpha_familia` (confiança de certificação) — § H3b.
- Célula sem poder permanece em `m` e reprova; `m` declarado menor que os gates observados reprova
  tudo — § A6/§ H2.
- Família primária nomeada `m = 4`, e o piso `n ≥ 250` clusters por célula — registro § B3.
- Papéis nomeados no relatório: intervalo individual **descritivo** contra simultâneo como o único que
  gateia (`missing-simultaneous-interval`) — § A6/§ A7.
- Bootstrap sobre estatísticas suficientes por cluster — § C4.
- Pesos iguais por cluster na agregação out-of-fold (Brier e ECE) — § C6.
- Desbalanceamento de fold publicado como **medida** contra piso de empacotamento — § C6.
- Pisos de poder pré-registrados por fatia (300 negativos / 200 positivos) e reserva de inventário
  para duas tentativas completas — § D0b.
- Cinco partições com dupla calibração (45/5/10/20/20) — § E2. Cawley & Talbot, citado acima, cobre
  apenas a separação `cal-A` × `cal-B`.
- Sorteio determinístico pré-registrado com seed declarada — § D1.
- Regra de parada em que **qualquer** achado anula a cota de zero achados — § D1.
- Redação obrigatória da cota de PII ("no quadro amostral") — § D1.
- Acoplamento declarado entre `redistribution: "not-published"` e auditoria por amostragem — § B1.
- Duas bases de evidência de rótulo (`labelBasis` + `labelEvidenceRef`, com contagens separadas) —
  § C1/§ A6; e divergência `labelDispute` registrada e nunca apagada — § C5.
- Log-loss publicado; gate de calibração sobre o limite superior de bootstrap simultâneo; regra de
  seleção de calibrador pré-registrada (tolerância `1e-4`, ordem Platt → beta → isotônico);
  `calibrationScope: "global"` por caminho — § A6/§ G1/§ G4.

---

## § K — a pré-inscrição v4: escopo por célula, limiar por quantil e teto de export (Commit C, 2026-08-04)

Nível 1 e 2 da hierarquia. O que segue cobre as decisões metodológicas que a troca atômica da
pré-inscrição introduziu; as decisões de **valor** entram na lista (b) do § J, não aqui.

### K1 — moldura amostral declarada em vez de "domínio geral"

O `intendedDomain` sai de `generic` para `scoped-cells` e a alegação é publicada como tabela por célula.
A prática de declarar a **população-alvo** e recusar extrapolação para fora dela é o núcleo das fichas
de documentação de dataset e modelo:

- Gebru et al., *Datasheets for Datasets*, CACM 64(12), 2021 — "Intended Uses" e "Composition" existem
  para impedir exatamente a leitura genérica. [link](https://doi.org/10.1145/3458723)
- Mitchell et al., *Model Cards for Model Reporting*, FAT* 2019 — desempenho **desagregado** por grupo
  declarado, e não um número único. [link](https://doi.org/10.1145/3287560.3287596)
- Bender & Friedman, *Data Statements for NLP*, TACL 6, 2018 — a "curation rationale" e a variedade
  linguística como parte da alegação. [link](https://doi.org/10.1162/tacl_a_00041)

**A transferência:** as três fontes tratam de *documentar* a população; aqui a moldura também **gateia**
— o parser recusa a política que nomeia um estrato sem fonte, e o selo recusa o corpus que não cobre a
célula declarada. Documentação que não reprova nada é o modo de falha que essas fichas descrevem. Quantas
células a moldura declara é decisão de escopo e não de método: hoje é **uma** (§ N1).

### K2 — família de hipóteses por célula, em vez de manchete do pior estrato

Bonferroni já está referenciado no § H; o que é novo é **escolher a família por célula** em vez de por
pior estrato. A razão é a que a literatura de subgrupos descreve: um máximo sobre estratos é uma
estatística cuja distribuição depende do número de estratos, então acrescentar cobertura **piora** a
manchete sem que nada tenha piorado.

- Barnett, van der Pols & Dobson, *Regression to the mean: what it is and how to deal with it*,
  IJE 34(1), 2005 — o extremo de um conjunto de estimativas é enviesado por seleção.
  [link](https://doi.org/10.1093/ije/dyh299)
- Efron, *Large-Scale Inference*, CUP, 2010, cap. 1–2 — por que o máximo sobre m estimativas não é uma
  estimativa do máximo. [link](https://doi.org/10.1017/CBO9780511761362)

**A transferência:** as fontes tratam de seleção pós-hoc do extremo; aqui a família é **nomeada antes**
(`multiplicity.primaryFamily`, conteúdo e ordem congelados), e o parser recomputa `alpha/m` em vez de
confiar no valor escrito. O que a citação sustenta é a **direção** da escolha, não o valor de `m` — que é
**4** desde a emenda da moldura (§ N2), e cujo preço medido está lá.

### K3 — limiar como ordem-estatística de um quantil unilateral, sem calibrador

A v1 não ajusta calibrador probabilístico: o corte é a ordem-estatística do quantil `1 − orçamento` sobre
os negativos humanos de `dev + cal-A`, aplicada ao escore cru de documento.

- Hyndman & Fan, *Sample Quantiles in Statistical Packages*, The American Statistician 50(4), 1996 — as
  nove definições de quantil empírico e por que a escolha tem de ser declarada.
  [link](https://doi.org/10.1080/00031305.1996.10473566)
- Scheffé & Tukey, *A formula for sample sizes for population tolerance limits*, Annals of Mathematical
  Statistics 15, 1944 — limites de tolerância não paramétricos por ordem-estatística, que é a família à
  qual este corte pertence. [link](https://doi.org/10.1214/aoms/1177731267)
- Guo, Pleiss, Sun & Weinberger, *On Calibration of Modern Neural Networks*, ICML 2017 — o softmax cru
  de uma rede moderna é **mal calibrado**, o que é precisamente por que este projeto mede ECE sobre ele e
  ainda assim não o chama de probabilidade. [link](https://proceedings.mlr.press/v70/guo17a.html)

**A transferência:** Hyndman & Fan catalogam definições para estimar um quantil da população; aqui a
escolha é a **conservadora sob o comparador do runtime** (`score >= threshold`), que desloca a posição em
um passo — o índice é `ceil(q·n)` e não `ceil(q·n) − 1`, porque o sorteio *no* corte é uma acusação.
Scheffé & Tukey dão o piso amostral: sem `n ≥ 1/(1 − q)` não existe cauda para o limite descrever, e é
esse o piso que o freeze exige. Guo et al. justificam a **recusa de linguagem de probabilidade**: um ECE
limitado sobre escore cru limita descalibração, não converte o escore em probabilidade.

**Sem precedente encontrado (2026-08-04)** para a regra de conferir o quantil da política contra
`1 − fprBudgets.warning` no *parser*, e para publicar `atOrAboveThreshold` no artefato em vez de reprovar
o freeze. As duas são engenharia de coerência interna: a primeira impede uma política que aponta o limiar
para uma taxa que ela não publica, a segunda separa "congelar o quantil" de "decidir o orçamento", que é
decisão de gate sobre `test`.

### K4 — teto de bytes do export ancorado em export medido, com a folga declarada

`onnxMaximumInt8Bytes` = **130 000 000**, ancorado num export int8 real desta arquitetura que mede
**109 681 931 bytes** (`snapshots/cleanfeed-ptbr-v1/onnx/model_int8.onnx`, fora do repositório, com
`parity_report.json` ao lado: 120 amostras, `meanAbsDelta` 0,000595, `verdictFlips` 0). O mesmo número está
**rastreado na árvore**, com `sha256`, em `models/cleanfeed-ptbr-v1/source-lock.json` e
`models/cleanfeed-ptbr-v1/cleanfeed-model.json` — é contra esses descritores que um teste confere o teto,
porque teto que nada mede não é teto. A folga de 20 318 069 bytes (18,5% do medido) é **declarada**, e o
campo é teto — não alvo. O `opset_import` do próprio artefato ancorante é **18** (ir_version 8, produtor
`onnx.quantize`), enquanto o fallback de `benchmark/lab/export_onnx.py` emite 14: a diferença de opset está
**dentro** da folga, e o campo não afirma nada sobre opset.

- Souza, Nogueira & Lotufo, *BERTimbau*, BRACIS 2020 — as contagens do backbone selado: `base` com 12
  camadas, dimensão 768 e vocabulário WordPiece de 29 794 (`config.json` do checkpoint).
  [link](https://doi.org/10.1007/978-3-030-61377-8_28)
- Conneau et al., *Unsupervised Cross-lingual Representation Learning at Scale* (XLM-R), ACL 2020 — as
  contagens da família recusada: vocabulário de 250k, o que põe o export int8 correspondente em ~2,8 ×
  10⁸ bytes, mais que o dobro deste teto. [link](https://doi.org/10.18653/v1/2020.acl-main.747)
- Jacob et al., *Quantization and Training of Neural Networks for Efficient Integer-Arithmetic-Only
  Inference*, CVPR 2018 — um peso int8 mais escala/zero-point por canal, que é a aritmética de tamanho
  usada aqui. [link](https://doi.org/10.1109/CVPR.2018.00286)

**A transferência:** o medido dá a ordem de grandeza e a paridade de **um** export desta arquitetura; as
fontes dão as contagens que explicam por que 130 MB nomeia **uma** arquitetura e não uma faixa. A folga
existe porque um teto de ajuste exato reprovaria um re-export legítimo que difira por poucos KB (opset,
configuração de quantização, forma da cabeça de classificação), e ela é pequena o suficiente para as duas
recusas que justificam o campo continuarem valendo: matriz de embeddings deixada em fp32 (22 881 792
bytes int8 contra 91 527 168 em fp32 ⇒ ~1,78 × 10⁸) e encoder de família RoBERTa.

**Sem precedente encontrado (2026-08-05)** para ancorar um teto de artefato num export de *fine-tune
anterior* da mesma arquitetura. O que esse artefato sustenta é explicitamente o **tamanho** e a paridade
de um export desta forma, não qualquer alegação sobre a qualidade do candidato da v1.

**Sem precedente encontrado (2026-08-05)**, e são engenharia de coerência interna, para as duas regras que
a revisão da emenda exigiu: identificar o checkpoint pelo **tamanho do vocabulário** (29 794) e não por
`model_type` — que vale `"bert"` para todo BERT, então um fine-tune de `bert-base-cased` (28 996) exporta
limpo, concorda consigo mesmo na paridade e **cabe** no teto —, e **perguntar à sessão ONNX** quais são
suas entradas em vez de presumir a forma do grafo, já que só o fallback do exportador as nomeia.

### K5 — identificador retirado por recusa nomeada, não por deleção

`ptbr-generic-v1` continua nomeado em `dataset.refusedIds` e é recusado com código próprio, do mesmo modo
que `pt-stackoverflow` continua em `blockedSnapshots`. O princípio — remover por *tombstone* explícito em
vez de apagar, para que a reutilização falhe com diagnóstico — é o de esquemas de dados com campos
reservados:

- Google, *Protocol Buffers Language Guide*, seção `reserved` — números e nomes de campo retirados são
  **reservados**, não liberados, porque a reutilização silenciosa corrompe leitores antigos.
  [link](https://protobuf.dev/programming-guides/proto3/#deleting)
- Nygard, *Release It!*, 2ª ed., 2018, cap. sobre versionamento — um identificador reaproveitado é
  indistinguível de um identificador nunca mudado.

**Sem precedente acadêmico encontrado (2026-08-04)** para aplicar a regra a um **identificador de
dataset de pré-inscrição**. A analogia com campos reservados de esquema é de engenharia, e é o que
sustenta a escolha; a alegação fica nesse nível.

### K6 — eixo de dependência declarado sem entrar na união de agrupamento

O bloco `connectivity` declara `sourceMaterialBatch` como unidade de dependência **entre** aquisições e
ao mesmo tempo o mantém fora de `splitUnionAxes`. A distinção entre "há dependência nesse nível" e "este
é o nível pelo qual eu agrupo" é a mesma que a literatura de amostragem por conglomerados faz entre
**unidade de amostragem** e **fonte de correlação**:

- Kish, *Survey Sampling*, Wiley, 1965, cap. 5–6 — conglomerado como unidade de seleção, distinto do
  estrato e do efeito de desenho que a correlação intraclasse produz.
- Cameron & Miller, *A Practitioner's Guide to Cluster-Robust Inference*, Journal of Human Resources
  50(2), 2015 — escolher o nível de agrupamento é um trade-off, e agrupar grosso demais destrói os graus
  de liberdade. [link](https://doi.org/10.3368/jhr.50.2.317)

**A transferência:** Cameron & Miller descrevem o custo em variância; aqui o custo é **viabilidade do
split** — medido, um evento de aquisição por fonte faz cada célula um componente indivisível e o alvo de
5 % de `dev` fica inalcançável por construção. A dependência não é ignorada: ela é publicada como
inventário por partição pela auditoria, com `connectivity.sharedValue: false` dizendo em voz alta que o
splitter não agrupou ali.

### K7 — ler o eixo de uma versão anterior do esquema como o MESMO fato, dentro do bootstrap por conglomerado

A tabela congelada nomeia `groups.generationBatch`, que só o esquema v4 declara, e todo corpus em disco é
v2 ou v3, onde o mesmo fato se escreve `collectionBatch`. `metrics.ts` consulta a grafia antiga quando a
versão do registro não declara a nova, **restrito a linhas não humanas** — numa linha humana aquela chave
guardava a execução de extração, que é outro fato.

O que a decisão é, em vocabulário de dados: **rastreamento de identidade entre versões de esquema**, e o
que ela compra é que a unidade de reamostragem de um intervalo publicado continue sendo o lote de geração
em vez de virar `unknown` por uma renomeação.

- Kimball & Ross, *The Data Warehouse Toolkit*, 3ª ed., 2013, cap. 5 — *durable supersedent key*: a
  identidade de uma entidade sobrevive à mudança de esquema porque é mapeada, não redescoberta. É a forma
  do alias: um mapa explícito com uma entrada, não uma cadeia de fallback.
- Cameron & Miller, *A Practitioner's Guide to Cluster-Robust Inference*, Journal of Human Resources
  50(2), 2015 — o nível de agrupamento decide a largura do intervalo; agrupar por uma variável **errada**
  não é conservador, é aleatório. [link](https://doi.org/10.3368/jhr.50.2.317) É por isso que a restrição
  a linhas não humanas é a fronteira e não um detalhe: ler a corrida de extração como lote fabricaria
  conglomerados a partir de invocações de extrator e **estreitaria** os intervalos.

**Sem precedente encontrado (2026-08-04)** para o caso específico — mapear o nome de um eixo entre versões
de esquema *dentro do desenho de reamostragem de uma pré-inscrição*. O que existe é a prática de
identidade durável em armazém de dados e a teoria de escolha de conglomerado; a junção das duas é decisão
deste projeto e está registrada como tal (registro § C-11).

**O que o alias NÃO compra**, escrito porque a assimetria é o risco: ele não torna um corpus v2/v3
equivalente a um v4. Os outros dois eixos que o v4 acrescentou (`sourceMaterialBatch`, `extractionRun`)
**não** têm alias, e o mapa tem exatamente uma entrada, verificada por teste.

### K8 — fonte fora da moldura recusada com código próprio, distinto de "recusada"

`OUT_OF_FRAME_HUMAN_SOURCES` (`src_b2w`) tem rota e licença admissíveis e **nenhuma célula**; `src_ptso`
está recusada por termo de acesso. As duas bloqueiam o manifesto, com códigos diferentes
(`SOURCE_OUT_OF_DECLARED_FRAME` e `SOURCE_BLOCKED_BY_ACCESS_TERMS`), porque juntá-las apagaria a
diferença entre uma condição jurídica satisfazível e uma decisão de escopo.

- Gebru et al., *Datasheets for Datasets*, CACM 64(12), 2021 — a documentação de um dataset tem de dizer
  o que **não** está nele e por quê; "ausente" e "excluído por razão X" não são a mesma linha.
  [link](https://doi.org/10.1145/3458723)
- Google, *Protocol Buffers Language Guide*, seção `reserved` — o mesmo argumento de K5, aplicado agora à
  fonte e não ao identificador de dataset. [link](https://protobuf.dev/programming-guides/proto3/#deleting)

**Sem precedente encontrado (2026-08-04)** para a distinção em três níveis (estocada / fora da moldura /
recusada) num inventário de fontes de benchmark. O que sustenta a escolha é o princípio do datasheet — a
lacuna é declarada e categorizada — mais a medição de que a lista puramente declarativa reproduzia o
silêncio que manter o registro devia evitar: retirar `src_b2w` do inventário estocado **desligou** a
checagem de eixo declarado para as linhas dele, em vez de recusá-las.

### K9 — o selo do corpus compara contra o ALVO de coleta, não contra o piso

> **Os números abaixo são os de quatro células e estão superados** (§ N2): hoje é 1 x 4.000 = **4.000**, e
> o bloco cego do alvo é 800 linhas. A regra — o total repousa no alvo e não no piso — é o que permanece, e
> é o que a citação sustenta.

`collection.humanLinesTotal` era 4 x 1.750 = **7.000**, e não 4 x 1.500 = 6.000, porque `sealDataset` compara
a composição por **igualdade exata**: derivar o total do piso recusaria justamente todo corpus que carrega
a margem. O piso continua sendo o número do gate (300 linhas por célula em `test`); o alvo é o número da
coleta.

A aritmética que decide: 1.750 linhas por célula, `test` = 20 %, dá ~350 esperadas com desvio-padrão
`sqrt(1750 x 0,2 x 0,8)` ≈ 16,7 — o piso de 300 fica ~3 desvios abaixo da média. No piso (1.500/célula) a
média em `test` é exatamente 300, então **metade dos sorteios reprova** o gate sem que nada esteja errado
com o corpus.

- Cochran, *Sampling Techniques*, 3ª ed., Wiley, 1977, cap. 4 — dimensionamento de amostra a partir da
  variância do estimador, e não a partir do valor mínimo aceitável: um tamanho igual ao mínimo entrega
  cobertura ~50 %.
- Kish, *Survey Sampling*, Wiley, 1965, § 2.5 — a distinção entre tamanho **planejado** e tamanho
  **realizado**, e por que o planejamento carrega folga para a perda do sorteio.

**Sem precedente encontrado (2026-08-04)** para o caso específico de uma pré-inscrição de benchmark que
congela as duas quantidades e as cruza no parser. A regra é aritmética de amostragem elementar; o que é
decisão deste projeto é **qual das duas o selo compara**, e essa é a linha registrada (registro § C-14).

### K10 — o inventário que gasta alpha é DERIVADO da família, e o que sobra publica sem certificar

`benchmark/gates.ts` deixa de manter uma lista local de gates obrigatórios e passa a derivar o inventário
de `multiplicity.primaryFamily`: seis gates de intervalo (quatro tetos de FPR por célula no eixo
`humanSourceType`, o recall geral no limiar e o ECE global) mais a conjunção de integridade, que é **um**
membro por mais booleanos que tenha. Todo o resto — o FPR agregado, os outros eixos críticos, as bases de
rótulo, a cobertura, o recall de assistência material e a camada de ação inteira — é publicado como
**diagnóstico**: não gasta cota de alpha, não sustenta alegação no nível pré-registrado, e **bloqueia
exatamente como antes**, pelo tier a que pertence.

A distinção é a de família **confirmatória** versus **secundária/exploratória**, e ela é normativa fora
desta área:

- ICH E9, § 2.2.5–2.2.6 e § 5.6 — variáveis primárias pré-especificadas, ajuste de multiplicidade sobre
  elas, e a assimetria explícita: variáveis de **segurança** normalmente não entram no ajuste e ainda assim
  restringem o programa. [link](https://database.ich.org/sites/default/files/E9_Guideline.pdf)
- FDA, *Multiple Endpoints in Clinical Trials: Guidance for Industry*, 2022 — a família que controla o erro
  familiar é declarada antes; um endpoint fora dela **não sustenta alegação**, e é reportado sem alpha.
  [link](https://www.fda.gov/media/162416/download)
- Dmitrienko & D'Agostino, *Traditional multiplicity adjustment methods in clinical trials*, Statistics in
  Medicine 32(29), 2013 — por que o conjunto de hipóteses tem de ser fixado antes de olhar os dados.
  [link](https://doi.org/10.1002/sim.5990)
- Bretz, Maurer, Brannath & Posch, *A graphical approach to sequentially rejective multiple test
  procedures*, Statistics in Medicine 28(4), 2009 — realocar alpha entre hipóteses só é válido sob regra
  pré-especificada; encolher `m` depois de uma célula perder poder não é uma delas.
  [link](https://doi.org/10.1002/sim.3495)

**A transferência, e o limite dela — medido.** O gate faz o que a diretriz descreve para a **alegação**: só
a família a decide, e `failedCertifying` é a lista que a nomeia. O que a diretriz NÃO autoriza é tratar o
secundário como inerte, e a medição diz por quê: em `benchmark/profile-artifact.ts` só `reject` produz
`profiles: []` e `rolloutState: "bundle-verified"`, e `scripts/release-policy.mjs` mapeia `reject` para
`includeTmr: false` com `activeRuntimeKind: "builtin"` — o scorer estilométrico embutido, que se abstém —
enquanto `indicator-only` publica o conjunto de perfis, entra no pacote com `includeTmr: true` e faz dos
pesos o runtime ativo. `indicator-only` não é um teto mais baixo que `reject`: é a fronteira entre **não
publicar** e **publicar**. Por isso a regra de decisão de §6.5 permanece intacta — integridade, warning ou
certificador falho ⇒ `reject`; só falha de ação ⇒ `indicator-only` — e a assimetria de segurança do E9 é
respeitada na direção em que ela existe: a variável fora do ajuste **restringe** o programa.

O que a derivação MUDA, então, é o que se afirma e não o que se libera: (i) a cobertura da família é medida
nas duas direções (membro sem gate, gate sem membro) e uma incoerência reprova fechado; (ii) uma célula
certificadora sem poder **permanece em `m` e reprova**, em vez de deixar de gatear; (iii) o relatório e o
resumo publicado dizem qual camada caiu.

**Sem precedente encontrado (2026-08-04)** para duas partes: (i) derivar o inventário obrigatório do
próprio objeto que declara a família — em ensaio clínico a família vive no protocolo e a conferência é
humana, aqui as duas direções são medidas e reprovam; (ii) publicar o papel por gate no artefato selado. A
célula sem poder que permanece em `m` e reprova segue de Bretz et al. por contraposição, não de um
precedente direto.

### K11 — no máximo uma linha por documento de origem por célula, como condição do n

O denominador de cada teto de FPR por célula é linha-registro de negativo humano, e a pré-inscrição admite
**uma** linha por documento de origem por célula (`collection.maximumLinesPerOriginDocument`). Sem essa
regra a mesma página poderia preencher a célula em fatias: `n` contaria sorteios correlacionados enquanto o
intervalo supõe permutabilidade, e o teto publicado sob zero eventos — `1 − (alpha/7)^(1/n)` — seria lido
de um tamanho de amostra que o corpus nunca teve.

- Kish, *Survey Sampling*, Wiley, 1965, § 5.2 (efeito de desenho) — o efeito de conglomerado infla a
  variância na razão `1 + (b − 1)ρ`; com uma unidade por conglomerado, `b = 1` e o fator desaparece por
  construção em vez de ser estimado.
- Cameron & Miller, *A Practitioner's Guide to Cluster-Robust Inference*, JHR 50(2), 2015 — o nível de
  agrupamento decide a largura do intervalo, e agrupar errado não é conservador.
  [link](https://doi.org/10.3368/jhr.50.2.317)

**A transferência:** as duas fontes tratam de **corrigir** a dependência depois de amostrar; aqui a regra
de coleta a **elimina** na origem, e é por isso que o piso de linhas e o piso de unidades independentes são
o mesmo número (`powerFloors.criticalFprHumanNegatives` = `powerFloors.samplingUnits` = 300). A razão de
domínio vive escrita no gate que a usa (`benchmark/gates.ts`, § "WHY A CELL'S n COUNTS INDEPENDENT
UNITS"), porque é ela que autoriza o denominador que o gate publica.

### K12 — o limite tem de ter sido corrigido para o `m` que o relatório publica

Cada teto de FPR por célula é decidido sobre um limite simultâneo **desenhado dentro da própria fatia**, e o
divisor chega ao agregado e a cada fatia por argumentos separados (`benchmark/commands/evaluate.ts`). Um
limite lido em `alpha/40` comparado ao mesmo orçamento é **mais largo** que o lido em `alpha/7`: passa
célula que o alpha pré-registrado reprovaria, sem que nada no relatório fique malformado. `benchmark/gates.ts`
recusa (`divergent-multiplicity`) qualquer limite cujo `m` difira do declarado, e `SliceOptions` exige o
divisor no tipo — omiti-lo deixa de compilar.

- Bretz, Maurer, Brannath & Posch, 2009 (K10) — o procedimento é definido pelo conjunto de hipóteses E pelos
  pesos de alpha; um limite que não pertence ao procedimento declarado não é evidência dele.
  [link](https://doi.org/10.1002/sim.3495)
- Ioannidis, *Why Most Published Research Findings Are False*, PLoS Medicine 2(8), 2005 — a análise que se
  afasta do plano na direção favorável é o mecanismo, não o acidente.
  [link](https://doi.org/10.1371/journal.pmed.0020124)

**Sem precedente encontrado (2026-08-04)** para a forma da guarda: a literatura estatística supõe UM
procedimento executado por UM analista, e não a fiação de um divisor entre dois sítios de chamada. A regra
aqui é a de R7 aplicada ao alpha — declarar a unidade não é medi-la — e é decisão deste projeto.

### K13 — o gate de calibração recusa a base de escore que a pré-inscrição não nomeia

A hipótese `calibration-global` é ECE-15 equal-mass **sobre `document-raw-score`** (K/Q2(b)): o softmax
agregado do próprio head, o mesmo número que o corte congelado corta. Um ECE é um número qualquer que seja o
escore que o produziu, então o gate não consegue lê-lo do valor: quem mediu declara a base
(`GateInput.calibrationScoreBasis`) e o gate recusa (`score-basis-mismatch`) qualquer uma que não seja a
pré-inscrita. Hoje o caminho certificador aplica o calibrador congelado antes de medir
(`benchmark/commands/evaluate.ts`, `applyFrozenCalibration`; nenhum `kind` de calibrador serializado é a
identidade), então a recusa é a resposta correta e permanente até o corte publicado passar a ser o do escore
bruto.

- Guo, Pleiss, Sun & Weinberger, *On Calibration of Modern Neural Networks*, ICML 2017 — ECE é uma
  propriedade de um escore específico; recalibrar muda a quantidade medida, não apenas o seu valor.
  [link](https://proceedings.mlr.press/v70/guo17a.html)
- Naeini, Cooper & Hauskrecht, *Obtaining Well Calibrated Probabilities Using Bayesian Binning*, AAAI 2015 —
  o estimador de ECE por binning é definido sobre a distribuição do escore de entrada.
  [link](https://doi.org/10.1609/aaai.v29i1.9602)
- ICH E9 § 5.6 e FDA 2022 (K10) — uma hipótese pré-especificada é sobre um estimando; medir outro estimando
  não a decide, ainda que ao mesmo alpha.

**A transferência:** as duas primeiras fontes dizem o que o ECE é medido sobre; nenhuma trata de um gate
automatizado que **recusa a corrida** por incoerência entre a base pré-inscrita e a medida. Essa parte é
**sem precedente encontrado (2026-08-04)**, e o desenho segue o resto do módulo: evidência ausente ou de
outra quantidade reprova fechado, e nunca cai para o número mais próximo.

### K14 — o piso de composição REPROVA O CONGELAMENTO, e conta três quantidades

`benchmark/composition-gate.ts` conta, por célula de cota × `test`, as **linhas negativas humanas
elegíveis**, as **unidades independentes** (componentes conexos, `preRegistration.powerInventoryUnit`) e as
**linhas por documento de origem**, e recusa (`COMPOSITION_BOUNDS_NOT_MET`, em
`benchmark/commands/split.ts`) o selo de corpus `release` fora de qualquer um dos três limites, nomeando
célula, contagem medida e limite. Cinco decisões distintas vivem aqui:

1. **A verificação é de DESENHO e não de relatório.** O piso é conferido antes de o split ser congelado —
   nada foi pontuado, nenhum limiar foi ajustado, nenhum byte cego foi lido —, então um corpus que não
   sustenta a alegação pré-inscrita não chega a existir como artefato selado. Poder conferido depois da
   medição só produz ressalva; conferido no congelamento, produz outro corpus.
2. **`test` e só `test`.** Os dois pisos limitam o denominador de um teto de FPR por célula, e essa taxa é
   medida no bloco cego: `dev` e `cal-A` ajustam o limiar, `train` treina, `cal-B` está reservada. Ler o
   piso como por-partição exigiria um corpus várias vezes maior para satisfazer quantidades que nenhuma
   alegação publicada usa.
3. **As três quantidades, e qualquer uma reprova.** Linhas respondem "quanto texto"; unidades respondem
   "quantas observações independentes"; linhas por documento responde "uma página foi fatiada em muitos
   sorteios". 300 linhas fatiadas de um documento de origem são 300 linhas e uma unidade, e é por isso que
   a conjunção — e não a disjunção — é o critério. Os **dois pisos não pegam** a violação da regra de
   coleta: 600 linhas sobre 300 documentos são 300 componentes, passam os dois, e publicariam o teto sobre
   `n = 600` com 300 sorteios independentes. O teto de `collection.maximumLinesPerOriginDocument` é, por
   isso, comparação própria — e é ele que torna verdadeira a frase que `benchmark/gates.ts` já escreve na
   evidência selada ("a imposição é do gate de composição", `gates.ts` na recusa de célula sem poder).
4. **A população contada é a MEDIDA.** As linhas contam pelo mesmo predicado que a medição usa
   (`isEligible`, `benchmark/metrics.ts`, no piso pré-inscrito `wordFloor.abstainBelow` = 50): uma linha em
   que o escore se abstém não está no denominador do FPR, então contá-la aqui defenderia uma população que
   nunca é medida — e a célula reprovaria por falta de poder **depois** de o bloco cego existir. A célula
   `carolina-social-media` é a tipologia em que documento abaixo de 50 palavras é o caso comum, então a
   folga não era teórica. Resíduo declarado: `slices.ts` registra que `negatives` ainda sobredeclara o `n`
   de um intervalo de FPR por `undecidedNegatives` — quantidade que **não é conhecível antes da pontuação**
   e portanto não pode ser conferida no congelamento; dono, a unidade que tocar a publicação de `n` no
   model card (A6/G2 em § 2.2).
5. **Origem não recuperada não vira sorteio.** Linha cujo eixo `source` não é `known` não tem documento de
   origem recuperável, e todas as de uma célula compartilham **um** balde: duas linhas que não se pode
   mostrar vindas de documentos diferentes não são dois sorteios. Lê-las como documentos distintos é a
   direção que superestima poder. **Sem precedente encontrado (2026-08-04)** — a literatura de amostragem
   trata o conglomerado como conhecido por desenho, não como campo que pode faltar.

- ICH E9, § 3.5 (*Sample Size*) — o tamanho da amostra é fixado e **justificado no protocolo**, antes dos
  dados; a quantidade sobre a qual o poder é calculado tem de ser a variável primária.
  [link](https://database.ich.org/sites/default/files/E9_Guideline.pdf)
- FDA, *Multiple Endpoints in Clinical Trials*, 2022 (K10) — a família que controla o erro familiar é
  declarada antes, e cada membro dela precisa do seu próprio denominador.
  [link](https://www.fda.gov/media/162416/download)
- Kish, *Survey Sampling*, Wiley, 1965, § 5.2 (K11) — a unidade de seleção é o conglomerado; contar
  elementos onde o desenho sorteia conglomerados infla o `n` efetivo.
- Cameron & Miller, *A Practitioner's Guide to Cluster-Robust Inference*, JHR 50(2), 2015 (K11) — agrupar
  errado não é conservador. [link](https://doi.org/10.3368/jhr.50.2.317)

**A transferência e o limite dela.** As diretrizes ancoram *justificar o tamanho antes*; nenhuma delas
descreve um **gate automatizado que recusa materializar o dataset** por não alcançar o próprio piso —
**sem precedente encontrado (2026-08-04)**, e é a mesma ausência que § 2.2 registra do outro lado: a área
publica o split, não a recusa. Também **sem precedente** a comparação **inclusiva**: as contagens são
inteiras, `300` é o piso ADOTADO, e uma célula com exatamente 300 satisfaz o que a pré-inscrição
congelou — comparar por `>` reprovaria o valor que o próprio documento nomeia. Kish § 5.2 e
Cameron & Miller cobrem o **porquê** do teto por documento (contar elementos onde o desenho sorteia
conglomerados infla o `n` efetivo); o teto **em si** é regra de coleta desta pré-inscrição, não achado
da literatura.

**A consequência medida, dita porque é real.** O eixo de que a célula é lida é `humanSourceType`
(`CELL_FPR_AXIS` em `benchmark/gates.ts`, o mesmo eixo em que os tetos são medidos). Um corpus cujo eixo
carrega o vocabulário de **estrato** (`humanCoreStrata`) em vez do de **célula**
(`preRegistration.quotaAxis.cells`) preenche célula nenhuma: as quatro declaradas leem zero e o selo é
recusado. Isso é o gate funcionando — a divergência de vocabulário aparece como célula vazia, nunca como
piso satisfeito — e é a mesma incoerência que `benchmark/gates.ts` já reprova a jusante
(`missingHypotheses` + `unexpectedHypotheses`). O que muda é o instante: passa a aparecer no
congelamento, não na medição.

**O outro lado do vocabulário, com o arquivo e o dono** — resolvido em § N3, que colapsou as duas listas
numa constante única em vez de traduzir entre elas. `sealDataset`
(`benchmark/dataset-manifest.ts`, o laço de `RELEASE_CORPUS_POLICY.requiredHumanSourceTypes`) exige, para
`release`, contagem **> 0** em cada um dos quatro **estratos** (`encyclopedic`, `judicial`, `social-media`,
`university`), enquanto este gate exige 300 em cada uma das quatro **células**. A afirmação forte de que
os dois lados são mutuamente insatisfazíveis é **falsa** e não deve circular: o limiar é `> 0`, não o alvo
de coleta, então um corpus que carregue os dois vocabulários no MESMO campo (quatro linhas com nome de
estrato, o resto com nome de célula) satisfaz os dois. A afirmação verdadeira é mais fraca: **nenhum corpus
com vocabulário coerente satisfaz os dois**, e uma coleta natural das quatro células é recusada antes do
split por `DATASET_COVERAGE_INVALID`. Dono: **Fase 2, D0** (`REGISTER`/`HUMAN_SOURCE` → 4 células), que
move `requiredHumanSourceTypes` junto do remapeamento do lab, ou declara a tradução estrato→célula num
lugar só.

### K15 — um preflight de condições NECESSÁRIAS, por classe, que declara a própria insuficiência (Commit F, 2026-08-04)

`benchmark/viability-preflight.ts` (comando `preflight-viability`) roda sobre o corpo carimbado **antes**
do split, conta os componentes conexos pelos eixos de conectividade v4 e compara, **em cada escopo** — o
corpo agregado e cada classe (`human`, `ai`, `mixed`), cada uma sobre o próprio total —, os dois
**extremos** com os dois **alvos extremos** das frações pré-inscritas: o maior componente contra `train`
(45 %) e a menor contribuição não nula contra `dev` (5 %), os dois com a tolerância de 2 pp de
`CLASS_TOLERANCE`. Cinco decisões distintas vivem aqui:

1. **Só condições NECESSÁRIAS, e a saída diz que são só isso.** Atribuir componentes indivisíveis a cinco
   blocos de tamanho-alvo é **partição multivias de números** — soma de subconjuntos com cinco caixas —,
   e resolvê-la é o que o preflight se recusa a fazer. As duas condições são as que se pode afirmar sem
   resolvê-la, e afirmar mais que isso é exatamente a suposição que a pré-inscrição v3 abandonada fez
   (§ 2.2g). Por isso a frase "necessário e NÃO suficiente" é **texto de saída** e não comentário: um
   preflight verde é a saída que um leitor pode tomar por corpus divisível. A insuficiência é **medida** e
   não só declarada — o catálogo de testes carrega um corpo (componentes de 47 %, 7 %, 23 % e 23 %) que
   passa nas duas condições e que `createBlockedSplit` recusa.
   _Fonte:_ **Karp, 1972 — Reducibility Among Combinatorial Problems**, em *Complexity of Computer
   Computations*, Plenum. [link](https://doi.org/10.1007/978-1-4684-2001-2_9) _Fato citado:_ KNAPSACK
   (soma de subconjuntos) está entre os 21 problemas NP-completos originais, então decidir existência de
   atribuição exata não é passo barato de um pipeline. _Estado do link:_ **não verificado em texto
   integral** nesta sessão (capítulo de livro, sem rede).
   _Fonte:_ **Garey & Johnson, 1979 — Computers and Intractability**, W. H. Freeman, problemas SP12
   (3-PARTITION) e SR1. [link](https://dl.acm.org/doi/book/10.5555/578533) _Fato citado:_ 3-PARTITION é
   NP-completo no sentido FORTE, isto é, permanece difícil mesmo com números limitados por um polinômio no
   tamanho da entrada — que é precisamente o regime deste corpus (tamanhos de componente pequenos, muitos
   componentes). _Estado do link:_ **não verificado em texto integral** nesta sessão.
2. **A condição frouxa é a do MAIOR, e é a padrão.** "Nenhum item excede a capacidade de uma caixa" é a
   condição elementar de viabilidade de empacotamento, e é a base do limite inferior L1 de bin packing.
   Ela só recusa escopo dominado por um bloco. _Fonte:_ **Martello & Toth, 1990 — Knapsack Problems:
   Algorithms and Computer Implementations**, Wiley, cap. 8 (*Bin-packing problem*).
   [link](http://www.or.deis.unibo.it/knapsack.html) _Fato citado:_ a viabilidade de um empacotamento
   exige que todo item caiba numa caixa, e essa é a primeira condição que qualquer limite inferior
   pressupõe. _Estado do link:_ **não verificado em texto integral** nesta sessão.
3. **A condição AFIADA é a do MENOR, e é contraintuitiva.** Todo alvo excede a tolerância, então toda
   partição tem de receber fração não nula de todo escopo; e todo subconjunto não vazio inclui ao menos um
   componente, então para existir subconjunto que realize o **menor** alvo é preciso existir componente que
   caiba nele. Quem limita a menor partição é o menor componente, não o maior — e a recusa é de
   **granularidade**, não de tamanho de corpo, porque crescer o corpo mantendo o número de componentes não
   muda fração alguma. A aritmética é elementar; **sem precedente encontrado (2026-08-04)** para o uso
   dela como **preflight de split de dataset**: a literatura de split agrupado (§ 2.2i, § 4.1) trata o
   grupo como átomo e mede vazamento *depois* do corte, e a de empacotamento raciocina sobre o maior item
   porque o objetivo dela é caber, não é realizar um alvo pequeno.
4. **A unidade da comparação é a CLASSE, e o corpo agregado é um escopo à parte.** O splitter compara
   fração **por classe** (`classTotals`/`scoreCut` em `benchmark/split.ts`), então as duas condições valem
   por classe, sobre o total daquela classe. O escopo agregado é necessário também — a fração agregada de
   uma partição é a **combinação convexa** das frações por classe, com pesos iguais aos totais de classe,
   logo cai na mesma faixa de tolerância, e a faixa exclui o zero —, e **nenhum dos dois se deduz do
   outro**, o que é a razão de os dois estarem escritos:
   - por classe **não** se deduz do agregado, e essa é a direção caríssima: a metade gerada é fina e
     derruba toda fração agregada, então uma metade humana degenerada em um componente por célula cabe em
     `train` no agregado e **passa** num teste só agregado — enquanto `dev` precisa de 5 % da classe
     `human` e não existe bloco dela pequeno o bastante. **Medido** (probe read-only, 2026-08-04, na
     composição de quatro células então ratificada — 7.000 humanas + 4.000 ai + 2.000 mistas): corpo de
     100 linhas, 40 humanas em 4 componentes de 25 % da classe mais 60 geradas de grão fino → preflight
     agregado `passed: true`, `createBlockedSplit` recusando com `human=[train 1.000, dev 0.000, …]`. A
     aritmética do probe é a das quatro células e está superada (§ N2), a **direção** não: sob a moldura
     de uma célula o mesmo corpo de 100 linhas dá um componente humano de 40 % do corpo e **100 %** da
     classe, e a recusa por classe fica mais folgada e não menos (medido em
     `benchmark/lab/test_connectivity_feasibility.py`). Esta versão recusa esse corpo nomeando a classe;
   - o agregado **não** se deduz do por classe: um corpo cujos componentes são todos grossos no agregado,
     tendo cada classe um componente fino, satisfaz todas as condições por classe e não preenche a menor
     partição. Está no catálogo como `corpo-grosso-classes-finas`.
   **Sem precedente encontrado (2026-08-04)** para a formulação por classe: a literatura de split agrupado
   mede *leakage* e balanceamento de rótulo **depois** do corte, e não publica condição necessária de
   granularidade por classe antes dele.
5. **Concordância entre duas linguagens, provada sobre um corpo comum.** A guarda equivalente do
   assembler (`assert_components_can_fill_five_partitions` em `benchmark/lab/assemble_corpus.py`, chamada
   em `assign_partitions` antes de qualquer carimbo) e este preflight têm de dar o mesmo veredito, e a
   concordância é mantida por um catálogo de corpos que os dois lados leem
   (`benchmark/tests/fixtures/viability-agreement.json`). O catálogo declara **geometria** e não registros
   prontos, porque os dois lados escrevem registro em idiomas diferentes; cada lado confere o histograma de
   componentes e as contagens por classe **medidos** contra os **declarados** antes de comparar veredito, e
   a lista de violações é **ordenada e escopada**, então os dois concordam sobre *qual* condição recusa e
   em *qual* escopo, não apenas sobre passar ou reprovar. **Sem precedente encontrado (2026-08-04)** para
   essa forma específica — catálogo de fixtures compartilhado entre implementações em duas linguagens, com
   o histograma de conectividade afirmado dos dois lados antes do veredito. A prática vizinha que existe no
   projeto é o espelho por REGEX sobre o fonte TypeScript (`test_extractors.py`), que pina **constante** e
   não **comportamento**.

**O que este preflight NÃO é, dito porque a confusão custa uma rodada de montagem.** Ele é irmão do
`cluster-ledger preflight`, não substituto: aquele mede **exposição** (que linha uma partição cega ainda
pode receber, lendo ledger e keyring privados) e este mede **geometria de partição** (lendo o
`records.jsonl` carimbado). Um corpus passa num e reprova no outro sem contradição. Os dois estão no
runbook § 4b e § 4b-bis. E há UMA entrada em que ele é deliberadamente **mais estrito** que o splitter:
corpo vazio, que `createBlockedSplit` aceita devolvendo cinco partições vazias e que aqui é recusado,
porque um corpo sem componente satisfaz todas as comparações e passaria por vacuidade.

**Custo de reversão:** baixo. O comando não escreve nada, não sela nada e não muda veredito de gate algum
— apagá-lo devolve o projeto ao estado em que a degenerescência do eixo grosso aparece só como
`SPLIT_CONSTRAINT` depois da montagem inteira, com mensagem de fração por classe em vez de granularidade.
**Nenhum arquivo novo entra em `EVALUATOR_FILES`, mas o `evaluatorDigest` MOVE**: `benchmark/cli.ts` e
`benchmark/split-audit.ts` são membros da lista (`digests.ts`) e os dois mudam de bytes — o dispatcher do
subcomando num, um comentário no outro. Medido:
`76e81ba0521f68c31d796da87fad4d9099993fdb0aca31c2fc10426a918ccf65` →
`35041bfa4f13719e7015c5ede03a1b994a3a54d64bcd93318278bafb0ebb1396`. É inevitável — um subcomando tem de
ser fiado no dispatcher — e inócuo hoje: `issuedAt` é `null`, há 0 tags de release e nenhum `fit` selado
(ESTADO § 1). **Medido** também: dos oito corpos do
catálogo, `createBlockedSplit` recusa sete com `class split fractions unreachable` — nenhuma mensagem dele
fala de granularidade, que é a razão de o comando existir — e aceita um, que o preflight aprova; o oitavo
é aprovado pelo preflight e recusado pelo splitter, e é a insuficiência medida. Que **tudo o que o
splitter aceita é aprovado aqui** é asserção do próprio teste, e é ela que dá sentido à prova por mutação
de cada condição.

---

## § L — o alinhamento do lab à moldura declarada (Fase 2, unidade L1, 2026-08-05)

> Escrito sob a moldura de **quatro** células. As regras de L1–L12 valem como método; a contagem de
> células e o vocabulário estão em § N.

As quatro decisões metodológicas que a unidade L1 implementou no lab Python (divergências D0, D4, D6 e
D7 da medição de conformidade). Nenhuma delas toca o caminho selado: o lab produz CANDIDATOS, e o que
sela ciência é o pipeline TypeScript. O que elas decidem é qual material chega ao selo.

### L1 — a moldura amostral como ALLOWLIST fail-closed, com a tipologia indecidida recusando a corrida

`extract_carolina.py` deixa de excluir uma tipologia por denylist (`wikis`) e passa a extrair **só** as
três da moldura (`FRAME_TYPOLOGIES`). As quatro restantes ficam declaradas com a razão
(`OUT_OF_FRAME_TYPOLOGIES`), não são abertas e por isso não consomem cota da corrida; uma tipologia que
**nenhuma das duas listas nomeia** recusa a extração inteira (`TypologyOutOfFrame`).

A assimetria é a decisão: exclusão DECIDIDA é silenciosa (a lista já é a declaração), exclusão
INDECIDIDA para a corrida. A razão é de domínio e é medida: o diretório da mesma tipologia vem grafado
com espaço em algumas releases da Carolina e com underscore em outras, então uma tipologia da moldura
renomeada produziria **zero linha** de uma célula cujo teto de FPR a release publica — e produziria em
silêncio, porque uma allowlist que pula o que não reconhece não distingue "não quero" de "não sei".

- Saltzer & Schroeder, *The Protection of Information in Computer Systems*, Proc. IEEE 63(9), 1975,
  § I.A.3 ("fail-safe defaults") — a decisão de acesso parte da negação e a permissão é a exceção
  enumerada. [link](https://doi.org/10.1109/PROC.1975.9939)
- Gebru et al., *Datasheets for Datasets*, CACM 64(12), 2021 — a documentação diz o que **não** está no
  dataset e por quê; "ausente" e "excluído pela razão X" não são a mesma linha.
  [link](https://doi.org/10.1145/3458723)
- Bender & Friedman, *Data Statements for NLP*, TACL 6, 2018, § 4.1 (*curation rationale*) — o critério
  de inclusão da amostra é parte do artefato, não do processo que o produziu.
  [link](https://doi.org/10.1162/tacl_a_00041)

**Sem precedente encontrado (2026-08-05)** para a terceira via — a categoria que **para a corrida** em
vez de aceitar ou de pular. A literatura de curadoria trata inclusão e exclusão; o estado "indecidido"
como falha ruidosa é analogia do fail-safe default, não citação.

### L2 — a cota humana é POR CÉLULA, lida da pré-inscrição, e não se transfere entre células

`TARGET["human"]` deixa de ser literal e passa a ser `collection.humanLinesTotal`
(`collection_targets()`, que confere total = células x alvo e alvo > piso). `balanced_humans` divide pelo
número de células que a **moldura declara** — não pelas que os pools contêm — e **não** completa uma
célula curta com material de outra: o top-up entre células foi retirado.

A razão é a estrutura da alegação, e ela é aritmética de amostragem estratificada com alocação fixa por
estrato: cada célula publica o próprio teto de FPR sobre o próprio denominador de negativos humanos, logo
uma linha coletada na célula A não substitui uma linha ausente na célula B. Um top-up alcança o total,
gasta o orçamento de coleta em material que o teto da célula faltante não pode usar, e o gate de
composição recusa a selagem no fim da corrida (K14) — com a diferença de que agora a falta aparece na
contagem de coleta, que é o número sobre o qual o operador ainda pode agir.

- Cochran, *Sampling Techniques*, 3ª ed., Wiley, 1977, cap. 5 (*Stratified random sampling*), § 5.3–5.6 —
  a alocação por estrato é decisão do desenho, e o estimador é por estrato antes de ser combinado; o
  tamanho realizado de um estrato não é compensável por outro.
- Kish, *Survey Sampling*, Wiley, 1965, § 2.5 e § 3.4 — tamanho **planejado** contra **realizado**, e por
  que o planejamento carrega folga para a perda do sorteio (é a mesma folga de K9).
- Neyman, *On the Two Different Aspects of the Representative Method*, JRSS 97(4), 1934 — a estratificação
  existe para que cada estrato tenha precisão própria; a alocação é sobre o estrato.
  [link](https://doi.org/10.2307/2342192)

**Transferência declarada:** as três fontes tratam de estimar sobre estratos; o que esta unidade decide é
que o **coletor** também é por estrato, e que a falta de um estrato permanece visível em vez de ser
absorvida. **Sem precedente encontrado (2026-08-05)** para essa regra num coletor de corpus de detecção;
a regra vizinha citável é a de K9 (o selo compara contra o alvo, não contra o piso).

### L3 — a lane fora do slate é recusada na ENTRADA do programa, não no meio da lane

`--provider` deriva as opções admissíveis de `PROVIDER_LANE` (as quatro lanes congeladas) e recusa na
argparse, nomeando as lanes e a razão. `openai` e `anthropic` permanecem nomeadas em
`OUT_OF_SLATE_PROVIDERS`, e os transportes REST das duas saíram de `call_provider`.

O que decide o **lugar** da recusa é uma medição, não estética: `PROVIDER_LANE[provider]` é lido uma vez
por linha gerada, **dentro do laço e depois da chamada ao provedor**, então uma lane fora do slate gastava
uma chamada real (dinheiro e cota) e morria com `KeyError` na primeira linha que escreveu — e morria de
novo em cada retomada. Falhar na entrada é o análogo, para um programa de linha de comando, do
*fail-fast* de configuração inválida: a validação da entrada acontece antes de qualquer efeito.

- Saltzer & Schroeder, 1975, § I.A.3 (*fail-safe defaults*) — mesma âncora de L1, aplicada agora à
  entrada do programa. [link](https://doi.org/10.1109/PROC.1975.9939)
- Nygard, *Release It!*, 2ª ed., Pragmatic Bookshelf, 2018, cap. 4 (*Stability patterns*, "fail fast") —
  validar tudo o que a operação exige **antes** de consumir recurso remoto; falhar no meio custa o
  recurso e deixa estado parcial.
- Google, *Protocol Buffers Language Guide*, seção `reserved` — o identificador retirado continua
  nomeado, para que pedi-lo dê erro em vez de significar outra coisa (o argumento de K5 e K8).
  [link](https://protobuf.dev/programming-guides/proto3/#deleting)

**Sem precedente encontrado (2026-08-05)** na literatura de benchmarks de MGT para "o conjunto de
geradores admissíveis é validado na entrada da ferramenta de coleta". Pré-registrar o slate de geradores
é a prática de § 2.2 e § 4; o que é decisão deste projeto é onde a violação falha.

### L4 — a fonte fora da moldura é NOMEADA no lab, com as três razões separadas

O lab passa a espelhar a distinção que o lado selado já fazia (K8), em três listas: as quatro células de
`REGISTER`/`HUMAN_SOURCE`; `A1_BLOCKED_DOMAIN_SOURCES` (`ptso_qa`, recusada por termo de acesso —
condição jurídica satisfazível); e `OUT_OF_FRAME_DOMAIN_SOURCES` (resenha de produto e as tipologias
Carolina fora da moldura — rota e licença admissíveis, **nenhuma célula**). Um candidato de fonte fora da
moldura é recusado por nome, com a razão, e **contado** (`OutOfFrameDomainSource`, subclasse de
`UnwritableInV3`) em vez de derrubar a montagem; o mesmo vale para a linha mista cujo **pai** está fora.

Duas consequências que a separação compra e que a deleção não compraria: (i) o vocabulário que ainda
nomeia B2W diz que ele está FORA, então quem reencontrar o nome num pool antigo lê a razão em vez de
descobrir silêncio; (ii) as duas razões exigem ações diferentes — parecer jurídico contra emenda da
moldura —, e juntá-las apagaria qual delas se aplica.

- Gebru et al., *Datasheets for Datasets*, CACM 64(12), 2021 — o dataset declara o que ficou fora e por
  quê. [link](https://doi.org/10.1145/3458723)
- Google, *Protocol Buffers Language Guide*, seção `reserved` — a mesma âncora de K5/K8, aplicada agora à
  fonte no lado do coletor. [link](https://protobuf.dev/programming-guides/proto3/#deleting)

**Sem precedente encontrado (2026-08-05)**, e é o mesmo vazio de K8: a distinção em três níveis
(estocada / fora da moldura / recusada) num inventário de fontes de benchmark não tem precedente
localizado. Esta entrada é o espelho, do lado Python, de uma decisão já registrada.

### L5 — o vocabulário da célula é o das duas listas que GATEIAM, não o dos nomes de registro

> **Superado por § N3.** A regra de desempate abaixo continua valendo e é o que decidiu qual grafia
> sobrevive; o que mudou é que as duas listas deixaram de existir separadas — a emenda da moldura de
> 2026-08-05 as colapsou numa constante única, então não há mais dois vocabulários para desempatar. O que
> segue é a medição que produziu a regra.

O campo que carrega a célula de uma linha humana é `humanSourceType`, e a pré-inscrição congelada nomeava
a mesma partição de quatro populações em DOIS vocabulários: `humanCoreStrata`
(`encyclopedic`/`judicial`/`social-media`/`university`) e `preRegistration.quotaAxis.cells`
(`carolina-judicial`/`carolina-social-media`/`carolina-university`/`ptwiki`). O lab escreve o segundo.

A escolha é medida e não estética. Quem lê o campo em produção são o gate de composição (que só conta
sobre `quotaAxis.cells`) e o gate de FPR por célula, que nomeia a hipótese que decide `fpr-<valor>` e a
procura em `multiplicity.primaryFamily` — cujos quatro membros certificadores são `fpr-carolina-*` e
`fpr-ptwiki`. Escrito com os nomes de registro, um corpus de 320 negativos humanos por célula em `test`
conta **zero** linha nas quatro células, reprova com oito quebras, e as quatro hipóteses pré-inscritas
ficam em `missingHypotheses` enquanto quatro que a família não nomeia entram em `unexpectedHypotheses`.
`humanCoreStrata` não tem consumidor que decida nada: é declaração, e o subconjunto
`uncoveredCoreStrata` é conferido contra ela no parser.

- Nosek, Ebersole, DeHaven & Mellor, *The preregistration revolution*, PNAS 115(11), 2018 — a família de
  hipóteses é nomeada ANTES, e a medição tem de ser a das hipóteses nomeadas; um dado que não alcança a
  hipótese pré-registrada não a decide. [link](https://doi.org/10.1073/pnas.1708274114)
- Sculley et al., *Hidden Technical Debt in Machine Learning Systems*, NeurIPS 2015, § 3 e § 5
  (*entanglement*, *undeclared consumers*, *configuration debt*) — dois consumidores do mesmo campo com
  vocabulários diferentes é a dívida que não aparece em teste porque cada lado é internamente coerente.
  [link](https://papers.nips.cc/paper_files/paper/2015/hash/86df7dcfd896fcaf2674f757a2463eba-Abstract.html)
- Google, *Protocol Buffers Language Guide*, seção `reserved` — a mesma âncora de K5/K8: o nome que
  sobrevive é o que faz o pedido errado falhar em vez de significar outra coisa.
  [link](https://protobuf.dev/programming-guides/proto3/#deleting)

**Sem precedente encontrado (2026-08-05)** para a regra de desempate propriamente dita — quando duas
listas congeladas do MESMO artefato nomeiam a mesma partição com grafias diferentes, vence a que tem
consumidor que reprova. É decisão de engenharia ancorada na dívida que Sculley et al. descrevem, não
citação. Consequência registrada: `RELEASE_CORPUS_POLICY.requiredHumanSourceTypes` (o único outro leitor
do campo, na cobertura do selo) passa à mesma grafia no mesmo commit, porque exigir os nomes de registro
ali recusaria exatamente todo corpus que o gate de composição aprova.

### L6 — a viabilidade do piso por célula é conferida na COLETA, e a condição é necessária

`assert_cells_can_meet_the_origin_document_floor` conta, por célula, quantos documentos de origem
(`groups.source`) DISTINTOS o pool humano entrega, e recusa a montagem de release abaixo de
`powerFloors.samplingUnits`. A derivação é o que permite conferir tão cedo:
`collection.maximumLinesPerOriginDocument` é 1 e as linhas de origem irrecuperável compartilham UM balde,
então uma célula carrega no máximo (documentos distintos + 1) linhas no bloco cego — por mais linhas que o
pool tenha. Uma célula com menos documentos que o piso não alcança o piso de negativos humanos, e nenhuma
reseleção muda isso.

A condição é **necessária e não suficiente**: os pisos são medidos em `test` e é o split que decide onde os
documentos caem. O gate de composição (K14) continua sendo a autoridade; o que muda é o **momento** em que
a mesma aritmética é ouvida.

- Cochran, *Sampling Techniques*, 3ª ed., Wiley, 1977, cap. 9 (*Cluster sampling*) — a unidade sorteada é
  o conglomerado; muitas linhas de um documento são um sorteio, e nenhuma correção posterior recupera a
  informação que não foi amostrada.
- Kish, *Survey Sampling*, Wiley, 1965, § 5 (efeito de desenho e correlação intraclasse) — o `n` efetivo de
  uma amostra conglomerada é menor que a contagem de linhas, e é o efetivo que sustenta o intervalo.
- Lachin, *Introduction to sample size determination and power analysis for clinical trials*, Controlled
  Clinical Trials 2(2), 1981 — o tamanho de amostra é decidido **antes** da coleta, e um desenho que não
  alcança o poder pretendido é redesenhado, não reanalisado.
  [link](https://doi.org/10.1016/0197-2456(81)90001-5)

**Medição que motivou a guarda (2026-08-05):** o pacote Carolina v2.0 tem 37 membros na tipologia
judiciária, 7 em domínios universitários e 2 em rede social — e o `source` que o extrator emite é o MEMBRO
do zip. Contra piso de 300 unidades, 300 negativos humanos por célula e teto de 1 linha por documento, as
três células Carolina são **inviáveis na granularidade atual**, e a guarda passa a dizer isso antes de a
extração ser gasta. A escolha entre reduzir a granularidade do eixo (documento TEI em vez de membro) e
emendar o piso ou o teto é decisão sobre a UNIÃO do split e sobre a pré-inscrição, e não cabe no lab.

**Sem precedente encontrado (2026-08-05)** para a guarda como *check* de viabilidade rodado pelo coletor
contra o piso pré-inscrito; a prática citável é a de Lachin (decidir o tamanho antes) e a de Cochran
(contar conglomerados e não linhas). O que é deste projeto é fazer as duas valerem no programa que monta o
corpus.

### L7 — a reserva OOD é POLÍTICA DECLARADA por nome, e a família indecidida para a corrida

A reserva de gerador não visto passa a ser declarada em duas listas de papéis
(`OOD_RESERVED_FAMILIES`, `CORE_GENERATOR_FAMILIES` em `assemble_corpus.py`), comparadas por **igualdade
exata** sobre `groups.generatorFamily`, e não deduzida de prefixo de nome (`f.startswith("gemini-3")`, o
predicado que estava lá) nem de lane. Reservada significa que nenhuma linha da família chega a partição de
que o treino é tirado: ela é assentada inteira no bloco cego. Uma família geradora que **nenhuma das duas
listas nomeia** para a corrida (`UndeclaredGeneratorFamily`).

Por que nem prefixo nem lane, medido: `gpt-5.6-luna` chega pela lane `codex` e `gpt-oss-120b-medium` só é
alcançável pelo `agy`, que é o harness do Google — a fronteira de provedor **cruza** a de lane, então
fatiar por lane não é fatiar por provedor. E prefixo é pior que errado, é silencioso: uma família
reservada renomeada pelo provedor deixa de casar o prefixo, é classificada como core e entra no treino sem
que nada reporte. Sob igualdade exata a mesma renomeação cai fora das duas listas e a corrida para — a
assimetria de L1 aplicada ao eixo do gerador.

- **Saltzer & Schroeder, 1975 — The Protection of Information in Computer Systems** (Proc. IEEE 63(9)),
  § I.A.3 (*fail-safe defaults*). [link](https://doi.org/10.1109/PROC.1975.9939)
  _Âncora:_ a decisão parte da negação e o caso não enumerado é recusado, nunca aceito por semelhança de
  nome. _Onde no projeto:_ `assemble_corpus.generator_family_roles`. _Fato citado:_ o mecanismo de
  proteção default nega, e a permissão é a exceção explicitamente enumerada.
- **Wang et al., 2024 — M4: Multi-generator, Multi-domain, and Multi-lingual Black-Box Machine-Generated
  Text Detection** (EACL 2024, Vol. 1, pp. 1369–1407).
  [link](https://ar5iv.labs.arxiv.org/html/2305.14902)
  _Âncora:_ o protocolo de gerador não visto exige que o gerador de avaliação esteja **ausente** do
  treino, e é a queda fora da distribuição que a reserva mede. _Onde no projeto:_ a reserva OOD do slate.
  _Fato citado:_ avaliação cruzada por gerador com geradores mantidos fora do treino, e a degradação
  medida nessa condição.
- **Macko et al., 2023 — MULTITuDE** (EMNLP 2023 Main, pp. 9960–9987).
  [link](https://aclanthology.org/2023.emnlp-main.616/)
  _Âncora:_ reserva por gerador reportada em fatia própria, nunca agregada aos estratos vistos.
  _Onde no projeto:_ a fatia de gerador não visto do bloco cego. _Fato citado:_ o benchmark reporta
  desempenho por gerador, com geradores de teste distintos dos de treino.
- **Gebru et al., 2021 — Datasheets for Datasets** (CACM 64(12)). [link](https://doi.org/10.1145/3458723)
  _Âncora:_ "quais famílias o treino contém" é linha do datasheet do artefato, não detalhe de
  implementação do coletor. _Fato citado:_ a composição e os critérios de inclusão fazem parte da
  documentação que acompanha o dataset.

**Divergência declarada do slate D3** (`docs/superpowers/plans/2026-07-26-detector-v3-rebuild-implementation.md`,
tabela de D3, plano **DORMENTE**): a tabela põe `gpt-oss-120b-medium` em **core** e manda não "consertar" a
linha. Aqui ela é **reservada**, e a precedência é a declarada em ESTADO.md — o código medido vence, o
ESTADO vence qualquer outro documento, e § 3.3 diz "famílias OpenAI ficam reservadas ao teste de gerador
não visto (OOD); nenhuma entra em treino", sem exceção por lane. O próprio remédio de D1 na medição de
conformidade fala em "toda família OpenAI (gpt-*)". Custo de reversão: mover uma entrada entre dois dicts.
Custo hoje: **zero medido** — a família aparece só nos pools de mistura, cujas linhas são todas recusadas
por `MissingRecipe`/`MissingMaterialBatch`.

**Sem precedente encontrado (2026-08-05)** para o par "papel declarado por nome + família indecidida para
a corrida" como mecanismo de código. A literatura fixa o protocolo (gerador ausente do treino) e não a
forma de impor a lista.

### L8 — o bloco cego carrega os DOIS papéis, e reserva vazia recusa em vez de substituir

Duas recusas novas, da mesma família de erro:

`assert_the_blind_block_holds_both_roles` exige que as linhas reservadas de cada classe sejam
**estritamente menos** que o bloco de teste daquela classe. A release publica duas hipóteses sobre o mesmo
bloco cego — recall no limiar, cuja população são positivos de famílias que o treino contém, e a fatia de
gerador não visto, cuja população é a reserva —, então uma reserva igual ao bloco deixa a primeira sem
população nenhuma. Quanto de cada papel o bloco carrega é **cota de coleta**, e o montador não escolhe
quais linhas reservadas descartar para abrir espaço. Medido: a lane `codex` tem 1.402 linhas frescas de
`gpt-5.6-luna` e a cota ratificada de 4.000 `ai` deixa bloco de teste de 800.

`declared_held_out_families` recusa (`HeldOutReserveEmpty`) quando nenhuma família pode ser declarada, em
vez de devolver um nome. O fallback que estava lá — `sorted(held_out) or ["gemini-3_5-flash-lite"]` —
reinstalava justamente uma das duas famílias cuja alegação de held-out havia sido **retirada por falta de
prova** (`HELD_OUT_INELIGIBLE`), o que torna a reserva uma alegação falsa em vez de ausente. A escolha
entre "vazio legal" e "recusa explícita" é decidida pelo lado selado e não por gosto:
`parseDatasetManifest` recusa por nome uma lista vazia, então não existe estado vazio a que cair.

- **Simmons, Nelson & Simonsohn, 2011 — False-Positive Psychology** (Psychological Science 22(11)).
  [link](https://doi.org/10.1177/0956797611417632)
  _Âncora:_ substituir em silêncio a população de uma hipótese é grau de liberdade exercido depois do
  desenho, que é o que quebra a garantia. _Fato citado:_ flexibilidade não declarada na coleta e na
  análise infla a taxa de falso positivo muito acima do nominal.
- **Ioannidis, 2005 — Why Most Published Research Findings Are False** (PLoS Medicine 2(8)).
  [link](https://doi.org/10.1371/journal.pmed.0020124)
  _Âncora:_ poder insuficiente por população esvaziada não aparece como falha, aparece como resultado.
  _Fato citado:_ o valor preditivo de um achado depende do poder do desenho, e desenhos sub-dimensionados
  produzem achados majoritariamente falsos.
- **Nosek, Ebersole, DeHaven & Mellor, 2018 — The preregistration revolution** (PNAS 115(11)).
  [link](https://doi.org/10.1073/pnas.1708274114)
  _Âncora:_ a composição pretendida é registrada antes; alcançá-la ou não é resultado a declarar, não algo
  a preencher. _Fato citado:_ a pré-registro separa predição de postdição e o desvio tem de ser reportado.

**Sem precedente encontrado (2026-08-05)** para "a composição do bloco cego tem de conter as duas
populações que a família de hipóteses nomeia" como recusa de montagem. É a aritmética de poder (L6, § K14)
aplicada à composição por papel de gerador.

### L9 — o conjunto de vistos é um ARTEFATO de digests, e a poda é global

O conjunto de vistos passa a ser os **10.000 registros do corpus morto** — todas as cinco partições — e a
poda é **global**: o candidato que casa sai do corpus, não fica barrado apenas das partições cegas. É
superconjunto da graduação de exposição de ESTADO.md § 3.4, que readmitiria a linha casada em `train`,
`dev` e `cal-A`; as ~1.600 linhas recuperáveis são abdicadas de propósito, e o que se compra é que "nada
deste corpus foi visto" seja **uma** comparação e não um argumento por partição.

Parte daquelas 10.000 linhas esteve em partição cega, então nada na montagem abre o corpus morto. O que a
montagem lê é um artefato construído uma vez (`near_dupes.py build-seen-index`) que carrega, por
documento, o digest do conteúdo tokenizado e as **chaves de 8 bytes de blake2b dos shingles de 5 tokens** —
nenhum token do material.

**O contrato declara a comparação que roda, e a largura da chave faz parte dele.** A frase é: hash exato
mais Jaccard ≥ 0,82 sobre shingles de 5 tokens **comparados como chaves**. A ressalva é carga, não
ornamento: dois shingles distintos com a mesma chave são um elemento só para a tela. A versão anterior
desta seção afirmava que "colisão só pode ACRESCENTAR à interseção, logo pode descartar um registro a mais
e nunca manter uma duplicata", e isso é **falso por aritmética**: colisão entre dois shingles que os dois
documentos COMPARTILHAM tira um elemento da interseção e um da união ao mesmo tempo, e 82/100 = 0,82 vira
81/99 = 0,8181 sob barra de 0,82 — a colisão MANTÉM a quase-duplicata. Sob crc32 o par era construtível por
busca de segundos (`aa7275 bb7275 cc7275 dd7275 ee7275` e `aa47144 bb47144 cc47144 dd47144 ee47144` colidem
em 232429220), e um par montado em torno dele media 0,82 sobre cadeias e sobrevivia à tela. A chave passou
a 8 bytes de blake2b: o número esperado de pares em colisão sobre as 3.323.576 chaves do artefato real é
`n²/2⁶⁵ ≈ 3e-7`, e é esse resíduo que a frase declara em vez de alegar ausência. O par está pinado como
fixture (`test_a_pair_at_the_bar_is_dropped_even_where_crc32_conflates_two_shingles`), com a expectativa
calculada no teste sobre as CADEIAS — duas implementações por chave concordando entre si não dizem nada
sobre nenhuma delas honrar a frase que publicam.

O artefato tem vocabulário FECHADO em cabeçalho e em linha de documento, e a razão é que um campo livre é
onde alguém põe "só uma amostra para saber de que corpus veio" — e a amostra É o material. Ele vive em
`benchmark/data/` (nunca no Git, nunca em pacote de evidência) e é **estritamente menos exposto** que o
arquivo de que deriva, não incondicionalmente opaco: chave de 64 bits de um 5-grama não é texto e não se
inverte sozinha, mas um dicionário de 5-gramas de pt-BR poderia testar candidatos contra ela. Declarado
em vez de escondido. A ordem ascendente das chaves é conferida na LEITURA: o subconjunto garantido é a
fatia inicial daquela ordem, então uma linha fora de ordem indexaria subconjunto arbitrário e o limite de
alcance deixaria de valer — em silêncio, porque todo o resto do contrato continua batendo.

Uma montagem de release **recusa** sem o artefato (`SeenIndexMissing`), recusa um artefato que cubra menos
de 10.000 documentos (`SeenIndexIncomplete`) e recusa um construído sobre **outro arquivo**
(`SeenIndexOfAnotherCorpus`). A terceira é a que faltava: contagem de documentos não identifica material,
e um índice construído por engano sobre os próprios pools frescos (13.880 candidatos em disco) satisfaz
`documents ≥ 10.000` — a montagem seguiria e imprimiria como contaminação o resultado de comparar os pools
contra si mesmos. O digest do corpus morto é CONSTANTE conferida (`DEAD_CORPUS_SHA256`) contra
`header.source.sha256`, e não prosa em comentário: medição que nada compara é folclore. O modo de falha
substituído era pular a poda em silêncio: a guarda anterior era um teste de veracidade sobre a lista de
textos vistos, então um insumo ausente produzia um corpus que não passara por tela nenhuma e não dizia
nada a respeito.

- **Broder, 1997 — On the resemblance and containment of documents** (SEQUENCES 1997, pp. 21–29).
  [link](https://doi.org/10.1109/SEQUEN.1997.666900)
  _Âncora:_ a resemblance é estimada sobre **assinaturas** de conjuntos de shingles, e não sobre o texto —
  é o que permite que a tela viaje como artefato de chaves. _Onde no projeto:_ `near_dupes.SeenIndex`.
  _Fato citado:_ resemblance/containment definidos sobre conjuntos de shingles e estimados por assinaturas
  de permutações min-wise.
- **Lee, Ippolito, Nystrom, Zhang, Eck, Callison-Burch & Carlini, 2022 — Deduplicating Training Data Makes
  Language Models Better** (ACL 2022, pp. 8424–8445).
  [link](https://aclanthology.org/2022.acl-long.577/)
  _Âncora:_ a sobreposição treino↔avaliação é medida por n-gramas antes de qualquer número ser publicado,
  e o erro que ela causa é sempre na direção otimista. _Fato citado:_ deduplicação exata e aproximada de
  corpora por sequências de n-gramas, com efeito medido sobre a avaliação.
- **Dodge, Sap, Marasović, Agnew, Ilharco, Groeneveld, Mitchell & Gardner, 2021 — Documenting Large
  Webtext Corpora: A Case Study on the Colossal Clean Crawled Corpus** (EMNLP 2021, pp. 1286–1305).
  [link](https://aclanthology.org/2021.emnlp-main.98/)
  _Âncora:_ a contaminação de benchmark é medida e **publicada como número**, não presumida ausente.
  _Onde no projeto:_ a linha `vazamento vs corpus morto` impressa em toda montagem. _Fato citado:_
  medição de sobreposição entre o corpus de treino e conjuntos de avaliação por correspondência de
  n-gramas, reportada por benchmark.
- **Michel et al., 2011 — Quantitative Analysis of Culture Using Millions of Digitized Books** (Science
  331(6014), pp. 176–182). [link](https://doi.org/10.1126/science.1199644)
  _Âncora:_ o precedente de distribuir um corpus como **contagens derivadas de n-gramas** quando o texto
  não pode circular; é a mesma troca que este artefato faz, uma ordem de grandeza menor.
  _Fato citado:_ o corpus foi disponibilizado como n-gramas e suas contagens, e não como o texto dos
  livros.

**Sem precedente encontrado (2026-08-05)** para a combinação exata — artefato de digests + chaves de
shingle usado para podar um corpus NOVO contra um corpus ABANDONADO cujas partições cegas não podem ser
abertas por quem monta. Os componentes são citáveis (shingles de Broder, deduplicação de Lee, contaminação
de Dodge, n-gramas em vez de texto de Michel); a restrição de leitura é do processo deste projeto.

### L10 — a LARGURA da chave é parte do contrato, e o terceiro papel do slate

Duas correções da rodada de fechamento de L2, ambas com a mesma forma: uma frase publicada que o código
não sustentava.

**A largura da chave.** O § L9 acima já carrega a aritmética. O que entra aqui é a escolha de desenho: das
três saídas possíveis — declarar a tela mais fraca, bifurcar entre caminho de texto e caminho de artefato,
ou alargar a chave —, a escolhida foi alargar E declarar o resíduo. Bifurcar reintroduziria dois
algoritmos onde `drop_seen(docs, textos) = drop_seen_against(docs, build_seen_index(textos))` mantém um, e
deixaria o caminho que a release roda com a tela mais fraca. Declarar sem alargar manteria um par
construtível em segundos atravessando a barra. Uma tela por chaves nunca é ABSOLUTA sobre shingles — a
única forma de ser seria guardar os shingles, isto é, guardar o texto —, então o honesto é dizer a largura
e o número.

- **Manku, Jain & Das Sarma, 2007 — Detecting Near-Duplicates for Web Crawling** (WWW 2007, pp. 141–150).
  [link](https://doi.org/10.1145/1242572.1242592)
  _Âncora:_ a impressão digital de 64 bits é a largura de referência para detecção de quase-duplicata em
  escala de bilhões de documentos; 3,3 milhões de chaves está seis ordens de grandeza abaixo do regime em
  que essa largura é considerada suficiente. _Onde no projeto:_ `near_dupes.shingle_key`. _Fato citado:_
  simhash de 64 bits sobre 8 bilhões de documentos, com a colisão tratada como resíduo quantificado e não
  como impossibilidade.
- **Aumasson, Neves, Wilcox-O'Hearn & Winnerlein, 2013 — BLAKE2: simpler, smaller, fast as MD5** (ACNS
  2013). [link](https://doi.org/10.1007/978-3-642-38980-1_8)
  _Âncora:_ digest de tamanho parametrizável com resistência a colisão declarada, mais rápido que MD5 —
  é o que permite trocar crc32 por 8 bytes sem pagar em tempo de montagem (medido: 5 s → 8 s sobre 10.000
  documentos). _Fato citado:_ BLAKE2b admite `digest_size` arbitrário até 64 bytes e as propriedades de
  segurança são declaradas em função dele.

**O terceiro papel.** `EXCLUDED_GENERATOR_FAMILIES`: família cuja PROVENIÊNCIA a linha não registra não
recebe papel que permita uso — as linhas saem do corpus, contadas, com a razão declarada por família. Não
é o mesmo que `HELD_OUT_INELIGIBLE`, que retira a ALEGAÇÃO e mantém as linhas como IA comum: ali o
provedor é conhecido (Google) e só a resolução do alias é que não é; aqui o provedor é desconhecido, e
`madras_synthetic_corpus_gptoss5` nomeia justamente o reservado. Core treinaria numa linha possivelmente
OpenAI e destruiria a alegação de provedor ausente; reservar publicaria gerador não visto sem saber o
provedor. Medido: 1.185 linhas em nove famílias, todas sob o piso de 200, entregues por
`ai_reserved.jsonl` — que o censo da unidade havia omitido. `POOL_GENERATOR_FAMILIES` é o censo medido e
`assert_slate_roles_are_consistent` o confere nos DOIS sentidos, porque a lista tinha sido escrita a
partir do slate de geração e lida como se fosse a partir dos pools.

- **Gebru, Morgenstern, Vecchione, Vaughan, Wallach, Daumé III & Crawford, 2021 — Datasheets for Datasets**
  (Communications of the ACM 64(12), pp. 86–92). [link](https://doi.org/10.1145/3458723)
  _Âncora:_ a proveniência de cada parcela é item de documentação obrigatório, e "não se sabe" é uma
  resposta a registrar em vez de um espaço a preencher. _Onde no projeto:_ a razão por família em
  `EXCLUDED_GENERATOR_FAMILIES`. _Fato citado:_ o datasheet exige composição, fonte e processo de coleta
  de cada subconjunto, com as lacunas declaradas.

**Sem precedente encontrado (2026-08-05)** para "família geradora de proveniência indeterminada é excluída
do corpus por declaração, em vez de entrar como IA genérica". A literatura de contaminação trata do
vazamento treino↔teste; excluir por não se poder atribuir o PROVEDOR é consequência da alegação de gerador
não visto deste release, e não uma prática encontrada.

### L11 — a licença é do DOCUMENTO e viaja no registro, e a fonte que carrega duas recusa

D8. A licença já era lida por documento (header TEI, allowlist fail-closed — C1) e morria no montador:
`cell_of` a derivava do ESTRATO, então todo registro da Carolina dizia `cc-by-nc-sa-4.0` qualquer que
fosse o header. A perda era silenciosa por acidente do pool e não por desenho, e o acidente é ESTREITO —
medido em 2026-08-05, por par (`domainSource`, `licenseId`), sobre os 11.600 documentos da Carolina em
disco:

| escopo | documentos | licenças declaradas |
|---|---:|---|
| em moldura (`carolina_judicial_branch`, `carolina_social_media`, `carolina_university_domains`) | 7.774 | `cc-by-nc-sa-4.0` só |
| `carolina.jsonl` inteiro | 8.000 | `cc-by-nc-sa-4.0` 7.997, `cc-by-sa-4.0` 3 |
| `carolina_fresh.jsonl` inteiro | 3.600 | `cc-by-nc-sa-4.0` só |

Os 3 documentos heterogêneos estão em `carolina_public_domain_works`, tipologia FORA da moldura — é só
por isso que a constante e a leitura concordavam. `SourceCarriesTwoLicenses` é portanto **alcançável e não
hipotética**: um único documento em moldura com header diferente aborta a montagem inteira, e a Fase 3
re-extrai de 38.189 + 26.409 + 8.863 documentos. Os dois remédios que a própria recusa nomeia ficam fora
do lab e são da Fase 3 — dividir `src_carolina` por licença (uma fonte por licença no manifesto revisado),
ou levar a licença a um caminho por registro no esquema selado. A escolha entre os dois é decisão de
esquema; o que o lab garante é que ela seja tomada em vez de sofrida.

Nenhum dos 11.600 declara `cc-by-4.0` ou `public-domain`, as duas licenças que o extrator admite e o
inventário revisado não publica: o custo medido de as manter nomeadas em vez de admitidas é ZERO linha.

Três consequências de desenho, cada uma com custo de reversão de uma entrada de dicionário:

**O `entryId` da evidência de rótulo nomeia a licença.** `assertLabelEvidenceResolves` indexa
`entryId -> UM digest`, e a licença está dentro dos bytes digeridos. Sem a licença no id, dois documentos
de um snapshot sob licenças diferentes dariam uma chave e dois digests: a deduplicação por `entryId`
guardaria o último e todo registro apontando para o outro reprovaria por divergência de digest — a única
recusa do caminho que não nomeia nada em que se possa agir.

**O inventário `licenses[]` é PROJETADO dos registros, contra uma allowlist.** `validateDatasetManifest`
recusa registro cuja `provenance.licenseId` não esteja no inventário (`DATASET_LICENSE_INVALID`), então
uma licença sem entrada é uma licença que nenhum registro pode carregar; e um inventário com entrada que
nenhuma linha usa declara termos a que o corpus não está sujeito. As duas direções são guarda.

**Licença que o inventário revisado não publica DERRUBA A LINHA, contada; licença que nenhuma lista
decidiu PARA A CORRIDA.** A assimetria é a de `UndecidedDomainSource` no eixo da licença. `cc-by-4.0` e
`public-domain` são admitidas pelo extrator e não estão no `CORPUS_LICENSE_REGISTRY`: registrar os termos
de uma licença é ato do inventário do corpus, não do montador, e "domínio público" é um status e não um
instrumento — qual regime coloca o documento lá é o que decide as obrigações. A conferência é contra a
allowlist do EXTRATOR (`extract_carolina.LICENSE_MAP`), então uma licença acrescentada lá sem decisão aqui
aparece como teste vermelho e não como descarte silencioso.

**A fonte sob duas licenças recusa.** `ReviewedSourceEntryV1.licenseId` é uma string: o manifesto revisado
declara UMA licença por fonte. Quando os documentos de uma base declaram duas, toda escolha é falsa sobre
parte das linhas, e escolher a maioria é a pior delas por ser invisível. Levantar o limite é decisão de
esquema no lado selado (caminho de licença por registro), então o lab recusa em vez de escolher.

- **Longpre, Mahari, Hooker et al., 2024 — A large-scale audit of dataset licensing and attribution in AI
  (Data Provenance Initiative)** (Nature Machine Intelligence, 30/08/2024).
  [link](https://www.nature.com/articles/s42256-024-00878-8)
  _Âncora:_ a licença tem de VIAJAR com o registro, e não ficar no agregador — é o modo de falha medido
  como norma do campo. _Onde no projeto:_ `assemble_corpus.document_license`,
  `used_license_inventory`. _Fato citado:_ auditoria de mais de 1.800 datasets, omissão de licença acima
  de 70% e taxa de erro acima de 50% nos sites populares.
- **USP — Corpus Carolina, página oficial de download e licenças por documento**
  (sites.usp.br/corpuscarolina). [link](https://sites.usp.br/corpuscarolina/corpus/)
  _Âncora:_ a base cujo header diz CC BY-NC-SA 4.0 e cujos documentos declaram licenças heterogêneas é
  exatamente esta — a leitura por documento não é zelo, é a única leitura correta desta fonte. _Onde no
  projeto:_ `extract_carolina.LICENSE_MAP` (leitura) e `document_license` (transporte). _Fato citado:_
  header CC BY-NC-SA 4.0, mas documentos individuais têm licenças heterogêneas que devem ser observadas.
- **Gebru, Morgenstern, Vecchione, Vaughan, Wallach, Daumé III & Crawford, 2021 — Datasheets for Datasets**
  (Communications of the ACM 64(12), pp. 86–92). [link](https://doi.org/10.1145/3458723)
  _Âncora:_ a licença é item de composição POR SUBCONJUNTO, e uma lacuna se declara em vez de se
  preencher — é o que sustenta `UNREVIEWED_DOCUMENT_LICENSES` existir nomeada em vez de ser apagada.
  _Onde no projeto:_ `UNREVIEWED_DOCUMENT_LICENSES`, `SourceCarriesTwoLicenses`. _Fato citado:_ o
  datasheet exige composição, fonte e termos de uso de cada subconjunto, com as lacunas declaradas.

**Sem precedente encontrado (2026-08-05)** para "a fonte cujos documentos declaram duas licenças recusa a
montagem em vez de o manifesto nomear uma". A literatura documenta a heterogeneidade (Longpre) e exige a
declaração (Gebru); nenhuma das duas transforma o limite de cardinalidade do esquema de manifesto numa
recusa da montagem, e é isso que esta unidade faz.

### L12 — o gate antiartefato mede FRAÇÃO POR FAMÍLIA e regenera a LANE, e não nomeia linha

D13/A4. Quatro detecções, cada uma com o seu nome no diagnóstico — `prompt-echo`, `refusal`,
`metaconversation`, `harness-signature` —, medidas sobre os registros de geração controlada antes do
split, que é o que "pré-treino" significa aqui: o conjunto de treino é o `train.jsonl` do split e o split
é cortado desses registros.

**A poda seletiva não é uma saída que este módulo consiga produzir.** O relatório não nomeia linha
nenhuma, então não há o que derrubar a jusante; o único desfecho além de passar é a recusa que nomeia
família, contagem, fração medida e a lane a regenerar. O argumento é de amostragem e não de gosto:
derrubar as linhas contaminadas de uma lane deixa como corpus justamente as linhas que o detector NÃO
pegou, e a seleção passa a depender do mecanismo de detecção — dado faltante não aleatório, com o viés da
lane entrando no corpus sem registro.

**As sondas são as constantes do próprio gerador.** `prompt-echo` deriva de `generate_ai.RECIPES` (só a
parte anterior a `{reference}`: o eco da referência é quase-duplicata de linha humana, que é decisão do
`near_dupes` e não pode ser contada duas vezes com outro nome) e `harness-signature` de
`CLI_BANNER_PREFIXES` e `GEMINI_AUTH_MARKERS`. Uma lista copiada seria uma segunda autoridade capaz de
divergir: das quatro lanes congeladas, só a `gemini-cli` filtra banner antes de escrever, e a `agy` grava
`proc.stdout` cru.

**Posição não é usada, e a razão é medida.** As três frases de recusa que casam prosa HUMANA nos pools
estão nos offsets 10, 67 e 214, dentro de qualquer janela de abertura que valha a pena. O que separa
recusa de prosa é o OBJETO da recusa ("com isso", "esse pedido"), não onde ela aparece: com o objeto
exigido, as três somem e nenhuma recusa real é perdida.

**A fronteira do marcador de turno é a LINHA, e não a pontuação de frase.** A forma canônica do vazamento
de chat template é o marcador `assistant` SOZINHO na própria linha, e o fold achatado — que colapsa toda
quebra de linha em espaço — deixa essa forma sem fronteira nenhuma à frente. A sonda roda contra
`fold_lines` sob `re.MULTILINE`, e a diferença é a maior parte do sinal: medido, a pontuação de frase
alcança 24 das 4.048 linhas geradas e a fronteira de linha alcança 146, com ZERO casamento nas 42.100
linhas dos pools humanos.

**Medições que decidiram o desenho** (2026-08-05, sobre os pools em disco):

| medição | valor |
|---|---:|
| linhas geradas com ao menos uma detecção | 148 de 4.048 (3,656 %) |
| `madras_synthetic_corpusqwn` | 146 de 150 (97,33 %) → regenerar a lane |
| segunda família mais contaminada (`…openrouter23`) | 2 de 147 (1,36 %) → limpa |
| famílias core (gemini-3.x, agy e gemini-api) | 0 de 1.170 (0,00 %) |
| mistas varridas INTEIRAS | 15 de 2.135 (0,703 %) |
| mistas varridas só nos VÃOS gerados | 1 de 2.135 (0,047 %) |
| controle humano (o gate nunca lê) | 0 de 42.100 no marcador de turno; 2 de 8.600 no total (0,023 %) |

Os 14 achados que a restrição a vãos elimina são respostas de fórum em pt-BR terminando em "espero ter
ajudado" — o pai humano da linha mista, não a metade gerada. E a taxa do controle humano, 0,023 %, é 87
vezes menor que o teto de 2 %: é ela que sustenta manter as frases de despedida como sonda em vez de
descartá-las por risco de falso positivo.

**O composto é recusado nas sondas escritas à mão E nas DERIVADAS.** `palavras(?![-\w])` entra na própria
derivação dos chunks de template, porque dois chunks de `generate_ai.RECIPES` terminam nessa palavra: sem
isso, `com aproximadamente 5 palavras-chave` casaria a sonda derivada mesmo com a sonda de diretiva
consertada, e a classe de falso positivo continuaria viva por outra porta. Medido, das 8.600 linhas
humanas 4 contêm o composto e nenhuma casa.

**O teto lê CONSTANTE e não política, com registro.** `preregistration-v4.json` está congelada e não tem
campo de contaminação; acrescentar um seria mudança de política e não leitura dela. A comparação é
`Fraction(contaminados, linhas) > Fraction(2, 100)`, aritmética racional exata, porque A4 diz "mais de
2 %" e a fronteira não pode depender de 0,02 ser representável em binário. Custo de reversão: uma
constante, no dia em que a pré-inscrição ganhar o campo.

**Não há denominador mínimo, e em fumaça isso é tolerância zero — declarado.** Com seis linhas numa
família a menor fração não nula é 1/6, então uma detecção recusa. É a leitura pretendida: a alternativa é
uma família que o gate MEDE e sobre a qual não age, isto é, um terceiro desfecho além de passar e recusar —
e é para ele que se estende a mão sob prazo. Uma fração é adimensional, um artefato detectado é artefato em
qualquer n, e o remédio (regenerar a lane) custa menos exatamente quando a lane é pequena. É a diferença
deliberada em relação ao piso de documentos de origem (L6), que é uma CONTAGEM sobre a cota de release e
por isso só vale fora de `--sample`.

**O relatório é publicado inclusive na recusa.** A mensagem da recusa carrega o nome das detecções e as
contagens; as SONDAS que casaram — o diagnóstico acionável, "esta família ecoa a diretiva de contagem de
palavras" — vivem só no `artifact-gate.json`. Escrevê-lo antes do veredito é o que faz o diagnóstico de uma
corrida recusada sobreviver em disco, e ele é o único artefato que uma corrida recusada escreve: nem
`records.jsonl`, nem `governance-inputs.json`. Publicar não reabre a poda que A4 proíbe, porque o relatório
continua não nomeando linha nenhuma.

- **Dingfelder & Riess (FAU Erlangen-Nürnberg), 2025 — Contamination in Generated Text Detection
  Benchmarks** (arXiv 2511.09200). [link](https://arxiv.org/html/2511.09200)
  _Âncora:_ a evidência primária de que as quatro detecções são o modo de falha nº 1 e de que acurácia
  alta em teste limpo não o detecta. _Onde no projeto:_ `artifact_gate.METACONVERSATION_FRAMES`,
  `ECHO_PROBES`. _Fato citado:_ 20.325 de 56.000 amostras do DetectRL contaminadas (36,3 %); "Here is..."
  em 94,7 % do texto do Claude; RoBERTa cai de 99,9 % para 12,1 % de acurácia quando a frase-artefato é
  anexada a texto **humano**.
- **Dugan, Zhu, Alam, Nakov, Apidianaki & Callison-Burch, 2025 — GenAI Content Detection Task 3:
  Cross-Domain Machine-Generated Text Detection Challenge** (1st Workshop on GenAI Content Detection,
  COLING 2025; arXiv 2501.08913). [link](https://arxiv.org/html/2501.08913v1)
  _Âncora:_ retreinar com dado limpo DERRUBA o desempenho, que é o custo que o gate cobra de propósito —
  um gate que não custasse nada não estaria medindo nada. _Onde no projeto:_
  `artifact_gate.assert_no_lane_needs_regeneration`. _Fato citado:_ inspeção manual achou confundidor
  (lista numerada em receitas geradas) e retreinar com dado limpo derrubou o desempenho de 92,67 % para
  89,67 %.
- **Rubin, 1976 — Inference and missing data** (Biometrika 63(3):581–592).
  [link](https://doi.org/10.1093/biomet/63.3.581)
  _Âncora:_ a proibição de poda seletiva, formalmente — remover linhas por um critério correlacionado com
  o próprio artefato é MNAR, e a lane sobrevivente deixa de ser amostra da lane. _Onde no projeto:_ a
  ausência de identificador de linha no relatório de `artifact_gate.measure`. _Fato citado:_ taxonomia
  MCAR/MAR/MNAR de mecanismos de dados faltantes.
- **Deming, 1986 — Out of the Crisis** (MIT Press; reimpressão 2000, ISBN 0-262-54115-7).
  [link](https://mitpress.mit.edu/9780262541152/out-of-the-crisis/)
  _Âncora:_ regenerar a lane em vez de triar as linhas é o Ponto 3 aplicado a um pipeline de geração — a
  triagem em massa não muda o processo que produziu o defeito, e aqui o processo É a lane. _Onde no
  projeto:_ A4; `VERDICT_REGENERATE_LANE`. _Fato citado:_ "Cease dependence on inspection to achieve
  quality. Eliminate the need for inspection on a mass basis by building quality into the product in the
  first place" (Ponto 3 dos 14).
- **Liang, Yuksekgonul, Mao, Wu & Zou, 2023 — GPT detectors are biased against non-native English
  writers** (Patterns 4(7):100779). [link](https://doi.org/10.1016/j.patter.2023.100779)
  _Âncora:_ por que o controle de falso positivo roda sobre prosa HUMANA e por que as sondas exigem o
  frame e não a frase — registro, e não autoria, é o que uma sonda frouxa mede. _Onde no projeto:_ o
  controle de 8.600 linhas humanas; `REFUSAL_FRAMES` com objeto obrigatório. _Fato citado:_ detectores
  classificam erroneamente texto de escritores não nativos como gerado, com viés atribuído a marcadores
  de registro e não de autoria.

**Sem precedente encontrado (2026-08-05)** para "a família contaminada acima de um teto invalida a LANE
inteira, e o relatório do gate deliberadamente não nomeia as linhas para tornar a poda inalcançável". A
literatura mede a contaminação (Dingfelder, Dugan) e formaliza o viés de remoção (Rubin); nenhuma das duas
propõe suprimir o identificador da linha no artefato de saída como forma de impedir a remediação errada.

### L12b — as seis detecções que D13 acrescenta, e por que o gate acusa o que a normalização apaga

D13/W2. As quatro detecções de L12 seguem válidas; o que deixou de valer é o número. São **dez**:
`spacing-anomaly`, `encoding-corruption`, `invisible-character`, `markdown-formatting`, `heading-line` e
`prompt-boilerplate` entram com o seu nome no diagnóstico, sob a mesma regra e o mesmo teto.

**O que o gate mede não é o que o modelo vê, e é essa a decisão central.**
`contracts/text-normalization.ts` remove os invisíveis de `REMOVED_INVISIBLE_CHARACTERS`, dobra todo
separador em U+0020/U+000A e roda NFKC por grafema **antes** da tokenização — então o detector pode nunca
ver um ZWSP. O gate acusa mesmo assim, porque a quantidade que ele mede é **contaminação da lane**: uma
lane que emite uma marca a uma taxa que a classe humana não tem entrega o rótulo de graça, e o remédio de
A4 é regenerar a lane, não filtrar o caractere. Neutralizar a jusante não é razão para parar de contar a
montante.

**A fração é por LINHA, e a soma por detecção pode ser maior que ela.** Uma linha que é eco de prompt E
tem cabeçalho é UMA linha contaminada com duas razões nomeadas. Medido no teste: duas linhas em cem que
casam as duas detecções dão 2 % (limpo), e contá-las uma vez por detecção daria 4 % (recusa) — a diferença
muda o veredito, então a regra é verificável e não decorativa.

**Duas sondas foram MEDIDAS E RECUSADAS, e a recusa está pinada por teste.**

| sonda recusada | humano em moldura | gerado | por que sai |
|---|---:|---:|---|
| espaço antes de pontuação | **7,15 %** | 0,55 % | direção invertida e ACIMA do teto no lado humano |
| NBSP nu (em vez de corrida) | **1,45 %** | 0,005 % | sozinha levava a união a 2,18 %, acima do teto |
| linha curta terminada em dois-pontos | 1,63 % | 5,25 % | é a forma de um dois-pontos, não de um cabeçalho |
| `no formato` solto | 0,20 % | 0,13 % | prosa comum |
| `atue como` sem substantivo de papel | 0,02 % | 0,01 % | verbo de prosa ("atue como mediador") |

A regra de calibração que essas recusas produziram, e que agora está escrita: **a união das dez detecções
sobre a classe humana em moldura tem de ficar ABAIXO do teto.** Uma lane recusada por ser tão limpa quanto
a classe negativa é um gate que recusa lanes por serem humanas. Medido depois da correção do NBSP: 89 de
11.000 linhas ptwiki (**0,809 %**), contra 49,07 % das 19.673 linhas `ai` e 10,30 % das 2.135 mistas
varridas só nos vãos gerados.

**A regra é IMPOSTA por teste, e a fixture é a composição medida da classe.** Uma regra de calibração que
só existe como frase num comentário não impede a próxima sonda invertida: a suíte fica verde e a sonda
entra. Os pools estão fora do repositório (`benchmark/data/*` é gitignored), então o que um checkout pode
guardar não é o pool e sim a sua composição — 1.000 linhas com cada forma na taxa em que a Wikipédia pt a
escreve, as quatro formas **recusadas** incluídas, submetidas ao próprio `artifact_gate.measure`, com
exigência de veredito `clear` (1,0 % contra teto de 2 %). É a mesma disciplina de allowlist já usada no
projeto: a fixture tem de conter o excluído, ou a guarda não morde. Acrescentar a sonda recusada de espaço
antes de pontuação leva a fixture a 8,2 % e o teste a vermelho.

**O conjunto de sondas de invisível é mantido em trava com o contrato de inferência.** O teste não afirma
uma amostra nomeada e sim **igualdade de conjuntos** contra os 27 code points de
`REMOVED_INVISIBLE_CHARACTERS`: um acrescentado no contrato sem sonda no gate seria apagado antes do
modelo e nunca contado contra a lane, que é exatamente o buraco que a detecção existe para fechar. A trava
custou quatro sondas novas — CGJ, separador vogal mongol, enchimentos Hangul e os operadores invisíveis
U+2061–U+2064 —, medidas em **0** nas 11.000 linhas em moldura, **0** nas 19.673 `ai` e **0** nas 2.135
mistas (1 linha entre as 31.100 fora de moldura), então a união publicada de 0,809 % não se move.

**A assimetria que faz `spacing-anomaly` discriminar é do próprio pipeline.** Todo pool escrito por
`CandidateWriter.offer` passou por `common.normalize_text`, que colapsa `[ \t]+` dentro da linha e faz
`strip()` por linha — os extratores humanos, `generate_ai` e `import_public_corpus`. `make_mixed.emit`
**não**: escreve `text: edited` cru. Medido: 0 de 11.000 linhas ptwiki e 0 de 19.673 linhas `ai` têm
corrida de espaço, contra 185 de 2.135 vãos mistos (8,67 %) e 113 com espaço terminal (5,29 %).

**A sonda de espaço terminal exige quebra de linha REAL e nunca o fim do texto.** O vão de uma linha mista
é uma FATIA, então um vão que termina em espaço pode ser só onde `mixture.spans` cortou. Medido, o braço
`\Z` acrescentaria 2 linhas de 2.135 e as duas são corte.

**Os invisíveis rodam invertidos nos pools de hoje, e isso está declarado.** Na moldura ptwiki o ZWSP
chega a 0,38 %, as marcas de direção a 0,12 % e o hífen suave a 0,05 %, contra 0,02 % nas linhas `ai`.
Nessa célula um invisível é marca do lado HUMANO — vem da fonte wiki e nenhum extrator o remove —, então a
detecção é guarda contra um harness FUTURO, não descrição do que as lanes emitem agora. Cada sonda fica
longe o bastante do teto para que manter custe nada: 0,59 % a detecção inteira.

**Denominadores.** As taxas acima são sobre as LINHAS DOS ARQUIVOS de pool, sem dedup: 11.000 ptwiki
(`wikipedia_fresh` + `wikipedia`), 31.100 humanas fora de moldura, 19.673 `ai` em 12 arquivos, 2.135
mistas. Não são o mesmo denominador dos 3,656 % de § 5.4 do ESTADO, que é a contagem de quatro detecções
sobre os 4.048 candidatos `ai` **depois** da dedup.

- **Lapuschkin, Wäldchen, Binder, Montavon, Samek & Müller, 2019 — Unmasking Clever Hans predictors and
  assessing what machines really learn** (Nature Communications 10:1096).
  [link](https://doi.org/10.1038/s41467-019-08987-4)
  _Âncora:_ a definição operacional de "rótulo de graça" — um artefato de aquisição presente numa classe e
  ausente na outra é aprendido em vez do conceito, e a medida certa é a taxa POR CLASSE. _Onde no
  projeto:_ a calibração de cada sonda contra a classe humana em moldura; a regra de que a união fica
  abaixo do teto. _Fato citado:_ um classificador Fisher-vector no PASCAL VOC 2007 detectava a classe
  "cavalo" por uma marca d'água de copyright presente nas imagens de cavalo, e a acurácia colapsava quando
  a marca era removida ou transplantada.
- **Geirhos, Jacobsen, Michaelis, Zemel, Brendel, Bethge & Wichmann, 2020 — Shortcut Learning in Deep
  Neural Networks** (Nature Machine Intelligence 2:665–673; arXiv 2004.07780).
  [link](https://arxiv.org/abs/2004.07780)
  _Âncora:_ por que o gate roda ANTES do treino e por que o remédio é a lane e não a linha — um atalho é
  regra de decisão que vai bem no benchmark e falha fora dele, e ele entra pelo dado, não pelo modelo.
  _Onde no projeto:_ `artifact_gate` no caminho de `assemble_corpus.main()`, antes do split. _Fato
  citado:_ taxonomia de shortcut learning e a analogia do Clever Hans para regras de decisão que exploram
  correlações espúrias do conjunto de dados.
- **Dugan, Hwang, Trhlík, Ludan, Zhu, Xu, Ippolito & Callison-Burch, 2024 — RAID** (ACL 2024; arXiv
  2405.07940). [link](https://arxiv.org/html/2405.07940v1)
  _Âncora:_ as classes de caractere que `invisible-character` e `spacing-anomaly` acusam são ataques
  NOMEADOS no benchmark mais rigoroso da área — é o precedente de que essas marcas mexem em detector, e é
  a mesma razão pela qual `contracts/text-normalization.ts` existe. _Onde no projeto:_
  `artifact_gate.INVISIBLE_PROBES`, `SPACING_PROBES`. _Fato citado:_ entre os 11 ataques adversariais do
  RAID estão `whitespace addition`, `zero-width space` e `homoglyph`.
- **Dugan, Zhu, Alam, Nakov, Apidianaki & Callison-Burch, 2025 — GenAI Content Detection Task 3**
  (COLING 2025; arXiv 2501.08913). [link](https://arxiv.org/html/2501.08913v1)
  _Âncora:_ `markdown-formatting` e `heading-line` como confundidores medidos, e não suspeitos — a
  inspeção manual dos organizadores achou exatamente estrutura de lista em texto gerado. _Onde no
  projeto:_ `artifact_gate.MARKDOWN_PROBES`, `HEADING_PROBES`. _Fato citado:_ inspeção manual achou
  confundidor (lista numerada em receitas geradas) e retreinar com dado limpo derrubou o desempenho de
  92,67 % para 89,67 %.
- **Speer et al. — ftfy: fixes text for you** (documentação oficial; Luminoso/rspeer).
  [link](https://ftfy.readthedocs.io/en/latest/)
  _Âncora:_ a forma da sonda de mojibake — UTF-8 lido como Latin-1/CP1252 produz uma cabeça `Ã`/`Â`
  seguida de um code point da faixa Latin-1, e repetir o erro põe um controle C1 nessa posição. É por isso
  que a sonda exige a cauda e não a cabeça sozinha: `SÃO`, `MÃE` e `CÂMARA` são maiúsculas de pt-BR.
  _Onde no projeto:_ `artifact_gate.ENCODING_PROBES`. _Fato citado:_ mojibake é a decodificação de bytes
  UTF-8 sob uma codificação de byte único, e a biblioteca a desfaz detectando exatamente essas sequências.
- **Kreutzer, Caswell, Wang, Wahab, van Esch, Ulzii-Orshikh, … & Adeyemi, 2022 — Quality at a Glance: An
  Audit of Web-Crawled Multilingual Datasets** (TACL 10:50–72; arXiv 2103.12028).
  [link](https://doi.org/10.1162/tacl_a_00447)
  _Âncora:_ por que a auditoria de artefato de corpus é MANUAL e por classe, e por que um corpus grande
  não é limpo por ser grande. _Onde no projeto:_ a sonda por pool que calibrou as dez sondas; A4. _Fato
  citado:_ auditoria manual de cinco corpora multilíngues de larga escala encontrou problemas sistemáticos
  de qualidade em línguas de menor recurso, com frações grandes de conteúdo não linguístico ou em língua
  errada.
- **Zinkevich (Google), Rules of Machine Learning: Best Practices for ML Engineering** (Google Developers).
  [link](https://developers.google.com/machine-learning/guides/rules-of-ml)
  _Âncora:_ a dívida que esta unidade mediu e não consertou — `train_detector.py` e `build_dataset.py` não
  normalizam, e `contracts/text-normalization.ts` roda só na inferência, então os invisíveis chegam ao
  treino e não chegam ao serviço. É train/serving skew nomeado. _Onde no projeto:_ § 7 do ESTADO. _Fato
  citado:_ training-serving skew é tratado como modo de falha próprio, com a recomendação de que o
  processamento de features do treino e do serviço venha do mesmo código.

**Sem precedente encontrado (2026-08-05)** para quatro coisas desta unidade: (i) um gate de corpus que
acusa deliberadamente caracteres que a normalização de inferência do MESMO projeto remove, pela razão de
que a quantidade medida é contaminação da lane e não entrada do modelo; (ii) a regra de calibração "a união
das detecções sobre a classe negativa em moldura fica abaixo do teto de recusa", que é o que derrubou a
sonda de NBSP nu, e a sua imposição por uma fixture que reproduz a **composição medida** da classe negativa
em vez do corpus; (iii) recusar uma sonda por **direção invertida** medida — mais frequente na classe
humana que na gerada — em vez de por falso positivo absoluto; (iv) travar o conjunto de sondas de um gate
de corpus ao conjunto de remoção do contrato de normalização de inferência, por igualdade de conjuntos
afirmada através da fronteira de linguagem. A literatura mede contaminação (Dingfelder, Dugan), formaliza
atalho (Geirhos, Lapuschkin) e audita corpus à mão (Kreutzer); nenhuma das três trata o gate como
instrumento cuja calibração é uma comparação de taxa entre classes com o próprio teto de recusa como
critério.

## § M — o lote de material: versão medida, aquisição pontual e fixidez do adquirido (2026-08-04/05)

As decisões metodológicas do inventário de material — o que um `SourceMaterialBatchV1` declara e como cada
campo dele se torna verificável por terceiro. Nenhuma está implementada ainda: o produtor é a Fase 3,
item 1. O que elas decidem é qual fato conta como prova de proveniência.

### M1 — a versão do material é MEDIDA no header, em duas âncoras independentes

A versão da Carolina não é aceita da declaração de quem entrega o pacote: é lida do header TEI de cada
arquivo, em dois lugares que existem por razões diferentes — o `<title type="sub">` da descrição
bibliográfica e o `href` do `xml-model`, que é o schema contra o qual o documento valida. A varredura dos
46 arquivos das três tipologias da moldura deu concordância em 46/46 nas duas âncoras.

O que a medição exclui é o **pacote de versão mista**. Um contêiner pode ter sido montado de releases
diferentes, e sob essa hipótese um único `materialVersion` seria falso sobre parte das linhas — o mesmo
modo de falha que `SourceCarriesTwoLicenses` recusa no eixo da licença.

- TEI Consortium, *TEI P5: Guidelines for Electronic Text Encoding and Interchange*, cap. 2 ("The TEI
  Header") — o header é o lugar canônico da descrição bibliográfica e da declaração de edição do
  documento, e é parte do documento e não metadado externo.
  [link](https://tei-c.org/release/doc/tei-p5-doc/en/html/HD.html)
- Wilkinson et al., *The FAIR Guiding Principles for scientific data management and stewardship*,
  Scientific Data 3:160018, 2016, princípios F1 e R1.2 — identificador globalmente único para o dado e
  proveniência detalhada como requisito de reusabilidade.
  [link](https://doi.org/10.1038/sdata.2016.18)
- Bender & Friedman, *Data Statements for NLP*, TACL 6, 2018 — a caracterização da fonte é parte do
  artefato publicado, não do processo. [link](https://doi.org/10.1162/tacl_a_00041)

**Sem precedente encontrado (2026-08-05)** para a forma específica: usar **duas âncoras independentes
dentro do mesmo header** como a medição que exclui o pacote de versão mista, e tratar a divergência entre
elas como o sinal. A literatura de proveniência exige que a versão seja registrada; qual evidência a
sustenta, e o que fazer quando o pacote pode ser heterogêneo, é engenharia deste projeto.

### M2 — a aquisição é um evento pontual, e o mtime é evidência e não declaração

`acquisitionWindow` admite `startedAt === endedAt`. O instante vem do mtime do arquivo adquirido, e o
registro diz explicitamente o que o mtime **não** prova: nada nele separa "baixado então" de "copiado
então". É por isso que o valor é ratificado pelo operador em vez de inferido pelo agente.

- IEEE Std 1003.1 (POSIX), `<sys/stat.h>` — `st_mtime` é o instante da última **modificação de conteúdo**
  do arquivo, atualizado por escrita; nenhum campo de `stat` registra origem ou meio de obtenção.
  [link](https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/sys_stat.h.html)
- W3C, *PROV-DM: The PROV Data Model*, 2013 — a aquisição é uma **Activity** com início e fim, distinta da
  **Entity** que ela gera; um instante de arquivo é atributo da entidade e não da atividade.
  [link](https://www.w3.org/TR/prov-dm/)
- Gebru et al., *Datasheets for Datasets*, CACM 64(12), 2021, § "Collection Process" — *"over what
  timeframe was the data collected?"* é campo do datasheet, e a resposta é declarada por quem coletou.
  [link](https://doi.org/10.1145/3458723)

### M3 — um lote por evento de aquisição, e não um por partição do que foi adquirido

As três tipologias da Carolina saem de um arquivo, um instante e um digest: são partições do download, não
três aquisições. O recorte do lote é o **evento**, e é isso que mantém `sourceMaterialBatch` com um valor
por fonte — a propriedade medida em G0.1-bis que o tira da união do split.

- W3C, *PROV-DM*, 2013 — `wasGeneratedBy` liga cada entidade à atividade que a gerou; subdividir uma
  atividade que ocorreu uma vez cria atividades que não ocorreram.
  [link](https://www.w3.org/TR/prov-dm/)
- IETF RFC 8493, *The BagIt File Packaging Format (V1.0)*, 2018 — a unidade de transferência é o **bag**,
  com um manifesto de checksums sobre o payload; a estrutura interna do payload não multiplica a
  transferência. [link](https://www.rfc-editor.org/rfc/rfc8493)

### M4 — a fixidez é do arquivo adquirido, não do extraído

O sha256 do lote é do bitstream que entrou, porque é ele que "o mesmo material" nomeia. Um digest do
extraído data o extrator: mudaria a cada mudança do nosso código, sobre material que não mudou.

- CCSDS 650.0-M-2, *Reference Model for an Open Archival Information System (OAIS)*, 2012 — *Fixity
  Information* é componente da Preservation Description Information, mantida sobre o objeto de conteúdo
  arquivado e distinta da *Provenance Information*.
  [link](https://public.ccsds.org/pubs/650x0m2.pdf)
- IETF RFC 8493, *The BagIt File Packaging Format (V1.0)*, 2018 — o manifesto declara checksum por arquivo
  do payload como recebido, e a verificação é contra esses bytes.
  [link](https://www.rfc-editor.org/rfc/rfc8493)
- Wilkinson et al., 2016, princípio R1.2 — proveniência detalhada; a versão do dado precisa ser
  verificável contra o artefato, não contra uma etapa derivada dele.
  [link](https://doi.org/10.1038/sdata.2016.18)

## § N — a emenda da moldura: uma célula, proveniência como condição da alegação (2026-08-05)

Nível 1 e 2 da hierarquia. Cobre as decisões metodológicas que reduzir a moldura de quatro células a uma
introduziu. As decisões de **valor** (qual célula, qual alvo) são do operador e estão no registro, não aqui.

### N1 — a proveniência do material é CONDIÇÃO da alegação por célula, e não um atributo de qualidade

A decisão: três células saem da moldura porque o material é de **instituição única** e não declara autor —
não porque o registro seja ruim, e não porque `n` seja pequeno. O que falta é a base para contar unidades
independentes na escala que o intervalo assume: entre 1 (a instituição) e 38.187 (os documentos) o pacote
não oferece critério. Um intervalo cuja unidade de amostragem não se estabelece não é um intervalo mais
largo — é um intervalo cuja cobertura nominal não se sustenta.

- Bender & Friedman, *Data Statements for NLP*, TACL 6, 2018 — a *curation rationale*, a *speaker
  demography* e a *provenance* fazem parte da alegação: sem elas o leitor não sabe sobre qual população o
  número fala. [link](https://doi.org/10.1162/tacl_a_00041)
- Gebru et al., *Datasheets for Datasets*, CACM 64(12), 2021 — "Composition" pergunta explicitamente se as
  instâncias são uma amostra de um conjunto maior e como a amostra foi tirada; "não sabemos" é uma resposta
  que limita o uso. [link](https://doi.org/10.1145/3458723)
- Kish, *Survey Sampling*, Wiley, 1965, cap. 5 — o **efeito de conglomerado**: com conglomerados grandes e
  homogêneos, o `n` efetivo é o número de conglomerados e não o de elementos, e a variância se inflaciona
  por `1 + (m − 1)ρ`. É por isso que 38.187 documentos de cinco hosts não são 38.187 unidades.
  [link](https://archive.org/details/surveysampling0000kish)
- Cameron & Miller, *A Practitioner's Guide to Cluster-Robust Inference*, JHR 50(2), 2015, § 6 — com poucos
  conglomerados a inferência robusta a conglomerado **sub-rejeita e sub-cobre**; o problema não é
  precisão, é a validade do intervalo. [link](https://doi.org/10.3368/jhr.50.2.317)
- Cornfield, *Randomization by group: a formal analysis*, AJE 108(2), 1978 — analisar por elemento o que
  foi amostrado por grupo é o erro de unidade de análise, e ele produz intervalo anticonservador.
  [link](https://doi.org/10.1093/oxfordjournals.aje.a112597)

**A transferência:** a literatura de amostragem trata do caso em que a estrutura de conglomerado é
**conhecida** e se corrige por ela. Aqui o material não permite nem isso: sem autor por documento, o eixo
mais fino disponível é o arquivo-membro do pacote (37 / 7 / 2 arquivos nas três tipologias), e o mais grosso
é a instituição (1). **Sem precedente encontrado (2026-08-05)** para a regra propriamente dita — quando o
material não determina a unidade de amostragem dentro de uma ordem de grandeza, a célula sai da moldura em
vez de entrar com intervalo mais largo. É decisão de engenharia ancorada em Cornfield e Cameron & Miller:
a alternativa (publicar com a unidade grosseira) daria um `n` de 1 a 5 e reprovaria o piso de qualquer
forma; a alternativa oposta (publicar por documento) é exatamente o erro de unidade de análise.

### N2 — estreitar a moldura ESTREITA o teto publicado, e a direção é aritmética e não retórica

A decisão: reduzir de quatro células a uma **aperta** o teto sob zero eventos, de 1,63 % para 0,55 %, por
duas vias que se somam — `m` cai de 7 para 4, então o α de Bonferroni por hipótese sobe de 0,05/7 para
0,05/4; e o orçamento de coleta concentra numa célula, então o `n` do bloco cego vai de 350 para 800.

- Bonferroni já está referenciado no § H; o que é novo aqui é que **`m` é uma escolha de desenho com preço
  medido**, e que reduzir cobertura compra poder por hipótese. É o trade-off que Rothman descreve ao
  argumentar contra o ajuste automático: cada hipótese removida da família devolve α às que ficam.
  Rothman, *No adjustments are needed for multiple comparisons*, Epidemiology 1(1), 1990.
  [link](https://doi.org/10.1097/00001648-199001000-00010)
- Clopper & Pearson, *The use of confidence or fiducial limits illustrated in the case of the binomial*,
  Biometrika 26(4), 1934 — o limite superior exato com zero eventos é `1 − α^(1/n)`, monótono decrescente
  em `n` e crescente em α. É a fórmula que a pré-inscrição nomeia.
  [link](https://doi.org/10.1093/biomet/26.4.404)
- Louis, *Confidence intervals for a binomial parameter after observing no successes*, The American
  Statistician 35(3), 1981 — a leitura da "regra dos três" e por que ela é o caso `n` grande de
  `1 − α^(1/n)`. [link](https://doi.org/10.1080/00031305.1981.10479337)

**A transferência:** as fontes dão a monotonicidade; a decisão é publicar os **dois** pontos da mesma
fórmula em vez de um. **Sem precedente encontrado (2026-08-05)** para declarar dois `n` na pré-inscrição —
o do piso, como critério de recusa, e o do alvo de coleta, como expectativa impressa no model card. A razão
é que os dois respondem perguntas diferentes e publicar só um é o modo de o leitor ficar com o número
errado: o do piso é o pior teto que ainda sela, e o do alvo é o que a coleta foi dimensionada para.

### N3 — duas grafias congeladas da mesma partição colapsam numa constante, e não num cross-check

A decisão: `humanCoreStrata` e `preRegistration.quotaAxis.cells` passam a ser a **mesma constante**
(`FROZEN_HUMAN_CORE_STRATA = FROZEN_QUOTA_AXIS_CELLS`), em vez de duas listas conferidas em runtime. A
grafia que sobrevive é a que tem consumidor que reprova (o id de célula), e é a regra de desempate que o
§ L5 registrou depois de a divergência ter sido medida.

- Sculley et al., *Hidden Technical Debt in Machine Learning Systems*, NeurIPS 2015, § 3 e § 5 —
  *entanglement*, *undeclared consumers* e *configuration debt*: dois consumidores do mesmo campo com
  vocabulários diferentes é a dívida que não aparece em teste porque cada lado é internamente coerente.
  [link](https://papers.nips.cc/paper_files/paper/2015/hash/86df7dcfd896fcaf2674f757a2463eba-Abstract.html)
- Nosek, Ebersole, DeHaven & Mellor, *The preregistration revolution*, PNAS 115(11), 2018 — a família é
  nomeada ANTES, e a medição tem de ser a das hipóteses nomeadas; dado que não alcança a hipótese
  pré-registrada não a decide. [link](https://doi.org/10.1073/pnas.1708274114)

**Sem precedente encontrado (2026-08-05)** para preferir a constante compartilhada ao cross-check: a razão
é que uma comparação que nenhuma entrada consegue reprovar se lê como defesa sem ser uma, o que é o mesmo
argumento que este arquivo já usa em K10 e o que fez sair a comparação de ordem entre os dois tetos
(registro, E-8).

### N4 — extrator de fonte fora da moldura recusa no PONTO DE ENTRADA, não numa passada vazia

A decisão: `FRAME_TYPOLOGIES` fica **vazia** e `extract_carolina.py` levanta `CarolinaOutOfFrame` antes de
abrir o arquivo, em vez de terminar com zero linha. É a mesma âncora de K5 e K8 — o nome que sobrevive é o
que faz o pedido errado **falhar** em vez de significar outra coisa —, aplicada a um módulo inteiro.

- Google, *Protocol Buffers Language Guide*, seção `reserved` — o campo retirado é reservado por nome para
  que a releitura falhe em vez de significar outra coisa.
  [link](https://protobuf.dev/programming-guides/proto3/#deleting)
- Saltzer & Schroeder, *The Protection of Information in Computer Systems*, Proc. IEEE 63(9), 1975 —
  *fail-safe defaults*: a decisão por omissão é a recusa, e a recusa carrega a razão.
  [link](https://doi.org/10.1109/PROC.1975.9939)

**Sem precedente encontrado (2026-08-05)** para a forma específica: a razão registrada é operacional e
medida — uma corrida que lê 3,1 GB e escreve zero linha se lê como arquivo corrompido, e o operador vai
procurar o arquivo em vez de ler a moldura. A recusa é onde a razão mora.

### N5 — nível degenerado sai da tabela de reamostragem em vez de ficar declarado

A decisão: com uma célula, `groups.domainSource` carrega um único valor no corpus, e as duas linhas humanas
da tabela de reamostragem deixam de nomeá-lo — caem por fallback para `groups.source`, com
`fallbackToIndependentRows: false`.

- Davison & Hinkley, *Bootstrap Methods and their Application*, CUP, 1997, § 3.8 — o bootstrap hierárquico
  reamostra no nível em que a dependência vive; um nível com um único valor não contribui variância.
  [link](https://doi.org/10.1017/CBO9780511802843)
- Field & Welsh, *Bootstrapping clustered data*, JRSS-B 69(3), 2007 — as variantes do bootstrap por
  conglomerado e o que cada uma assume sobre o número de conglomerados; com um conglomerado o
  procedimento não estima nada.
  [link](https://doi.org/10.1111/j.1467-9868.2007.00593.x)

**A transferência:** as fontes descrevem a inflação de variância que o nível captura. A decisão é a
consequência de publicação: uma tabela que nomeasse o nível degenerado se leria como se o limite publicado
tivesse contabilizado variação entre estratos que o desenho não sorteou. **Sem precedente encontrado
(2026-08-05)** para a regra de remover o nível do artefato publicado em vez de o declarar com um valor —
a razão é que a tabela é lida como declaração do desenho, e declarar um fator não variado **em silêncio**
é over-claim de desenho, não conservadorismo.

**A qualificação, e ela é necessária.** A regra não é "nenhum fator degenerado na tabela": é "nenhum fator
degenerado **sem a declaração de que é degenerado**". A mesma tabela carrega o caso contrário e ele fica:
`resampling.estimandClasses.mixed.levels[1]` nomeia `groups.promptTemplate` **com** `proxyFor` e
`proxyReason`, e o `proxyReason` diz por escrito que o fator "tem um único nível sobre as linhas mistas
montadas, logo este fator é degenerado por construção até um eixo de operação existir". As duas linhas
diferem no que o leitor pode concluir: `groups.domainSource` nomeado sem qualificação afirmaria variação
entre estratos que o sorteio não viu; `groups.promptTemplate` declarado como **proxy com a lacuna
nomeada** afirma o oposto — que o eixo que a classe precisaria não existe no esquema, e que o nível está
ali como marcador da lacuna. Remover essa linha esconderia a lacuna, que é o erro simétrico. O critério é
portanto **declaração**, não presença, e é isso que distingue os dois casos.

### N6 — derivação degenerada sob a política vigente é pinada num insumo NÃO degenerado, não removida

A decisão: quando a política congelada torna uma derivação uma **identidade** — `total = alvo × células`
com uma célula, `QUOTA_CELLS = cells(REGISTER)` com um registro de uma entrada —, o fator não sai do
código; ele ganha nome e é exercitado num insumo que a política vigente não oferece (duas e quatro
células, um registro de duas entradas). Sob a política vigente **toda derivação errada devolve a resposta
certa**, então nenhum corpus e nenhuma política admissível distinguem `alvo × células` de `alvo`.

É o **oposto** da regra que E-8 aplicou, e a diferença é qual coisa é inalcançável. Em E-8 o que nenhuma
entrada alcançava era a **comparação** — o ramo não decidia nada, e mantê-lo era publicar defesa que não
defende. Aqui o que a política vigente não alcança é um **valor do insumo**: a comparação decide (um total
errado é recusado), e é só o fator que fica sem exercício. Remover o fator não retira defesa morta — grava
no código a coincidência de que hoje há uma célula, que é a classe de erro que a emenda inteira existe
para desfazer.

- **DeMillo, Lipton & Sayward, *Hints on Test Data Selection*, IEEE Computer 11(4), 1978** — a hipótese do
  programador competente e o acoplamento: o mutante que nenhum dado de teste mata é ou equivalente ao
  original **sob os dados disponíveis** ou uma falha de cobertura, e a distinção é o que decide o remédio.
  [link](https://doi.org/10.1109/C-M.1978.218136)
- **Jia & Harman, *An Analysis and Survey of the Development of Mutation Testing*, IEEE TSE 37(5), 2011** —
  o problema do **mutante equivalente**: mutante indistinguível por qualquer entrada do domínio de teste
  vigente não é ruído a descartar, e ampliar o domínio é uma das duas saídas.
  [link](https://doi.org/10.1109/TSE.2010.62)

**A transferência:** as fontes tratam de equivalência de mutantes num domínio de teste; a decisão aqui é
qual das duas saídas se toma quando o domínio é uma **política congelada**. Ampliar o domínio significa
extrair a derivação para uma função pura e a exercitar fora da política — e não relaxar a política, que
seria afrouxar o próprio congelamento que o pré-registro existe para impor. **Sem precedente encontrado
(2026-08-05)** para a regra aplicada a um artefato de pré-registro: a literatura de mutação supõe que o
domínio de entrada é do testador, e aqui ele é congelado por decisão de publicação.

### N7 — valor MEDIDO publicado em documento é lido por teste, ou envelhece em silêncio

A decisão: o `evaluatorDigest` que `docs/ESTADO.md` § 5.6 publica passa a ser conferido contra a árvore
viva por teste nomeado, e a composição ratificada citada em comentário de módulo do bench passa a ser
conferida contra `RELEASE_CORPUS_POLICY.counts`. **Medido** nesta unidade: o digest publicado como medido
divergia do que a árvore hasheava (`b705f062…` publicado, `87d7a9a0…` medido) e a suíte inteira estava
verde; dois membros de `EVALUATOR_FILES` afirmavam a composição de 7.000 humanas com um bloco cego de
1.400 linhas — números que a mesma emenda acabara de mover para 4.000 e 800 — também com a suíte verde.

O argumento não é que prosa erra mais que código; é que **prosa não recomputa**. Um número medido escrito
num documento tem exatamente a validade do instante em que foi lido, e um comentário dentro de
`EVALUATOR_FILES` é pior: seus bytes decidem a identidade do avaliador enquanto nada os lê.

- **Knuth, *Literate Programming*, The Computer Journal 27(2), 1984** — programa e explicação como um só
  artefato; o corolário que interessa aqui é o inverso do usual: se a explicação é parte do artefato, ela
  precisa da mesma disciplina de verificação que o código.
  [link](https://doi.org/10.1093/comjnl/27.2.97)
- **Ratner et al., *Snorkel*, VLDB 11(3), 2017** — o padrão de tratar regra declarada como código
  executável e versionado, em vez de descrição, para que ela possa reprovar.
  [link](https://doi.org/10.14778/3157794.3157797)

**A transferência:** nenhuma das duas fontes trata de digest de código publicado em documento de estado.
O que se transfere é o princípio: declaração que decide algo tem de ser executável. **Sem precedente
encontrado (2026-08-05)** para o caso específico — um teste que lê o documento de estado do projeto e
reprova quando o número medido nele discorda da medição da árvore.

**Extensão da mesma regra, na revisão da W3 (2026-08-05).** A contagem de referências publicada em § 5.6
envelheceu uma **terceira** vez: 322, depois 349, contra 410 medidos na árvore ao encontrar o achado — e 413
depois das três referências que esta própria revisão acrescentou. Passou a ser lida pelo
mesmo mecanismo (`benchmark/tests/estado-counts.test.ts`), e a unidade acrescentou um achado que a regra
de N7 não previa: **declarar a regra de contagem não basta se a regra admite duas implementações
honestas.** "`[link]` seguido de URL entre parênteses" rende 372 aplicada por linha e 410 aplicada ao
arquivo inteiro, porque 38 rótulos de link atravessam a quebra de ~100 colunas. A regra registrada é agora
a ocorrência da junta `](` seguida de URL, contada no arquivo inteiro — a junta não pode atravessar quebra
sem deixar de ser link —, e o teste afirma a diferença entre as duas contagens com a fixture do rótulo
quebrado, para que ninguém "conserte" o contador de volta. Nenhuma referência nova: é N7 aplicada a outro
número, mais a observação de que a regra precisa ser executável e não só declarada.

---

## § O — as quatro sondas de dependência de tema (2026-08-07)

Nível 1, 2 e 3 da hierarquia. Cobre os quatro instrumentos que medem se o veredito do detector lê
**assunto** ou lê **estrutura**, e a leitura do resultado da família geradora reservada. Nenhum dos quatro
é hipótese da família certificadora: não decidem gate e não gastam alpha (ESTADO § 3.1), e há guarda que
recusa se algum deles entrar em `multiplicity.primaryFamily`.

### O1 — o que está ESTABELECIDO sobre co-ocorrência, e o que foi ESPECULADO

A hipótese que originou a unidade: o detector poderia aprender **implausibilidade de co-ocorrência** como
atalho — texto cuja combinação de entidades é improvável seria lido como IA. Perseguindo o argumento, ele
ficou mais fraco do que foi enunciado, e a separação entre o estabelecido e o especulado é parte do
registro (registro § "As quatro sondas de dependência de tema").

- **Devlin et al., *BERT*, NAACL 2019** — o objetivo de pré-treino é prever o token mascarado a partir do
  contexto, então as representações codificam estatística de co-ocorrência **por construção**. Isto é
  arquitetura, não especulação. [link](https://doi.org/10.18653/v1/N19-1423)
- **Salazar et al., *Masked Language Model Scoring*, ACL 2020** — o método padrão para ler SURPRESA de um
  MLM é a **pseudo-perplexidade**: mascarar cada token por vez e somar as log-verossimilhanças
  condicionais. É o instrumento que mediria implausibilidade de co-ocorrência, e o classificador deste
  projeto **não o calcula** — a cabeça lê uma representação agrupada. Que a representação agrupada exponha
  essa surpresa de forma utilizável pela cabeça é a parte ESPECULADA, e nenhuma das duas fontes acima a
  sustenta. [link](https://doi.org/10.18653/v1/2020.acl-main.240)
- **Ji et al., *Survey of Hallucination in Natural Language Generation*, ACM CSUR 55(12), 2023** — a
  confabulação factual concentra-se em modelos menores e em domínios de cauda longa; prosa enciclopédica
  curta sobre tópico conhecido é o caso fácil. É por isso que o gradiente é fino nas famílias de treino,
  que são modelos de fronteira, e grosso na família reservada, que é um modelo pequeno.
  [link](https://doi.org/10.1145/3571730)

**O que sobrevive da hipótese:** o pareamento da geração controla o **assunto** (a linha de IA responde ao
título da seção humana), não a **correção**. Dentro de um par de tópico idêntico, uma entidade inventada
ainda diferencia. **O que se dissolve:** que isso seja um atalho aprendível no treino — as famílias de
treino raramente confabulam neste gênero, e a confabulação pesada vive na família reservada, que é só
teste e portanto não ensina nada ao modelo; ela apenas infla a leitura do resultado OOD, que é o assunto
de O4.

### O2 — mascaramento de entidades: perturbação de entrada como ablação sem retreino

A decisão: a política sela a receita de treino e proíbe ablação; ela não diz nada sobre a **entrada**.
Substituir as entidades nomeadas, datas e numerais por um marcador e re-pontuar com **os mesmos pesos**
responde "o escore é carregado pelas entidades?" sem tocar no treino.

- **Ribeiro et al., *Why Should I Trust You?* (LIME), KDD 2016** — explicação por perturbação da entrada
  e re-inferência, com o modelo fixo: é a família de método à qual o mascaramento pertence.
  [link](https://doi.org/10.1145/2939672.2939778)
- **Kaushik, Hovy & Lipton, *Learning the Difference that Makes a Difference with
  Counterfactually-Augmented Data*, ICLR 2020** — intervir no texto e medir a mudança de predição é o modo
  de separar o sinal causal do artefato correlacionado. [link](https://openreview.net/forum?id=Sklgs0NFvr)
- **Sinha et al., *UnNatural Language Inference*, ACL 2021** — o controle importa: modelos mantêm o
  veredito sob perturbações que deveriam destruí-lo, então uma perturbação sem braço de controle não
  distingue "o sinal sobreviveu" de "o modelo é insensível a qualquer perturbação".
  [link](https://doi.org/10.18653/v1/2021.acl-long.569)
- **Ribeiro et al., *Beyond Accuracy: Behavioral Testing of NLP Models with CheckList*, ACL 2020** — teste
  de invariância: uma perturbação que **não deveria** mudar a saída é uma asserção, e é exatamente a forma
  do braço placebo. [link](https://doi.org/10.18653/v1/2020.acl-main.442)

**A transferência, e o que ela obriga:** LIME perturba para explicar UMA predição; aqui a perturbação é
sistemática e a quantidade lida é a **diferença de duas perturbações** — o braço de entidades contra um
braço **placebo** que remove a mesma quantidade de palavras comuns minúsculas, com a mesma contagem de
vãos e o mesmo multiconjunto de comprimentos de vão. Sem o placebo, um deslocamento de escore é atribuível
ao marcador `[MASK]`, que a cabeça ajustada nunca viu, e não à identidade das entidades.
**Sem precedente encontrado (2026-08-07)** para o braço placebo casado por comprimento de vão em
detecção de texto gerado, nem para o critério de colapso: `excesso de queda média >= 0,10` **ou**
`excesso de taxa de virada de veredito >= 0,20`, medidos na classe `ai`. Os dois números são declarados, e
o piso que eles têm de superar é medido — o relatório de paridade do export int8 que ancora o teto de
bytes aceita `maxAbsDelta` 0,008950 e **zero** viradas em 120 amostras, então 0,10 é onze vezes o maior
delta que o gate de paridade tolera e não pode ser quantização.

**A recall do achador de entidades é declarada, não assumida.** O achador é heurístico (maiúscula em meio
de frase, siglas, numerais, datas), e um capital que só abre frase é indistinguível de substantivo próprio
por caixa — recuperado quando a mesma forma aparece capitalizada no meio de outra frase do mesmo
documento, e não recuperado quando não aparece. Isso é um **sub-mascaramento**, e sub-mascarar só pode
empurrar o veredito para `survives`: o veredito `collapses` é o forte, e o `survives` é limitado pela
fração de palavras efetivamente mascarada, que o relatório publica ao lado dele.

### O3 — o piso cego a tema são as palavras funcionais, e SÓ elas

A decisão: um modelo deliberadamente incapaz de ler assunto — TF-IDF sobre **somente palavras funcionais**,
uma classe gramatical fechada — estabelece o **piso** do sinal independente de tema. A diferença até o modelo
grande é o **máximo** que poderia ser temático. Não prova que a diferença é temática: limita.

**A primeira versão desta entrada estava errada, e a medição é a correção.** Escreveu-se que o piso era
"estilometria mais TF-IDF de somente palavras funcionais, com palavras de conteúdo estruturalmente barradas".
Medido sobre 253 pares pareados por tópico (docs/ESTADO.md § 5.8): a **união** dos dois ramos chega a 0,9767
e o ramo **estilométrico sozinho** a 0,9712, ou 98,8 % da separação acima do acaso da união; sete das 19
features de `probes.STYLOMETRIC_FEATURES` são funções das palavras de conteúdo (`type-token-ratio`, `mtld`,
`trigram-repetition`, `hapax-rate`, `long-word-rate`, `word-length-mean`, `flesch-pt`) e a matriz
estilométrica recebe o texto **inteiro**. "Estruturalmente barradas" era falso da união. O piso que este
verbete decide é o ramo `funcionais` e nada mais, com **0,9313** medido — logo **abaixo** de palavra (0,9327)
e de caractere (0,9319), e não acima delas. A união continua publicada, sob o nome
`funcionais+estilometria` e com o papel de **piso barato** do verbete O4, onde ser cega a tema nunca foi
exigência: o que aquele critério quer é o máximo que um modelo burro alcança.

- **Mosteller & Wallace, *Inference in an Authorship Problem*, JASA 58(302), 1963** — atribuíram os
  *Federalist Papers* disputados usando **só palavras funcionais**, precisamente porque palavras
  funcionais são independentes de tema. É o precedente canônico de "estrutura vale, conteúdo não vale".
  [link](https://doi.org/10.1080/01621459.1963.10500849)
- **Burrows, *Delta: a Measure of Stylistic Difference and a Guide to Likely Authorship*, LLC 17(3),
  2002** — a prática moderna de atribuição usa as palavras **mais frequentes** (largamente funcionais)
  como espaço de atributos, pela mesma razão. [link](https://doi.org/10.1093/llc/17.3.267)
- **Kestemont, *Function Words in Authorship Attribution: From Black Magic to Theory?*, CLfL 2014** — a
  justificativa linguística explícita: palavras funcionais são de alta frequência, de escolha inconsciente
  e **independentes de tópico**. [link](https://aclanthology.org/W14-0908/)
- **Stamatatos, *A Survey of Modern Authorship Attribution Methods*, JASIST 60(3), 2009, § 2.2** — a
  taxonomia dos atributos e a razão de os lexicais de função e os de caractere serem preferidos aos de
  conteúdo quando o tema varia entre as classes. [link](https://doi.org/10.1002/asi.21001)

**A lista de palavras funcionais do português: sem fonte citável.** **Sem precedente encontrado
(2026-08-07)** para uma lista de palavras funcionais de pt-BR publicada e citável que sirva de referência.
A lista usada é a que a sonda estilométrica já mantinha (`diagnostic_probes.FUNCTION_WORDS`, lida e não
copiada), e o critério está escrito: é uma **classe gramatical fechada** — artigos, preposições,
contrações, conjunções, pronomes, auxiliares de alta frequência e cinco advérbios — e **não** um corte de
frequência, porque um corte de frequência precisa de um corpus de referência que esta bancada não baixa. O
critério deixou de ser só uma frase: as 120 palavras estão enumeradas **sob a classe que admite cada uma** em
`baseline_tfidf.DECLARED_FUNCTION_WORD_CLASSES`, e a guarda é **igualdade de conjuntos** contra esse
inventário.

A igualdade de conjuntos substituiu uma lista negra, e a razão é medida. A guarda anterior comparava a lista
de funcionais contra 42 palavras de conteúdo medidas no domínio, e só contra elas: medido, `brasil` declarado
funcional passava pela guarda de construção **e** pela guarda pós-`fit` — esta última porque compara o modelo
ajustado contra a mesma lista já contaminada — e chegava ao vocabulário. Não existe teste computável de
"conteúdo"; existe inventário de classe fechada, e é isso que a guarda afirma agora, nas duas direções
(admissão e **remoção**: uma lista que perdeu `a`, `e` e `o` é outra medição sob o mesmo nome). As 42 palavras
de conteúdo continuam no módulo, com o papel de **nomear a falha** na mensagem de erro. A segunda guarda
segue recusando um modelo **ajustado** cujos atributos não sejam subconjunto da lista fechada — a forma exata
que um `vocabulary=` removido assume.

**A armadilha do `token_pattern`, medida.** O default do sklearn é `(?u)\b\w\w+\b` e descarta todo token
de menos de dois caracteres. Cinco entradas da lista fechada têm um caractere — `a`, `e`, `o`, `à`, `é` —, ou
seja as três palavras mais frequentes do português e exactamente o material que Mosteller & Wallace contam:
sob o default elas ficavam no vocabulário com massa **zero permanente**, e nenhum teste podia notar porque a
única fixture do instrumento não tinha palavra funcional nenhuma (matriz de zeros 40×120). Custo medido do
default: o ramo lia 0,8944 em vez de 0,9313, 0,041 de AUC perdidos em silêncio. `token_pattern` fixado em
`(?u)\b\w+\b`, e um teste afirma que **toda** entrada da lista é alcançável pelo analisador e que as cinco
de um caractere carregam massa positiva num texto que as contém.

Unigrama e não bigrama: um bigrama de palavras funcionais exigiria o produto cruzado da lista fechada como
vocabulário explícito, e o desenho de Mosteller & Wallace conta palavras funcionais isoladas.

### O4 — a família reservada pode ser FÁCIL, e o critério de aceitação lê um número

A decisão: a família reservada ao teste de gerador não visto é um modelo pequeno de pesos abertos, e há
medição própria mostrando que ele escreve prosa fluente e **factualmente errada**. Isso não invalida o
rótulo — torna a fatia OOD **mais fácil** que as famílias de treino, e uma fatia mais fácil infla o número
de generalização na direção lisonjeira. O instrumento é o piso **barato** (`funcionais+estilometria`,
o mais forte dos baselines burros e cego a nada) rodado contra a reservada e contra as *core*, comparado
com o modelo grande sobre os mesmos textos e sempre contra os **pais pareados** do lado humano.

- **Torralba & Efros, *Unbiased Look at Dataset Bias*, CVPR 2011** — desempenho alto que não transfere é
  propriedade do conjunto e não do modelo; medir um baseline burro no mesmo conjunto é como se lê isso.
  [link](https://doi.org/10.1109/CVPR.2011.5995347)
- **Gururangan et al., *Annotation Artifacts in Natural Language Inference Data*, NAACL 2018** — um modelo
  que vê **só** parte da entrada e ainda acerta mede artefato do conjunto; é o mesmo raciocínio do
  baseline lexical contra a fatia reservada. [link](https://doi.org/10.18653/v1/N18-2017)
- **Poliak et al., *Hypothesis Only Baselines in Natural Language Inference*, SEM 2018** — a prática de
  publicar o baseline degenerado ao lado do resultado, para que o leitor saiba quanto do número é
  facilidade. [link](https://doi.org/10.18653/v1/S18-2023)
- **Mitchell et al., *Model Cards for Model Reporting*, FAT\* 2019** — a exigência de declarar as
  condições em que o número vale; é onde o "limite otimista" da fatia reservada é publicado.
  [link](https://doi.org/10.1145/3287560.3287596)

**A transferência e os três números declarados.** A literatura publica o baseline degenerado ao lado do
resultado; aqui o baseline degenerado é o piso **barato** e a quantidade é adimensional de propósito:
`lift(família) = (AUC_piso − 0,5) / (AUC_detector − 0,5)`, a fração da separação acima do acaso que um
modelo burro já alcança. **Sem precedente encontrado (2026-08-07)** para essa razão como critério de
aceitação de família reservada, nem para os três números que a governam:

- `margem = 0,10` — a reservada mede FACILIDADE quando o excesso de *lift* dela sobre as *core* alcança um
  décimo da escala;
- `folga = 0,10` — se as *core* já entregam mais de 90 % do *lift* ao piso, o excesso é pequeno **por
  construção** e a comparação não resolve nada. O terceiro veredito é **abstenção**, e a asserção de
  aceitação recusa a abstenção exatamente como recusa a facilidade: uma comparação irresolúvel lida como
  aceitação é o fail-open que esta regra fecha. A necessidade dela é **medida** — sobre os pools do piloto
  o piso barato chegou a 0,9830 nas *core*, contra detector de 0,9898, o que
  põe o *lift* das *core* em 0,9861 e o excesso em 0,0070: não poderia ter sido outro número;
- `piso de separação = 0,51` — abaixo dele o detector está no acaso na família e a razão não tem
  denominador; a função **recusa** em vez de devolver um *lift* enorme, que seria fail-open.

### O5 — `topic` como eixo de FATIA e nunca de UNIÃO

A decisão: `topic` é campo obrigatório de todo registro desde o esquema v2 e nada o lia. Ele passa a ser
eixo de **fatia** — FPR e recall por tópico, como diagnóstico — e **não** entra em `GROUP_KEYS`.

- **Sagawa et al., *Distributionally Robust Neural Networks for Group Shifts*, ICLR 2020** — a taxa média
  esconde o pior grupo; reportar por grupo é a condição de saber se a taxa transfere.
  [link](https://openreview.net/forum?id=ryxGuJrFvS)
- **Barocas, Guo et al., *Designing Disaggregated Evaluations of AI Systems*, AIES 2021** — a avaliação
  desagregada é uma decisão de desenho com custos, entre eles a multiplicidade que ela cria: por isso o
  eixo é diagnóstico e não gate. [link](https://doi.org/10.1145/3461702.3462610)
- Kish, *Survey Sampling*, 1965, cap. 5 (já citado em § N1) — a razão de `topic` NÃO ser eixo de união:
  conglomerado temático é grande, e unir por ele traz de volta a degenerescência de poucos blocos grandes
  que a emenda da moldura resolveu.

**Sem precedente encontrado (2026-08-07)** para a regra propriamente dita — que um eixo derivável de uma
escolha de agrupamento pode ser eixo de **relato** mas não de **união selada**, porque congelar um eixo de
união que depende de um *clustering* põe uma decisão de modelagem dentro da política. É decisão de
engenharia ancorada em Kish (custo estatístico) e em Barocas & Guo (o custo de desagregar).

---

## § P — o corte pré-inscrito DECIDE, e o perfil servido carrega o mesmo corte (2026-08-10)

Unidade R1. Três decisões metodológicas, todas sobre a mesma pergunta: **qual número é cortado** numa
versão que declarou não ter calibrador probabilístico.

### P1 — quantil unilateral de escore CRU como corte publicado, sem calibração probabilística

A decisão: o corte da v1 é o quantil 0,95 superior de `document-raw-score` sobre os negativos humanos de
`dev` + `cal-A` (`provisional-v1`), e é ele que **decide** a medição certificadora. Nenhum calibrador
participa: `MEASURED_CALIBRATION_SCORE_BASIS` passa a ser lido de `calibrationGate.scoreBasis`, e o
ECE-15 do gate global mede a mesma quantidade que o corte corta.

- **Lei, Robins, Wasserman, *Distribution-Free Prediction Sets*, JASA 2013** — o limiar por estatística de
  ordem sobre uma amostra de troca (aqui, os negativos humanos reservados ao ajuste) controla a taxa do
  lado escolhido **sem** modelo de probabilidade: a garantia é de cobertura marginal e não exige que o
  escore seja probabilidade. É o precedente exato de cortar sobre escore cru.
  [link](https://doi.org/10.1080/01621459.2012.751873)
- **Vovk, Gammerman, Shafer, *Algorithmic Learning in a Random World*, 2005, cap. 2** — a mesma leitura na
  forma conformal: o escore é um *nonconformity measure* qualquer, monotônico ou não calibrado, e o quantil
  empírico é o que carrega a garantia. Justifica por que a ausência de calibrador **não** enfraquece o
  corte. [link](https://doi.org/10.1007/b106715)
- **Guo, Pleiss, Sun, Weinberger, *On Calibration of Modern Neural Networks*, ICML 2017** — a direção
  contrária, e é por isso que ela entra: um softmax de rede moderna é tipicamente **mal calibrado**, então
  chamar o escore cru de probabilidade seria falso. Limitar o ECE dele é medir o desvio, não conferir-lhe
  semântica probabilística — o que é exatamente o que o gate faz e o que a política proíbe descrever de
  outro modo. [link](https://proceedings.mlr.press/v70/guo17a.html)
- **Kull, Silva Filho, Flach, *Beta calibration*, AISTATS 2017** e **Zadrozny & Elkan, *Transforming
  classifier scores into accurate multiclass probability estimates*, KDD 2002** — as duas famílias que o
  `fit` continua ajustando e **selando como diagnóstico** reservado à v2 (`calibrator.reservedFor`). Ficam
  citadas aqui para registrar que a decisão é de **não usá-las na decisão**, não de descartá-las.
  [link](https://proceedings.mlr.press/v54/kull17a.html) ·
  [link](https://doi.org/10.1145/775047.775151)

### P2 — a identidade é um kind EXPLÍCITO do contrato, e não um calibrador parametrizado para não fazer nada

A decisão: `SerializedCalibratorV1` ganha `{ kind: "identity" }`, e é ele que um release sob
`threshold.probabilisticCalibrator: "none"` publica. A união admitia `platt`, `beta` e `isotonic`, e
**nenhum** dos três é a identidade: um platt de inclinação 1 e intercepto 0 é uma sigmoide, não uma
passagem direta. Um isotônico de dois nós `(0,0)`–`(1,1)` seria numericamente a identidade e foi recusado
como forma de dizê-lo — semântica embutida em parâmetros é a que ninguém encontra ao reler.

**Sem precedente na literatura (2026-08-10)** para esta escolha: é decisão de desenho de contrato, e a
razão é medível em vez de estética. Sem um kind próprio, a única maneira de o perfil servido cortar o
escore cru seria confiar em que ninguém publicaria outro calibrador, e
`assertServedCutIsTheMeasuredCut` não teria o que afirmar por igualdade. O precedente **de forma** é a
prática de tipos-soma fechados com um caso neutro nomeado (a *null object* de Woolf, *Pattern Languages of
Program Design 3*, 1997, cap. 1), aplicada a um artefato serializado em vez de a um objeto.

### P3 — o corte MEDIDO e o corte ENTREGUE mudam no mesmo commit, e a igualdade é imposta

A decisão: `profile-artifact.ts` publica `documentIndicator` = limiar pré-inscrito atrás de calibradores
`identity`, e `assertServedCutIsTheMeasuredCut` **recusa** um perfil cujo calibrador não seja a identidade
ou cujo limiar não seja o medido. `localizedIndicator` e `documentAction` ficam desabilitados em 1: a v1
pré-inscreve **um** corte sobre **uma** base, e um gatilho servido que a medição não contou entrega decisão
acima da medida.

- **Sculley et al., *Hidden Technical Debt in Machine Learning Systems*, NIPS 2015** — nomeia
  `training/serving skew` como dívida estrutural e não como bug: o consumidor que aplica uma
  transformação que o avaliador não aplicou produz divergência **silenciosa**, porque as duas metades
  continuam devolvendo números. É a razão de as duas metades mudarem no mesmo commit e de a igualdade ser
  afirmada por guarda em vez de por convenção.
  [link](https://papers.nips.cc/paper/2015/hash/86df7dcfd896fcaf2674f757a2463eba-Abstract.html)
- **Breck, Cai, Nielsen, Salib, Sculley, *The ML Test Score*, IEEE BigData 2017**, teste
  *Infra 3* — "training and serving features compute the same values": aqui na forma mais estreita
  possível, que é o limiar e o transformador do escore.
  [link](https://doi.org/10.1109/BigData.2017.8258038)
- **Gebru et al., *Datasheets for Datasets*, CACM 2021** e **Mitchell et al., *Model Cards*, FAT* 2019** —
  o corte com valor, base, quantil, população e digest passa a sair no `fit-summary.json` do bundle
  público, porque um pacote que nomeia a *origem* do limiar e não o limiar não é verificável contra a
  política que declara seguir. [link](https://doi.org/10.1145/3458723) ·
  [link](https://doi.org/10.1145/3287560.3287596)

**Sem precedente encontrado** para a leitura de que **meia troca é pior que nenhuma** — escore cru sob corte
calibrado, ou corte cru sob perfil calibrado, sendo estritamente pior que manter as duas pontas calibradas.
É consequência direta de Sculley et al. aplicada a este pipeline: os dois estados inconsistentes falham em
silêncio, e o estado consistente-mas-errado falha no gate.

### P4 — a base sobre a qual a estatística foi medida é DERIVADA dos números, não declarada ao lado deles

A decisão (2026-08-10, ao consertar a cross-review de R1): `measuredCalibrationScoreBasis(cut, rows)`
devolve a base do corte apenas quando **todo** item pontuado carrega `documentScore ===
prediction.documentRawScore`, e `document-calibrated-score` caso contrário. A versão anterior desta
unidade declarava a base numa constante lida da própria política que o gate compara contra ela — o que
tornou `score-basis-mismatch` uma tautologia `X === X`.

- **Sculley et al., 2015** (citado em P3) — a mesma dívida vista pelo outro lado: o *metadado
  autodeclarado* é o que permite ao pipeline afirmar uma propriedade que ele não tem. Um campo de
  proveniência preenchido por quem produziu o número não é evidência sobre o número.
- **Breck et al., 2017**, teste *Monitor 2* — "training/serving skew não é detectável por um monitor que lê
  a mesma fonte que o produtor": o detector precisa de uma segunda origem, e aqui a segunda origem são os
  próprios escores comparados byte a byte.

**Sem precedente na literatura (2026-08-10)** para a formulação exata: derivar o rótulo de proveniência de
uma estatística a partir de uma verificação de igualdade sobre a amostra que a produziu. O precedente **de
forma** é *parse, don't validate* (Alexis King, 2019) — a informação sobre o dado é obtida ao atravessá-lo,
não afirmada sobre ele. [link](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)

### P5 — "desligado" é uma comparação, não uma convenção sobre um valor

A decisão: `thresholdFires(score, threshold)` = `threshold < 1 && score >= threshold`, e o contrato exporta
`DISABLED_THRESHOLD = 1`. O contrato já codificava desligado com 1 (`parseProfile` exige
`documentAction === 1` de toda release `indicator-only`), mas o runtime comparava `score >= 1` — e 1,0 é
**entrada alcançável**: o escore localizado é o máximo sobre softmaxes de janela, e um softmax saturado é
exatamente 1,0 em ponto flutuante. Logo o gatilho "desabilitado" disparava.

- **Goldberg, *What Every Computer Scientist Should Know About Floating-Point Arithmetic*, ACM Computing
  Surveys 1991** — a razão de o caso não ser hipotético: a saturação de uma exponencial normalizada atinge
  o extremo do intervalo exatamente, e não "quase". Um raciocínio que trate 1,0 como inalcançável está
  errado sobre a aritmética, não sobre a probabilidade.
  [link](https://doi.org/10.1145/103162.103163)
- **Hoare, *Null References: The Billion Dollar Mistake*, QCon 2009** — a leitura clássica de por que um
  valor do domínio usado como sentinela custa: o consumidor tem de saber da convenção para não a violar. A
  decisão aqui é a mais barata das duas saídas — honrar a convenção **no comparador**, que é um sítio, em
  vez de introduzir uma segunda codificação (`null`) enquanto a primeira segue pinada no parser — e o custo
  residual é nomeado por código: `PROFILE_CUT_AT_DISABLED_SENTINEL` recusa um corte medido cujo valor seja
  1, porque servi-lo entregaria um gatilho que nunca dispara.
  [link](https://www.infoq.com/presentations/Null-References-The-Billion-Dollar-Mistake-Tony-Hoare/)
## § Q — o export publica só depois de todas as guardas, e paridade não é validade (2026-08-10)

Unidade R2. Cinco decisões metodológicas sobre o passo do **operador** (Colab, Fase 4): o que um artefato
tem de provar sobre si mesmo antes de ser publicado, e o que nenhuma dessas provas alcança.

### Q1 — variância de escore nula RECUSA a paridade, em vez de a aprovar

A decisão: o gate de paridade passa a recusar quando a dispersão do escore sobre a amostra **não supera a
própria tolerância** dos deltas (0,02). A dispersão é o **intervalo interquartil**, a amostra é sorteada com
metade de cada classe, e o relatório publica os dois interquartis, as duas amplitudes e a composição da
amostra.

A razão é medida (ESTADO § 5.9): um checkpoint da forma selada com cabeça de duas classes **zerada**
devolve logitos exatamente `[0,0]` para todo texto, os dois lados calculam `P(ai) = 0,5`,
`meanAbsDelta = 0`, `maxAbsDelta = 0`, zero inversões — e o veredito anterior era `pass: true`. A leitura
que organiza o conserto: **paridade é verificação de autoconsistência, não de validade, e um modelo
degenerado a MAXIMIZA**. "Os deltas ficam abaixo de 0,02" só fala de quantização quando os escores variam
mais que 0,02; abaixo disso todo modelo constante satisfaz a desigualdade.

- **Chen, Cheung & Yiu, _Metamorphic Testing: A New Approach for Generating Next Test Cases_,
  HKUST-CS98-01 (1998)** — a paridade fp32↔int8 é exatamente uma **relação metamórfica**: mesma entrada,
  duas implementações, saída que deve coincidir. O que a literatura de teste metamórfico registra e que
  aqui morde: uma relação de igualdade entre duas execuções é satisfeita **trivialmente** por qualquer
  função constante, então a relação sozinha não distingue implementação correta de implementação vazia.
  [link](https://arxiv.org/abs/2002.12543)
- **Segura, Fraser, Sánchez & Ruiz-Cortés, _A Survey on Metamorphic Testing_, IEEE TSE 42(9), 2016** — a
  sistematização do mesmo ponto: a força de uma relação metamórfica depende de ela ser **violável** pelo
  defeito que se quer pegar. Uma relação que o defeito satisfaz melhor que o comportamento correto é um
  teste com o sinal invertido. [link](https://doi.org/10.1109/TSE.2016.2532875)
- **Adebayo, Gilmer, Muelly, Goodfellow, Hardt & Kim, _Sanity Checks for Saliency Maps_, NeurIPS 2018** —
  o precedente mais próximo em ML, e é um precedente de **método**: a maneira de descobrir que uma
  verificação não verifica nada é rodá-la contra um modelo de **pesos aleatórios** e ver se ela passa. Foi
  literalmente o que esta unidade fez com a paridade, e é o ensaio que ESTADO § 5.9 registra.
  [link](https://arxiv.org/abs/1810.03292)

- **Rousseeuw & Croux, _Alternatives to the Median Absolute Deviation_, JASA 88(424):1273–1283, 1993** — por
  que a estatística do piso é interquartil e não amplitude. A amplitude tem ponto de ruptura **zero**: uma
  observação a move sozinha. Medido aqui (ESTADO § 5.9b): 119 escores em 0,5 e um em 0,9 dão amplitude 0,4 e
  passavam pelo piso com `meanAbsDelta` 0 — um detector constante em 119 de 120 casos.
  [link](https://doi.org/10.1080/01621459.1993.10476408)
- **Fawcett, _An introduction to ROC analysis_, Pattern Recognition Letters 27(8), 2006** — por que a
  composição da amostra é parte da decisão e não detalhe de amostragem: uma estatística resumo sobre escores
  de classificador só é legível contra a distribuição de classes da amostra que a produziu. Medido:
  `dev.jsonl` é agrupado e as 120 primeiras linhas são de uma classe, sobre a qual um detector confiante é tão
  achatado quanto um constante. [link](https://doi.org/10.1016/j.patrec.2005.10.010)

**Sem precedente encontrado** para a forma exata do conserto — um **piso de dispersão de escore** ancorado
na própria tolerância do gate, de modo que a afirmação "os deltas são pequenos" não possa ser satisfeita
por uma faixa de escore menor que os deltas admitidos. A ancoragem existe para não introduzir constante
nova: qualquer piso escolhido à parte seria número que alguém pode mover depois de ver o resultado. Pela
mesma razão a amostra é **exatamente** metade de cada classe: qualquer fração mínima de minoria seria a
constante nova entrando pela porta da amostragem.

### Q2 — a cabeça de classificação é LIDA do artefato, e nada disso prova treino

A decisão: o export exige `architectures == ["BertForSequenceClassification"]`, contrato binário de labels
(`num_labels`/`id2label`, na ordem selada `{0: human, 1: ai}`) e **ausência de `classifier.*`** em
`missing_keys`/`mismatched_keys` do carregamento.

A armadilha de biblioteca que isso fecha está medida (ESTADO § 5.9) e o próprio repositório já a
documentava em `benchmark/lab/score_pilot_local.py`:
`AutoModelForSequenceClassification.from_pretrained` **carrega** um checkpoint sem cabeça, constrói o
classificador ao azar e apenas **avisa** — em `transformers` 5.14.1 o aviso é um `LOAD REPORT` com
`MISSING` e a nota "Consider training on your downstream task".

- **Torres-Arias, Awan, Cappos et al., _in-toto: Providing farm-to-table guarantees for bits and bytes_,
  USENIX Security 2019** — a razão de o conserto não bastar: garantir uma etapa da cadeia não garante a
  cadeia. Só um **recibo** que ligue cada passo (corpus → split → política → seed → hash dos pesos)
  sustenta a afirmação "estes pesos foram treinados neste corpus"; guardas locais sobre o artefato final
  não a alcançam por construção.
  [link](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias)
- **Mitchell et al., _Model Cards for Model Reporting_, FAT\* 2019** — o artefato publicado tem de declarar
  **em que** foi treinado e avaliado; um pacote cuja proveniência de treino não é verificável não é
  reportável nos termos do próprio model card.
  [link](https://doi.org/10.1145/3287560.3287596)
- **Sculley et al., _Hidden Technical Debt in Machine Learning Systems_, NIPS 2015** — a classe de falha:
  as duas metades continuam devolvendo números, então a divergência é silenciosa.
  [link](https://papers.nips.cc/paper/2015/hash/86df7dcfd896fcaf2674f757a2463eba-Abstract.html)

**Sem precedente encontrado** para ler `missing_keys`/`mismatched_keys` do carregador como **guarda de
publicação**. É uso de um diagnóstico de biblioteca como condição de aceitação do artefato, e a dívida que
ele não paga fica escrita: a prova completa é o recibo F6 (ESTADO § 7, primeira linha).

### Q3 — nada é escrito no caminho canônico antes de todas as guardas aceitarem

A decisão: o bundle inteiro é montado em `<out>.staging`, todas as guardas rodam lá, e diretório e ZIP são
**promovidos** depois; a publicação anterior é removida no começo da corrida.

Medido antes do conserto: teto reprovado deixava `out/onnx/` vazio; `vocab.txt` ausente deixava
`model_int8.onnx` e artefatos parciais; grafo ou tokenizer reprovados deixavam ONNX e bundle no caminho
final; paridade reprovada deixava `parity_report.json` com `pass: false`. E numa segunda corrida sobre a
mesma saída, **qualquer** recusa preservava o ZIP aprovado da corrida anterior ao lado do diretório
rejeitado — porque `zipfile.ZipFile(..., "w")` só trunca se a execução chegar até ele.

- **Pillai, Chidambaram, Alagappan, Al-Kiswany, Arpaci-Dusseau & Arpaci-Dusseau, _All File Systems Are Not
  Created Equal: On the Complexity of Crafting Crash-Consistent Applications_, OSDI 2014** — o precedente
  de forma: a aplicação que escreve no lugar final e conserta depois deixa estados intermediários
  observáveis por quem lê; a disciplina que funciona é escrever fora e **renomear**, porque a troca é o
  único passo que o leitor não vê pela metade.
  [link](https://www.usenix.org/conference/osdi14/technical-sessions/presentation/pillai)
- **Saltzer & Schroeder, 1975 — The Protection of Information in Computer Systems**, princípio de
  _fail-safe defaults_ — o estado sem artefato é o estado seguro. Apagar a publicação anterior no começo é
  a direção fail-**closed**: preferir não ter nada a ter um ZIP aprovado que se apresenta como produto de
  uma corrida que reprovou. [link](https://doi.org/10.1109/PROC.1975.9939)

- **Saltzer & Schroeder, 1975**, princípio de _least privilege_ — a segunda metade da mesma decisão, e a que a
  revisão obrigou a escrever: apagar no começo é fail-closed **só** se o que pode ser apagado for estreito. A
  primeira versão reconhecia como publicação anterior qualquer diretório com **um** dos sete arquivos do
  bundle, e cinco desses nomes são o que `save_pretrained` deixa num checkpoint — medido, `--out
  bertimbau/best` apagava os pesos treinados antes de qualquer guarda, num caminho destrutivo que o código
  anterior não tinha. O privilégio de remover passou a exigir os **dois** marcadores que só este exportador
  escreve, e arquivo de checkpoint recusa a remoção nomeando o arquivo. [link](https://doi.org/10.1109/PROC.1975.9939)

**Sem precedente encontrado** para a leitura de que **preservar** a saída anterior é o risco, e não a
proteção. Ela é consequência de o consumidor ser humano: o operador baixa o ZIP do diretório de saída, e um
ZIP que sobrevive a uma recusa não carrega nada que diga de qual corrida veio. O custo — perder um artefato
aprovado ao rodar de novo — está declarado no README e é o lado barato: reexportar é determinístico. **Sem
precedente encontrado**, também, para o predicado de remoção ser escrito sobre os arquivos que o **próprio
produtor** escreve em vez de sobre os que ele espera encontrar: é o que separa "isto é uma publicação minha
anterior" de "isto tem a forma do que eu produzo".

### Q4 — a política selada passa por um parser fechado no lab, e o recibo diz qual arquivo governou

A decisão: `benchmark/lab/sealed_policy.py` é o **único** leitor da pré-inscrição do lado Python; ele pina
`policyVersion`, pina o **`sha256` do arquivo**, exige os quatro valores que o lab consome (`backbone`,
`backboneBakeOff`, `seeds.publishableCheckpoint`, `onnxMaximumInt8Bytes`), recusa nomeando campo, path e
digest, e devolve de qual dos três caminhos o arquivo veio. Os dois recibos (`metrics.json`,
`parity_report.json`) gravam path, digest e origem.

`json.loads` **não é parse**: todo objeto JSON o satisfaz. Medido: `benchmark/rebuild-v3-policy.json` está
na árvore, tem `backbone` e `onnxMaximumInt8Bytes`, e era aceito como política selada pelo leitor anterior.

- **Alexis King, _Parse, Don't Validate_ (2019)** — a informação sobre o dado é obtida ao **atravessá-lo**:
  o leitor devolve os quatro valores tipados ou recusa, e não existe caminho em que um consumidor leia um
  campo que ninguém conferiu.
  [link](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)
- **Nosek, Ebersole, DeHaven & Mellor, 2018 — The preregistration revolution** (PNAS 115(11)) — por que a
  identidade do arquivo é a questão e não só a sua forma: uma pré-inscrição vale pelo compromisso feito
  **antes**, então um artefato produzido sob uma cópia editada à mão é um artefato sem pré-inscrição, e o
  recibo é o que torna essa diferença observável depois.
  [link](https://doi.org/10.1073/pnas.1708274114)
- **Torres-Arias et al., in-toto, 2019** (citado em Q2) — registrar **qual** política governou o passo é o
  elo mínimo da cadeia que o passo do operador pode produzir sozinho.

- **Merkle, 1988** (citado em Q5) — a razão de o digest ser o que identifica o arquivo e não a versão que ele
  declara. Medido: `policyVersion` **não se move** quando a pré-inscrição é emendada (quatro emendas até
  aqui), então uma cópia com a versão selada, `seeds.publishableCheckpoint: 42` e teto 340 000 000 satisfazia
  toda conferência de campo e era aceita pelos dois scripts — a guarda de seed comparando 42 com 42.
  [link](https://doi.org/10.1007/3-540-48184-2_32)

**Sem precedente encontrado** para o marcador de origem da política (`policyOrigin`): declarar, dentro do
artefato, de qual dos três caminhos a autoridade que o governou foi lida. É consequência de o Colab não ter
checkout — o fallback é necessário, e a alternativa a registrá-lo é não saber. O marcador tem **três** estados
porque o booleano anterior mentia por omissão: ele dizia `false` tanto para o arquivo rastreado quanto para um
path passado à mão e para uma cópia "um nível acima" fora de checkout (medido nas duas conferências do T5).
O marcador diz **onde**; quem diz **o quê** é o digest.

**Sem precedente encontrado** para a regra de manutenção que o pino cria: emendar a pré-inscrição obriga a
reescrever o literal do digest no mesmo commit, e um teste do lab compara os dois e reprova até que isso
aconteça. É deliberado — um pino que se ajustasse sozinho ao arquivo que verifica não seria pino, e é o mesmo
raciocínio do pino triplo da forma do backbone (Q5).

### Q5 — a forma comparada vem da testemunha rastreada, e o vocabulário é o ARQUIVO

A decisão: `BACKBONE_CONFIG_SHAPE` passa a comparar **oito** campos de `config.json` — a forma completa que
a testemunha declara — e o export confere o **arquivo** `vocab.txt`, no checkpoint e no bundle, contra o
`vocab_size` selado. O pino do lado do teste deixa de ser derivado do próprio dicionário: ele é a
testemunha `public/models/cleanfeed-ptbr-v1/config.json`, cujo `sha256` os dois descritores rastreados
declaram.

Medido pela revisão: os quatro campos anteriores (`model_type`, `vocab_size`, `hidden_size`,
`num_hidden_layers`) **não identificam** o modelo — um BERT 12×768 de vocabulário 29 794 com
`intermediate_size: 16` os satisfaz, exporta limpo, emite as três entradas, escreve `vocab.txt`, fica
**mais** abaixo do teto por ter encoder menor e concorda consigo mesmo na paridade.

- **Souza, Nogueira & Lotufo, _BERTimbau_, BRACIS 2020** — a quantidade que separa: vocabulário WordPiece
  de **29 794**, contra 28 996 do BERT cased inglês da mesma forma 12×768. É por isso que o vocabulário é
  a testemunha, e é por isso que ele é conferido no arquivo e não no campo que fala dele.
  [link](https://doi.org/10.1007/978-3-030-61377-8_28)
- **Merkle, 1988 — A digital signature based on a conventional encryption function** (CRYPTO '87, LNCS
  293:369–378) — a cobertura por digest é o que faz uma declaração ser **verificável** em vez de afirmada:
  a testemunha não está no Git, mas o `sha256` dela está, em `source-lock.json` e `cleanfeed-model.json`.
  Um repack move os dois descritores, e o teste que os lê obriga a rederivar a forma.
  [link](https://doi.org/10.1007/3-540-48184-2_32)

**Sem precedente encontrado** para comparar a **contagem de linhas do vocabulário** contra o tamanho selado
como guarda de export. A razão é a assimetria entre os dois lados: `config.json` é editável à mão e
`vocab.txt` é o material — um fine-tune de outro BERT com o campo corrigido passa por toda comparação de
número e não passa por esta.
