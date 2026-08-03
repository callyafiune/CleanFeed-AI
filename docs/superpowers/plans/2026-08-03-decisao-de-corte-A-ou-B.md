# Duas opções de corte — para o operador escolher

**Este documento é curto de propósito.** O projeto tem **24.482** linhas de plano contra 24.687 de
código de produto, e 1,6 MB só em `docs/superpowers/plans`. Um documento longo sobre inflação de escopo
se refutaria. Se algo aqui precisar de mais detalhe, o detalhe já existe nos planos citados.

E o número acima **já inclui este arquivo** — medi antes de escrevê-lo em 24.304 e depois em 24.482.
Acrescentar 178 linhas de plano para dizer que há plano demais é o custo mínimo de parar, e fica
registrado como custo e não como isenção.

## O diagnóstico, medido

| fato | valor |
|---|---|
| commits | 426 |
| tags de release | **0** |
| `issuedAt` no descritor | **null** — nunca empacotado |
| linhas de plano ÷ linhas de `src/` | 24.482 ÷ 24.687 ≈ **1,0** |
| unidades entregues em 2026-08-02/03 | 7, **nenhuma** no caminho crítico |

O operador diagnosticou: escopo fora de controle, sem artefato, dando voltas. O diagnóstico está
correto. As duas causas **não são a stack**:

1. **a base acabou** — três fontes públicas utilizáveis, uma bloqueada juridicamente, e nenhum registro
   de evento de aquisição, que é o que torna o corpus indivisível;
2. **o padrão foi posto onde esta base não alcança** — 250 componentes independentes por célula nas
   partições cegas, contra **1** que existe hoje.

Reescrever em outra stack não cria eventos de aquisição retroativos nem componentes que não existem.
A saída é **cortar a alegação**, não o código.

---

## Opção A — publicar o preview

### O que é

Detector pt-BR por adesão explícita, **desligado por padrão**, sempre rotulado experimental,
**sem alegação de erro**, com `actionCeiling = indicator` em todo resultado. É a v1.0 que o
`2026-07-30-plano-v1-minima.md` já define.

**Não precisa de corpus.** Não faz alegação, então não há o que medir.

### O que já existe

- pesos em `models/cleanfeed-ptbr-v1/`: `bundle-verified`, `profileDigests: []`, `gateDecision: pending`;
- a lane `experimental` que o empacotamento aceita (`83479e6`);
- teto `indicator` **estrutural** — reintroduzir `hide` é erro de compilação (`218f3ca`);
- 11 guardas de integridade do pacote medidas, cadeia manifesto↔lock↔release cruzada.

### O que falta

| # | item | quem |
|---|---|---|
| 1 | **B1** — parecer jurídico da posição (a) **ou** risco assumido por escrito | **operador** |
| 2 | `license-review.json` → `approved` | operador (é a assinatura de B1) |
| 3 | Fase 3: model card com a frase R7-correta, seção de dados e proveniência, varredura repo-wide de alegações, E2E real | agente, 4–7 dias úteis |
| 4 | empacotar (define `issuedAt`) e `release:assert-publishable` | agente, horas |

### O que sai de escopo, por escrito

Fase 1 inteira (corpus), Fase 2 (treino), a ratificação de `domainSource`, o pré-registro, a cota
`m=4`, `cal-B`, o bloco cego, a v2.0 — e a fila de endurecimento.

### As duas ressalvas honestas

**Os pesos atuais não têm proveniência documentada.** Nenhum vínculo F6 prova em que corpus foram
treinados. Então o preview é declarado **terminal**: a v2.0, se houver, treina pesos novos. Isso é
aceitável exatamente porque o preview não alega nada — e publicar pesos não queima partição cega
futura.

**Publicar detector sem taxa de erro medida é risco real, mesmo rotulado.** Falso positivo é acusação
contra pessoa. O piso ético do plano existe e é o que segura: opt-in desligado, teto `indicator`,
proibição explícita de uso disciplinar/acadêmico/empregatício, nenhum rótulo de autoria, nenhuma
confiança numérica, disclosure em todo resultado, e a ressalva de que revisão humana não salva sinal
não validado. Se o operador julgar que isso não basta, **A está fora** e a resposta é B.

### O que o operador ganha

Um artefato que existe, publicado, apontável. Não é produto competitivo — é o fim de "nunca
entregamos".

---

## Opção B — publicar o avaliador

### O que é

Repositório público + relatório técnico: **uma bancada de avaliação** para detecção de texto gerado em
pt-BR, com a metodologia que a área não tem, aplicada a detectores **que já existem**. É o caminho 2
que o agente recomendou em D0 e que o operador sobrepôs.

O produto é o método, não o detector. Não depende de o nosso ser bom.

### Por que tem valor, medido

A auditoria de 2026-07-30 varreu 10 benchmarks, 7 shared tasks e 12 repositórios. **Não achou em
nenhum:** uso único do bloco de teste, pré-registro (zero ocorrências), controle de FWER entre fatias,
inferência cluster-robusta, cota distribution-free, manchete de pior estrato, tratamento de erro de
inferência, estado epistêmico de grupo, **nem um único arquivo de teste automatizado**. Artefato
mediano da área: README + licença + paper.

Nós temos tudo isso funcionando, com **1.265 testes do avaliador** verdes — 1.099 em `benchmark/tests`
e 166 em `benchmark/lab/test_*.py`. A suíte inteira tem 2.499, mas os outros 1.234 são da **extensão** e
não entram nesta comparação: os projetos auditados são código de pesquisa sem produto. Ver
`MANIFESTO-DE-TRANSPLANTE.md` § 1.

### O que já existe

- a bancada em `benchmark/` (71.757 linhas TS) mais `contracts/` (3.176), e o lab em `benchmark/lab/`
  (**604 KB de Python**, que a stack de qualquer reinício em Python reusa direto);
- `docs/references.md` — 270 entradas, 222 links, ancoradas por decisão;
- o ledger de uso único, a invalidação graduada por cluster, o Regime 2, a auditoria por mutação;
- `evaluate_external.py`, `compare_detectors.py`, `evaluate_slices.py`.

### O que falta

| # | item | quem |
|---|---|---|
| 1 | decidir os candidatos finais (C1: Binoculars, Fast-DetectGPT, RoBERTa-OpenAI, 1–2 do HF, o nosso **sem publicar pesos**) | agente decide, operador ratifica |
| 2 | verificar se o português do MULTITuDE é PT-BR ou PT-PT | agente, horas |
| 3 | corpus de avaliação: MULTITuDE-pt + MultiSocial-pt (uso avaliativo) + o nosso nos estratos que eles não cobrem | agente |
| 4 | relatório com intervalos e fatias | agente |

**Estimativa registrada: 1,5–3 semanas, ~R$0.**

### O que sai de escopo, por escrito

A extensão como produto, a publicação de pesos, a v1.0 e a v2.0, o corpus dimensionado a 20 mil
linhas, e a fila de endurecimento. `test` e `cal-B` ficam **preservados** (C4) para um caminho 1 futuro.

### As duas ressalvas honestas

**O problema de componentes volta, mas menor.** Alegação *comparativa* — detector A contra B nos mesmos
dados — exige muito menos que cota absoluta de FPR. Ainda pede intervalo cluster-robusto, mas não pede
250 componentes por célula.

**Abandona o produto.** Se o objetivo é uma extensão que as pessoas usem, B não entrega isso. Entrega
uma contribuição de método, que é o que a área não tem.

---

## O que as duas exigem igualmente

1. **Declarar o resto fora de escopo por escrito**, neste documento, com data e assinatura de quem
   decidiu (R4);
2. **parar a fila de endurecimento** — inclusive a do agente. Ela é infinita por construção: cada item
   se justifica sozinho e o conjunto não tem fim. Foi ela que consumiu 2026-08-02;
3. **não acrescentar plano.** Nenhum documento novo em `docs/superpowers/plans/` até o artefato existir.

## Comparação em uma tabela

| | A — preview | B — avaliador |
|---|---|---|
| precisa de corpus novo | **não** | sim, mas externo e menor |
| bloqueado por assinatura sua | **sim (B1)** | não |
| trabalho de agente até o artefato | 4–7 dias úteis | 1,5–3 semanas |
| custo | R$0 | R$0 |
| entrega produto | sim, sem alegação | não |
| entrega contribuição inédita | não | **sim** |
| risco ético a assumir | publicar detector sem erro medido | baixo |
| o que fica preservado | bancada intocada | pesos e blocos selados |

---

## Campos de decisão — só o operador

Nada abaixo é delegável: define o que é publicado externamente.

```
Opção escolhida:        [ A ]  [ B ]  [ nenhuma / encerrar ]
Data:
Decidida por:

Se A — B1 resolvido como:   [ parecer jurídico obtido ]  [ risco assumido por escrito ]
Se A — piso ético julgado suficiente:  [ sim ]  [ não → vai para B ]

Fora de escopo por esta decisão (marcar):
  [ ] corpus dimensionado e ratificação de domainSource
  [ ] pré-registro, cota m=4, cal-B, bloco cego, v2.0
  [ ] fila de endurecimento
  [ ] documentos de plano novos até o artefato existir
```

**Enquanto este documento não estiver preenchido, o agente não abre unidade nova.** Parar é ato
explícito, e este documento é o ato.
