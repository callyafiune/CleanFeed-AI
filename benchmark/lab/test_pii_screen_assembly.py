"""A triagem DENTRO do funil do montador (run: py -3.13 -m pytest).

O que este arquivo prende:

  * a POSICAO: a projecao e tomada depois da ultima poda determinística e depois de
    `enforce_unique_keys`, antes da selecao, da cota e do split;
  * o SNAPSHOT carrega texto, logo nao pode ser escrito dentro da arvore de fontes —
    D-4 manda os logs para `benchmark/data/`, que e gitignored;
  * o DROP: todo sinalizado sai, e a mista cujo PAI saiu sai em categoria propria;
  * a GUARDA: por registro selecionado, `disposition == "passed"`;
  * o SELO: a corrida `llm-pii-screen` e estampada DEPOIS da guarda, nunca antes;
  * o PREFLIGHT: os sobreviventes reais sao contados por classe depois do drop.

A ponte pai/mista e MEDIDA aqui e nao raciocinada: `enforce_unique_keys` renomeia o lado
HUMANO quando `mixed.parentId` colide com `human.candidateId` — medido, e nao o contrario —,
entao a chave que a mista nomeia deixa de existir. A cascata atravessa isso pela chave
ORIGINAL carimbada na propria linha, e nao por um mapa velho -> novo: dois renomeios podem
partir da mesma chave antiga, e um mapa nao os distingue.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import assemble_corpus as ac
import pii_screen
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


class RenameMapTests(unittest.TestCase):
    def test_enforce_unique_keys_devolve_o_mapa_de_renomeios(self) -> None:
        humans = [human_candidate("src_p1", "ptwiki_page_1")]
        mixed = [mixed_candidate("src_p1", "outro texto " * 20)]
        renames = ac.enforce_unique_keys(
            [([], "candidateId"), (mixed, "parentId"), (humans, "candidateId")]
        )
        # O mapa e para o operador ler no log: e o unico sitio que diz quantas chaves
        # foram desambiguadas e quais. A cascata nao o usa (usa o carimbo na linha).
        self.assertEqual(list(renames), ["src_p1"])
        self.assertEqual(renames["src_p1"], humans[0]["candidateId"])
        self.assertNotEqual(humans[0]["candidateId"], "src_p1")
        self.assertEqual(mixed[0]["parentId"], "src_p1")

    def test_sem_colisao_o_mapa_e_vazio(self) -> None:
        humans = [human_candidate("src_p1", "ptwiki_page_1")]
        mixed = [mixed_candidate("src_p9", "outro texto " * 20)]
        self.assertEqual(
            ac.enforce_unique_keys(
                [([], "candidateId"), (mixed, "parentId"), (humans, "candidateId")]
            ),
            {},
        )


class ProjectionTests(unittest.TestCase):
    def test_uma_linha_por_linha_de_pool_com_a_chave_do_funil(self) -> None:
        humans = [human_candidate("h1", "ptwiki_page_1")]
        ai = [{"candidateId": "a1", "text": "texto ai " * 20}]
        mixed = [mixed_candidate("h9", "texto misto " * 20)]
        projection = ac.screening_projection(humans, ai, mixed)
        self.assertEqual([row.row_id for row in projection], ["a1", "h9", "h1"])

    def test_o_digesto_e_o_da_regra_SELADA_e_nao_o_da_regra_do_lab(self) -> None:
        # `norm_hash` e a regra que a ingestao aplica (CRLF/CR para LF, depois NFC) e e o
        # valor que o corpus publica em `normalizedTextSha256`. `common.normalize_text` faz
        # MAIS — colapsa espaco, apara linha — e usa-la aqui daria um par que ninguem
        # consegue re-derivar do `records.jsonl`.
        text = "linha um\r\nlinha  dois  \n\n\n\nfim"
        projection = ac.screening_projection(
            [], [{"candidateId": "a1", "text": text}], []
        )
        self.assertEqual(projection[0].text_sha256, ac.norm_hash(text)[1])
        import common

        self.assertNotEqual(
            projection[0].text_sha256, ac.norm_hash(common.normalize_text(text))[1]
        )

    def test_recusa_a_projecao_tomada_ANTES_da_desambiguacao(self) -> None:
        # A mista e chaveada pelo `parentId`, que e o `candidateId` do pai: antes de
        # `enforce_unique_keys` as duas linhas partilham a chave, e uma projecao tomada
        # ali leria o mesmo id duas vezes.
        humans = [human_candidate("src_p1", "p1")]
        mixed = [mixed_candidate("src_p1", "outro texto " * 20)]
        with self.assertRaises(ac.ProjectionKeyCollision) as caught:
            ac.screening_projection(humans, [], mixed)
        self.assertIn("src_p1", str(caught.exception))
        self.assertIn("enforce_unique_keys", str(caught.exception))
        # E DEPOIS dela a mesma projecao passa: e a ordem, e nao o material.
        ac.enforce_unique_keys(
            [([], "candidateId"), (mixed, "parentId"), (humans, "candidateId")]
        )
        self.assertEqual(len(ac.screening_projection(humans, [], mixed)), 2)

    def test_o_texto_da_projecao_e_o_texto_da_linha(self) -> None:
        projection = ac.screening_projection(
            [], [{"candidateId": "a1", "text": "  vem  assim  "}], []
        )
        self.assertEqual(projection[0].text, "  vem  assim  ")


class SnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_escreve_o_snapshot_e_devolve_o_digesto_I(self) -> None:
        path = Path(self.tmp.name) / "snapshot.jsonl"
        projection = ac.screening_projection(
            [], [{"candidateId": "a1", "text": "x " * 20}], []
        )
        digest = ac.emit_screening_snapshot(path, projection)
        import hashlib

        self.assertEqual(digest, hashlib.sha256(path.read_bytes()).hexdigest())
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(len(rows), 1)
        self.assertEqual(set(rows[0]), {"id", "textSha256", "text"})

    def test_recusa_escrever_dentro_da_arvore_de_fontes_E_NAO_ESCREVE(self) -> None:
        # D-4: o snapshot CARREGA TEXTO, e o texto pode conter PII real. Os logs vivem
        # sob `benchmark/data/`, que e gitignored; escrever dentro de `benchmark/` fora
        # de `data/` poria texto de origem num caminho rastreavel.
        #
        # A SEGUNDA metade do nome e a que importa, e foi uma bateria que a ensinou:
        # desligar a guarda deixou 76 KB de texto num arquivo sob `docs/`, e o teste
        # antigo — que so afirmava a excecao — nao dizia nada sobre o arquivo. "Recusa" e
        # "recusa e nao escreve" sao alegacoes diferentes, e e a segunda que D-4 quer.
        # O `finally` existe para uma mutacao futura nao deixar lixo na arvore.
        repo = Path(ac.__file__).resolve().parents[2]
        projection = ac.screening_projection(
            [], [{"candidateId": "a1", "text": "texto que nao pode vazar " * 5}], []
        )
        for forbidden in (
            repo / "benchmark" / "_teste_snapshot.jsonl",
            repo / "benchmark" / "lab" / "_teste_snapshot.jsonl",
            repo / "docs" / "_teste_snapshot.jsonl",
            repo / "src" / "_teste_snapshot.jsonl",
            repo / "contracts" / "_teste_snapshot.jsonl",
            repo / "scripts" / "_teste_snapshot.jsonl",
        ):
            try:
                with self.assertRaises(ac.SnapshotPathIsTracked) as caught:
                    ac.emit_screening_snapshot(forbidden, projection)
                self.assertIn(
                    "benchmark/data", str(caught.exception).replace("\\", "/")
                )
                self.assertFalse(
                    forbidden.exists(),
                    f"{forbidden} foi ESCRITO apesar da recusa",
                )
            finally:
                forbidden.unlink(missing_ok=True)

    def test_aceita_benchmark_data_e_qualquer_caminho_fora_do_repositorio(self) -> None:
        repo = Path(ac.__file__).resolve().parents[2]
        inside_data = repo / "benchmark" / "data" / "_teste_snapshot.jsonl"
        try:
            ac.emit_screening_snapshot(inside_data, [])
            self.assertTrue(inside_data.exists())
        finally:
            inside_data.unlink(missing_ok=True)
        outside = Path(self.tmp.name) / "fora.jsonl"
        ac.emit_screening_snapshot(outside, [])
        self.assertTrue(outside.exists())


class DropTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "d.jsonl"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def ledger_for(self, projection, flagged_ids=frozenset()):
        class Triager:
            def __init__(self, flag_texts):
                self.flag_texts = flag_texts

            def __call__(self, text):
                if text in self.flag_texts:
                    return pii_screen.TriageVerdict(True, ("email",))
                return pii_screen.TriageVerdict(False)

        flag_texts = {
            row.text for row in projection if row.row_id in flagged_ids
        }
        pii_screen.write_ledger(
            self.path, pii_screen.screen_census(projection, Triager(flag_texts))
        )
        return pii_screen.read_ledger(self.path)

    def test_o_sinalizado_sai_de_cada_pool(self) -> None:
        humans = [human_candidate("h1", "p1"), human_candidate("h2", "p2", PROSE + " dois")]
        ai = [{"candidateId": "a1", "text": "ai um " * 20}]
        mixed = [mixed_candidate("m1", "misto um " * 20)]
        projection = ac.screening_projection(humans, ai, mixed)
        ledger = self.ledger_for(projection, {"h2", "a1"})
        result = ac.drop_the_flagged(humans, ai, mixed, ledger)
        self.assertEqual([r["candidateId"] for r in result.humans], ["h1"])
        self.assertEqual(result.ai, [])
        self.assertEqual(len(result.mixed), 1)
        self.assertEqual(result.counts["flagged"], 2)

    def test_a_mista_cujo_PAI_saiu_sai_em_categoria_propria(self) -> None:
        humans = [human_candidate("h1", "p1")]
        mixed = [mixed_candidate("h1", "misto derivado " * 20)]
        # `enforce_unique_keys` PRIMEIRO, que e a ordem real: antes dele a mista e o pai
        # partilham a chave do funil, e a projecao recusa.
        ac.enforce_unique_keys(
            [([], "candidateId"), (mixed, "parentId"), (humans, "candidateId")]
        )
        projection = ac.screening_projection(humans, [], mixed)
        ledger = self.ledger_for(projection, {humans[0]["candidateId"]})
        result = ac.drop_the_flagged(humans, [], mixed, ledger)
        self.assertEqual(result.humans, [])
        self.assertEqual(result.mixed, [])
        # Categoria PROPRIA: a mista nao foi sinalizada, saiu porque o pai saiu, e somar
        # as duas esconderia o custo do falso positivo no pai.
        self.assertEqual(result.counts["flagged"], 1)
        self.assertEqual(result.counts["cascade-parent-flagged"], 1)

    def test_a_cascata_atravessa_o_RENOMEIO_do_pai(self) -> None:
        # O caso medido: `enforce_unique_keys` renomeia o lado humano, entao a chave que a
        # mista nomeia deixou de existir. Sem o mapa a cascata nao acha o pai e a mista
        # derivada de um pai sinalizado FICA.
        humans = [human_candidate("src_p1", "p1")]
        mixed = [mixed_candidate("src_p1", "misto derivado " * 20)]
        renames = ac.enforce_unique_keys(
            [([], "candidateId"), (mixed, "parentId"), (humans, "candidateId")]
        )
        self.assertEqual(list(renames), ["src_p1"])
        # A ligacao NAO vem de um mapa lateral: vem carimbada na propria linha, porque
        # dois renomeios podem partir da MESMA chave antiga e um mapa velho -> novo nao
        # os distingue.
        projection = ac.screening_projection(humans, [], mixed)
        ledger = self.ledger_for(projection, {humans[0]["candidateId"]})
        result = ac.drop_the_flagged(humans, [], mixed, ledger)
        self.assertEqual(result.counts["cascade-parent-flagged"], 1)
        self.assertEqual(result.mixed, [])

    def test_mista_cujo_pai_nao_resolve_e_CONTADA_e_nao_calada(self) -> None:
        humans = [human_candidate("h1", "p1")]
        mixed = [mixed_candidate("pai_que_nao_existe", "misto " * 20)]
        projection = ac.screening_projection(humans, [], mixed)
        ledger = self.ledger_for(projection)
        result = ac.drop_the_flagged(humans, [], mixed, ledger)
        # Publicada com denominador: uma ligacao quebrada tem de ser um numero, e nao um
        # zero silencioso na categoria da cascata.
        self.assertEqual(result.counts["parent-unresolved"], 1)
        self.assertEqual(result.counts["cascade-parent-flagged"], 0)
        self.assertEqual(len(result.mixed), 1)

    def test_a_cobertura_e_exigida_antes_do_drop(self) -> None:
        humans = [human_candidate("h1", "p1"), human_candidate("h2", "p2", PROSE + " dois")]
        projection = ac.screening_projection(humans, [], [])
        partial = self.ledger_for(projection[:1])
        with self.assertRaises(pii_screen.CensusIncomplete):
            ac.drop_the_flagged(humans, [], [], partial)


class StampAndGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "d.jsonl"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def built_pair(self, flagged: bool):
        cand = human_candidate("h1", "ptwiki_page_1")
        projection = ac.screening_projection([cand], [], [])

        class Triager:
            def __call__(self, text):
                return (
                    pii_screen.TriageVerdict(True, ("email",))
                    if flagged
                    else pii_screen.TriageVerdict(False)
                )

        pii_screen.write_ledger(
            self.path, pii_screen.screen_census(projection, Triager())
        )
        ledger = pii_screen.read_ledger(self.path)
        record = ac.human_record(cand, "ptwiki", None, evidence_sink=[])
        return [("h1", record)], ledger

    def test_a_guarda_aceita_o_registro_cujo_par_passou(self) -> None:
        built, ledger = self.built_pair(flagged=False)
        ac.assert_the_screen_passed_every_selected_record(built, ledger)

    def test_a_guarda_recusa_o_registro_cujo_par_foi_sinalizado(self) -> None:
        built, ledger = self.built_pair(flagged=True)
        with self.assertRaises(pii_screen.SelectedRecordWasFlagged):
            ac.assert_the_screen_passed_every_selected_record(built, ledger)

    def test_a_guarda_le_o_digesto_do_TEXTO_DO_REGISTRO_e_nao_o_da_projecao(self) -> None:
        # Mutacao de bytes: se o texto escrito no registro divergir do que foi triado, o
        # par nao casa. A guarda recomputa do registro, nunca reusa o da projecao.
        built, ledger = self.built_pair(flagged=False)
        built[0][1]["text"] = built[0][1]["text"] + " sufixo que ninguem triou"
        with self.assertRaises(pii_screen.SelectedRecordNotScreened):
            ac.assert_the_screen_passed_every_selected_record(built, ledger)

    def test_o_selo_da_corrida_entra_na_lista_de_filtros_do_registro(self) -> None:
        built, _ = self.built_pair(flagged=False)
        record = built[0][1]
        before = len(record["review"]["automatedFilters"])
        ac.stamp_the_screen_run(record)
        filters = record["review"]["automatedFilters"]
        self.assertEqual(len(filters), before + 1)
        stamped = filters[-1]
        self.assertEqual(stamped["filter"], "llm-pii-screen")
        self.assertEqual(stamped["outcome"], "passed")
        self.assertIn("pii_screen.py", stamped["implementation"])
        # O estado NAO muda: um filtro nao e uma revisao.
        self.assertEqual(record["review"]["state"], "automated/unreviewed")

    def test_o_selo_nao_se_estampa_duas_vezes(self) -> None:
        built, _ = self.built_pair(flagged=False)
        record = built[0][1]
        ac.stamp_the_screen_run(record)
        ac.stamp_the_screen_run(record)
        names = [f["filter"] for f in record["review"]["automatedFilters"]]
        self.assertEqual(names.count("llm-pii-screen"), 1)

    def test_uma_linha_GERADA_tambem_recebe_o_selo(self) -> None:
        # A docstring de `review_state` dizia que nenhum filtro nosso viu uma linha
        # gerada. Com o censo isso deixou de ser verdade, e o mecanismo e este.
        record = {
            "review": {
                "state": "automated/unreviewed",
                "automatedFilters": [],
                "humanAuditAbsentReason": ac.NO_HUMAN_AUDIT,
            }
        }
        ac.stamp_the_screen_run(record)
        self.assertEqual(
            [f["filter"] for f in record["review"]["automatedFilters"]],
            ["llm-pii-screen"],
        )


class TextIsVerbatimTests(unittest.TestCase):
    """Por que a guarda de `main()` nao tem hoje entrada que a faca FALHAR, e o que
    torna essa afirmacao verificavel em vez de raciocinada.

    Medido: retirar a chamada de `assert_the_screen_passed_every_selected_record` de
    `main()` deixa a suite VERDE. A razao nao e que a guarda seja decorativa — D-13
    exige-a — e sim que hoje ela e IMPLICADA por tres factos: a cobertura provou que todo
    par da projecao esta no ledger, o drop removeu toda linha que nao diz `passed`, e
    nada entre a projecao e o registro escrito toca o `text`.

    O terceiro e o fragil, e e o que este caso prende. Se alguem puser uma transformacao
    de texto num construtor, ele fica VERMELHO — e esse vermelho e o aviso de que a
    guarda passou a ser alcancavel e precisa da sua propria entrada.
    """

    def test_os_construtores_passam_o_texto_BYTE_A_BYTE(self) -> None:
        adversarial = "  espaco   duplo\r\nlinha\n\n\n\nfim  "
        cand = human_candidate("h1", "ptwiki_page_1", adversarial)
        record = ac.human_record(cand, "ptwiki", None, evidence_sink=[])
        self.assertEqual(record["text"], adversarial)

        mixed = mixed_candidate("h9", adversarial)
        self.assertEqual(ac.mixed_record(mixed)["text"], adversarial)

    def test_o_digesto_do_registro_e_o_da_projecao_no_mesmo_texto(self) -> None:
        # A consequencia da igualdade acima, dita como aritmetica: e este par que a
        # guarda junta, e se as duas pontas divergirem ela e que o diz.
        adversarial = "  espaco   duplo\r\nlinha\n\n\n\nfim  "
        cand = human_candidate("h1", "ptwiki_page_1", adversarial)
        projection = ac.screening_projection([cand], [], [])
        record = ac.human_record(cand, "ptwiki", None, evidence_sink=[])
        self.assertEqual(projection[0].text_sha256, ac.norm_hash(record["text"])[1])


class SurvivorPreflightTests(unittest.TestCase):
    """D-15 + D-21: os SOBREVIVENTES reais, contados depois da ultima poda."""

    def test_conta_por_classe_e_aceita_quando_sobra_o_bastante(self) -> None:
        counts = {"human": 4, "ai": 4, "mixed": 2}
        ac.assert_the_survivors_meet_the_quota(
            survivors={"human": 4, "ai": 5, "mixed": 2}, counts=counts
        )

    def test_recusa_nomeando_a_classe_e_a_falta(self) -> None:
        counts = {"human": 4, "ai": 4, "mixed": 2}
        with self.assertRaises(ac.SurvivorsBelowQuota) as caught:
            ac.assert_the_survivors_meet_the_quota(
                survivors={"human": 4, "ai": 3, "mixed": 0}, counts=counts
            )
        message = str(caught.exception)
        self.assertIn("ai", message)
        self.assertIn("mixed", message)
        # As DUAS classes, e nao so a primeira: quem le precisa de saber o tamanho do
        # buraco inteiro antes de decidir regenerar.
        self.assertIn("3/4", message)
        self.assertIn("0/2", message)


if __name__ == "__main__":
    unittest.main()
