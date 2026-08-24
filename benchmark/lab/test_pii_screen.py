"""Fixture tests do censo e do ledger de disposicoes (run: py -3.13 -m pytest).

O que este arquivo prende:

  * a CEGUEIRA e mecanica — o triador recebe texto e nada mais, e o campo que ele nao
    pode ver nao existe no que lhe e passado;
  * o LEDGER e por par `(id, sha256)`, com disposicao de duas palavras e nada entre elas;
  * a COBERTURA e do censo: linha da projecao sem linha no ledger recusa;
  * a guarda da montagem exige `passed`, e PRESENCA DO PAR NAO BASTA — a diferenca entre
    as duas e o achado que D-13/D-19 fecha, e ha um caso para cada;
  * a revisao post-hoc conta TRES categorias, nunca `k - c`.

O digesto do texto NAO e calculado aqui: quem o calcula e o montador, que e o dono do
snapshot (D-19), e este modulo recebe o par ja formado. Um segundo calculo do mesmo
digesto seria uma segunda autoridade capaz de discordar da primeira.
"""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import pii_screen
import pii_screen_protocol as protocol


def digest_of(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def projection(*texts: str) -> list[pii_screen.ProjectionRow]:
    return [
        pii_screen.ProjectionRow(f"r{index}", digest_of(text), text)
        for index, text in enumerate(texts, start=1)
    ]


class RecordingTriager:
    """Triador falso que grava com que argumentos foi chamado."""

    def __init__(self, flag_texts: set[str] | None = None, subtypes=("email",)):
        self.calls: list[object] = []
        self.flag_texts = flag_texts or set()
        self.subtypes = tuple(subtypes)

    def __call__(self, text):
        self.calls.append(text)
        if text in self.flag_texts:
            return pii_screen.TriageVerdict(flagged=True, subtypes=self.subtypes)
        return pii_screen.TriageVerdict(flagged=False)


class BlindnessTests(unittest.TestCase):
    def test_a_projecao_tem_TRES_campos_e_nenhum_deles_e_rotulo_grupo_ou_escore(
        self,
    ) -> None:
        import dataclasses

        names = {f.name for f in dataclasses.fields(pii_screen.ProjectionRow)}
        self.assertEqual(names, {"row_id", "text_sha256", "text"})
        # A cegueira e mecanica e nao disciplinar: o campo que o triador nao pode ver
        # nao existe na forma que lhe chega, entao nao ha nada a esquecer de apagar.
        for forbidden in ("label", "groups", "score", "partition", "generatorFamily"):
            self.assertNotIn(forbidden, names)

    def test_o_triador_recebe_SO_o_texto(self) -> None:
        triager = RecordingTriager()
        rows = projection("um texto qualquer", "outro texto")
        pii_screen.screen_census(rows, triager)
        self.assertEqual(triager.calls, ["um texto qualquer", "outro texto"])
        # Nem o id: um id pseudonimizado ainda e um eixo pelo qual o triador poderia
        # correlacionar, e ele nao precisa dele para responder.
        for call in triager.calls:
            self.assertIsInstance(call, str)


class CensusTests(unittest.TestCase):
    def test_toda_linha_da_projecao_recebe_disposicao(self) -> None:
        rows = projection("a", "b", "c")
        dispositions = pii_screen.screen_census(rows, RecordingTriager())
        self.assertEqual(len(dispositions), 3)
        self.assertEqual(
            [d.row_id for d in dispositions], [row.row_id for row in rows]
        )
        self.assertEqual({d.disposition for d in dispositions}, {"passed"})

    def test_o_sinalizado_e_flagged_dropped_e_nunca_passed(self) -> None:
        rows = projection("limpo", "com pii")
        dispositions = pii_screen.screen_census(
            rows, RecordingTriager(flag_texts={"com pii"})
        )
        by_id = {d.row_id: d for d in dispositions}
        self.assertEqual(by_id["r1"].disposition, "passed")
        self.assertEqual(by_id["r2"].disposition, "flagged-dropped")
        # D-12: nao existe terceiro valor. Um "sinalizado-limpo" seria um registro lido
        # por humano dentro do corpus, e a rota de exposicao das cegas fecha por nao
        # haver como o escrever.
        self.assertEqual(pii_screen.DISPOSITIONS, ("passed", "flagged-dropped"))

    def test_o_par_do_ledger_e_o_da_projecao_byte_a_byte(self) -> None:
        rows = projection("texto com acento: coração")
        dispositions = pii_screen.screen_census(rows, RecordingTriager())
        self.assertEqual(dispositions[0].text_sha256, rows[0].text_sha256)

    def test_um_triador_que_levanta_ABORTA_o_censo_em_vez_de_saltar_a_linha(self) -> None:
        class Explodes:
            def __init__(self) -> None:
                self.seen = 0

            def __call__(self, text):
                self.seen += 1
                if self.seen == 2:
                    raise RuntimeError("transporte caiu")
                return pii_screen.TriageVerdict(flagged=False)

        rows = projection("a", "b", "c")
        with self.assertRaises(pii_screen.TriagerFailedOnRow) as caught:
            pii_screen.screen_census(rows, Explodes())
        # Nomeia a linha, porque um censo interrompido nao e um censo com uma lacuna:
        # e um censo que nao aconteceu, e quem retoma precisa de saber onde parou.
        self.assertIn("r2", str(caught.exception))

    def test_um_subtipo_fora_da_taxonomia_pre_inscrita_e_recusado(self) -> None:
        rows = projection("com pii")
        triager = RecordingTriager(
            flag_texts={"com pii"}, subtypes=("categoria-inventada",)
        )
        with self.assertRaises(pii_screen.TriagerNamedUnknownSubtype) as caught:
            pii_screen.screen_census(rows, triager)
        self.assertIn("categoria-inventada", str(caught.exception))
        # E a mensagem oferece o vocabulario, porque a alternativa e ir ler o protocolo.
        self.assertIn("relational", str(caught.exception))

    def test_um_subtipo_da_taxonomia_e_aceito_e_registado(self) -> None:
        rows = projection("com pii")
        dispositions = pii_screen.screen_census(
            rows, RecordingTriager(flag_texts={"com pii"}, subtypes=("relational",))
        )
        self.assertEqual(dispositions[0].subtypes, ("relational",))

    def test_linha_que_passa_nao_carrega_subtipo(self) -> None:
        # Um subtipo numa linha que passou seria uma sinalizacao sem disposicao de
        # sinalizacao — a contradicao que `flagged-dropped` existe para nao permitir.
        class Contradicts:
            def __call__(self, text):
                return pii_screen.TriageVerdict(flagged=False, subtypes=("email",))

        with self.assertRaises(pii_screen.TriagerContradictedItself):
            pii_screen.screen_census(projection("a"), Contradicts())

    def test_sinalizado_sem_subtipo_nenhum_tambem_e_contradicao(self) -> None:
        class Contradicts:
            def __call__(self, text):
                return pii_screen.TriageVerdict(flagged=True, subtypes=())

        with self.assertRaises(pii_screen.TriagerContradictedItself):
            pii_screen.screen_census(projection("a"), Contradicts())


class LedgerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "dispositions.jsonl"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_o_digesto_do_ledger_e_o_sha256_dos_bytes_escritos(self) -> None:
        rows = projection("a", "b")
        dispositions = pii_screen.screen_census(rows, RecordingTriager())
        digest = pii_screen.write_ledger(self.path, dispositions)
        self.assertEqual(
            digest, hashlib.sha256(self.path.read_bytes()).hexdigest()
        )

    def test_o_digesto_muda_com_o_conteudo(self) -> None:
        first = pii_screen.write_ledger(
            self.path, pii_screen.screen_census(projection("a"), RecordingTriager())
        )
        second = pii_screen.write_ledger(
            self.path,
            pii_screen.screen_census(
                projection("a"), RecordingTriager(flag_texts={"a"})
            ),
        )
        self.assertNotEqual(first, second)

    def test_o_ledger_e_escrito_em_LF_e_ordenado_pelo_par(self) -> None:
        rows = [
            pii_screen.ProjectionRow("z", digest_of("z"), "z"),
            pii_screen.ProjectionRow("a", digest_of("a"), "a"),
        ]
        pii_screen.write_ledger(
            self.path, pii_screen.screen_census(rows, RecordingTriager())
        )
        raw = self.path.read_bytes()
        self.assertNotIn(b"\r", raw)
        ids = [json.loads(line)["id"] for line in raw.decode("utf-8").splitlines()]
        # Ordenado pelo par e nao pela ordem de chegada: o digesto do ledger nao pode
        # depender da ordem em que o funil entregou as linhas.
        self.assertEqual(ids, ["a", "z"])

    def test_le_de_volta_o_que_escreveu(self) -> None:
        rows = projection("limpo", "com pii")
        written = pii_screen.screen_census(
            rows, RecordingTriager(flag_texts={"com pii"})
        )
        pii_screen.write_ledger(self.path, written)
        ledger = pii_screen.read_ledger(self.path)
        self.assertEqual(len(ledger), 2)
        self.assertEqual(
            ledger[("r1", rows[0].text_sha256)].disposition, "passed"
        )
        self.assertEqual(
            ledger[("r2", rows[1].text_sha256)].disposition, "flagged-dropped"
        )

    def test_recusa_par_duplicado(self) -> None:
        line = json.dumps(
            {
                "id": "r1",
                "textSha256": "a" * 64,
                "disposition": "passed",
                "subtypes": [],
            }
        )
        self.path.write_text(line + "\n" + line + "\n", encoding="utf-8", newline="\n")
        with self.assertRaises(pii_screen.LedgerUnreadable) as caught:
            pii_screen.read_ledger(self.path)
        self.assertIn("r1", str(caught.exception))

    def test_recusa_disposicao_fora_da_uniao(self) -> None:
        self.path.write_text(
            json.dumps(
                {
                    "id": "r1",
                    "textSha256": "a" * 64,
                    "disposition": "flagged-human-cleared",
                    "subtypes": [],
                }
            )
            + "\n",
            encoding="utf-8",
            newline="\n",
        )
        with self.assertRaises(pii_screen.LedgerUnreadable) as caught:
            pii_screen.read_ledger(self.path)
        # O valor recusado e exactamente o do HIBRIDO da v2 (§ 5.14b), e recusa-lo aqui
        # e o que impede a v2 de entrar por acidente numa execucao da v1.
        self.assertIn("flagged-human-cleared", str(caught.exception))

    def test_recusa_campo_ausente_e_digesto_malformado(self) -> None:
        for body in (
            {"id": "r1", "disposition": "passed", "subtypes": []},
            {"id": "r1", "textSha256": "curto", "disposition": "passed", "subtypes": []},
            {"id": "", "textSha256": "a" * 64, "disposition": "passed", "subtypes": []},
        ):
            self.path.write_text(
                json.dumps(body) + "\n", encoding="utf-8", newline="\n"
            )
            with self.assertRaises(pii_screen.LedgerUnreadable):
                pii_screen.read_ledger(self.path)

    def test_recusa_subtipo_fora_da_taxonomia_na_leitura(self) -> None:
        self.path.write_text(
            json.dumps(
                {
                    "id": "r1",
                    "textSha256": "a" * 64,
                    "disposition": "flagged-dropped",
                    "subtypes": ["categoria-inventada"],
                }
            )
            + "\n",
            encoding="utf-8",
            newline="\n",
        )
        with self.assertRaises(pii_screen.LedgerUnreadable):
            pii_screen.read_ledger(self.path)

    def test_recusa_arquivo_ausente_nomeando_o_caminho(self) -> None:
        missing = Path(self.tmp.name) / "nao-existe.jsonl"
        with self.assertRaises(pii_screen.LedgerUnreadable) as caught:
            pii_screen.read_ledger(missing)
        self.assertIn("nao-existe.jsonl", str(caught.exception))


class CoverageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "d.jsonl"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def ledger_over(self, rows, flag=frozenset()):
        pii_screen.write_ledger(
            self.path, pii_screen.screen_census(rows, RecordingTriager(set(flag)))
        )
        return pii_screen.read_ledger(self.path)

    def test_projecao_coberta_passa(self) -> None:
        rows = projection("a", "b")
        pii_screen.assert_the_ledger_covers(rows, self.ledger_over(rows))

    def test_linha_da_projecao_sem_linha_no_ledger_recusa_nomeando_o_id(self) -> None:
        rows = projection("a", "b")
        ledger = self.ledger_over(rows[:1])
        with self.assertRaises(pii_screen.CensusIncomplete) as caught:
            pii_screen.assert_the_ledger_covers(rows, ledger)
        self.assertIn("r2", str(caught.exception))
        self.assertIn("1 de 2", str(caught.exception))

    def test_texto_que_mudou_depois_do_snapshot_recusa(self) -> None:
        # Risco declarado do perfil: "mutacao de bytes". O par nao casa porque o digesto
        # e outro, e o id igual nao salva a linha.
        rows = projection("a")
        ledger = self.ledger_over(rows)
        mutated = [
            pii_screen.ProjectionRow(rows[0].row_id, digest_of("a mudou"), "a mudou")
        ]
        with self.assertRaises(pii_screen.CensusIncomplete):
            pii_screen.assert_the_ledger_covers(mutated, ledger)


class SelectionGuardTests(unittest.TestCase):
    """D-13 + D-19: a guarda da montagem exige `passed`, e presenca do par nao basta."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "d.jsonl"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def ledger_over(self, rows, flag=frozenset()):
        pii_screen.write_ledger(
            self.path, pii_screen.screen_census(rows, RecordingTriager(set(flag)))
        )
        return pii_screen.read_ledger(self.path)

    def test_registro_com_par_passed_passa(self) -> None:
        rows = projection("a", "b")
        ledger = self.ledger_over(rows)
        pii_screen.assert_selected_records_passed(
            [(row.row_id, row.text_sha256) for row in rows], ledger
        )

    def test_registro_cujo_par_ESTA_no_ledger_mas_como_flagged_dropped_RECUSA(
        self,
    ) -> None:
        # O caso que separa "presenca do par" de "disposicao passed", e e o unico que
        # D-13 nomeia: presenca inclui os sinalizados.
        rows = projection("limpo", "com pii")
        ledger = self.ledger_over(rows, flag={"com pii"})
        with self.assertRaises(pii_screen.SelectedRecordWasFlagged) as caught:
            pii_screen.assert_selected_records_passed(
                [(row.row_id, row.text_sha256) for row in rows], ledger
            )
        self.assertIn("r2", str(caught.exception))
        self.assertIn("flagged-dropped", str(caught.exception))

    def test_registro_sem_par_nenhum_recusa_com_erro_DIFERENTE(self) -> None:
        # Dois erros e nao um: "ninguem triou esta linha" e "esta linha foi sinalizada"
        # mandam o operador a trabalhos diferentes.
        rows = projection("a")
        ledger = self.ledger_over(rows)
        with self.assertRaises(pii_screen.SelectedRecordNotScreened) as caught:
            pii_screen.assert_selected_records_passed([("r9", digest_of("z"))], ledger)
        self.assertIn("r9", str(caught.exception))

    def test_conta_TODOS_os_recusados_e_nao_para_no_primeiro(self) -> None:
        rows = projection("a", "pii1", "pii2", "pii3")
        ledger = self.ledger_over(rows, flag={"pii1", "pii2", "pii3"})
        with self.assertRaises(pii_screen.SelectedRecordWasFlagged) as caught:
            pii_screen.assert_selected_records_passed(
                [(row.row_id, row.text_sha256) for row in rows], ledger
            )
        self.assertIn("3 de 4", str(caught.exception))


class PostHocTests(unittest.TestCase):
    """D-18: TRES categorias, e `k - c` nao e uma delas."""

    def test_as_tres_categorias_somam_k(self) -> None:
        breakdown = pii_screen.post_hoc_breakdown(flagged=100, reviewed=40, confirmed=25)
        self.assertEqual(breakdown["confirmed"], 25)
        self.assertEqual(breakdown["falsePositives"], 15)
        self.assertEqual(breakdown["notReviewed"], 60)
        self.assertEqual(
            breakdown["confirmed"]
            + breakdown["falsePositives"]
            + breakdown["notReviewed"],
            100,
        )

    def test_o_falso_positivo_e_r_menos_c_e_NUNCA_k_menos_c(self) -> None:
        breakdown = pii_screen.post_hoc_breakdown(flagged=100, reviewed=40, confirmed=25)
        # `k - c` daria 75, que colapsaria os 60 nao revistos em falsos positivos e
        # publicaria uma precisao inventada sobre material que ninguem leu.
        self.assertNotEqual(breakdown["falsePositives"], 100 - 25)
        self.assertEqual(breakdown["falsePositives"], 40 - 25)

    def test_sem_revisao_nenhuma_as_tres_categorias_sao_honestas(self) -> None:
        breakdown = pii_screen.post_hoc_breakdown(flagged=100, reviewed=0, confirmed=0)
        self.assertEqual(breakdown["confirmed"], 0)
        self.assertEqual(breakdown["falsePositives"], 0)
        self.assertEqual(breakdown["notReviewed"], 100)
        # E a precisao NAO e publicada como zero: nao ha denominador.
        self.assertIsNone(breakdown["precisionAmongReviewed"])

    def test_a_precisao_e_sobre_os_REVISTOS_e_nao_sobre_os_sinalizados(self) -> None:
        breakdown = pii_screen.post_hoc_breakdown(flagged=100, reviewed=40, confirmed=25)
        # O denominador e `r` e nao `k`: 25/40 e nao 25/100. Risco declarado do perfil:
        # confusao de PPV, e o nome do campo e parte da guarda contra ela.
        self.assertAlmostEqual(breakdown["precisionAmongReviewed"], 25 / 40)
        self.assertNotAlmostEqual(breakdown["precisionAmongReviewed"], 25 / 100)
        self.assertIn("precisionAmongReviewed", breakdown)
        self.assertNotIn("precision", breakdown)

    def test_recusa_aritmetica_impossivel(self) -> None:
        for flagged, reviewed, confirmed in (
            (10, 11, 0),
            (10, 5, 6),
            (-1, 0, 0),
            (10, -1, 0),
            (10, 5, -1),
        ):
            with self.assertRaises(ValueError):
                pii_screen.post_hoc_breakdown(
                    flagged=flagged, reviewed=reviewed, confirmed=confirmed
                )


class ProtocolBindingTests(unittest.TestCase):
    def test_o_censo_le_a_taxonomia_do_protocolo_e_nao_uma_copia(self) -> None:
        # Uma lista propria de subtipos aqui seria uma segunda taxonomia capaz de
        # discordar da pre-inscrita, e a pre-inscrita e a que o recibo cita. A igualdade
        # de conjuntos nao distingue leitura de copia: quem distingue e MOVER a
        # pre-inscrita e ver a leitura mover com ela.
        self.assertEqual(
            set(pii_screen.taxonomy_keys()),
            {subtype.key for subtype in protocol.TAXONOMY},
        )
        original = protocol.TAXONOMY
        try:
            protocol.TAXONOMY = original + (
                protocol.Subtype("subtipo-de-teste", "prose-only", "fixture", 0.70),
            )
            self.assertIn("subtipo-de-teste", pii_screen.taxonomy_keys())
            # E o censo aceita-o, porque a autoridade e o protocolo e nao uma copia.
            class Flags:
                def __call__(self, text):
                    return pii_screen.TriageVerdict(
                        flagged=True, subtypes=("subtipo-de-teste",)
                    )

            got = pii_screen.screen_census(projection("x"), Flags())
            self.assertEqual(got[0].subtypes, ("subtipo-de-teste",))
        finally:
            protocol.TAXONOMY = original
        self.assertNotIn("subtipo-de-teste", pii_screen.taxonomy_keys())


if __name__ == "__main__":
    unittest.main()
