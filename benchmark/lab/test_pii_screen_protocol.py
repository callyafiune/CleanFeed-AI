"""Fixture tests da pre-inscricao do protocolo de triagem (run: py -3.13 -m pytest).

O que este arquivo prende e a PRE-INSCRICAO: taxonomia, `n` por subtipo, pisos de
sensibilidade, vetores adversariais com teto de sham, margem de equivalencia e o
orcamento de chamadas. Sao numeros escolhidos ANTES de qualquer resultado, e a
legitimidade disso depende de eles nao se moverem depois — logo cada um e lido aqui, e
o digesto do modulo entra no recibo.

A aritmetica de Wilson e conferida contra valores calculados a mao, e nao contra a
propria implementacao: duas implementacoes que concordam entre si nao dizem nada sobre
a formula que publicam.
"""

from __future__ import annotations

import hashlib
import math
import unittest
from pathlib import Path

import pii_screen_protocol as protocol


class WilsonTests(unittest.TestCase):
    def test_limite_inferior_com_acerto_total_e_n_sobre_n_mais_z_quadrado(self) -> None:
        # Caso fechado: com p̂ = 1 o centro e a meia-largura de Wilson cancelam-se e o
        # limite inferior colapsa em n / (n + z²). E o caso que decide o piso de 0,95,
        # e o unico com forma simples o suficiente para ser aritmetica e nao chamada.
        z2 = protocol.WILSON_Z_ONE_SIDED_95**2
        for n in (40, 52, 60, 100):
            self.assertAlmostEqual(
                protocol.wilson_lower_bound(n, n),
                n / (n + z2),
                places=12,
            )

    def test_o_n_de_60_com_zero_falhas_passa_o_piso_de_0_95_e_o_de_52_e_a_fronteira(
        self,
    ) -> None:
        self.assertGreaterEqual(protocol.wilson_lower_bound(60, 60), 0.95)
        # 52 e o menor n inteiro cujo limite inferior alcanca 0,95 com acerto total, e
        # 51 nao alcanca: e isso que torna 60 uma margem escolhida e nao um numero
        # redondo.
        self.assertGreaterEqual(protocol.wilson_lower_bound(52, 52), 0.95)
        self.assertLess(protocol.wilson_lower_bound(51, 51), 0.95)

    def test_uma_falha_em_60_reprova_o_piso_de_0_95(self) -> None:
        # A consequencia declarada do piso alto dos subtipos visiveis por regex: as
        # cinco `PII_PATTERNS` pegam-nos todos, entao um triador que perde UM e sinal.
        self.assertLess(protocol.wilson_lower_bound(59, 60), 0.95)

    def test_a_tolerancia_de_cada_piso_em_60_controles_e_medida_e_nao_estimada(
        self,
    ) -> None:
        # As quatro fronteiras, medidas: o piso decide quantas falhas o subtipo suporta
        # antes de ABORTAR a execucao, e esse numero e o que o operador precisa de ver
        # antes de escolher o piso. Escrito como par (acerta / falha por um) para que
        # nenhum lado passe sozinho.
        n = protocol.CONTROLS_PER_SUBTYPE
        for floor, least in ((0.95, 60), (0.80, 54), (0.75, 51), (0.70, 48)):
            self.assertGreaterEqual(
                protocol.wilson_lower_bound(least, n), floor, f"piso {floor}"
            )
            self.assertLess(
                protocol.wilson_lower_bound(least - 1, n), floor, f"piso {floor}"
            )

    def test_todo_piso_da_taxonomia_e_um_dos_quatro_medidos_acima(self) -> None:
        # Um piso novo entra com a sua fronteira medida no caso acima, ou a tolerancia
        # dele fica sem numero publicado.
        self.assertEqual(
            {s.sensitivity_floor for s in protocol.TAXONOMY}, {0.95, 0.80, 0.75, 0.70}
        )

    def test_limite_superior_com_zero_acertos_e_z_quadrado_sobre_n_mais_z_quadrado(
        self,
    ) -> None:
        z2 = protocol.WILSON_Z_ONE_SIDED_95**2
        for n in (40, 160):
            self.assertAlmostEqual(
                protocol.wilson_upper_bound(0, n), z2 / (n + z2), places=12
            )

    def test_o_teto_de_sham_e_alcancavel_com_zero_e_reprovado_com_muitos(self) -> None:
        total = protocol.ADVERSARIAL_VECTORS_COUNT * protocol.ADVERSARIAL_PAIRS_PER_VECTOR
        self.assertLessEqual(
            protocol.wilson_upper_bound(0, total),
            protocol.SHAM_FALSE_POSITIVE_CEILING,
        )
        self.assertGreater(
            protocol.wilson_upper_bound(total // 2, total),
            protocol.SHAM_FALSE_POSITIVE_CEILING,
        )

    def test_recusa_contagem_impossivel(self) -> None:
        for successes, n in ((-1, 10), (11, 10), (0, 0), (1, -1)):
            with self.assertRaises(ValueError):
                protocol.wilson_lower_bound(successes, n)
            with self.assertRaises(ValueError):
                protocol.wilson_upper_bound(successes, n)

    def test_o_z_e_o_quantil_unilateral_de_95_por_cento(self) -> None:
        # 1,6449 e nao 1,96: o piso e uma pergunta de UM lado ("a sensibilidade esta
        # acima de X?"), e usar o bilateral aqui apertaria o piso sem o declarar.
        self.assertAlmostEqual(protocol.WILSON_Z_ONE_SIDED_95, 1.6448536269514722, places=12)
        self.assertNotAlmostEqual(protocol.WILSON_Z_ONE_SIDED_95, 1.959963984540054, places=3)


class WilsonMirrorTests(unittest.TestCase):
    """O espelho tem de continuar espelho, e a bancada e a autoridade.

    `benchmark/intervals.ts::wilsonOneSided` decide os tetos de FPR e os pisos de recall
    da bancada, e este modulo repete a formula em Python porque o lab e Python por
    decisao. Duas implementacoes da mesma formula que ninguem compara divergem em
    silencio, e a divergencia mais provavel nao e algebrica — e o ultimo bit do float,
    que muda o veredito de um piso na fronteira.
    """

    def test_a_bancada_e_o_lab_devolvem_o_MESMO_float_em_toda_a_tabela(self) -> None:
        import json
        import subprocess

        root = Path(__file__).resolve().parents[2]
        cases = [
            (0, 1),
            (1, 1),
            (0, 60),
            (1, 60),
            (47, 60),
            (48, 60),
            (53, 60),
            (54, 60),
            (59, 60),
            (60, 60),
            (0, 160),
            (8, 160),
            (32, 160),
            (7, 40),
            (40, 40),
            (1, 10_000),
        ]
        script = (
            "import {wilsonOneSided} from './benchmark/intervals.ts';"
            f"const cases={json.dumps(cases)};"
            "console.log(JSON.stringify(cases.map(([k,n])=>["
            "wilsonOneSided(k,n,'lower').value,wilsonOneSided(k,n,'upper').value])));"
        )
        proc = subprocess.run(
            ["node", "--experimental-strip-types", "--input-type=module", "-e", script],
            cwd=root,
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr[-2000:])
        bench = json.loads(proc.stdout.strip().splitlines()[-1])
        self.assertEqual(len(bench), len(cases))
        for (successes, n), (lower, upper) in zip(cases, bench):
            # Igualdade EXACTA de float, e nao `assertAlmostEqual`: a razao de a
            # expressao estar escrita na forma da bancada e justamente esta, e uma
            # tolerancia aqui apagaria a unica coisa que o caso mede.
            self.assertEqual(
                protocol.wilson_lower_bound(successes, n),
                lower,
                f"limite inferior divergiu em ({successes}, {n})",
            )
            self.assertEqual(
                protocol.wilson_upper_bound(successes, n),
                upper,
                f"limite superior divergiu em ({successes}, {n})",
            )

    def test_o_z_do_lab_e_o_literal_que_a_bancada_congela(self) -> None:
        # Lido do ARQUIVO da bancada, nao de uma copia da constante: o valor e literal
        # nos dois lados, e um literal que ninguem compara e um literal que se move.
        intervals = (
            Path(__file__).resolve().parents[1] / "intervals.ts"
        ).read_text(encoding="utf-8")
        self.assertIn(
            f"export const ONE_SIDED_95_Z = {protocol.WILSON_Z_ONE_SIDED_95};",
            intervals,
        )


class TaxonomyTests(unittest.TestCase):
    def test_a_taxonomia_tem_os_dois_grupos_e_onze_subtipos(self) -> None:
        self.assertEqual(len(protocol.TAXONOMY), 11)
        groups = {subtype.group for subtype in protocol.TAXONOMY}
        self.assertEqual(groups, {"regex-visible", "prose-only"})

    def test_o_grupo_visivel_por_regex_e_exactamente_o_que_as_PII_PATTERNS_pegam(
        self,
    ) -> None:
        import common

        visible = {s.key for s in protocol.TAXONOMY if s.group == "regex-visible"}
        # A relacao e de IGUALDADE e nao de inclusao: um subtipo declarado como
        # "visivel por regex" que nenhum padrao pega e um sanity check que nao checa
        # nada, e um padrao sem subtipo declarado sai da medicao por omissao.
        self.assertEqual(visible, set(common.PII_PATTERNS))

    def test_todo_subtipo_visivel_por_regex_carrega_o_piso_alto(self) -> None:
        for subtype in protocol.TAXONOMY:
            if subtype.group == "regex-visible":
                self.assertEqual(subtype.sensitivity_floor, 0.95, subtype.key)

    def test_o_grupo_so_prosa_nomeia_a_PII_relacional_e_o_quase_identificador(
        self,
    ) -> None:
        prose = {s.key for s in protocol.TAXONOMY if s.group == "prose-only"}
        self.assertIn("relational", prose)
        self.assertIn("quasi-identifier", prose)

    def test_nenhum_piso_e_maior_que_o_alcancavel_com_acerto_total(self) -> None:
        # Um piso acima do limite inferior do acerto PERFEITO aborta toda execucao, e
        # aborta-a por aritmetica e nao por desempenho: o `n` nao chega para o afirmar.
        best = protocol.wilson_lower_bound(
            protocol.CONTROLS_PER_SUBTYPE, protocol.CONTROLS_PER_SUBTYPE
        )
        for subtype in protocol.TAXONOMY:
            self.assertLessEqual(subtype.sensitivity_floor, best, subtype.key)

    def test_as_chaves_sao_unicas_e_a_descricao_nunca_e_vazia(self) -> None:
        keys = [s.key for s in protocol.TAXONOMY]
        self.assertEqual(len(keys), len(set(keys)))
        for subtype in protocol.TAXONOMY:
            self.assertTrue(subtype.description.strip(), subtype.key)


class AdversarialTests(unittest.TestCase):
    def test_quatro_vetores_declarados_e_m_e_esse_numero(self) -> None:
        self.assertEqual(len(protocol.ADVERSARIAL_VECTORS), 4)
        self.assertEqual(
            protocol.ADVERSARIAL_VECTORS_COUNT, len(protocol.ADVERSARIAL_VECTORS)
        )

    def test_os_quatro_vetores_sao_os_do_desenho(self) -> None:
        keys = {vector.key for vector in protocol.ADVERSARIAL_VECTORS}
        self.assertEqual(
            keys,
            {"prompt-injection", "spacing-obfuscation", "homoglyph", "line-break-split"},
        )

    def test_todo_vetor_tem_sham_pareado_declarado(self) -> None:
        for vector in protocol.ADVERSARIAL_VECTORS:
            self.assertTrue(vector.sham_description.strip(), vector.key)

    def test_o_piso_do_gate_e_sobre_a_taxa_de_PARES_e_nao_de_sinalizacoes(self) -> None:
        self.assertEqual(protocol.CORRECT_PAIR_RATE_FLOOR, 0.80)
        # O nome do campo e parte da guarda: um gate sobre a taxa de sinalizacoes
        # deixaria passar um triador que sinaliza tudo.
        self.assertIn("PAR", protocol.CORRECT_PAIR_RULE.upper())


class BudgetTests(unittest.TestCase):
    def test_o_orcamento_e_itemizado_e_soma_o_total(self) -> None:
        plan = protocol.planned_call_count(census=10_000)
        self.assertEqual(
            plan["controls"],
            len(protocol.TAXONOMY)
            * (protocol.CONTROLS_PER_SUBTYPE + protocol.SHAMS_PER_SUBTYPE),
        )
        self.assertEqual(
            plan["adversarial"],
            2
            * protocol.ADVERSARIAL_VECTORS_COUNT
            * protocol.ADVERSARIAL_PAIRS_PER_VECTOR,
        )
        self.assertEqual(
            plan["indistinguishability"], protocol.INDISTINGUISHABILITY_PAIRS
        )
        self.assertEqual(plan["census"], 10_000)
        self.assertEqual(
            plan["total"],
            plan["controls"]
            + plan["adversarial"]
            + plan["indistinguishability"]
            + plan["census"],
        )

    def test_o_total_de_hoje_e_o_numero_que_o_operador_confirma(self) -> None:
        # Publicado como valor: o operador digita este numero, e um plano que mudasse
        # de tamanho em silencio faria dele um `--confirm-calls` que confirma outra
        # coisa. 11 subtipos x 120 + 4 vetores x 40 x 2 + 100 = 1.740, mais o censo.
        self.assertEqual(protocol.planned_call_count(census=0)["total"], 1_740)

    def test_recusa_censo_negativo(self) -> None:
        with self.assertRaises(ValueError):
            protocol.planned_call_count(census=-1)


class DigestTests(unittest.TestCase):
    def test_o_digesto_do_protocolo_e_o_sha256_dos_bytes_do_proprio_modulo(self) -> None:
        path = Path(protocol.__file__)
        expected = hashlib.sha256(path.read_bytes()).hexdigest()
        self.assertEqual(protocol.protocol_digest(), expected)

    def test_a_versao_do_protocolo_e_versionada_e_nao_uma_data(self) -> None:
        self.assertTrue(protocol.PROTOCOL_VERSION.endswith("-v1"))

    def test_a_fracao_escrita_a_mao_tem_piso_declarado(self) -> None:
        self.assertGreaterEqual(protocol.HAND_WRITTEN_FRACTION_FLOOR, 1 / 3)
        self.assertLessEqual(protocol.HAND_WRITTEN_FRACTION_FLOOR, 1.0)

    def test_a_margem_de_equivalencia_e_a_amostra_humana_estao_pre_inscritas(
        self,
    ) -> None:
        self.assertEqual(protocol.INDISTINGUISHABILITY_MARGIN, 0.10)
        self.assertEqual(protocol.INDISTINGUISHABILITY_PAIRS, 100)
        self.assertEqual(protocol.HUMAN_INDISTINGUISHABILITY_SAMPLE, 20)
        # A margem tem de ser alcancavel pelo `n`: com 100 pares o intervalo de um
        # discriminador exactamente ao azar cabe dentro de +/- 0,10.
        half_width = protocol.WILSON_Z_ONE_SIDED_95 * math.sqrt(
            0.25 / protocol.INDISTINGUISHABILITY_PAIRS
        )
        self.assertLess(half_width, protocol.INDISTINGUISHABILITY_MARGIN)


if __name__ == "__main__":
    unittest.main()
