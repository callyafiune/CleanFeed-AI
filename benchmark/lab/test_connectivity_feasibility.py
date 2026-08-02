"""O que a CONECTIVIDADE por valor compartilhado faz com a viabilidade do split (run: python -m unittest).

Estes testes nao inventam regra: importam `connected_components` e `group_axes` do proprio
laboratorio e montam linhas com os mesmos eixos que `assemble_corpus` escreve.

O que eles medem e a pergunta que ordena a nova pre-inscricao. `GROUP_KEYS` une registros por
VALOR compartilhado, e o splitado do E2 coloca componente inteiro numa unica particao. Logo o
tamanho do maior componente e um LIMITE SUPERIOR de viabilidade: um componente que valha 25% do
corpo nao cabe inteiro numa particao de 5%.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import group_axes  # noqa: E402
from assemble_corpus import SPLIT_GROUP_KEYS, connected_components  # noqa: E402

# A menor particao do desenho de cinco (45/5/10/20/20).
MENOR_PARTICAO = 0.05


def linha(rec_id: str, dominio: str, autor: str, lote: str) -> dict:
    """Uma linha humana extraida, com os eixos que o montador preenche.

    `source` e o DOCUMENTO de origem — o prefixo `th_` do corpo real e de thread —, um por
    registro. Dar a mesma `source` a varias linhas as uniria por outro eixo e mediria a coisa
    errada; foi o erro que a primeira versao desta medicao cometeu.
    """
    return {
        "id": rec_id,
        "groups": {
            "author": group_axes.known(autor),
            "source": group_axes.known(f"th_doc_{rec_id}"),
            "domainSource": group_axes.known(group_axes.axis_token(dominio)),
            "collectionBatch": group_axes.known(group_axes.axis_token(lote)),
            "nearDuplicate": group_axes.known(f"nd_{rec_id}"),
            "derivationRoot": group_axes.not_applicable("texto extraido"),
        },
    }


def maior_componente(registros: list[dict]) -> tuple[int, float]:
    tamanhos: dict[str, int] = {}
    for raiz in connected_components(registros).values():
        tamanhos[raiz] = tamanhos.get(raiz, 0) + 1
    return len(tamanhos), max(tamanhos.values()) / len(registros)


class ConectividadeEViabilidade(unittest.TestCase):
    def test_domain_source_une_o_dominio_inteiro(self):
        """Com `domainSource` em GROUP_KEYS, ha um componente por dominio e nada mais.

        Quatro dominios de dez linhas, cada linha com autor e documento PROPRIOS: nada as
        deveria unir. Ainda assim saem quatro componentes de 25%.
        """
        registros = [
            linha(f"r{d}_{i}", f"dominio{d}", f"a_aut_{d}_{i}", f"extraction_dominio{d}")
            for d in range(4)
            for i in range(10)
        ]
        componentes, maior = maior_componente(registros)
        self.assertEqual(componentes, 4)
        self.assertAlmostEqual(maior, 0.25, places=6)
        self.assertGreater(
            maior,
            MENOR_PARTICAO,
            "um componente maior que a menor particao nao cabe nela inteiro",
        )

    def test_lote_de_material_nao_muda_nada_enquanto_domain_source_unir(self):
        """O achado que ORDENA a unidade nova.

        Cinco lotes distintos por dominio — o que o termo `sourceMaterialBatch` pretende
        introduzir — e o numero de componentes NAO muda: `domainSource` ja uniu tudo. Portanto
        acrescentar o eixo de lote nao compra viabilidade nenhuma enquanto `domainSource`
        carregar dependencia. Quem sustenta a viabilidade e tirar `domainSource` do
        GROUP_KEYS, nao acrescentar lote.
        """
        com_lote = [
            linha(f"r{d}_{i}", f"dominio{d}", f"a_aut_{d}_{i}", f"smb_{d}_{i % 5}")
            for d in range(4)
            for i in range(10)
        ]
        componentes, maior = maior_componente(com_lote)
        self.assertEqual(componentes, 4)
        self.assertAlmostEqual(maior, 0.25, places=6)

    def test_sem_o_estrato_o_lote_passa_a_decidir(self):
        """A contraprova: sem `domainSource` conhecido, o lote e que agrupa.

        Aqui o estrato entra como `notApplicable` — que e como um eixo de RELATO se comporta
        para quem agrupa — e os cinco lotes por dominio produzem vinte componentes de 5%. E a
        medicao que mostra que a mudanca pendente de ratificacao nao e cosmetica.
        """
        registros = []
        for d in range(4):
            for i in range(10):
                rec = linha(f"r{d}_{i}", f"dominio{d}", f"a_aut_{d}_{i}", f"smb_{d}_{i % 5}")
                rec["groups"]["domainSource"] = group_axes.not_applicable(
                    "estrato de relato, nao unidade de dependencia"
                )
                registros.append(rec)
        componentes, maior = maior_componente(registros)
        self.assertEqual(componentes, 20)
        self.assertAlmostEqual(maior, 0.05, places=6)

    def test_o_eixo_do_estrato_ainda_esta_entre_os_que_unem(self):
        """Guarda de estado: enquanto isto passar, a unidade nova NAO comecou.

        Quando `domainSource` sair de GROUP_KEYS este teste falha, e a falha e o sinal de que a
        mudanca foi feita — nao um defeito. Trocar a assercao e parte daquele passo.
        """
        self.assertIn("domainSource", SPLIT_GROUP_KEYS)


if __name__ == "__main__":
    unittest.main()
