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
                # O `promptId` nomeia a SEMENTE, e `ai_record` deriva `humanSeed` dele
                # (`<receita>_<candidateId>`). Aqui aponta para a propria linha de
                # proposito: o caso mede o pai da MISTA, e uma semente ausente na linha
                # `ai` fa-la-ia sair por outra razao.
                "promptId": "original_src_ptwiki_p1",
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


if __name__ == "__main__":
    unittest.main()
