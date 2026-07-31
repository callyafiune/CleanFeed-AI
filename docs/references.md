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
  problema que essa unidade resolve. _Onde no projeto:_ `benchmark/split.ts:203`
  (`CONNECTIVITY_AXES`), `:375-397` (`connectedComponentRoots`); plano v3 § C3. _Fato citado:_
  "held-out test sets" sem holdout oculto, totalmente público; os autores reconhecem dependência
  por cluster de pergunta sem ajustar a análise para isso.
- **He, Shen, Chen, Backes & Zhang, 2024 — MGTBench: Benchmarking Machine-Generated Text
  Detection** (ACM CCS 2024). [link](https://ar5iv.labs.arxiv.org/html/2303.14822)
  _Âncora:_ o tratamento de autor como eixo de agrupamento — o MGTBench ignora um agrupamento
  óbvio no próprio dataset, exatamente o erro que o desenho por componente conexa evita. _Onde
  no projeto:_ `benchmark/split.ts:203`; plano v3 § "§0" R6 e § C3. _Fato citado:_ split 80/20
  aleatório reutilizável; 13 detectores × 6 LLMs × 3 datasets sem correção de multiplicidade;
  Reuters 50-50 tem 50 jornalistas como agrupamento óbvio não tratado.
- **Paes, Negrão, Silva, Junior, Luz & Silva (UFOP), 2025 — Detecção de textos gerados por LLM
  em português (PT-Detect)** (ENIAC 2025, DOI 10.5753/eniac.2025.13952).
  [link](https://sol.sbc.org.br/index.php/eniac/article/view/38755)
  _Âncora:_ a unidade de reamostragem por componente conexa — é o exemplo negativo exato de
  vazamento de cluster em pt-BR. _Onde no projeto:_ `benchmark/split.ts:375-397`; plano v3 § C3
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

### 10.4 Backlog de corpora pt-BR

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

### Cluster como átomo: componente conexo e validação cruzada

- **Tarjan, 1975 — Efficiency of a Good But Not Linear Set Union Algorithm** (Journal of the ACM
  22(2):215–225). [link](https://dl.acm.org/doi/10.1145/321879.321884)
  _Âncora:_ cluster de split e de exposição como **componente conexo** (union-find) sobre a união
  dos eixos de agrupamento aplicáveis. _Onde no projeto:_ `benchmark/split.ts:203`
  (`CONNECTIVITY_AXES`), `:375-397` (`connectedComponentRoots`); plano v3 § C3. _Fato citado:_
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
  _Âncora:_ o backbone efetivamente selado (`neuralmind/bert-base-portuguese-cased`, sem bake-off
  na v3), e o tokenizer WordPiece cujo comportamento (`[UNK]` por ideograma CJK isolado) a
  normalização contorna explicitamente. _Onde no projeto:_ plano v3 linha 51;
  `contracts/text-normalization.ts` linhas 208-210, 505-507. _Fato citado:_ pré-treina BERT
  base/large para português do Brasil no corpus BrWaC (2,68B tokens), com estado da arte à época
  em NER, STS e RTE para pt-BR.
- **Conneau, Khandelwal, Goyal, Chaudhary, Wenzek, Guzmán, Grave, Ott, Zettlemoyer & Stoyanov,
  2020 — Unsupervised Cross-lingual Representation Learning at Scale (XLM-R)** (ACL 2020).
  [link](https://aclanthology.org/2020.acl-main.747/)
  _Âncora:_ candidato de backbone no bake-off contra o BERTimbau, **descartado** como bake-off na
  v3. _Onde no projeto:_
  `docs/superpowers/plans/2026-07-22-cleanfeed-ptbr-detector-v2-finetune.md` (tabela linhas
  73-78, linha 107, T4 linha 141); `benchmark/lab/train_detector.py` (`--model
  xlm-roberta-base`); `benchmark/lab/README.md`; plano v3 linha 51. _Fato citado:_ apresenta o
  XLM-R, um RoBERTa multilíngue pré-treinado em CommonCrawl filtrado sobre 100 línguas.
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
