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
import near_dupes
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


def mixed_row(index: int, text: str) -> dict:
    """Uma linha mista cujo pai e `src_ptwiki_h<index>`, presente no pool humano."""
    import hashlib

    return {
        "parentId": f"src_ptwiki_h{index}",
        "text": text,
        "provider": "gemini",
        "generationLane": "gemini-api",
        "model": "gemini-3.5-flash-lite",
        "promptTemplateId": "mix-insercao-ilha-00",
        "promptTemplateDigest": hashlib.sha256(f"m{index}".encode("utf-8")).hexdigest(),
        "parentFamily": "ptwiki_lead",
        "sourceMaterialBatch": "smb_ptwiki-20220301",
        "temperature": "0.8",
        "generatedAt": "2026-07-24T13:51:05.004170+00:00",
        "mixture": {
            "spans": [
                {"start": 0, "end": 40, "origin": "human"},
                {"start": 40, "end": len(text), "origin": "ai"},
            ]
        },
    }


class MainSnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.candidates = self.root / "candidates"
        self.candidates.mkdir()
        (self.candidates / f"{ac.HUMAN_POOL_FILES[0]}.jsonl").write_text(
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

    def tearDown(self) -> None:
        sys.argv = self.argv
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
            # HERMETICO por ARGUMENTO, e nao por desvio de modulo: enquanto o caminho das
            # reservadas era fixo, este arquivo tinha de reescrever `ac.DATASET` por
            # dentro para nao colher as 583 linhas reais do disco — um teste que depende
            # do que esta em benchmark/data nao e teste.
            "--reserved",
            str(self.root / "sem-reservadas.jsonl"),
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

    def test_a_reservada_entra_no_pool_e_NAO_paga_chamada_de_triagem(self) -> None:
        # AS DUAS PONTAS, e sao duas alegacoes diferentes. (1) O caminho das reservadas e
        # ARGUMENTO: a linha escrita aqui e colhida, e um loader que lesse um caminho fixo
        # colheria as 583 do disco em vez desta. (2) Ela NAO entra na projecao do censo:
        # `human_record` recusa-a (nao carrega licenca, data nem eixos), entao pagar uma
        # chamada por ela seria pagar por linha que nao pode entrar no corpus de modo
        # nenhum — uma conta antes de uma chamada paga.
        import json as _json

        reservada = self.root / "reservadas.jsonl"
        reservada.write_text(
            _json.dumps(
                {
                    "id": "src_reservada_1",
                    "text": " ".join(f"reservada_{n}" for n in range(60)),
                    "label": 0,
                    "family": "ptwiki_lead",
                    "wordCount": 60,
                }
            )
            + chr(10),
            encoding="utf-8",
            newline=chr(10),
        )
        snapshot = self.root / "snapshot.jsonl"
        argv = [
            "assemble_corpus.py",
            "--out-dir",
            str(self.root / "out"),
            "--candidates-dir",
            str(self.candidates),
            "--sample",
            "100",
            "--seen-index",
            str(self.root / "sem-indice.json"),
            "--reserved",
            str(reservada),
            "--emit-screening-snapshot",
            str(snapshot),
        ]
        import contextlib
        import io as _io

        class Capturada(_io.StringIO):
            # `main()` chama `sys.stdout.reconfigure`, que um StringIO nao tem: o
            # montador fixa a codificacao da saida de proposito, porque os nomes de fonte
            # levam acento e a consola do Windows nao e utf-8 por omissao.
            def reconfigure(self, **_kwargs):
                return None

        saida = Capturada()
        sys.argv = argv
        with contextlib.redirect_stdout(saida):
            ac.main()
        log = saida.getvalue()
        # (1) colhida: 45 do arquivo fresco mais esta.
        self.assertIn("pools (dedup): human=46", log)
        # (2) e fora da projecao, contada pela razao.
        self.assertIn("MissingDocumentLicense: 1", log)
        ids = {
            _json.loads(linha)["id"]
            for linha in snapshot.read_text(encoding="utf-8").splitlines()
        }
        self.assertNotIn("src_reservada_1", ids)
        self.assertIn("src_ptwiki_h1", ids)

    def test_a_gerada_inexpressavel_tambem_NAO_paga_chamada(self) -> None:
        # A metade `ai` da mesma alegacao, e ela precisa de caso proprio: o pool humano e
        # o pool gerado sao substituidos em ramos diferentes do mesmo laco, e apagar um
        # deles deixava a suite verde enquanto o outro tinha caso.
        import json as _json

        # A SEMENTE TEM DE EXISTIR, e a primeira versao deste caso errava aqui: com
        # `pairedWith` a nomear uma humana que o pool nao tem, a linha saia como ORFA um
        # passo antes e o caso media o corte errado.
        quebrada = core_ai_row(1)
        quebrada["candidateId"] = "src_ai_gemini_0099"
        # TEXTO PROPRIO, e a segunda coisa que este caso precisou de aprender: com o
        # texto de `core_ai_row(1)` a linha era descartada pelo dedup exacto e nunca
        # chegava ao filtro — o caso passava a medir o dedup.
        quebrada["text"] = " ".join(f"quebrada_{n}" for n in range(60))
        # OS DOIS, porque `ai_record` cai para `promptSha256` quando o digesto do template
        # falta: sem os dois o eixo `promptTemplate` nao tem identidade nenhuma e
        # `MissingRecipe` dispara.
        del quebrada["meta"]["promptTemplateDigest"]
        del quebrada["meta"]["promptSha256"]
        (self.candidates / "ai_fresh_gemini_multi.jsonl").write_text(
            _json.dumps(quebrada, ensure_ascii=False) + chr(10),
            encoding="utf-8",
            newline=chr(10),
        )
        snapshot = self.root / "snapshot.jsonl"
        self.run_main("--emit-screening-snapshot", str(snapshot))
        ids = {
            _json.loads(linha)["id"]
            for linha in snapshot.read_text(encoding="utf-8").splitlines()
        }
        self.assertNotIn(quebrada["candidateId"], ids)
        self.assertIn("src_ai_gemini_0001", ids)

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

    def write_mixed(self, rows: list[dict]) -> None:
        (self.candidates / "mixed_from_pairs.jsonl").write_text(
            "".join(json.dumps(row, ensure_ascii=False) + chr(10) for row in rows),
            encoding="utf-8",
            newline=chr(10),
        )

    def write_humans(self, quantos: int) -> None:
        (self.candidates / f"{ac.HUMAN_POOL_FILES[0]}.jsonl").write_text(
            "".join(
                json.dumps(human_row(index), ensure_ascii=False) + chr(10)
                for index in range(1, quantos + 1)
            ),
            encoding="utf-8",
            newline=chr(10),
        )

    # Os pais das mistas comecam DEPOIS dos cinco que as linhas reservadas semeiam
    # (`pairedWith` de `qwen_row` e h1..h5). A razao e uma consequencia real da ponte
    # consertada: uma mista derivada do mesmo pai que semeou uma reservada entra no
    # componente da reservada, e o componente reservado assenta INTEIRO no bloco cego —
    # cinco mistas arrastadas para um bloco que aguenta quatro fazem `main()` recusar
    # com `ReserveFillsTheBlindBlock`. E o mesmo atrito que o § 5.12 do ESTADO
    # declara, e nao um defeito deste caso.
    PRIMEIRO_PAI_MISTO = 6

    def vinte_mistas(
        self, primeira_text: str | None = None, primeiro_pai: int | None = None
    ) -> list[dict]:
        """A cota mista da escala de amostra e 20, e um componente que valha a classe
        inteira nao cabe em particao nenhuma — o preflight do split recusa antes."""
        rows = []
        base = self.PRIMEIRO_PAI_MISTO if primeiro_pai is None else primeiro_pai
        for offset in range(20):
            index = base + offset
            text = " ".join(f"mistura{index}_{n}" for n in range(60))
            if offset == 0 and primeira_text is not None:
                text = primeira_text
            rows.append(mixed_row(index, text))
        return rows

    def records(self) -> list[dict]:
        return [
            json.loads(line)
            for line in (self.root / "out" / "records.jsonl")
            .read_text(encoding="utf-8")
            .splitlines()
        ]

    def test_a_mista_entra_no_funil_pela_identidade_DELA(self) -> None:
        self.write_mixed(self.vinte_mistas())
        snapshot = self.root / "snapshot.jsonl"
        self.run_main("--emit-screening-snapshot", str(snapshot))
        ids = {
            json.loads(line)["id"]
            for line in snapshot.read_text(encoding="utf-8").splitlines()
        }
        pai = f"src_ptwiki_h{self.PRIMEIRO_PAI_MISTO}"
        # As DUAS linhas estao na projecao com nomes distintos: a mista pelo id dela, o
        # pai pelo dele. Enquanto a mista era chaveada pelo pai, uma delas nao tinha nome
        # proprio no snapshot.
        self.assertIn(f"mix_{pai}", ids)
        self.assertIn(pai, ids)

    def test_a_mista_quase_duplicada_do_pai_sai_com_ele_e_nao_chega_ao_corpus(
        self,
    ) -> None:
        # PONTA A PONTA da retractacao: a poda derruba o pai (a mista tem prioridade
        # menor e fica), e a mista sai depois, porque a linhagem dela nomeia um registro
        # que o corpus nao tem. Guardar a filha e derrubar o pai nao guarda material — e
        # o corpus que sairia dali seria recusado pelo comando de split.
        # Os pais das mistas ficam DENTRO dos que o nucleo `ai` pareia (h1..h40), e a
        # razao e aritmetica de cota: a escala de amostra escolhe 40 humanas, e cada linha
        # derivada exige o pai dela entre as escolhidas. Com pais mistos fora desse
        # conjunto, as ancoras distintas passam de 40 e a selecao tem de cortar algumas —
        # o que orfana linhas derivadas que nada de errado tem.
        primeiro = 6
        self.write_humans(45)
        pai = human_row(primeiro)
        enxertada = pai["text"].replace(f"palavra{primeiro}_7", "enxerto")
        # VINTE E UMA, para a cota de vinte fechar DEPOIS de a orfa sair: a mista cujo
        # pai a poda derrubou e cortada antes da selecao, entao escrever exactamente
        # vinte deixaria a classe com dezenove e as fracoes do split fora do alvo.
        # UMA mista, e so uma: o caso mede que ela SAI, entao a classe fica vazia e o
        # corpo volta a ser o de humanas mais geradas — a mesma forma dos outros casos
        # deste arquivo. Uma classe mista sobrevivente poria a aritmetica de subconjuntos
        # do split dentro deste caso, que nao e o que ele mede.
        self.write_mixed([mixed_row(primeiro, enxertada)])
        self.run_main()
        ids = [record["id"] for record in self.records()]
        # O pai caiu na poda e a mista saiu com ele: nenhum dos dois esta no corpus.
        self.assertNotIn(pai["candidateId"], ids)
        self.assertNotIn(f"mix_{pai['candidateId']}", ids)
        self.assertEqual([i for i in ids if i.startswith("mix_")], [])

    def test_a_selecao_humana_RECEBE_as_ancoras_das_duas_classes_derivadas(self) -> None:
        # A costura, e ela nao se le de `balanced_humans`: o efeito de honrar uma ancora
        # esta medido em `test_funnel_identity.py`; o que falta e que `main()` as passe, e
        # que passe as das DUAS classes. Sem as mistas na conta, o pai de uma mista pode
        # ser cortado pela cota e a mista sai com ele.
        # Os pais das mistas ficam FORA do alcance do nucleo `ai` (que pareia h1..h40),
        # porque de outro modo a metade `ai` das ancoras ja os traria e apagar a metade
        # mista nao mudaria nada — o caso mediria menos do que diz.
        primeiro = 41
        self.write_mixed(
            [
                mixed_row(primeiro + offset, " ".join(f"mix{offset}_{n}" for n in range(60)))
                for offset in range(5)
            ]
        )
        vistas: list[set[str]] = []
        original = ac.balanced_humans

        def espia(cands, total, anchors=None):
            vistas.append(set(anchors or ()))
            return original(cands, total, anchors)

        ac.balanced_humans = espia
        try:
            self.run_main()
        except ac.UnsplittableCorpus:
            # TOLERADA, e a razao esta escrita: cinco mistas fazem de cada componente
            # 20 % da classe, e a menor particao pede 5 % — granularidade, nao tamanho de
            # corpo. Este caso mede o que a SELECAO recebe, e a selecao corre antes.
            pass
        finally:
            ac.balanced_humans = original
        self.assertEqual(len(vistas), 1)
        ancoras = vistas[0]
        # As sementes das geradas de nucleo (o nucleo pareia h1..h40) ...
        self.assertIn("src_ptwiki_h1", ancoras)
        # ... e os pais das mistas, que sao a metade que uma mutacao apagava em silencio.
        for offset in range(5):
            self.assertIn(f"src_ptwiki_h{primeiro + offset}", ancoras)

    def test_a_ORDEM_do_funil_e_desambiguacao_poda_ligacao_orfas_projecao(self) -> None:
        # A POSICAO de cada passo e a alegacao, e nenhuma funcao pura a carrega. O caso
        # observa a PODA tambem, e o cross-review mediu por que: sem ela na lista, mover a
        # desambiguacao para DEPOIS das podas — que e o defeito que ela existe para
        # fechar — deixava esta ordem intacta e o caso verde.
        #
        # E a ligacao vem antes do corte de orfas pela razao inversa: o corte compara com
        # IDENTIDADES, entao antes da ligacao ele le como orfa toda derivada cujo pai foi
        # renomeado.
        self.write_humans(60)
        self.write_mixed(self.vinte_mistas(primeiro_pai=41))
        ordem: list[str] = []
        no_ac = (
            "enforce_unique_keys",
            "link_derived_to_parents",
            "drop_orphan_derived_rows",
            "screening_projection",
        )
        originais = {nome: getattr(ac, nome) for nome in no_ac}
        prune_original = near_dupes.prune

        def espia(nome, alvo, funcao):
            def envolvida(*args, **kwargs):
                ordem.append(nome)
                return funcao(*args, **kwargs)

            setattr(alvo, nome, envolvida)

        for nome, funcao in originais.items():
            espia(nome, ac, funcao)
        espia("prune", near_dupes, prune_original)
        try:
            self.run_main()
        finally:
            for nome, funcao in originais.items():
                setattr(ac, nome, funcao)
            near_dupes.prune = prune_original
        self.assertEqual(
            ordem[:5],
            [
                "enforce_unique_keys",
                "prune",
                "link_derived_to_parents",
                "drop_orphan_derived_rows",
                "screening_projection",
            ],
        )

if __name__ == "__main__":
    unittest.main()
