# Licença da documentação e da evidência — CC BY 4.0

Copyright (c) 2026 Cally Afiune

A documentação deste repositório (`docs/`), os protocolos
(`benchmark/protocols/`) e a evidência publicada (`benchmark/evidence/`) estão
sob **Creative Commons Attribution 4.0 International (CC BY 4.0)**.

Texto integral: <https://creativecommons.org/licenses/by/4.0/legalcode.pt>
Resumo: <https://creativecommons.org/licenses/by/4.0/deed.pt>

## Por que a licença mais permissiva das três

A evidência existe para ser checada. Um relatório de avaliação que alguém não
pode citar, reproduzir num paper, nem republicar com correção não serve à
finalidade de ter sido publicado. CC BY exige só a atribuição, que é o que
mantém a linha de proveniência legível.

Não é CC BY-NC, embora o projeto seja não comercial. A restrição não comercial
protege o artefato que pode causar dano a uma pessoa — os pesos, sob
`cleanfeed-weights-nc-1.0`. Aplicá-la à documentação atingiria o uso que o
projeto quer: um curso pago que ensine a metodologia, um jornal que reproduza a
tabela de limitações, uma auditoria contratada que cite o model card.

Não é CC0. A atribuição é o que liga uma alegação ao registro que a sustenta;
sem ela, um número desta bancada pode reaparecer sem as ressalvas que o
qualificam, que é a falha que o projeto passa o dia inteiro tentando evitar.

## O que esta licença não cobre

- **o código** — MIT (`LICENSE`, na raiz);
- **os pesos treinados** — `cleanfeed-weights-nc-1.0`
  (`models/cleanfeed-ptbr-v1/LICENSE`);
- **o corpus** — não redistribuído (`redistribution: "not-published"`). As
  obrigações das licenças das fontes e a LGPD regem os dados, e nenhuma licença
  deste repositório concede direito sobre eles. Ver `docs/corpus-sources.md`.
