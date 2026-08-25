"""A IDENTIDADE da linha no funil, e a REFERENCIA que ela nao e (run: py -3.13 -m pytest).

O defeito que este arquivo fecha e de TIPO. `parentId` e chave ESTRANGEIRA: e o nome com
que a linha mista aponta para o pai humano. Passa-la a um impositor de unicidade que a
MUTILA e tratar referencia como identidade, e o custo aparecia em tres sitios de uma vez,
os tres medidos aqui:

  * a PONTE. `connected_components` une por `derivationRoot` com a condicao `named in
    ids` — o valor tem de ser id de registro PRESENTE. Com a chave do pai movida debaixo
    da mista, a uniao e saltada em SILENCIO, e a ilha racha;
  * a PODA. `near_dupes.prune` devolve um conjunto de IDS, entao duas linhas com o mesmo
    nome vivem e morrem juntas mesmo em clusters diferentes. O caso que isto salva sao as
    HOMONIMAS — duas mistas do mesmo pai, duas lanes `ai` que pediram o mesmo pai —, e
    NAO o par pai/mista: essa alegacao foi retractada, porque a mista precisa do pai
    presente e sai com ele de qualquer modo;
  * o RENOMEIO. Quem colide e quem sobra era decidido pela ORDEM dos pools, entao
    inverte-la inverteria a vitima — sinal de que nenhuma ordem estava certa.

A forma do conserto: a identidade da linha no funil e a identidade do REGISTRO que ela vai
produzir (`funnel_key`), a mista carrega a dela propria (`mix_<pai>`), e
`enforce_unique_keys` nao recebe nome de campo nenhum — nao ha por onde apontar-lhe uma
referencia.

TRES CONDICOES QUE O CROSS-REVIEW ACRESCENTOU, e as tres eram buracos reais do conserto:

  * a identidade E o id do registro BYTE A BYTE, entao ela passa pelo `slug` no funil.
    Sem isso `id.a` e `id_a` eram identidades distintas que escreviam o MESMO `id`;
  * a desambiguacao corre ANTES das podas. Enquanto corria depois, duas linhas do mesmo
    pool com a mesma identidade — duas mistas do mesmo pai, duas lanes `ai` que pediram o
    mesmo pai — chegavam a `prune` com um nome so, e o conjunto de nomes que ele devolve
    matava as duas;
  * um registro cujo pai NAO esta no corpus sai, contado. `assertDerivedParentsResolve`
    (`benchmark/commands/split.ts:116`) recusa o corpus inteiro por causa dele, entao
    conta-lo e continuar era falhar tarde e noutro comando.
"""

from __future__ import annotations

import inspect
import unittest
from pathlib import Path

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


class AIdentidadeEOIdDoRegistro(unittest.TestCase):
    def test_duas_identidades_que_o_slug_COLAPSA_nao_passam_pelo_funil(self) -> None:
        # MEDIDO pelo cross-review: `id.a` e `id_a` sao chaves distintas e o `slug` de
        # ambas e `id_a`. Com a unicidade imposta sobre a chave CRUA, as duas passavam e
        # os dois construtores escreviam o mesmo `id` — DUPLICATE_ID na ingestao.
        humans = [
            human_candidate("src.ptwiki.a", "pagina_1"),
            human_candidate("src_ptwiki_a", "pagina_2", PROSE + " outro"),
        ]
        ac.enforce_unique_keys([[], [], humans])
        identidades = [ac.funnel_key(row) for row in humans]
        self.assertEqual(len(set(identidades)), 2)
        registros = [ac.human_record(row, "ptwiki", None) for row in humans]
        self.assertEqual(len({r["id"] for r in registros}), 2)
        # E CADA UMA E TOKEN, que e a metade que faltava: manter as duas distintas
        # deixando `id.a` como identidade so move o problema para a ingestao, onde um "."
        # e tratado como separador de PII e o esquema selado recusa o registro.
        for identidade in identidades:
            self.assertRegex(identidade, r"^[A-Za-z0-9_-]+$")
        for registro in registros:
            self.assertRegex(registro["id"], r"^[A-Za-z0-9_-]+$")

    def test_a_identidade_E_o_id_do_registro_nas_TRES_classes(self) -> None:
        humano = human_candidate("src.ptwiki.a", "pagina_1")
        gerada = {
            "candidateId": "src.ai.a",
            "text": "gerado " * 40,
            "wordCount": 40,
            "meta": {
                "provider": "gemini",
                "family": "gemini-3.5-flash-lite",
                "model": "gemini-3.5-flash-lite",
                "version": "gemini-3.5-flash-lite",
                "recipe": "original",
                "generationLane": "gemini-api",
                "temperature": "0.8",
                "promptId": "original_x",
                "promptSha256": "b" * 64,
                "promptTemplateDigest": "c" * 64,
                "generatedAt": "2026-07-24T13:51:05.004170+00:00",
            },
        }
        mista = mixed_candidate("src.ptwiki.a", "misto " * 30)
        self.assertEqual(
            ac.human_record(humano, "ptwiki", None)["id"], ac.funnel_key(humano)
        )
        self.assertEqual(ac.ai_record(gerada)["id"], ac.funnel_key(gerada))
        self.assertEqual(ac.mixed_record(mista)["id"], ac.funnel_key(mista))


class AAutoReferenciaNaoESemente(unittest.TestCase):
    """Uma linha gerada cuja semente e o proprio id NAO tem pai humano.

    O guarda saltava toda auto-referencia, nos dois eixos, e era assim que esta linha
    passava. A assimetria certa e a do guarda selado: `derivationRoot` pede presenca — e o
    proprio registro esta presente —, `humanSeed` pede um registro HUMANO, e um registro
    gerado nao o e nem quando aponta para si mesmo.
    """

    @staticmethod
    def _ai(**meta_extra) -> dict:
        meta = {
            "provider": "gemini",
            "family": "gemini-3.5-flash-lite",
            "model": "gemini-3.5-flash-lite",
            "version": "gemini-3.5-flash-lite",
            "recipe": "original",
            "generationLane": "gemini-api",
            "temperature": "0.8",
            "promptSha256": "b" * 64,
            "promptTemplateDigest": "c" * 64,
            "generatedAt": "2026-07-24T13:51:05.004170+00:00",
        }
        meta.update(meta_extra)
        return {
            "candidateId": "src_ptwiki_h41",
            "text": "gerado " * 40,
            "wordCount": 40,
            "meta": meta,
        }

    def test_gerada_que_nomeia_A_SI_PROPRIA_como_semente_SAI(self) -> None:
        registro = ac.ai_record(self._ai(pairedWith="src_ptwiki_h41"))
        self.assertEqual(registro["groups"]["humanSeed"]["id"], registro["id"])
        kept, counts = ac.drop_records_whose_parent_is_absent([registro])
        self.assertEqual(kept, [])
        self.assertEqual(counts["parent-not-human"], 1)

    def test_a_linha_da_reserva_nomeia_se_por_ID_e_a_identidade_e_UMA(self) -> None:
        # `load_ai` normaliza a linha reservada para `candidateId`, mas uma linha que
        # chegue com `candidateId` vazio e `id` preenchido tinha DUAS fontes de
        # identidade: `funnel_key` caia no ramo da mista (e levantava) e `ai_record` lia
        # `cand["id"]` por conta propria.
        row = {
            "candidateId": "",
            "id": "src_ai_ollama_0001",
            "text": "gerado " * 40,
            "wordCount": 40,
            "meta": {"family": "qwen2.5-7b-q4km", "provider": "ollama"},
        }
        self.assertEqual(ac.funnel_key(row), "src_ai_ollama_0001")

    def test_o_carimbo_de_identidade_tambem_passa_pelo_slug(self) -> None:
        row = human_candidate("src_ptwiki_p1", "pagina_1")
        row[ac.FUNNEL_KEY_FIELD] = "mau.id"
        self.assertEqual(ac.funnel_key(row), "mau_id")
        self.assertEqual(ac.human_record(row, "ptwiki", None)["id"], "mau_id")


class ALigacaoAlcancaAsDuasClasses(unittest.TestCase):
    @staticmethod
    def _ai(candidate_id: str, paired: str) -> dict:
        return {
            "candidateId": candidate_id,
            "text": "gerado " * 40,
            "wordCount": 40,
            "meta": {
                "provider": "gemini",
                "family": "gemini-3.5-flash-lite",
                "model": "gemini-3.5-flash-lite",
                "version": "gemini-3.5-flash-lite",
                "recipe": "original",
                "generationLane": "gemini-api",
                "temperature": "0.8",
                "promptSha256": "b" * 64,
                "promptTemplateDigest": "c" * 64,
                "pairedWith": paired,
                "generatedAt": "2026-07-24T13:51:05.004170+00:00",
            },
        }

    def test_a_gerada_cuja_semente_foi_RENOMEADA_e_repontada_e_NAO_e_orfa(self) -> None:
        # O achado do cross-review: o corte de orfas compara com IDENTIDADES, entao antes
        # da ligacao a gerada cujo pai foi renomeado lia como orfa — e uma geracao, que e
        # chamada paga, saia por um renomeio que o linker sabia resolver.
        colidente = self._ai("src_ptwiki_p1", "src_ptwiki_ausente")
        humans = [human_candidate("src_ptwiki_p1", "pagina_1")]
        gerada = self._ai("src_ai_0002", "src_ptwiki_p1")
        ai = [colidente, gerada]
        ac.enforce_unique_keys([ai, [], humans])
        self.assertNotEqual(ac.funnel_key(humans[0]), "src_ptwiki_p1")

        counts = ac.link_derived_to_parents(ai, [], humans)
        self.assertEqual(counts["repointed"], 1)
        ai_left, _mixed, orphans = ac.drop_orphan_derived_rows(humans, ai, [])
        self.assertIn(gerada, ai_left)
        self.assertEqual(orphans["ai-seed-absent"], 1)  # a colidente, que nomeia ausente

        registro = ac.ai_record(gerada)
        humano = ac.human_record(humans[0], "ptwiki", None)
        self.assertEqual(registro["groups"]["humanSeed"]["id"], humano["id"])
        kept, absent = ac.drop_records_whose_parent_is_absent([humano, registro])
        self.assertEqual(len(kept), 2)
        self.assertEqual(absent["parent-absent"], 0)

    def test_a_ligacao_e_IDEMPOTENTE_e_a_segunda_passagem_nao_orfana(self) -> None:
        # MEDIDO antes de existir: depois da primeira passagem `named_seed_identity`
        # devolve o CARIMBO, que e a identidade, e um mapa chaveado so por referencias
        # nao o encontrava — a segunda chamada reportava `unresolved: 1` e o corte de
        # orfas dropava uma geracao que a primeira tinha resolvido.
        colidente = self._ai("src_ptwiki_p1", "src_ptwiki_ausente")
        humans = [human_candidate("src_ptwiki_p1", "pagina_1")]
        gerada = self._ai("src_ai_0002", "src_ptwiki_p1")
        ai = [colidente, gerada]
        ac.enforce_unique_keys([ai, [], humans])
        primeira = ac.link_derived_to_parents(ai, [], humans)
        segunda = ac.link_derived_to_parents(ai, [], humans)
        self.assertEqual(primeira["resolved"], 1)
        self.assertEqual(segunda["resolved"], 1)
        self.assertEqual(segunda["unresolved"], primeira["unresolved"])
        # E o repontamento conta UMA vez: a segunda passagem nao move nada.
        self.assertEqual(primeira["repointed"], 1)
        self.assertEqual(segunda["repointed"], 0)
        ai_left, _mixed, _orphans = ac.drop_orphan_derived_rows(humans, ai, [])
        self.assertIn(gerada, ai_left)

    def test_semente_que_resolve_em_DUAS_humanas_RECUSA(self) -> None:
        humans = [
            human_candidate("src_ptwiki_p1", "pagina_1"),
            human_candidate("src_ptwiki_p1", "pagina_2", PROSE + " outro"),
        ]
        ai = [self._ai("src_ai_0001", "src_ptwiki_p1")]
        ac.enforce_unique_keys([ai, [], humans])
        with self.assertRaises(ac.ParentIdentityAmbiguous) as caught:
            ac.link_derived_to_parents(ai, [], humans)
        self.assertIn("src_ptwiki_p1", str(caught.exception))

    def test_a_gerada_SEM_semente_nao_e_contada_em_lado_nenhum(self) -> None:
        humans = [human_candidate("src_ptwiki_p1", "pagina_1")]
        ai = [self._ai("src_ai_0001", "")]
        ai[0]["meta"]["promptId"] = "original"
        counts = ac.link_derived_to_parents(ai, [], humans)
        self.assertEqual(counts, {"resolved": 0, "repointed": 0, "unresolved": 0})


class ASementeNomeada(unittest.TestCase):
    @staticmethod
    def _ai(paired: str) -> dict:
        return {
            "candidateId": "src_ai_0001",
            "text": "gerado " * 40,
            "wordCount": 40,
            "meta": {
                "provider": "gemini",
                "family": "gemini-3.5-flash-lite",
                "model": "gemini-3.5-flash-lite",
                "version": "gemini-3.5-flash-lite",
                "recipe": "original",
                "generationLane": "gemini-api",
                "temperature": "0.8",
                "promptId": "original_x",
                "promptSha256": "b" * 64,
                "promptTemplateDigest": "c" * 64,
                "pairedWith": paired,
                "generatedAt": "2026-07-24T13:51:05.004170+00:00",
            },
        }

    def test_a_semente_e_TOKEN_de_eixo_e_nao_a_cadeia_do_arquivo_de_pares(self) -> None:
        # `pairedWith` vem do arquivo de pares e nao passou por normalizacao nenhuma; o
        # eixo de agrupamento recusa valor fora de /^[A-Za-z0-9_-]+$/. Convertendo numa
        # autoridade so, a comparacao com a identidade da humana e a escrita do eixo
        # nunca discordam.
        row = self._ai("src.ptwiki.a")
        self.assertEqual(ac.named_seed_identity(row), "src_ptwiki_a")
        registro = ac.ai_record(row)
        self.assertEqual(registro["groups"]["humanSeed"]["id"], "src_ptwiki_a")

    def test_receita_sem_pai_humano_nao_nomeia_semente(self) -> None:
        row = self._ai("")
        row["meta"]["promptId"] = "original"
        self.assertIsNone(ac.named_seed_identity(row))
        registro = ac.ai_record(row)
        self.assertEqual(registro["groups"]["humanSeed"]["state"], "notApplicable")


class AOrfaSaiANTESDaCota(unittest.TestCase):
    """As derivadas sem pai no pool saem antes da SELECAO, e a posicao e a alegacao.

    Depois da construcao ha um guarda que apanha o mesmo estado, e ele fica: e o que prova
    que a combinacao de poda, triagem e selecao fechou. Mas apanhar la e apanhar TARDE —
    a cota ja foi preenchida com linhas que desaparecem, e o corpus sai curto sem ninguem
    ter escolhido isso.
    """

    def test_a_gerada_cuja_semente_nao_esta_no_pool_SAI_contada(self) -> None:
        humans = [human_candidate("src_ptwiki_p1", "pagina_1")]
        ai = [
            {
                "candidateId": "a1",
                "text": "gerado " * 40,
                "meta": {"pairedWith": "src_ptwiki_ausente"},
            },
            {
                "candidateId": "a2",
                "text": "outro gerado " * 40,
                "meta": {"pairedWith": "src_ptwiki_p1"},
            },
        ]
        ai_left, mixed_left, counts = ac.drop_orphan_derived_rows(humans, ai, [])
        self.assertEqual([r["candidateId"] for r in ai_left], ["a2"])
        self.assertEqual(counts["ai-seed-absent"], 1)
        self.assertEqual(mixed_left, [])

    def test_a_mista_cujo_pai_nao_esta_no_pool_SAI_contada(self) -> None:
        humans = [human_candidate("src_ptwiki_p1", "pagina_1")]
        mixed = [
            mixed_candidate("src_ptwiki_ausente", "misto um " * 30),
            mixed_candidate("src_ptwiki_p1", "misto dois " * 30),
        ]
        _ai, mixed_left, counts = ac.drop_orphan_derived_rows(humans, [], mixed)
        self.assertEqual([r["parentId"] for r in mixed_left], ["src_ptwiki_p1"])
        self.assertEqual(counts["mixed-parent-absent"], 1)

    def test_a_gerada_SEM_semente_declarada_fica(self) -> None:
        # `load_ai` normaliza as linhas reservadas e descarta o `pairedWith` delas, entao
        # "sem semente" e um estado real do material e nao um defeito a apanhar.
        humans = [human_candidate("src_ptwiki_p1", "pagina_1")]
        ai = [{"candidateId": "a1", "text": "gerado " * 40, "meta": {}}]
        ai_left, _mixed, counts = ac.drop_orphan_derived_rows(humans, ai, [])
        self.assertEqual(len(ai_left), 1)
        self.assertEqual(counts["ai-seed-absent"], 0)


class ASelecaoProtegeAAncora(unittest.TestCase):
    def test_a_ancora_alem_do_corte_da_cota_e_SELECIONADA(self) -> None:
        # Sem as ancoras, `balanced_humans` toma as primeiras da celula e a humana que
        # ancora uma linha gerada fica de fora — e a linha gerada, que e chamada paga, sai
        # com ela. Trocar uma extracao por uma geracao e trocar o barato pelo caro.
        humans = [human_candidate(f"src_ptwiki_h{i}", f"pagina_{i}") for i in range(5)]
        ancora = ac.funnel_key(humans[4])
        escolhidas = ac.balanced_humans(humans, 2, {ancora})
        self.assertIn(ancora, [ac.funnel_key(row) for row in escolhidas])
        self.assertEqual(len(escolhidas), 2)

    def test_sem_ancora_a_ordem_do_pool_decide(self) -> None:
        humans = [human_candidate(f"src_ptwiki_h{i}", f"pagina_{i}") for i in range(5)]
        escolhidas = ac.balanced_humans(humans, 2)
        self.assertEqual(
            [ac.funnel_key(row) for row in escolhidas],
            ["src_ptwiki_h0", "src_ptwiki_h1"],
        )

    def test_a_ordem_RELATIVA_dentro_de_cada_grupo_e_preservada(self) -> None:
        # A selecao continua determinista: as ancoras vao a frente na ordem em que estao
        # no pool, e as outras atras na ordem em que estao no pool.
        humans = [human_candidate(f"src_ptwiki_h{i}", f"pagina_{i}") for i in range(6)]
        ancoras = {ac.funnel_key(humans[5]), ac.funnel_key(humans[3])}
        escolhidas = ac.balanced_humans(humans, 4, ancoras)
        self.assertEqual(
            [ac.funnel_key(row) for row in escolhidas],
            ["src_ptwiki_h3", "src_ptwiki_h5", "src_ptwiki_h0", "src_ptwiki_h1"],
        )


class OPaiAusenteSaiContado(unittest.TestCase):
    @staticmethod
    def _mixed_record_with_absent_parent() -> dict:
        return ac.mixed_record(mixed_candidate("src_ptwiki_ausente", "misto " * 30))

    def test_registro_cujo_pai_nao_esta_no_corpus_SAI(self) -> None:
        # `assertDerivedParentsResolve` recusa o corpus INTEIRO por um destes, e o sitio
        # que o chama e o comando de split. Contar e continuar era falhar tarde.
        humano = ac.human_record(
            human_candidate("src_ptwiki_p1", "pagina_1"), "ptwiki", None
        )
        orfa = self._mixed_record_with_absent_parent()
        kept, counts = ac.drop_records_whose_parent_is_absent([humano, orfa])
        self.assertEqual([r["id"] for r in kept], [humano["id"]])
        self.assertEqual(counts["parent-absent"], 1)

    def test_o_par_que_RESOLVE_fica(self) -> None:
        humano = ac.human_record(
            human_candidate("src_ptwiki_p1", "pagina_1"), "ptwiki", None
        )
        mista = ac.mixed_record(mixed_candidate("src_ptwiki_p1", "misto " * 30))
        kept, counts = ac.drop_records_whose_parent_is_absent([humano, mista])
        self.assertEqual(len(kept), 2)
        self.assertEqual(counts["parent-absent"], 0)

    def test_pai_presente_que_NAO_E_HUMANO_tambem_sai(self) -> None:
        # A segunda pergunta do guarda selado: `humanSeed` nomeia o texto HUMANO de que a
        # linha partiu, entao um pai presente com outro rotulo nao a satisfaz.
        gerada = {
            "candidateId": "src_ptwiki_p1",
            "text": "gerado " * 40,
            "wordCount": 40,
            "meta": {
                "provider": "gemini",
                "family": "gemini-3.5-flash-lite",
                "model": "gemini-3.5-flash-lite",
                "version": "gemini-3.5-flash-lite",
                "recipe": "original",
                "generationLane": "gemini-api",
                "temperature": "0.8",
                # SEM SEMENTE (`promptId` sem sublinhado nao nomeia pai): o caso mede o
                # pai da MISTA, e a linha `ai` esta aqui so para ser um registro PRESENTE
                # com rotulo diferente de humano. Apontar a semente dela a si propria —
                # como a primeira versao deste fixture fazia — era o estado que o guarda
                # tem de recusar, e foi ele que o cross-review achou por essa porta.
                "promptId": "original",
                "promptSha256": "b" * 64,
                "promptTemplateDigest": "c" * 64,
                "generatedAt": "2026-07-24T13:51:05.004170+00:00",
            },
        }
        registro_ai = ac.ai_record(gerada)
        mista = ac.mixed_record(mixed_candidate("src_ptwiki_p1", "misto " * 30))
        kept, counts = ac.drop_records_whose_parent_is_absent([registro_ai, mista])
        self.assertEqual([r["id"] for r in kept], [registro_ai["id"]])
        self.assertEqual(counts["parent-not-human"], 1)


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


class PodaNaoMataAHomonima(unittest.TestCase):
    """A poupanca da poda, e ela NAO e o par pai/mista — essa alegacao foi retractada.

    `prune` devolve um conjunto de NOMES, e o montador filtra os pools por pertenca a ele.
    Duas linhas que cheguem la com a MESMA identidade morrem juntas mesmo em clusters
    diferentes, e chegar com a mesma identidade e comum: duas mistas do mesmo pai (o funil
    le dois arquivos), duas lanes `ai` que pediram o mesmo pai (295 colisoes medidas no
    material). E ESSA a linha que a desambiguacao antes da poda salva.

    O par pai/mista NAO e o caso, e a primeira versao desta unidade dizia que era: uma
    mista precisa do pai PRESENTE — os dois eixos de linhagem dela sao `known` —, entao
    guardar a mista e derrubar o pai nao guarda nada. As duas saem, antes e depois do
    conserto; o que muda e a razao, e a razao agora esta escrita.
    """

    def test_a_poda_nao_mata_a_HOMONIMA_que_ela_guardou(self) -> None:
        # Duas mistas do MESMO pai: identidades homonimas antes da desambiguacao. Uma e
        # quase-duplicata de um terceiro documento e cai; a outra nao tem nada a ver com
        # ele. Com o nome partilhado, o conjunto devolvido matava as duas.
        alheio = PROSE
        quase = PROSE.replace("palavra7", "enxerto")
        distinta = " ".join(f"outra{i}" for i in range(60))
        mixed = [
            mixed_candidate("src_ptwiki_p1", quase),
            mixed_candidate("src_ptwiki_p1", distinta),
        ]
        ac.enforce_unique_keys([[], mixed, []])
        # O documento alheio tem prioridade MENOR (a da classe `ai`), entao e ele que a
        # poda guarda: a mista quase-duplicata dele cai, e a outra so cai com ela se as
        # duas partilharem o nome.
        docs = [(ac.funnel_key(r), r["text"], 1) for r in mixed]
        docs.append(("doc_alheio", alheio, 0))
        dropped, stats = near_dupes.prune(docs)
        self.assertEqual(stats["clusters_collapsed"], 1)
        sobreviventes = [r for r in mixed if ac.funnel_key(r) not in dropped]
        self.assertEqual([r["text"] for r in sobreviventes], [distinta])

    def test_o_par_pai_mista_quase_duplicado_sai_INTEIRO(self) -> None:
        # A RETRACTACAO, medida: a poda guarda a mista (prioridade 1) e derruba o pai
        # (prioridade 2), e a mista sai depois de qualquer modo, porque a linhagem dela
        # nomeia um registro que o corpus nao tem.
        humans = [human_candidate("src_ptwiki_p1", "pagina_1", PROSE)]
        mixed = [mixed_candidate("src_ptwiki_p1", PROSE.replace("palavra7", "enxerto"))]
        docs = [(ac.funnel_key(r), r["text"], 1) for r in mixed] + [
            (ac.funnel_key(r), r["text"], 2) for r in humans
        ]
        dropped, _ = near_dupes.prune(docs)
        humans = [r for r in humans if ac.funnel_key(r) not in dropped]
        mixed = [r for r in mixed if ac.funnel_key(r) not in dropped]
        self.assertEqual(humans, [])
        self.assertEqual(len(mixed), 1)
        # ... e agora a linhagem:
        registros = [ac.mixed_record(r) for r in mixed]
        kept, counts = ac.drop_records_whose_parent_is_absent(registros)
        self.assertEqual(kept, [])
        self.assertEqual(counts["parent-absent"], 1)


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


class AContaAntesDaChamadaPaga(unittest.TestCase):
    """A linha que o construtor recusa sai ANTES da projecao do censo.

    Duas consequencias, e as duas eram reais. A COTA: `balanced_humans` escolhia 4.000 de
    um pool que continha linhas que o construtor ia recusar, e o corpus saia curto. O
    DINHEIRO: a projecao do censo e tomada dos pools, entao cada uma dessas linhas pagava
    uma chamada de triagem para nao poder entrar no corpus de modo nenhum.
    """

    def test_a_linha_inexpressavel_sai_e_a_razao_e_contada(self) -> None:
        boa = human_candidate("src_ptwiki_p1", "pagina_1")
        # Sem `meta`: e a forma das linhas de `reserved.jsonl`, que nao carregam licenca,
        # data nem eixos. `human_record` recusa-as, e `MissingDocumentLicense` e a
        # primeira das quatro recusas a disparar.
        ma = {
            "candidateId": "src_reservada_1",
            "text": PROSE,
            "wordCount": 60,
            "domainSource": "ptwiki_lead",
            "meta": {},
        }
        kept, refused, examples = ac.partition_by_expressibility(
            [boa, ma], lambda c: ac.human_record(c, ac.cell_of(c)[0], None)
        )
        self.assertEqual([r["candidateId"] for r in kept], ["src_ptwiki_p1"])
        self.assertEqual(sum(refused.values()), 1)
        self.assertEqual(list(refused), ["MissingDocumentLicense"])
        self.assertIn("src_reservada_1", examples["MissingDocumentLicense"])

    def test_o_construtor_e_o_MESMO_que_a_montagem_usa_depois(self) -> None:
        # Uma regra propria de "esta linha e expressavel?" poderia discordar da que decide
        # o registro, e a que decide a cota tem de ser a que decide o registro. Medido: o
        # filtro aprova exactamente as linhas que o construtor consegue construir.
        linhas = [
            human_candidate("src_ptwiki_p1", "pagina_1"),
            {
                "candidateId": "src_reservada_1",
                "text": PROSE,
                "wordCount": 60,
                "domainSource": "ptwiki_lead",
                "meta": {},
            },
        ]
        kept, _refused, _ex = ac.partition_by_expressibility(
            linhas, lambda c: ac.human_record(c, ac.cell_of(c)[0], None)
        )
        for linha in kept:
            ac.human_record(linha, ac.cell_of(linha)[0], None)
        for linha in linhas:
            if linha not in kept:
                with self.assertRaises(ac.UnwritableInV3):
                    ac.human_record(linha, ac.cell_of(linha)[0], None)


class OCaminhoDasReservadas(unittest.TestCase):
    def test_load_humans_le_o_caminho_que_lhe_dao_e_nao_um_FIXO(self) -> None:
        # Medido antes do conserto: uma corrida `--sample` sobre um `--candidates-dir` de
        # tres linhas colhia 583 humanas, porque este loader lia `DATASET/reserved.jsonl`
        # ignorando o diretorio que o resto do funil respeita.
        import inspect

        parametros = list(inspect.signature(ac.load_humans).parameters)
        self.assertEqual(
            parametros, ["cand", "reserved", "pools", "collision_sink"]
        )

    def test_reservada_de_um_caminho_dado_entra_no_pool(self) -> None:
        import json
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            raiz = Path(tmp)
            (raiz / f"{ac.HUMAN_POOL_FILES[0]}.jsonl").write_text(
                json.dumps(human_candidate("src_ptwiki_p1", "pagina_1"))
                + chr(10),
                encoding="utf-8",
                newline=chr(10),
            )
            reservada = raiz / "reservada.jsonl"
            reservada.write_text(
                json.dumps(
                    {
                        "id": "src_reservada_1",
                        "text": PROSE,
                        "label": 0,
                        "family": "ptwiki_lead",
                        "wordCount": 60,
                    }
                )
                + chr(10),
                encoding="utf-8",
                newline=chr(10),
            )
            colhidas = ac.load_humans(raiz, reservada)
            vazio = ac.load_humans(raiz, raiz / "nao-existe.jsonl")
        self.assertEqual(len(colhidas), 2)
        self.assertEqual(len(vazio), 1)


class ODesacordoEntreOsDoisConstrutores(unittest.TestCase):
    def test_recusa_DEPOIS_do_filtro_levanta_em_vez_de_contar(self) -> None:
        # Nao e recusa de material: e desacordo entre duas execucoes do mesmo construtor
        # sobre a mesma linha. Contar deixaria a cota curta outra vez, pela razao que o
        # filtro existe para fechar.
        #
        # Chamada DIRECTA porque nenhuma entrada real a alcanca — as duas execucoes sao do
        # mesmo construtor —, e uma guarda que so uma mutacao exercita e a familia de
        # defeito que a § 7 nomeia.
        from collections import Counter

        with self.assertRaises(ac.BuilderRefusalAfterTheFilter) as caught:
            ac.assert_the_builders_agree_with_the_filter(
                Counter({"MissingDocumentLicense": 3}),
                {"MissingDocumentLicense": "a linha src_x nao declara licenca"},
            )
        mensagem = str(caught.exception)
        self.assertIn("MissingDocumentLicense", mensagem)
        self.assertIn("src_x", mensagem)
        self.assertFalse(issubclass(ac.BuilderRefusalAfterTheFilter, ac.UnwritableInV3))

    def test_sem_recusa_o_guarda_do_desacordo_cala(self) -> None:
        from collections import Counter

        ac.assert_the_builders_agree_with_the_filter(Counter(), {})


class APistaMistaRecusaPaiInutilizavel(unittest.TestCase):
    """A pista mista le a forma de CANDIDATO e recusa pai que nao pode ser registro.

    A razao e dinheiro: uma mista feita de pai que o corpus nao pode conter e uma chamada
    paga por um registro que o split recusa. As duas condicoes vivem em
    `make_mixed.parent_refusal_reason`, que e a autoridade unica do relatorio e do filtro.
    """

    @staticmethod
    def _reservada(**extra) -> dict:
        linha = {
            "id": "res_0001",
            "text": PROSE,
            "label": 0,
            "family": "ptwiki_lead",
        }
        linha.update(extra)
        return linha

    @staticmethod
    def _candidata(**extra) -> dict:
        linha = {
            "candidateId": "src_wikipedia_pt_0001",
            "text": PROSE,
            "domainSource": "ptwiki_lead",
            "meta": {"sourceMaterialBatch": "smb_ptwiki-20220301"},
        }
        linha.update(extra)
        return linha

    def test_pai_que_nao_nomeia_aquisicao_e_RECUSADO_e_nao_projetado_como_None(
        self,
    ) -> None:
        import make_mixed

        # A projecao continua a dizer `None` — e a verdade sobre a linha —, e o que mudou
        # e a ADMISSIBILIDADE: antes a linha era gerada e a mista dela caia na montagem,
        # o que gastava a chamada e perdia o registro.
        reservada = self._reservada()
        self.assertIsNone(
            make_mixed.parent_projection(reservada)["sourceMaterialBatch"]
        )
        self.assertEqual(
            make_mixed.parent_refusal_reason(
                make_mixed.normalize_parent_row(reservada)
            ),
            "pai-nao-nomeia-aquisicao",
        )
        self.assertEqual(make_mixed.admissible_parents([reservada]), [])

    def test_a_forma_de_CANDIDATO_e_lida_e_o_lote_vem_do_meta(self) -> None:
        import make_mixed

        candidata = self._candidata()
        normalizada = make_mixed.normalize_parent_row(candidata)
        self.assertEqual(normalizada["id"], "src_wikipedia_pt_0001")
        self.assertEqual(normalizada["label"], 0)
        self.assertEqual(normalizada["family"], "ptwiki_lead")
        self.assertIsNone(make_mixed.parent_refusal_reason(normalizada))
        (projetada,) = make_mixed.admissible_parents([candidata])
        self.assertEqual(projetada["sourceMaterialBatch"], "smb_ptwiki-20220301")

    def test_um_pool_de_GERADAS_recusa_por_nome(self) -> None:
        import make_mixed

        # Um pool de geradas tambem tem `candidateId`, e admiti-lo produziria mistas cujo
        # "pai" e uma linha de IA. `domainSource` e o que separa os dois pools.
        with self.assertRaises(make_mixed.ParentsFileIsNotAHumanPool) as caught:
            make_mixed.normalize_parent_row(
                {"candidateId": "src_ai_0001", "text": PROSE, "meta": {}}
            )
        self.assertIn("src_ai_0001", str(caught.exception))

    def test_a_itemizacao_e_a_MESMA_autoridade_do_filtro(self) -> None:
        import make_mixed

        # Duas contagens da mesma pergunta divergiriam no dia em que uma delas ganhasse
        # uma condicao que a outra nao tem, e a que decide o gasto tem de ser a que
        # decide o relatorio.
        curta = self._candidata(candidateId="src_curta", text="tres palavras so")
        linhas = [self._reservada(), self._candidata(), curta]
        relatorio = make_mixed.parent_admissibility(linhas)
        self.assertEqual(
            relatorio,
            {
                "pai-nao-nomeia-aquisicao": 1,
                "admissivel": 1,
                "abaixo-da-janela-do-extrator": 1,
            },
        )
        self.assertEqual(
            len(make_mixed.admissible_parents(linhas)), relatorio["admissivel"]
        )


if __name__ == "__main__":
    unittest.main()
