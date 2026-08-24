"""`main()` DIRIGIDO, porque as duas costuras novas do funil nao tinham entrada.

Toda a logica da triagem esta em funcoes puras, e essas ja tem casos. O que este arquivo
prende e o que nenhuma delas prende: que `main()` as CHAMA, na ordem certa, e que
`--emit-screening-snapshot` PARA antes da selecao. Uma costura sem entrada de teste e a
familia de defeito que a § 7 do ESTADO ja nomeia — "guarda que nenhuma entrada alcanca".

O caminho exercitado e o do snapshot, que retorna cedo de proposito: ele passa por pools,
dedup, poda, desambiguacao, projecao e escrita, que sao exactamente as etapas que decidem
o par do ledger.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

import assemble_corpus as ac
import pii_screen
from group_axes import NO_SINGLE_AUTHOR, known, not_applicable


def human_row(index: int) -> dict:
    # ESPACO EM VOLTA de proposito. O par do ledger e o digesto do texto tal como ele e,
    # e um fixture limpo tornaria vacua a igualdade entre o digesto da projecao e o do
    # registro escrito: com texto sem bordas, um construtor que apare-las nao mudaria
    # nada. Com bordas, apara-las quebra o par — e e a guarda que o diz.
    text = "  " + " ".join(f"palavra{index}_{n}" for n in range(60)) + "  "
    return {
        "candidateId": f"src_ptwiki_h{index}",
        "text": text,
        "wordCount": 60,
        "domainSource": "ptwiki_lead",
        "licenseId": "cc-by-sa-4.0",
        "createdAt": 1621555200000,
        "meta": {
            "dateField": "pages-articles.xml@revision/timestamp",
            "observedValue": "2021-05-21T00:00:00+00:00",
            "groupAxes": {
                "source": known(f"ptwiki_page_{index}"),
                "author": not_applicable(NO_SINGLE_AUTHOR),
            },
            "sourceMaterialBatch": "smb_ptwiki-20220301",
            "extractionRun": "er_teste",
        },
    }


def qwen_row(index: int) -> dict:
    """Uma linha da reserva OOD.

    Sem ela `main()` recusa com `HeldOutReserveEmpty`: um corpus so humano nao sustenta
    alegacao de gerador nao visto, e a lista de familias reservadas do manifesto selado
    nao pode sair vazia. A familia e a que o slate reserva, `qwen2_5-7b-q4km`.
    """
    import hashlib

    text = " ".join(f"gerada{index}_{n}" for n in range(60))
    return {
        "candidateId": f"src_ai_ollama_{index:04d}",
        "text": text,
        "wordCount": 60,
        "meta": {
            "provider": "ollama",
            "family": "qwen2.5-7b-q4km",
            "model": "qwen2.5:7b",
            "version": "qwen2.5:7b@845dbda0ea48",
            "harnessVersion": "ollama 0.32.6",
            "recipe": "original",
            "generationLane": "ollama",
            "promptId": f"original_src_ptwiki_h{index}",
            "promptSha256": hashlib.sha256(b"p").hexdigest(),
            # DISTINTO por linha: `promptTemplate` e eixo de agrupamento, entao um
            # digesto partilhado uniria TODAS as geradas num componente so e o split
            # nao teria granularidade para a menor particao.
            "promptTemplateDigest": hashlib.sha256(
                f"t{index}".encode("utf-8")
            ).hexdigest(),
            "pairedWith": f"src_ptwiki_h{index}",
            "generatedAt": "2026-07-24T13:51:05.004170+00:00",
        },
    }


def core_ai_row(index: int) -> dict:
    """Uma linha do NUCLEO da geracao, na pista `gemini-api`.

    Ela existe para a reserva ser estritamente MENOR que o bloco cego: sem nucleo, a
    reserva enche o bloco e `ReserveFillsTheBlindBlock` recusa — o slice de gerador nao
    visto ficaria sem positivo do nucleo por onde ler recall.
    """
    import hashlib

    text = " ".join(f"nucleo{index}_{n}" for n in range(60))
    return {
        "candidateId": f"src_ai_gemini_{index:04d}",
        "text": text,
        "wordCount": 60,
        "meta": {
            "provider": "gemini",
            "family": "gemini-3.5-flash-lite",
            "model": "gemini-3.5-flash-lite",
            "version": "gemini-3.5-flash-lite",
            "recipe": "original",
            "generationLane": "gemini-api",
            "temperature": "0.8",
            "promptId": f"original_src_ptwiki_h{index}",
            "promptSha256": hashlib.sha256(b"p").hexdigest(),
            # DISTINTO por linha: `promptTemplate` e eixo de agrupamento, entao um
            # digesto partilhado uniria TODAS as geradas num componente so e o split
            # nao teria granularidade para a menor particao.
            "promptTemplateDigest": hashlib.sha256(
                f"t{index}".encode("utf-8")
            ).hexdigest(),
            "pairedWith": f"src_ptwiki_h{index}",
            "generatedAt": "2026-07-24T13:51:05.004170+00:00",
        },
    }


class MainSnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.candidates = self.root / "candidates"
        self.candidates.mkdir()
        (self.candidates / "wikipedia_fresh.jsonl").write_text(
            "".join(
                json.dumps(human_row(index), ensure_ascii=False) + "\n"
                for index in range(1, 46)
            ),
            encoding="utf-8",
            newline="\n",
        )
        (self.candidates / "ai_reserved_qwen.jsonl").write_text(
            "".join(
                json.dumps(qwen_row(index), ensure_ascii=False) + chr(10)
                for index in range(1, 6)
            ),
            encoding="utf-8",
            newline=chr(10),
        )
        (self.candidates / "ai_fresh_gemini.jsonl").write_text(
            "".join(
                json.dumps(core_ai_row(index), ensure_ascii=False) + chr(10)
                for index in range(1, 41)
            ),
            encoding="utf-8",
            newline=chr(10),
        )
        self.argv = sys.argv
        # HERMETICO de proposito, e o desvio mede uma coisa: `load_humans` le
        # `reserved.jsonl` de um caminho FIXO, fora de `--candidates-dir`. Sem este
        # desvio a corrida colhe o material real em disco — medido, 580 linhas
        # reservadas — e um teste que depende do que esta em benchmark/data nao e teste.
        self.dataset = ac.DATASET
        ac.DATASET = self.root / "dataset-vazio"

    def tearDown(self) -> None:
        sys.argv = self.argv
        ac.DATASET = self.dataset
        self.tmp.cleanup()

    def run_main(self, *extra: str) -> None:
        sys.argv = [
            "assemble_corpus.py",
            "--out-dir",
            str(self.root / "out"),
            "--candidates-dir",
            str(self.candidates),
            "--sample",
            "100",
            # Indice de vistos AUSENTE: com `--sample` a poda global e dispensada com um
            # aviso, e ler o indice real tornaria o caso dependente do disco.
            "--seen-index",
            str(self.root / "sem-indice.json"),
            *extra,
        ]
        ac.main()

    def test_o_snapshot_sai_com_uma_linha_por_candidato_e_main_PARA(self) -> None:
        snapshot = self.root / "snapshot.jsonl"
        self.run_main("--emit-screening-snapshot", str(snapshot))
        rows = [
            json.loads(line)
            for line in snapshot.read_text(encoding="utf-8").splitlines()
        ]
        self.assertEqual(len(rows), 90)
        self.assertEqual(
            {row["id"] for row in rows},
            {f"src_ptwiki_h{index}" for index in range(1, 46)}
            | {f"src_ai_ollama_{index:04d}" for index in range(1, 6)}
            | {f"src_ai_gemini_{index:04d}" for index in range(1, 41)},
        )
        # PAROU: nada da montagem foi escrito, porque triar e o passo seguinte.
        self.assertFalse((self.root / "out" / "records.jsonl").exists())

    def test_o_par_do_snapshot_e_o_par_que_o_ledger_vai_carregar(self) -> None:
        snapshot = self.root / "snapshot.jsonl"
        self.run_main("--emit-screening-snapshot", str(snapshot))
        rows = [
            json.loads(line)
            for line in snapshot.read_text(encoding="utf-8").splitlines()
        ]
        by_id = {row["id"]: row for row in rows}
        for index in range(1, 46):
            candidate = human_row(index)
            self.assertEqual(
                by_id[candidate["candidateId"]]["textSha256"],
                ac.norm_hash(candidate["text"])[1],
            )

    def test_a_projecao_do_snapshot_alimenta_o_censo_sem_traducao(self) -> None:
        # O snapshot e legivel de volta como projecao: e o que faz do arquivo o contrato
        # entre o montador e a triagem, em vez de um relatorio.
        snapshot = self.root / "snapshot.jsonl"
        self.run_main("--emit-screening-snapshot", str(snapshot))
        projection = [
            pii_screen.ProjectionRow(
                row_id=row["id"], text_sha256=row["textSha256"], text=row["text"]
            )
            for row in (
                json.loads(line)
                for line in snapshot.read_text(encoding="utf-8").splitlines()
            )
        ]

        class Clean:
            def __call__(self, text):
                return pii_screen.TriageVerdict(flagged=False)

        ledger_path = self.root / "d.jsonl"
        pii_screen.write_ledger(
            ledger_path, pii_screen.screen_census(projection, Clean())
        )
        ledger = pii_screen.read_ledger(ledger_path)
        pii_screen.assert_the_ledger_covers(projection, ledger)
        self.assertEqual(len(ledger), 90)

    def screen_the_snapshot(self, snapshot: Path, flagged_ids=frozenset()) -> Path:
        rows = [
            json.loads(line)
            for line in snapshot.read_text(encoding="utf-8").splitlines()
        ]
        projection = [
            pii_screen.ProjectionRow(row["id"], row["textSha256"], row["text"])
            for row in rows
        ]
        flag_texts = {row.text for row in projection if row.row_id in flagged_ids}

        class Triager:
            def __call__(self, text):
                if text in flag_texts:
                    return pii_screen.TriageVerdict(True, ("full-name",))
                return pii_screen.TriageVerdict(False)

        ledger_path = self.root / "ledger.jsonl"
        pii_screen.write_ledger(
            ledger_path, pii_screen.screen_census(projection, Triager())
        )
        return ledger_path

    def test_a_montagem_COM_ledger_estampa_a_corrida_em_todo_registro(self) -> None:
        snapshot = self.root / "snapshot.jsonl"
        self.run_main("--emit-screening-snapshot", str(snapshot))
        ledger = self.screen_the_snapshot(snapshot)
        self.run_main("--pii-screen-ledger", str(ledger))
        records = [
            json.loads(line)
            for line in (self.root / "out" / "records.jsonl")
            .read_text(encoding="utf-8")
            .splitlines()
        ]
        self.assertTrue(records)
        for record in records:
            names = [f["filter"] for f in record["review"]["automatedFilters"]]
            self.assertIn("llm-pii-screen", names)
            # O ESTADO nao muda: um filtro nao e uma revisao.
            self.assertEqual(record["review"]["state"], "automated/unreviewed")

    def test_a_montagem_SEM_ledger_nao_estampa_nada(self) -> None:
        self.run_main()
        records = [
            json.loads(line)
            for line in (self.root / "out" / "records.jsonl")
            .read_text(encoding="utf-8")
            .splitlines()
        ]
        self.assertTrue(records)
        for record in records:
            names = [f["filter"] for f in record["review"]["automatedFilters"]]
            self.assertNotIn("llm-pii-screen", names)

    def test_o_sinalizado_nao_chega_ao_records_jsonl(self) -> None:
        snapshot = self.root / "snapshot.jsonl"
        self.run_main("--emit-screening-snapshot", str(snapshot))
        ledger = self.screen_the_snapshot(snapshot, {"src_ptwiki_h1"})
        self.run_main("--pii-screen-ledger", str(ledger))
        ids = [
            json.loads(line)["id"]
            for line in (self.root / "out" / "records.jsonl")
            .read_text(encoding="utf-8")
            .splitlines()
        ]
        # D-12 ponta a ponta: a linha sinalizada nao esta no corpus escrito.
        self.assertNotIn("src_ptwiki_h1", ids)

    def test_recusa_o_snapshot_rastreado_pelo_proprio_main_E_NAO_ESCREVE(self) -> None:
        # `finally` e `assertFalse` porque uma bateria ja deixou 76 KB de texto sob
        # `docs/` quando a guarda foi desligada: a alegacao e "recusa e nao escreve".
        repo = Path(ac.__file__).resolve().parents[2]
        forbidden = repo / "docs" / "_teste_main_snapshot.jsonl"
        try:
            with self.assertRaises(ac.SnapshotPathIsTracked):
                self.run_main("--emit-screening-snapshot", str(forbidden))
            self.assertFalse(forbidden.exists(), f"{forbidden} foi ESCRITO")
        finally:
            forbidden.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
