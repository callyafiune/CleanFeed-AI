# Licenças — uma por artefato

Este repositório publica três artefatos com riscos diferentes, e por isso com
licenças diferentes. Se você chegou aqui procurando "a licença do projeto", a
resposta depende de qual parte você vai usar.

| artefato                 | licença                                                                  | arquivo                                                                |
| ------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| código                   | MIT                                                                      | [`LICENSE`](LICENSE)                                                   |
| pesos treinados          | `cleanfeed-weights-nc-1.0` — não comercial, usos de alto risco proibidos | [`models/cleanfeed-ptbr-v1/LICENSE`](models/cleanfeed-ptbr-v1/LICENSE) |
| documentação e evidência | CC BY 4.0                                                                | [`docs/LICENSE-DOCS.md`](docs/LICENSE-DOCS.md)                         |
| corpus de treino         | não redistribuído                                                        | [`docs/corpus-sources.md`](docs/corpus-sources.md)                     |

**Atenção ao arquivo `LICENSE`:** existem dois. O da raiz é o MIT do código. O
de `models/cleanfeed-ptbr-v1/` é a licença dos pesos, e não é MIT. Até
2026-07-31 o script de empacotamento copiava o primeiro sobre o segundo em cada
repackage, o que punha uma licença que permite revenda comercial no mesmo
diretório de um NOTICE declarando `commercialUse: false`.

## Por que não uma licença só

Restrição de uso no **código** não protege ninguém: quem quiser um detector
comercial treina o próprio, e a restrição só conseguiria impedir o reuso da
parte que vale — a bancada de avaliação. Restrição de uso nos **pesos** protege
uma pessoa concreta, porque um falso positivo é uma acusação contra alguém e o
dano na área é documentado (Weber-Wulff et al. 2023; Liang et al. 2023). A
proteção acompanha o artefato que causa o dano.

Os pesos não são "open source" pela definição da OSI, e o projeto não usa esse
termo para eles. Diz **pesos abertos, uso restrito**.

## Posição de licença dos pesos

As obrigações das licenças das fontes de treino regem a aquisição, a preparação
e o uso do **corpus**. O projeto sustenta que não alcançam o artefato treinado,
e o regime não comercial dos pesos é política própria — escolhida, não
importada. Isso é **decisão de risco do operador**, não parecer jurídico e não
conclusão da Creative Commons, e está registrada em
[`models/cleanfeed-ptbr-v1/license-review.json`](models/cleanfeed-ptbr-v1/license-review.json)
com a ressalva completa. Ver a seção "Posição (a)" de
[`docs/corpus-sources.md`](docs/corpus-sources.md).

A publicação dos pesos ainda depende da ratificação B1 pelo operador: buscar
parecer jurídico sobre essa posição, ou assumir o risco por escrito. Enquanto
isso, `license-review.json` permanece `status: "pending"`, e é isso que o gate
de publicação lê.
