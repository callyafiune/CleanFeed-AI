"""A IDENTIDADE da linha no funil, e a REFERENCIA que ela nao e (run: py -3.13 -m pytest).

O defeito que este arquivo fecha e de TIPO. `parentId` e chave ESTRANGEIRA: e o nome com
que a linha mista aponta para o pai humano. Passa-la a um impositor de unicidade que a
MUTILA e tratar referencia como identidade, e o custo aparecia em tres sitios de uma vez,
os tres medidos aqui:

  * a PONTE. `connected_components` une por `derivationRoot` com a condicao `named in
    ids` — o valor tem de ser id de registro PRESENTE. Com a chave do pai movida debaixo
    da mista, a uniao e saltada em SILENCIO, e a ilha racha;
  * a PODA. `near_dupes.prune` devolve um conjunto de IDS, e pai e mista partilhavam o id:
    a poda que escolhe guardar a mista e derrubar o pai derrubava as duas, porque o nome
    que ela devolve nomeava ambas;
  * o RENOMEIO. Quem colide e quem sobra era decidido pela ORDEM dos pools, entao
    inverte-la inverteria a vitima — sinal de que nenhuma ordem estava certa.

A forma do conserto: a identidade da linha no funil e a identidade do REGISTRO que ela vai
produzir (`funnel_key`), a mista carrega a dela propria (`mix_<pai>`), e
`enforce_unique_keys` nao recebe nome de campo nenhum — nao ha por onde apontar-lhe uma
referencia.
"""

from __future__ import annotations

import inspect
import unittest

import assemble_corpus as ac
import near_dupes
from group_axes import NO_SINGLE_AUTHOR, known, not_applicable

PROSE = " ".join(f"palavra{index}" for index in range(60))


def human_candidate(candidate_id: str, page: str, text: str = PROSE) -> dict:
    return {
        "candidateId": candidate_id,
        "text": text,
        "wordCount": len(text.split()),
        "domainSource": "ptwiki_lead",
        "licenseId": "cc-by-sa-4.0",
        "createdAt": 1621555200000,
        "meta": {
            "dateField": "pages-articles.xml@revision/timestamp",
            "observedValue": "2021-05-21T00:00:00+00:00",
            "groupAxes": {
                "source": known(page),
                "author": not_applicable(NO_SINGLE_AUTHOR),
            },
            "sourceMaterialBatch": "smb_ptwiki-20220301",
            "extractionRun": "er_teste",
        },
    }


def mixed_candidate(parent_id: str, text: str) -> dict:
    return {
        "parentId": parent_id,
        "text": text,
        "provider": "gemini",
        "generationLane": "gemini-api",
        "model": "gemini-3.5-flash-lite",
        "promptTemplateId": "original",
        "promptTemplateDigest": "d" * 64,
        "parentFamily": "ptwiki_lead",
        "sourceMaterialBatch": "smb_ptwiki-20220301",
        "temperature": "0.8",
        "mixture": {
            "spans": [
                {"start": 0, "end": 100, "origin": "human"},
                {"start": 100, "end": len(text), "origin": "ai"},
            ]
        },
    }


class IdentidadeDaMista(unittest.TestCase):
    def test_a_chave_do_funil_da_mista_e_o_ID_DELA_e_nao_o_do_pai(self) -> None:
        mixed = mixed_candidate("src_ptwiki_p1", "misto " * 30)
        # O id do registro que esta linha vai produzir, e o funil chaveia por ele: e o
        # que separa a identidade da linha da referencia ao pai.
        self.assertEqual(ac.funnel_key(mixed), "mix_src_ptwiki_p1")

    def test_a_chave_do_funil_E_o_id_do_registro_construido(self) -> None:
        mixed = mixed_candidate("src_ptwiki_p1", "misto " * 30)
        record = ac.mixed_record(mixed)
        self.assertEqual(record["id"], ac.funnel_key(mixed))

    def test_duas_mistas_do_MESMO_pai_recebem_ids_distintos(self) -> None:
        # Possivel em material: `already_done` chaveia por `parentId` DENTRO de um
        # arquivo, e o funil le dois (`mixed_candidates` e `mixed_from_pairs`).
        primeira = mixed_candidate("src_ptwiki_p1", "misto um " * 30)
        segunda = mixed_candidate("src_ptwiki_p1", "misto dois " * 30)
        ac.enforce_unique_keys([[primeira, segunda]])
        self.assertNotEqual(ac.funnel_key(primeira), ac.funnel_key(segunda))
        self.assertNotEqual(
            ac.mixed_record(primeira)["id"], ac.mixed_record(segunda)["id"]
        )
        # E a referencia nao foi tocada em NENHUMA das duas.
        self.assertEqual(primeira["parentId"], "src_ptwiki_p1")
        self.assertEqual(segunda["parentId"], "src_ptwiki_p1")


class ReferenciaNaoSeMutila(unittest.TestCase):
    def test_o_par_pai_mista_nao_colide_e_o_pai_NAO_e_renomeado(self) -> None:
        humans = [human_candidate("src_ptwiki_p1", "pagina_1")]
        mixed = [mixed_candidate("src_ptwiki_p1", "misto derivado " * 30)]
        renames = ac.enforce_unique_keys([[], mixed, humans])
        # O caso que era o normal e nao a excepcao: TODA mista sobrevivente colidia com
        # o proprio pai, porque a chave dela era o nome dele.
        self.assertEqual(renames, {})
        self.assertEqual(humans[0]["candidateId"], "src_ptwiki_p1")
        self.assertEqual(mixed[0]["parentId"], "src_ptwiki_p1")

    def test_parentId_sai_do_funil_BYTE_A_BYTE(self) -> None:
        humans = [
            human_candidate("src_ptwiki_p1", "pagina_1"),
            human_candidate("src_ptwiki_p1", "pagina_2", PROSE + " outro"),
        ]
        mixed = [mixed_candidate("src_ptwiki_p1", "misto derivado " * 30)]
        ac.enforce_unique_keys([[], mixed, humans])
        # Ha renomeio no pool humano (duas linhas com a mesma chave), e a referencia da
        # mista continua a mesma cadeia: o impositor de unicidade nao a alcanca.
        self.assertEqual(mixed[0]["parentId"], "src_ptwiki_p1")

    def test_o_impositor_de_unicidade_nao_recebe_nome_de_campo(self) -> None:
        # A AUSENCIA do parametro e o mecanismo, e por isso e ela que se afirma: com um
        # nome de campo era possivel — e foi feito — apontar a funcao a `parentId`.
        # Enquanto ela receber UM argumento, o defeito de tipo fica irrepresentavel.
        parametros = list(inspect.signature(ac.enforce_unique_keys).parameters)
        self.assertEqual(parametros, ["pools"])


class PodaNaoMataPeloNomeDoPai(unittest.TestCase):
    def test_a_poda_derruba_o_pai_e_a_mista_SOBREVIVE(self) -> None:
        # O caso medido: pai e mista sao quase-duplicatas por construcao (a mista E o
        # texto do pai com trechos enxertados), entao caem no MESMO cluster. A poda
        # guarda a de prioridade menor — a mista — e derruba o pai. Com a chave
        # partilhada, o nome devolvido nomeava as DUAS e as duas morriam.
        parent_text = PROSE
        # Jaccard 0,8361 sobre shingles de 5 tokens, acima do limite de 0,82 da poda —
        # a mesma faixa que o § U.3 de references.md mediu para pai/mista em
        # material (0,848-0,869).
        mixed_text = PROSE.replace("palavra7", "enxerto")
        humans = [human_candidate("src_ptwiki_p1", "pagina_1", parent_text)]
        mixed = [mixed_candidate("src_ptwiki_p1", mixed_text)]
        docs = [(ac.funnel_key(r), r["text"], 1) for r in mixed] + [
            (ac.funnel_key(r), r["text"], 2) for r in humans
        ]
        dropped, stats = near_dupes.prune(docs)
        self.assertEqual(stats["clusters_collapsed"], 1)
        sobreviventes_mistos = [r for r in mixed if ac.funnel_key(r) not in dropped]
        sobreviventes_humanos = [r for r in humans if ac.funnel_key(r) not in dropped]
        self.assertEqual(len(sobreviventes_mistos), 1)
        self.assertEqual(sobreviventes_humanos, [])


class APonteMedeUmComponente(unittest.TestCase):
    @staticmethod
    def _components(humans: list[dict], mixed: list[dict]) -> dict[str, str]:
        records = [ac.human_record(h, "ptwiki", None) for h in humans]
        records += [ac.mixed_record(m) for m in mixed]
        return ac.connected_components(records)

    def test_o_par_pai_mista_mede_UM_componente(self) -> None:
        humans = [human_candidate("src_ptwiki_p1", "pagina_1")]
        mixed = [mixed_candidate("src_ptwiki_p1", "misto derivado " * 30)]
        ac.enforce_unique_keys([[], mixed, humans])
        ac.link_mixed_to_parents(mixed, humans)
        roots = self._components(humans, mixed)
        self.assertEqual(len(set(roots.values())), 1)

    def test_o_pai_RENOMEADO_leva_a_ponte_consigo(self) -> None:
        # A linha `ai` toma a chave primeiro, entao o humano e o renomeado. A mista
        # continua a nomear a cadeia antiga, e sem resolucao o `derivationRoot` dela
        # apontaria ao registro `ai` — uniao com o registro ERRADO, e em silencio.
        ai = [{"candidateId": "src_ptwiki_p1", "text": "gerado " * 40}]
        humans = [human_candidate("src_ptwiki_p1", "pagina_1")]
        mixed = [mixed_candidate("src_ptwiki_p1", "misto derivado " * 30)]
        ac.enforce_unique_keys([ai, mixed, humans])
        self.assertNotEqual(ac.funnel_key(humans[0]), "src_ptwiki_p1")
        counts = ac.link_mixed_to_parents(mixed, humans)
        self.assertEqual(counts["repointed"], 1)
        record = ac.mixed_record(mixed[0])
        human = ac.human_record(humans[0], "ptwiki", None)
        self.assertEqual(record["groups"]["derivationRoot"]["id"], human["id"])
        roots = self._components(humans, mixed)
        self.assertEqual(len(set(roots.values())), 1)

    def test_pai_que_resolve_em_DUAS_humanas_RECUSA(self) -> None:
        humans = [
            human_candidate("src_ptwiki_p1", "pagina_1"),
            human_candidate("src_ptwiki_p1", "pagina_2", PROSE + " outro"),
        ]
        mixed = [mixed_candidate("src_ptwiki_p1", "misto derivado " * 30)]
        ac.enforce_unique_keys([[], mixed, humans])
        with self.assertRaises(ac.ParentIdentityAmbiguous) as caught:
            ac.link_mixed_to_parents(mixed, humans)
        self.assertIn("src_ptwiki_p1", str(caught.exception))

    def test_a_identidade_do_pai_e_um_TOKEN_de_eixo_e_nao_a_cadeia_crua(self) -> None:
        # `derivationRoot` e eixo de agrupamento, e o esquema selado recusa valor fora de
        # /^[A-Za-z0-9_-]+$/ — um "." em particular e tratado como separador de PII. A
        # referencia vem do arquivo de pares e nao passou por `slug`, entao quem a escreve
        # no eixo tem de a converter.
        # AS DUAS PONTAS, e sao caminhos diferentes de codigo: a linha LIGADA le o
        # carimbo, e a que nao passou pela ligacao cai na derivacao — nenhuma das duas
        # pode escrever a cadeia crua.
        crua = mixed_candidate("src.ptwiki.p1", "misto derivado " * 30)
        sem_ligacao = ac.mixed_record(crua)
        self.assertEqual(
            sem_ligacao["groups"]["derivationRoot"]["id"], "src_ptwiki_p1"
        )
        self.assertEqual(sem_ligacao["groups"]["humanSeed"]["id"], "src_ptwiki_p1")

        humans = [human_candidate("src.ptwiki.p1", "pagina_1")]
        mixed = [mixed_candidate("src.ptwiki.p1", "misto derivado " * 30)]
        ac.enforce_unique_keys([[], mixed, humans])
        ac.link_mixed_to_parents(mixed, humans)
        ligada = ac.mixed_record(mixed[0])
        self.assertEqual(ligada["groups"]["derivationRoot"]["id"], "src_ptwiki_p1")
        self.assertEqual(ligada["groups"]["humanSeed"]["id"], "src_ptwiki_p1")

    def test_mista_cujo_pai_nao_esta_no_pool_e_CONTADA_e_nao_calada(self) -> None:
        humans = [human_candidate("src_ptwiki_p1", "pagina_1")]
        mixed = [mixed_candidate("pai_que_nao_existe", "misto " * 30)]
        counts = ac.link_mixed_to_parents(mixed, humans)
        self.assertEqual(counts["unresolved"], 1)
        self.assertEqual(counts["resolved"], 0)


if __name__ == "__main__":
    unittest.main()
