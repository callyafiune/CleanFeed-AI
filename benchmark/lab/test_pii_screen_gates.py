"""Os CONTROLES, os GATES e o RECIBO da triagem (run: py -3.13 -m pytest).

O que este arquivo prende, e cada item e uma alegacao que o recibo publica:

  * o CATALOGO e conferido contra o protocolo ANTES de gastar chamada — contagem por
    subtipo, pareamento 1:1, fracao escrita a mao, os quatro vetores, os cem pares;
  * `S_control` por estrato com o limite INFERIOR de Wilson, e estrato abaixo do piso
    reprova o gate;
  * o gate e sobre SINALIZAR, e a concordancia de subtipo e diagnostico ao lado;
  * o teto de sham e sobre o limite SUPERIOR, e um triador que sinaliza tudo passa a
    sensibilidade e cai aqui;
  * o par adversarial: controle sinalizado E sham aprovado na MESMA unidade, e sinalizar
    os dois nao e meio acerto;
  * a indistinguibilidade aborta nas DUAS direcoes — acertar demais e o desfecho ruim;
  * o RECIBO nao se constroi sobre gate reprovado, e carrega a alegacao e o que ela NAO
    afirma.

A CEGUEIRA e medida e nao raciocinada: o triador recebe `ProjectionRow`, que nao tem
campo de papel nem de subtipo, e um caso afirma que o gabarito nao viaja na projecao.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import pii_screen
import pii_screen_gates as gates
import pii_screen_protocol as protocol


def taxonomy_catalogue() -> list[gates.TaxonomyProbe]:
    """Um catalogo COMPLETO e valido, derivado do protocolo e nao digitado.

    Derivado porque as contagens sao o que os casos medem: um catalogo com 60 escrito a
    mao continuaria valido se o protocolo mudasse para 61, e o caso deixaria de medir a
    condicao.
    """
    probes: list[gates.TaxonomyProbe] = []
    for subtype in protocol.TAXONOMY:
        # A fracao a mao e o TETO do piso arredondado para cima: o caso valido tem de
        # passar, e passar por pouco e o que mantem a assercao viva.
        a_mao = -(-protocol.CONTROLS_PER_SUBTYPE * 1 // 3)
        for index in range(protocol.CONTROLS_PER_SUBTYPE):
            pair_id = f"{subtype.key}_par_{index:03d}"
            probes.append(
                gates.TaxonomyProbe(
                    probe_id=f"{pair_id}_inj",
                    subtype=subtype.key,
                    role="injected",
                    pair_id=pair_id,
                    hand_written=index < a_mao,
                    text=f"texto com injecao de {subtype.key} numero {index}",
                )
            )
            probes.append(
                gates.TaxonomyProbe(
                    probe_id=f"{pair_id}_sham",
                    subtype=subtype.key,
                    role="sham",
                    pair_id=pair_id,
                    hand_written=index < a_mao,
                    text=f"texto limpo de {subtype.key} numero {index}",
                )
            )
    return probes


def adversarial_catalogue() -> list[gates.AdversarialProbe]:
    probes: list[gates.AdversarialProbe] = []
    for vector in protocol.ADVERSARIAL_VECTORS:
        for index in range(protocol.ADVERSARIAL_PAIRS_PER_VECTOR):
            pair_id = f"{vector.key}_par_{index:03d}"
            probes.append(
                gates.AdversarialProbe(
                    probe_id=f"{pair_id}_inj",
                    vector=vector.key,
                    role="injected",
                    pair_id=pair_id,
                    text=f"instrucao mais PII, {vector.key} {index}",
                )
            )
            probes.append(
                gates.AdversarialProbe(
                    probe_id=f"{pair_id}_sham",
                    vector=vector.key,
                    role="sham",
                    pair_id=pair_id,
                    text=f"a mesma instrucao sem PII, {vector.key} {index}",
                )
            )
    return probes


def indistinguishability_catalogue() -> list[gates.IndistinguishabilityPair]:
    return [
        gates.IndistinguishabilityPair(
            pair_id=f"ind_{index:03d}",
            injected_probe_id=f"ind_{index:03d}_inj",
            clean_probe_id=f"ind_{index:03d}_limpo",
            injected_text=f"com injecao {index}",
            clean_text=f"sem injecao {index}",
        )
        for index in range(protocol.INDISTINGUISHABILITY_PAIRS)
    ]


def outcomes_for(
    probes, flagged_ids=frozenset(), named_subtype=True
) -> list[gates.ProbeOutcome]:
    """Resultados sinteticos: sinaliza os ids pedidos e nomeia o subtipo verdadeiro."""
    out: list[gates.ProbeOutcome] = []
    for probe in probes:
        sinalizado = probe.probe_id in flagged_ids
        subtipos: tuple[str, ...] = ()
        if sinalizado:
            verdadeiro = getattr(probe, "subtype", None)
            subtipos = (
                (verdadeiro,) if (named_subtype and verdadeiro) else ("full-name",)
            )
        out.append(gates.ProbeOutcome(probe.probe_id, sinalizado, subtipos))
    return out


def perfect_outcomes(probes) -> list[gates.ProbeOutcome]:
    """Sinaliza toda injecao e aprova todo sham: o triador ideal."""
    return outcomes_for(
        probes, {p.probe_id for p in probes if p.role == "injected"}
    )


class CatalogoConferidoAntesDoDinheiro(unittest.TestCase):
    def test_o_catalogo_completo_passa(self) -> None:
        gates.assert_the_taxonomy_catalogue_matches_the_plan(taxonomy_catalogue())
        gates.assert_the_adversarial_catalogue_matches_the_plan(adversarial_catalogue())
        gates.assert_the_indistinguishability_catalogue_matches_the_plan(
            indistinguishability_catalogue()
        )

    def test_uma_injecao_a_menos_num_subtipo_RECUSA(self) -> None:
        probes = [
            p
            for p in taxonomy_catalogue()
            if p.probe_id != f"relational_par_{0:03d}_inj"
        ]
        with self.assertRaises(gates.CatalogueDoesNotMatchThePlan) as caught:
            gates.assert_the_taxonomy_catalogue_matches_the_plan(probes)
        mensagem = str(caught.exception)
        self.assertIn("relational", mensagem)
        self.assertIn(str(protocol.CONTROLS_PER_SUBTYPE), mensagem)

    def test_sham_sem_par_RECUSA_e_nomeia_o_par(self) -> None:
        probes = taxonomy_catalogue()
        alvo = f"email_par_{7:03d}"
        probes = [p for p in probes if p.probe_id != f"{alvo}_sham"]
        probes.append(
            gates.TaxonomyProbe(
                probe_id=f"{alvo}_sham_orfao",
                subtype="email",
                role="sham",
                pair_id="email_par_999",
                hand_written=False,
                text="sham sem par",
            )
        )
        with self.assertRaises(gates.CatalogueDoesNotMatchThePlan) as caught:
            gates.assert_the_taxonomy_catalogue_matches_the_plan(probes)
        self.assertIn("1:1", str(caught.exception))

    def test_fracao_escrita_a_mao_abaixo_do_piso_RECUSA(self) -> None:
        probes = [
            gates.TaxonomyProbe(
                probe_id=p.probe_id,
                subtype=p.subtype,
                role=p.role,
                pair_id=p.pair_id,
                hand_written=False,
                text=p.text,
            )
            for p in taxonomy_catalogue()
        ]
        with self.assertRaises(gates.CatalogueDoesNotMatchThePlan) as caught:
            gates.assert_the_taxonomy_catalogue_matches_the_plan(probes)
        self.assertIn("a mao", str(caught.exception))

    def test_subtipo_fora_da_taxonomia_RECUSA(self) -> None:
        probes = taxonomy_catalogue()
        probes.append(
            gates.TaxonomyProbe(
                probe_id="inventado_inj",
                subtype="numero-de-passaporte",
                role="injected",
                pair_id="inventado",
                hand_written=True,
                text="x",
            )
        )
        with self.assertRaises(gates.CatalogueDoesNotMatchThePlan) as caught:
            gates.assert_the_taxonomy_catalogue_matches_the_plan(probes)
        self.assertIn("numero-de-passaporte", str(caught.exception))

    def test_um_vetor_com_um_par_a_menos_RECUSA(self) -> None:
        probes = [
            p
            for p in adversarial_catalogue()
            if p.probe_id != f"homoglyph_par_{0:03d}_sham"
        ]
        with self.assertRaises(gates.CatalogueDoesNotMatchThePlan) as caught:
            gates.assert_the_adversarial_catalogue_matches_the_plan(probes)
        self.assertIn("homoglyph", str(caught.exception))

    def test_noventa_e_nove_pares_de_indistinguibilidade_RECUSA(self) -> None:
        pares = indistinguishability_catalogue()[:-1]
        with self.assertRaises(gates.CatalogueDoesNotMatchThePlan) as caught:
            gates.assert_the_indistinguishability_catalogue_matches_the_plan(pares)
        self.assertIn(str(protocol.INDISTINGUISHABILITY_PAIRS), str(caught.exception))


class ACegueiraEAFormaDoTipo(unittest.TestCase):
    def test_a_projecao_das_sondas_nao_carrega_o_gabarito(self) -> None:
        probes = taxonomy_catalogue()[:4]
        projection = gates.probe_projection(probes)
        campos = set(vars(projection[0]))
        self.assertEqual(campos, {"row_id", "text_sha256", "text"})
        self.assertNotIn("role", campos)
        self.assertNotIn("subtype", campos)

    def test_o_triador_recebe_TEXTO_e_nada_mais(self) -> None:
        vistos: list[object] = []

        def triador(text):
            vistos.append(text)
            return pii_screen.TriageVerdict(flagged=False)

        probes = taxonomy_catalogue()[:6]
        gates.screen_probes(probes, triador)
        self.assertEqual(vistos, [p.text for p in probes])

    def test_o_vocabulario_de_DROP_do_censo_nao_viaja_para_os_controles(self) -> None:
        # Nenhum controle esta no corpus, entao "flagged-dropped" nomearia uma acao que
        # nao aconteceu. O log dos controles tem forma propria.
        probes = taxonomy_catalogue()[:2]

        def triador(text):
            return pii_screen.TriageVerdict(True, ("email",))

        resultados = gates.screen_probes(probes, triador)
        self.assertTrue(all(r.flagged for r in resultados))
        with tempfile.TemporaryDirectory() as tmp:
            caminho = Path(tmp) / "controles.jsonl"
            gates.write_probe_outcomes(caminho, resultados)
            linhas = [
                json.loads(linha)
                for linha in caminho.read_text(encoding="utf-8").splitlines()
            ]
        self.assertEqual(set(linhas[0]), {"probeId", "flagged", "subtypes"})
        self.assertNotIn(
            "flagged-dropped", caminho.name + json.dumps(linhas, ensure_ascii=False)
        )


class SControlPorEstrato(unittest.TestCase):
    def test_acerto_total_da_o_limite_de_Wilson_e_nao_um(self) -> None:
        probes = taxonomy_catalogue()
        medicao = gates.measure_sensitivity_by_stratum(probes, perfect_outcomes(probes))
        email = medicao["email"]
        self.assertEqual(email["flagged"], protocol.CONTROLS_PER_SUBTYPE)
        self.assertEqual(email["sControl"], 1.0)
        # A leitura honesta de "nenhuma falha em 60": n/(n+z^2), e nao 1,0.
        self.assertAlmostEqual(
            email["wilsonLower"],
            protocol.wilson_lower_bound(
                protocol.CONTROLS_PER_SUBTYPE, protocol.CONTROLS_PER_SUBTYPE
            ),
            places=12,
        )
        self.assertLess(email["wilsonLower"], 1.0)
        self.assertTrue(email["meetsFloor"])

    def test_o_denominador_e_o_CATALOGO_e_uma_lacuna_falsifica(self) -> None:
        probes = taxonomy_catalogue()
        resultados = [
            r for r in perfect_outcomes(probes) if r.probe_id != "cpf_par_000_inj"
        ]
        with self.assertRaises(gates.ProbeOutcomeMissing) as caught:
            gates.measure_sensitivity_by_stratum(probes, resultados)
        self.assertIn("cpf_par_000_inj", str(caught.exception))

    def test_um_estrato_abaixo_do_piso_reprova_o_gate_e_e_NOMEADO(self) -> None:
        probes = taxonomy_catalogue()
        # `email` tem piso 0,95, que com n = 60 nao tolera nem uma falha: o limite
        # inferior de 59/60 cai abaixo de 0,95.
        perdidas = {"email_par_000_inj"}
        sinalizadas = {
            p.probe_id
            for p in probes
            if p.role == "injected" and p.probe_id not in perdidas
        }
        medicao = gates.measure_sensitivity_by_stratum(
            probes, outcomes_for(probes, sinalizadas)
        )
        self.assertFalse(medicao["email"]["meetsFloor"])
        self.assertTrue(medicao["relational"]["meetsFloor"])
        verdicts = gates.evaluate_gates(
            sensitivity=medicao,
            shams={"underCeiling": True},
            adversarial={"byVector": {}},
            indistinguishability={"withinMargin": True},
        )
        self.assertEqual(
            verdicts["sensitivityByStratum"]["strataBelowFloor"], ["email"]
        )
        with self.assertRaises(gates.GatesFailed) as caught:
            gates.assert_the_gates_passed(verdicts)
        self.assertIn("email", str(caught.exception))

    def test_o_gate_e_sobre_SINALIZAR_e_a_concordancia_de_subtipo_e_diagnostico(
        self,
    ) -> None:
        probes = taxonomy_catalogue()
        # Sinaliza tudo, mas nomeia sempre a categoria ERRADA.
        sinalizadas = {p.probe_id for p in probes if p.role == "injected"}
        medicao = gates.measure_sensitivity_by_stratum(
            probes, outcomes_for(probes, sinalizadas, named_subtype=False)
        )
        # `full-name` e o subtipo que o triador nomeia sempre, entao e o unico estrato em
        # que a concordancia nao e zero.
        self.assertTrue(medicao["cpf"]["meetsFloor"])
        self.assertEqual(medicao["cpf"]["subtypeAgreement"], 0.0)
        self.assertEqual(medicao["full-name"]["subtypeAgreement"], 1.0)


class TetoDeSham(unittest.TestCase):
    def test_o_triador_que_sinaliza_TUDO_passa_a_sensibilidade_e_cai_aqui(self) -> None:
        probes = taxonomy_catalogue() + adversarial_catalogue()
        tudo = outcomes_for(probes, {p.probe_id for p in probes})
        sensibilidade = gates.measure_sensitivity_by_stratum(
            [p for p in probes if isinstance(p, gates.TaxonomyProbe)], tudo
        )
        self.assertTrue(all(v["meetsFloor"] for v in sensibilidade.values()))
        shams = gates.measure_sham_false_positives(probes, tudo)
        self.assertEqual(shams["rate"], 1.0)
        self.assertFalse(shams["underCeiling"])

    def test_zero_sham_sinalizado_fica_sob_o_teto(self) -> None:
        probes = taxonomy_catalogue() + adversarial_catalogue()
        shams = gates.measure_sham_false_positives(probes, perfect_outcomes(probes))
        self.assertEqual(shams["flagged"], 0)
        self.assertLessEqual(shams["wilsonUpper"], protocol.SHAM_FALSE_POSITIVE_CEILING)
        self.assertTrue(shams["underCeiling"])

    def test_o_teto_e_sobre_o_limite_SUPERIOR_e_nao_sobre_a_taxa(self) -> None:
        # O CASO QUE SEPARA OS DOIS, e a bateria mostrou que faltava: com 20 shams e UM
        # sinalizado a taxa e 0,05, SOB o teto de 0,10 — e o limite superior de Wilson e
        # 0,1926, ACIMA dele. E o limite que gateia, porque a taxa amostral sozinha nao
        # diz o que a proxima execucao faria.
        probes = [
            gates.TaxonomyProbe(
                probe_id=f"email_par_{index:03d}_sham",
                subtype="email",
                role="sham",
                pair_id=f"email_par_{index:03d}",
                hand_written=True,
                text=f"texto limpo {index}",
            )
            for index in range(20)
        ]
        medicao = gates.measure_sham_false_positives(
            probes, outcomes_for(probes, {probes[0].probe_id})
        )
        self.assertAlmostEqual(medicao["rate"], 0.05, places=12)
        self.assertLessEqual(medicao["rate"], protocol.SHAM_FALSE_POSITIVE_CEILING)
        self.assertGreater(
            medicao["wilsonUpper"], protocol.SHAM_FALSE_POSITIVE_CEILING
        )
        self.assertFalse(medicao["underCeiling"])

    def test_a_divisao_por_familia_e_publicada_ao_lado(self) -> None:
        probes = taxonomy_catalogue() + adversarial_catalogue()
        medicao = gates.measure_sham_false_positives(probes, perfect_outcomes(probes))
        self.assertEqual(
            set(medicao["byFamily"]), {"taxonomy", "adversarial"}
        )
        self.assertEqual(
            medicao["n"],
            medicao["byFamily"]["taxonomy"]["n"]
            + medicao["byFamily"]["adversarial"]["n"],
        )


class ParAdversarial(unittest.TestCase):
    def test_o_par_perfeito_passa_o_piso(self) -> None:
        probes = adversarial_catalogue()
        medicao = gates.measure_adversarial_pairs(probes, perfect_outcomes(probes))
        for vector in protocol.ADVERSARIAL_VECTORS:
            entrada = medicao["byVector"][vector.key]
            self.assertEqual(
                entrada["correctPairs"], protocol.ADVERSARIAL_PAIRS_PER_VECTOR
            )
            self.assertTrue(entrada["meetsFloor"])

    def test_sinalizar_OS_DOIS_nao_e_meio_acerto_e_e_NENHUM(self) -> None:
        probes = adversarial_catalogue()
        tudo = outcomes_for(probes, {p.probe_id for p in probes})
        medicao = gates.measure_adversarial_pairs(probes, tudo)
        for vector in protocol.ADVERSARIAL_VECTORS:
            entrada = medicao["byVector"][vector.key]
            self.assertEqual(entrada["correctPairs"], 0)
            self.assertEqual(
                entrada["flaggedSham"], protocol.ADVERSARIAL_PAIRS_PER_VECTOR
            )
            self.assertFalse(entrada["meetsFloor"])

    def test_as_TRES_maneiras_de_errar_sao_contadas_separadamente(self) -> None:
        probes = adversarial_catalogue()
        injetadas = {
            p.pair_id: p for p in probes if p.role == "injected" and p.vector == "homoglyph"
        }
        pares = sorted(injetadas)
        sinalizadas = {
            p.probe_id
            for p in probes
            if p.role == "injected" and p.pair_id != pares[0]
        }
        # o par 1 perde o controle; o par 2 sinaliza o sham; o par 3 erra as duas
        sinalizadas |= {
            p.probe_id
            for p in probes
            if p.role == "sham" and p.pair_id in {pares[1], pares[2]}
        }
        sinalizadas -= {
            p.probe_id
            for p in probes
            if p.role == "injected" and p.pair_id == pares[2]
        }
        medicao = gates.measure_adversarial_pairs(
            probes, outcomes_for(probes, sinalizadas)
        )
        homoglyph = medicao["byVector"]["homoglyph"]
        self.assertEqual(homoglyph["missedControl"], 1)
        self.assertEqual(homoglyph["flaggedSham"], 1)
        self.assertEqual(homoglyph["bothWrong"], 1)
        self.assertEqual(
            homoglyph["correctPairs"], protocol.ADVERSARIAL_PAIRS_PER_VECTOR - 3
        )

    def test_a_regra_do_par_vem_do_protocolo_e_nao_daqui(self) -> None:
        medicao = gates.measure_adversarial_pairs([], [])
        self.assertEqual(medicao["rule"], protocol.CORRECT_PAIR_RULE)


class Indistinguibilidade(unittest.TestCase):
    def test_o_azar_passa(self) -> None:
        pares = indistinguishability_catalogue()
        escolhas = {
            pair.pair_id: (
                pair.injected_probe_id if index % 2 == 0 else pair.clean_probe_id
            )
            for index, pair in enumerate(pares)
        }
        medicao = gates.measure_indistinguishability(pares, escolhas)
        self.assertEqual(medicao["accuracy"], 0.5)
        self.assertTrue(medicao["withinMargin"])

    def test_acertar_DEMAIS_reprova(self) -> None:
        pares = indistinguishability_catalogue()
        escolhas = {pair.pair_id: pair.injected_probe_id for pair in pares}
        medicao = gates.measure_indistinguishability(pares, escolhas)
        self.assertEqual(medicao["accuracy"], 1.0)
        self.assertFalse(medicao["withinMargin"])

    def test_acertar_de_MENOS_tambem_reprova(self) -> None:
        # Nao ha resultado bom fora do azar: a alegacao e EQUIVALENCIA, e um
        # discriminador que erra sistematicamente tambem distingue os dois lados.
        pares = indistinguishability_catalogue()
        escolhas = {pair.pair_id: pair.clean_probe_id for pair in pares}
        medicao = gates.measure_indistinguishability(pares, escolhas)
        self.assertEqual(medicao["accuracy"], 0.0)
        self.assertFalse(medicao["withinMargin"])

    def test_par_sem_escolha_do_discriminador_RECUSA(self) -> None:
        pares = indistinguishability_catalogue()
        escolhas = {pair.pair_id: pair.injected_probe_id for pair in pares[:-1]}
        with self.assertRaises(gates.ProbeOutcomeMissing):
            gates.measure_indistinguishability(pares, escolhas)


class ORecibo(unittest.TestCase):
    def setUp(self) -> None:
        self.taxonomia = taxonomy_catalogue()
        self.adversarial = adversarial_catalogue()
        self.pares = indistinguishability_catalogue()
        todas = self.taxonomia + self.adversarial
        resultados = perfect_outcomes(todas)
        self.sensibilidade = gates.measure_sensitivity_by_stratum(
            self.taxonomia, resultados
        )
        self.shams = gates.measure_sham_false_positives(todas, resultados)
        self.adv = gates.measure_adversarial_pairs(self.adversarial, resultados)
        self.ind = gates.measure_indistinguishability(
            self.pares,
            {
                pair.pair_id: (
                    pair.injected_probe_id if index % 2 == 0 else pair.clean_probe_id
                )
                for index, pair in enumerate(self.pares)
            },
        )
        self.gates = gates.evaluate_gates(
            sensitivity=self.sensibilidade,
            shams=self.shams,
            adversarial=self.adv,
            indistinguishability=self.ind,
        )

    def receipt(self, **overrides) -> dict:
        argumentos = dict(
            triager={
                "provider": "gemini",
                "model": "gemini-3.5-flash-lite",
                "promptSha256": "a" * 64,
                "parameters": {"temperature": 0.0},
                "runAt": "2026-08-25T00:00:00+00:00",
            },
            discriminator={"provider": "openai", "model": "gpt-5.6-sol"},
            injection_generator={"provider": "openai", "model": "gpt-5.6-sol"},
            catalogue={"taxonomyProbes": len(self.taxonomia)},
            sensitivity=self.sensibilidade,
            shams=self.shams,
            adversarial=self.adv,
            indistinguishability=self.ind,
            census={
                "projectionPairs": 10_000,
                "projectionDigest": "i" * 64,
                **pii_screen.post_hoc_breakdown(flagged=12, reviewed=5, confirmed=3),
            },
            corpus={"records": 9_988, "digest": "d" * 64, "ledgerDigest": "l" * 64},
            gates=self.gates,
        )
        argumentos.update(overrides)
        return gates.build_receipt(**argumentos)

    def test_o_recibo_cita_o_protocolo_por_DIGESTO(self) -> None:
        recibo = self.receipt()
        self.assertEqual(recibo["protocol"]["version"], protocol.PROTOCOL_VERSION)
        self.assertEqual(recibo["protocol"]["digest"], protocol.protocol_digest())

    def test_o_recibo_publica_o_piso_AO_LADO_da_medicao(self) -> None:
        recibo = self.receipt()
        for chave, entrada in recibo["sControlByStratum"].items():
            self.assertEqual(entrada["floor"], protocol.subtype(chave).sensitivity_floor)
            self.assertIn("wilsonLower", entrada)

    def test_o_recibo_carrega_prevalenceBound_NULO_e_a_alegacao(self) -> None:
        recibo = self.receipt()
        self.assertIsNone(recibo["prevalenceBound"])
        self.assertIn("prevalenceBound: null", recibo["claim"])
        self.assertIn("nao satisfazem R4", recibo["claim"])

    def test_o_recibo_declara_o_que_NAO_afirma_e_os_riscos_nomeados(self) -> None:
        recibo = self.receipt()
        self.assertEqual(len(recibo["namedRisks"]), 9)
        junto = " ".join(recibo["doesNotClaim"]).lower()
        for exigido in ("prevalencia", "r4", "completude taxonomica"):
            self.assertIn(exigido, junto)

    def test_o_recibo_diz_que_o_gate_e_sobre_SINALIZAR(self) -> None:
        recibo = self.receipt()
        self.assertIn("SINALIZAR", recibo["gateIsOnFlagging"])

    def test_NAO_se_constroi_recibo_sobre_gate_reprovado(self) -> None:
        reprovado = dict(self.gates)
        reprovado["shamFalsePositive"] = {"passed": False, "wilsonUpper": 0.4}
        with self.assertRaises(gates.GatesFailed):
            self.receipt(gates=reprovado)

    def test_a_recusa_nomeia_TODOS_os_gates_que_cairam_e_nao_o_primeiro(self) -> None:
        reprovado = {
            "sensitivityByStratum": {"passed": False, "strataBelowFloor": ["cpf"]},
            "shamFalsePositive": {"passed": False, "wilsonUpper": 0.4},
            "adversarialPairs": {"passed": False, "vectorsBelowFloor": ["homoglyph"]},
            "indistinguishability": {"passed": True},
        }
        with self.assertRaises(gates.GatesFailed) as caught:
            gates.assert_the_gates_passed(reprovado)
        mensagem = str(caught.exception)
        self.assertIn("3 de 4", mensagem)
        for esperado in ("cpf", "homoglyph", "shamFalsePositive"):
            self.assertIn(esperado, mensagem)

    def test_o_digesto_do_recibo_e_o_dos_BYTES_escritos(self) -> None:
        import hashlib

        with tempfile.TemporaryDirectory() as tmp:
            caminho = Path(tmp) / "pii-screening-receipt.json"
            digesto = gates.write_receipt(caminho, self.receipt())
            self.assertEqual(
                digesto, hashlib.sha256(caminho.read_bytes()).hexdigest()
            )
            relido = json.loads(caminho.read_text(encoding="utf-8"))
        self.assertEqual(relido["artifact"], "pii-screening-receipt")

    def test_o_recibo_e_ESTAVEL_byte_a_byte_para_o_mesmo_conteudo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            um = Path(tmp) / "um.json"
            dois = Path(tmp) / "dois.json"
            self.assertEqual(
                gates.write_receipt(um, self.receipt()),
                gates.write_receipt(dois, self.receipt()),
            )

    def test_as_TRES_categorias_post_hoc_viajam_no_recibo(self) -> None:
        recibo = self.receipt()
        censo = recibo["census"]
        self.assertEqual(censo["flagged"], 12)
        self.assertEqual(censo["falsePositives"], 2)
        self.assertEqual(censo["notReviewed"], 7)
        self.assertAlmostEqual(censo["precisionAmongReviewed"], 3 / 5)


if __name__ == "__main__":
    unittest.main()
