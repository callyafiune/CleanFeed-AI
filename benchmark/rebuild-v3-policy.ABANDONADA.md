# `rebuild-v3-policy.json` está ABANDONADA (2026-08-01)

Este arquivo existe para que ninguém leia `rebuild-v3-policy.json` sem saber disso. A política **não
foi editada** e não será: uma autoridade pré-registrada alterada em silêncio é indistinguível de uma que
sempre disse aquilo. Ela fica legível, íntegra e explicitamente morta.

## Por quê

A estrutura de agrupamento do corpus humano não admite o split pré-registrado, e a constatação é sobre
os GRUPOS, não sobre resultados: **o bloco cego não foi consultado em momento algum**. Os alvos são
45/5/10/20/20 por classe com tolerância absoluta de 0,02, então `dev` exige entre 3% e 7% de cada classe
e nenhuma das cinco partições pode ficar sem presença humana.

A seleção humana que os pools produziriam tem componentes conectados de tamanho **Carolina 1.600,
PT.SO 800, Wikipédia 800, B2W 800** — quatro blocos indivisíveis, e nenhuma atribuição deles atende aos
cinco alvos. Retirar `collectionBatch` da conectividade não resolve, porque `domainSource` também está
em `GROUP_KEYS`: o resultado são cinco blocos de 800, com o mesmo impedimento em `dev` e em `cal-A`.

## O que substitui

`benchmark/preregistration-v4.json` + `.ts`, sob o dataset ID `cleanfeed-ptbr-cells-v1`. É ela que está
em `EVALUATOR_FILES`; este par saiu de lá, **nenhum módulo de produção o importa e nenhum lê o JSON** —
inclusive do lado Python, onde `assemble_corpus.POLICY_PATH` aponta para a política viva. O arquivo
continua legível e byte-exato — permanece no `.prettierignore` por isso, e não porque ainda seja hasheado.
Um byte alterado aqui não move mais o `evaluatorDigest`, o que é exatamente por que nada pode lê-lo:
autoridade fora da identidade do avaliador decide sem ser vigiada.

A nova pré-inscrição define e exige `sourceMaterialBatch` como a identidade que carrega dependência —
separada de `extractionRun`, porque a execução local de um extrator determinístico não é unidade
estatística —, mantém esse eixo FORA da união do split (`splitUnionsOnDependencyAxis: false`, medido:
unir por ali faz cada célula um componente indivisível) e roda um preflight de viabilidade sobre
tamanhos e intervalos temporais dos componentes ANTES da montagem.

`pt-stackoverflow` permanece fora até a condição jurídica do termo de acesso de 2024 ser satisfeita.

## Onde está a decisão completa

- `docs/superpowers/plans/2026-07-30-registro-de-decisoes.md` § "F1-5q" — a decisão, o escopo e a
  sequência; e § "Consenso sobre o garfo do `collectionBatch`" — a medição, incluindo o que eu havia
  registrado errado antes.
- `docs/references.md` § 2.2g — por que abandonar é legítimo e emendar não seria.
