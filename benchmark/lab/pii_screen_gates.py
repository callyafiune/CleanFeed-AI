"""Os CONTROLES semeados, os GATES e o RECIBO da execucao do `llm-pii-screen`.

O que este modulo mede, e nada alem: como o triador se comporta sobre material cuja
resposta NOS conhecemos. Nao mede prevalencia de PII real, nao estima `S_real`, e nao
transporta nada dos controles para o corpus. A extrapolacao controles -> corpus esta
declarada NOVA e NAO VALIDADA no registro, e este modulo nao a faz em sitio nenhum.

TRES FAMILIAS DE MEDICAO, e sao tres porque respondem a perguntas diferentes:

  * TAXONOMIA — `S_control` por estrato: de 60 injecoes de cada subtipo declarado,
    quantas o triador sinalizou? O piso e sobre o LIMITE INFERIOR de Wilson, por
    subtipo, e estrato abaixo do piso ABORTA. Sem isso a execucao publicaria alegacao
    sobre um subtipo cuja sensibilidade ela nao alcancou;
  * ADVERSARIAL — a taxa de PARES CORRECTOS por vetor de evasao: o controle sinalizado
    E o sham pareado aprovado, na MESMA unidade. Sinalizar os dois nao e meio acerto, e
    nenhum, e a regra esta escrita no protocolo em vez de aqui;
  * INDISTINGUIBILIDADE — as injecoes sao tao dificeis quanto instancias reais? Um
    discriminador terceiro tenta dizer qual membro do par a carrega, e a execucao aborta
    se ele acertar FORA da margem em torno do azar. Note que o desfecho ruim aqui e
    acertar demais: um discriminador certeiro diz que as injecoes tem forma propria.

A CEGUEIRA E A MESMA DO CENSO, e pelo mesmo mecanismo: o triador recebe
`pii_screen.ProjectionRow`, que tem tres campos e nenhum deles diz se a linha carrega
injecao. O gabarito vive no CATALOGO, que e um objeto diferente e nunca lhe e passado.

O GATE E SOBRE SINALIZAR, e nao sobre nomear o subtipo certo — a distincao esta
publicada no recibo para nao ser lida errado. Razao: o que protege o corpus e o
sinalizar (D-12 dropa todo sinalizado, com subtipo certo ou errado), e um piso que
exigisse a categoria correcta mediria competencia taxonomica, que e outra alegacao. A
concordancia de subtipo e medida e publicada como DIAGNOSTICO, ao lado.

E o par de gates e coerente por construcao: um triador que sinalize tudo alcanca
sensibilidade 1,0 em todo estrato e falha o teto de sham.

STDLIB SO, como o resto do lab.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Mapping, Sequence

import pii_screen
import pii_screen_protocol as protocol


class GateError(RuntimeError):
    """Base de toda recusa deste modulo."""


class CatalogueDoesNotMatchThePlan(GateError):
    """O catalogo de controles nao e o que o protocolo pre-inscreve. Recusado ANTES da
    primeira chamada paga: contar depois de gastar seria descobrir o denominador com o
    dinheiro ja gasto."""


class ProbeOutcomeMissing(GateError):
    """Ha sonda do catalogo sem resultado. Uma lacuna muda o denominador do estrato, e um
    denominador escolhido depois de ver o resultado nao e medicao."""


class GatesFailed(GateError):
    """Um ou mais gates reprovaram. Lista TODOS, e a razao de listar todos e a mesma de
    medir todos antes de abortar: parar no primeiro escolheria quais gates a execucao
    reporta."""


# Os papeis de uma sonda, e sao dois. `injected` carrega a instancia; `sham` e a copia
# limpa do MESMO portador, com uma edicao de forma equivalente e nenhuma PII.
PROBE_ROLES: tuple[str, ...] = ("injected", "sham")


@dataclass(frozen=True)
class TaxonomyProbe:
    """Uma sonda da familia da taxonomia: injecao de um subtipo declarado, ou o sham dela.

    `hand_written` e do OPERADOR e nao do gerador, e o protocolo poe piso na fracao: um
    triador que reconhece o proprio estilo de injecao mede a si mesmo, e a fracao manual
    e o que impede a medicao de ser sobre o gerador.
    """

    probe_id: str
    subtype: str
    role: str
    pair_id: str
    hand_written: bool
    text: str


@dataclass(frozen=True)
class AdversarialProbe:
    """Uma sonda de vetor de evasao, ou o sham de INSTRUCAO IDENTICA dela."""

    probe_id: str
    vector: str
    role: str
    pair_id: str
    text: str


@dataclass(frozen=True)
class IndistinguishabilityPair:
    """Um par que o DISCRIMINADOR julga: qual dos dois carrega a injecao?

    Nao passa pelo triador. O discriminador e de familia diferente do triador E do
    gerador das injecoes, porque um discriminador da familia do gerador reconheceria o
    estilo dele e mediria autoria em vez de dificuldade.
    """

    pair_id: str
    injected_probe_id: str
    clean_probe_id: str
    injected_text: str
    clean_text: str


@dataclass(frozen=True)
class ProbeOutcome:
    """O que o triador respondeu sobre uma sonda. `flagged` e o que os gates leem."""

    probe_id: str
    flagged: bool
    subtypes: tuple[str, ...] = ()


def _digest_of(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def probe_projection(
    probes: Sequence[TaxonomyProbe | AdversarialProbe],
) -> list[pii_screen.ProjectionRow]:
    """As sondas na forma CEGA, que e a unica forma em que o triador as ve.

    Reusa `ProjectionRow` do censo em vez de um tipo novo, e a razao e a mesma pela qual
    ele existe: a cegueira e a FORMA do tipo. Um tipo proprio para controles seria uma
    segunda forma capaz de ganhar um campo de gabarito.
    """
    return [
        pii_screen.ProjectionRow(
            row_id=probe.probe_id,
            text_sha256=_digest_of(probe.text),
            text=probe.text,
        )
        for probe in probes
    ]


def screen_probes(
    probes: Sequence[TaxonomyProbe | AdversarialProbe],
    triager: Callable[[str], pii_screen.TriageVerdict],
) -> list[ProbeOutcome]:
    """Corre o triador sobre as sondas e devolve os resultados.

    A chamada e a do CENSO (`pii_screen.screen_census`), de proposito: e ele que valida o
    veredito contra a taxonomia pre-inscrita e aborta na linha em que o triador levantar.
    Uma segunda porta de chamada teria uma segunda validacao capaz de discordar.

    O vocabulario de disposicao do censo NAO viaja para ca. `flagged-dropped` nomeia uma
    acao — a linha sai do corpus — que sobre um controle nao acontece: nenhum controle
    esta no corpus. Aqui le-se so o sinal, e o log dos controles tem forma propria.
    """
    dispositions = pii_screen.screen_census(probe_projection(probes), triager)
    return [
        ProbeOutcome(
            probe_id=disposition.row_id,
            flagged=disposition.disposition != "passed",
            subtypes=disposition.subtypes,
        )
        for disposition in dispositions
    ]


def write_probe_outcomes(path: Path, outcomes: Iterable[ProbeOutcome]) -> str:
    """Escreve o log dos controles e devolve o sha256 dos bytes.

    Ordenado por id e nao pela ordem de chegada, como o ledger do censo e pela mesma
    razao: o digesto entra no recibo, e um digesto que dependesse da ordem da corrida
    mudaria sem o conteudo mudar.
    """
    ordered = sorted(outcomes, key=lambda outcome: outcome.probe_id)
    body = "".join(
        json.dumps(
            {
                "probeId": outcome.probe_id,
                "flagged": outcome.flagged,
                "subtypes": list(outcome.subtypes),
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        + "\n"
        for outcome in ordered
    )
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with Path(path).open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(body)
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _by_id(outcomes: Sequence[ProbeOutcome]) -> dict[str, ProbeOutcome]:
    return {outcome.probe_id: outcome for outcome in outcomes}


def _require_every_probe_answered(
    probes: Sequence[TaxonomyProbe | AdversarialProbe],
    outcomes: Mapping[str, ProbeOutcome],
) -> None:
    missing = [probe.probe_id for probe in probes if probe.probe_id not in outcomes]
    if missing:
        names = ", ".join(missing[:5])
        tail = ", ..." if len(missing) > 5 else ""
        raise ProbeOutcomeMissing(
            f"{len(missing)} de {len(probes)} sondas nao tem resultado: {names}{tail}. "
            "O denominador do estrato e o catalogo, entao uma lacuna nao encolhe a "
            "medicao — falsifica-a"
        )


def assert_the_taxonomy_catalogue_matches_the_plan(
    probes: Sequence[TaxonomyProbe],
) -> None:
    """As contagens do protocolo, conferidas ANTES de gastar chamada.

    Cinco condicoes, e cada uma corresponde a um literal pre-inscrito: um subtipo por
    linha da taxonomia, `CONTROLS_PER_SUBTYPE` injecoes, `SHAMS_PER_SUBTYPE` shams,
    pareamento 1:1 por `pair_id`, e a fracao escrita a mao por subtipo acima de
    `HAND_WRITTEN_FRACTION_FLOOR`.
    """
    faltas: list[str] = []
    ids = [probe.probe_id for probe in probes]
    if len(set(ids)) != len(ids):
        repetidos = sorted({name for name in ids if ids.count(name) > 1})
        faltas.append(f"ids repetidos: {', '.join(repetidos[:5])}")
    conhecidos = {subtype.key for subtype in protocol.TAXONOMY}
    for probe in probes:
        if probe.subtype not in conhecidos:
            faltas.append(
                f"a sonda {probe.probe_id!r} nomeia o subtipo {probe.subtype!r}, fora da "
                "taxonomia pre-inscrita"
            )
        if probe.role not in PROBE_ROLES:
            faltas.append(
                f"a sonda {probe.probe_id!r} tem papel {probe.role!r}, fora de "
                f"{PROBE_ROLES}"
            )
    for subtype in protocol.TAXONOMY:
        do_subtipo = [probe for probe in probes if probe.subtype == subtype.key]
        injetadas = [probe for probe in do_subtipo if probe.role == "injected"]
        shams = [probe for probe in do_subtipo if probe.role == "sham"]
        if len(injetadas) != protocol.CONTROLS_PER_SUBTYPE:
            faltas.append(
                f"{subtype.key}: {len(injetadas)} injecoes, o protocolo pre-inscreve "
                f"{protocol.CONTROLS_PER_SUBTYPE}"
            )
        if len(shams) != protocol.SHAMS_PER_SUBTYPE:
            faltas.append(
                f"{subtype.key}: {len(shams)} shams, o protocolo pre-inscreve "
                f"{protocol.SHAMS_PER_SUBTYPE}"
            )
        pares_injetados = {probe.pair_id for probe in injetadas}
        pares_sham = {probe.pair_id for probe in shams}
        if pares_injetados != pares_sham:
            sem_sham = sorted(pares_injetados - pares_sham)
            sem_injecao = sorted(pares_sham - pares_injetados)
            faltas.append(
                f"{subtype.key}: pareamento 1:1 quebrado — {len(sem_sham)} injecao(oes) "
                f"sem sham ({', '.join(sem_sham[:3])}) e {len(sem_injecao)} sham(s) sem "
                f"injecao ({', '.join(sem_injecao[:3])})"
            )
        if injetadas:
            mao = sum(1 for probe in injetadas if probe.hand_written)
            fracao = mao / len(injetadas)
            if fracao < protocol.HAND_WRITTEN_FRACTION_FLOOR:
                faltas.append(
                    f"{subtype.key}: {mao}/{len(injetadas)} injecoes escritas a mao "
                    f"({fracao:.4f}), abaixo do piso "
                    f"{protocol.HAND_WRITTEN_FRACTION_FLOOR:.4f} — sem a fracao manual a "
                    "medicao e sobre o gerador e nao sobre o triador"
                )
    if faltas:
        raise CatalogueDoesNotMatchThePlan(
            f"o catalogo de controles nao e o do protocolo "
            f"({protocol.PROTOCOL_VERSION}): " + "; ".join(faltas)
        )


def assert_the_adversarial_catalogue_matches_the_plan(
    probes: Sequence[AdversarialProbe],
) -> None:
    """Os quatro vetores, `ADVERSARIAL_PAIRS_PER_VECTOR` pares cada, pareados 1:1."""
    faltas: list[str] = []
    ids = [probe.probe_id for probe in probes]
    if len(set(ids)) != len(ids):
        repetidos = sorted({name for name in ids if ids.count(name) > 1})
        faltas.append(f"ids repetidos: {', '.join(repetidos[:5])}")
    conhecidos = {vector.key for vector in protocol.ADVERSARIAL_VECTORS}
    fora = sorted({probe.vector for probe in probes} - conhecidos)
    if fora:
        faltas.append(f"vetor(es) fora da lista fechada: {', '.join(fora)}")
    for vector in protocol.ADVERSARIAL_VECTORS:
        do_vetor = [probe for probe in probes if probe.vector == vector.key]
        injetadas = [probe for probe in do_vetor if probe.role == "injected"]
        shams = [probe for probe in do_vetor if probe.role == "sham"]
        if len(injetadas) != protocol.ADVERSARIAL_PAIRS_PER_VECTOR:
            faltas.append(
                f"{vector.key}: {len(injetadas)} controles, o protocolo pre-inscreve "
                f"{protocol.ADVERSARIAL_PAIRS_PER_VECTOR}"
            )
        if len(shams) != protocol.ADVERSARIAL_PAIRS_PER_VECTOR:
            faltas.append(
                f"{vector.key}: {len(shams)} shams, o protocolo pre-inscreve "
                f"{protocol.ADVERSARIAL_PAIRS_PER_VECTOR}"
            )
        if {probe.pair_id for probe in injetadas} != {
            probe.pair_id for probe in shams
        }:
            faltas.append(
                f"{vector.key}: pareamento 1:1 quebrado, e sem o par o gate mede "
                "sensibilidade em vez de discriminacao"
            )
    if faltas:
        raise CatalogueDoesNotMatchThePlan(
            "o catalogo adversarial nao e o do protocolo: " + "; ".join(faltas)
        )


def assert_the_indistinguishability_catalogue_matches_the_plan(
    pairs: Sequence[IndistinguishabilityPair],
) -> None:
    """`INDISTINGUISHABILITY_PAIRS` pares, ids distintos entre si e dentro do par."""
    faltas: list[str] = []
    if len(pairs) != protocol.INDISTINGUISHABILITY_PAIRS:
        faltas.append(
            f"{len(pairs)} pares, o protocolo pre-inscreve "
            f"{protocol.INDISTINGUISHABILITY_PAIRS}"
        )
    identificadores = [pair.pair_id for pair in pairs]
    if len(set(identificadores)) != len(identificadores):
        faltas.append("pair_id repetido")
    for pair in pairs:
        if pair.injected_probe_id == pair.clean_probe_id:
            faltas.append(
                f"o par {pair.pair_id!r} nomeia a mesma sonda nos dois lados: um par cujo "
                "membros coincidem nao tem resposta a acertar"
            )
    if faltas:
        raise CatalogueDoesNotMatchThePlan(
            "o catalogo de indistinguibilidade nao e o do protocolo: "
            + "; ".join(faltas)
        )


def measure_sensitivity_by_stratum(
    probes: Sequence[TaxonomyProbe], outcomes: Sequence[ProbeOutcome]
) -> dict:
    """`S_control` por estrato, com o limite inferior de Wilson e o piso do subtipo.

    O SUCESSO E SINALIZAR, e a concordancia de subtipo vai ao lado como diagnostico. As
    duas nao se somam nem se substituem: o piso e sobre a primeira porque e ela que
    protege o corpus, e a segunda e publicada para que ninguem leia o piso como
    competencia taxonomica.
    """
    por_id = _by_id(outcomes)
    injetadas = [probe for probe in probes if probe.role == "injected"]
    _require_every_probe_answered(injetadas, por_id)
    estratos: dict[str, dict] = {}
    for subtype in protocol.TAXONOMY:
        do_subtipo = [probe for probe in injetadas if probe.subtype == subtype.key]
        if not do_subtipo:
            continue
        sinalizadas = [
            probe for probe in do_subtipo if por_id[probe.probe_id].flagged
        ]
        concordantes = [
            probe
            for probe in sinalizadas
            if subtype.key in por_id[probe.probe_id].subtypes
        ]
        n = len(do_subtipo)
        acertos = len(sinalizadas)
        limite = protocol.wilson_lower_bound(acertos, n)
        estratos[subtype.key] = {
            "group": subtype.group,
            "flagged": acertos,
            "n": n,
            "sControl": acertos / n,
            "wilsonLower": limite,
            "floor": subtype.sensitivity_floor,
            "meetsFloor": limite >= subtype.sensitivity_floor,
            # DIAGNOSTICO, e nao gate: nomear a categoria errada continua a proteger o
            # corpus, porque D-12 dropa todo sinalizado.
            "subtypeAgreement": len(concordantes) / n,
        }
    return estratos


def measure_sham_false_positives(
    probes: Sequence[TaxonomyProbe | AdversarialProbe],
    outcomes: Sequence[ProbeOutcome],
) -> dict:
    """A taxa de sinalizacao dos SHAMS, com o limite SUPERIOR de Wilson.

    UM gate sobre a UNIAO dos shams, porque o protocolo pre-inscreve UM teto. A divisao
    por familia e publicada ao lado como diagnostico: derivar tres gates de um literal
    seria apertar a pre-inscricao depois de a escrever.
    """
    por_id = _by_id(outcomes)
    shams = [probe for probe in probes if probe.role == "sham"]
    _require_every_probe_answered(shams, por_id)
    sinalizados = [probe for probe in shams if por_id[probe.probe_id].flagged]
    n = len(shams)
    limite = protocol.wilson_upper_bound(len(sinalizados), n) if n else 0.0
    familias: dict[str, dict] = {}
    for nome, membros in (
        ("taxonomy", [p for p in shams if isinstance(p, TaxonomyProbe)]),
        ("adversarial", [p for p in shams if isinstance(p, AdversarialProbe)]),
    ):
        if not membros:
            continue
        marcados = sum(1 for p in membros if por_id[p.probe_id].flagged)
        familias[nome] = {
            "flagged": marcados,
            "n": len(membros),
            "rate": marcados / len(membros),
        }
    return {
        "flagged": len(sinalizados),
        "n": n,
        "rate": (len(sinalizados) / n) if n else None,
        "wilsonUpper": limite,
        "ceiling": protocol.SHAM_FALSE_POSITIVE_CEILING,
        "underCeiling": limite <= protocol.SHAM_FALSE_POSITIVE_CEILING,
        "byFamily": familias,
    }


def measure_adversarial_pairs(
    probes: Sequence[AdversarialProbe], outcomes: Sequence[ProbeOutcome]
) -> dict:
    """A taxa de PARES CORRECTOS por vetor, sob a regra que o protocolo escreve.

    Um par conta como correcto quando o controle e sinalizado E o sham pareado passa, na
    mesma unidade. As tres maneiras de errar sao contadas separadamente, porque dizem
    coisas diferentes: perder o controle e cegueira, sinalizar o sham e excesso, e as
    duas ao mesmo tempo e um triador que nao esta a ler o texto.
    """
    por_id = _by_id(outcomes)
    _require_every_probe_answered(probes, por_id)
    por_vetor: dict[str, dict] = {}
    for vector in protocol.ADVERSARIAL_VECTORS:
        do_vetor = [probe for probe in probes if probe.vector == vector.key]
        if not do_vetor:
            continue
        injetadas = {probe.pair_id: probe for probe in do_vetor if probe.role == "injected"}
        shams = {probe.pair_id: probe for probe in do_vetor if probe.role == "sham"}
        correctos = 0
        perdeu_controle = 0
        sinalizou_sham = 0
        os_dois = 0
        for pair_id, injetada in injetadas.items():
            sham = shams.get(pair_id)
            if sham is None:
                continue
            controle_ok = por_id[injetada.probe_id].flagged
            sham_ok = not por_id[sham.probe_id].flagged
            if controle_ok and sham_ok:
                correctos += 1
            elif not controle_ok and not sham_ok:
                os_dois += 1
            elif not controle_ok:
                perdeu_controle += 1
            else:
                sinalizou_sham += 1
        n = len(injetadas)
        limite = protocol.wilson_lower_bound(correctos, n) if n else 0.0
        por_vetor[vector.key] = {
            "correctPairs": correctos,
            "n": n,
            "rate": (correctos / n) if n else None,
            "wilsonLower": limite,
            "floor": protocol.CORRECT_PAIR_RATE_FLOOR,
            "meetsFloor": limite >= protocol.CORRECT_PAIR_RATE_FLOOR,
            "missedControl": perdeu_controle,
            "flaggedSham": sinalizou_sham,
            "bothWrong": os_dois,
        }
    return {"rule": protocol.CORRECT_PAIR_RULE, "byVector": por_vetor}


def measure_indistinguishability(
    pairs: Sequence[IndistinguishabilityPair], choices: Mapping[str, str]
) -> dict:
    """A acuracia do discriminador contra o AZAR, por equivalencia pre-definida.

    O desfecho ruim aqui e acertar DEMAIS: um discriminador que distingue as injecoes das
    instancias reais diz que as injecoes tem forma propria, e a sensibilidade medida sobre
    elas nao viaja. Acertar de menos tambem sai da margem, e tambem aborta — nao ha
    resultado bom fora do azar, porque a alegacao e equivalencia e nao superioridade.
    """
    faltando = [pair.pair_id for pair in pairs if pair.pair_id not in choices]
    if faltando:
        raise ProbeOutcomeMissing(
            f"{len(faltando)} de {len(pairs)} pares de indistinguibilidade sem escolha do "
            f"discriminador: {', '.join(faltando[:5])}"
        )
    acertos = sum(
        1 for pair in pairs if choices[pair.pair_id] == pair.injected_probe_id
    )
    n = len(pairs)
    acuracia = acertos / n if n else None
    desvio = abs(acuracia - 0.5) if acuracia is not None else None
    return {
        "correct": acertos,
        "n": n,
        "accuracy": acuracia,
        "chance": 0.5,
        "margin": protocol.INDISTINGUISHABILITY_MARGIN,
        "deviation": desvio,
        "withinMargin": (
            desvio is not None and desvio <= protocol.INDISTINGUISHABILITY_MARGIN
        ),
        "humanSampleRequired": protocol.HUMAN_INDISTINGUISHABILITY_SAMPLE,
    }


def evaluate_gates(
    *,
    sensitivity: Mapping[str, dict],
    shams: Mapping[str, object],
    adversarial: Mapping[str, object],
    indistinguishability: Mapping[str, object],
) -> dict:
    """Os quatro gates, TODOS avaliados, com o veredito de cada um nomeado.

    Avaliar todos antes de abortar nao e cortesia: parar no primeiro escolheria quais
    gates a execucao reporta, e um relatorio que so mostra o primeiro a cair esconde se
    os outros tres tambem cairiam.
    """
    estratos_abaixo = sorted(
        chave for chave, valor in sensitivity.items() if not valor["meetsFloor"]
    )
    vetores_abaixo = sorted(
        chave
        for chave, valor in dict(adversarial.get("byVector", {})).items()
        if not valor["meetsFloor"]
    )
    return {
        "sensitivityByStratum": {
            "passed": not estratos_abaixo,
            "strataBelowFloor": estratos_abaixo,
        },
        "shamFalsePositive": {
            "passed": bool(shams.get("underCeiling")),
            "wilsonUpper": shams.get("wilsonUpper"),
            "ceiling": shams.get("ceiling"),
        },
        "adversarialPairs": {
            "passed": not vetores_abaixo,
            "vectorsBelowFloor": vetores_abaixo,
        },
        "indistinguishability": {
            "passed": bool(indistinguishability.get("withinMargin")),
            "accuracy": indistinguishability.get("accuracy"),
            "margin": indistinguishability.get("margin"),
        },
    }


def assert_the_gates_passed(gates: Mapping[str, dict]) -> None:
    """Aborta nomeando TODOS os gates que cairam, e o que cada um exigia."""
    reprovados = [nome for nome, valor in gates.items() if not valor["passed"]]
    if not reprovados:
        return
    detalhes: list[str] = []
    for nome in reprovados:
        valor = gates[nome]
        extra = {
            chave: item
            for chave, item in valor.items()
            if chave != "passed" and item not in (None, [], ())
        }
        detalhes.append(f"{nome} ({extra})" if extra else nome)
    raise GatesFailed(
        f"{len(reprovados)} de {len(gates)} gates reprovaram: {'; '.join(detalhes)}. "
        "Uma execucao com gate reprovado nao produz recibo: o perfil "
        f"{protocol.PROTOCOL_VERSION} publica alegacao por subtipo sobre os controles, e "
        "um estrato abaixo do piso nao a sustenta"
    )


def build_receipt(
    *,
    triager: Mapping[str, object],
    discriminator: Mapping[str, object],
    injection_generator: Mapping[str, object],
    catalogue: Mapping[str, object],
    sensitivity: Mapping[str, dict],
    shams: Mapping[str, object],
    adversarial: Mapping[str, object],
    indistinguishability: Mapping[str, object],
    census: Mapping[str, object],
    corpus: Mapping[str, object],
    gates: Mapping[str, dict],
) -> dict:
    """O recibo da execucao, com o protocolo citado por digesto.

    O recibo NAO se constroi sobre gate reprovado, e a guarda esta aqui e nao no chamador:
    um recibo de execucao reprovada seria lido como recibo.

    A ALEGACAO vai por extenso e a lista do que ela NAO afirma vai ao lado, as duas do
    registro. Escritas no artefato e nao so no documento porque o artefato e o que viaja:
    um recibo lido sozinho tem de dizer o que nao pode ser concluido dele.
    """
    assert_the_gates_passed(gates)
    return {
        "artifact": "pii-screening-receipt",
        "protocol": {
            "version": protocol.PROTOCOL_VERSION,
            "digest": protocol.protocol_digest(),
            "plannedCalls": protocol.planned_call_count(
                census=int(census.get("projectionPairs") or 0)
            ),
        },
        "triager": dict(triager),
        "discriminator": dict(discriminator),
        "injectionGenerator": dict(injection_generator),
        "catalogue": dict(catalogue),
        "sControlByStratum": {chave: dict(valor) for chave, valor in sensitivity.items()},
        "shamFalsePositive": dict(shams),
        "adversarial": dict(adversarial),
        "indistinguishability": dict(indistinguishability),
        "census": dict(census),
        "corpus": dict(corpus),
        "gates": {chave: dict(valor) for chave, valor in gates.items()},
        "prevalenceBound": None,
        "gateIsOnFlagging": (
            "o piso por subtipo e sobre SINALIZAR, nao sobre nomear a categoria certa: "
            "`subtypeAgreement` esta publicado ao lado como diagnostico e nao gateia nada"
        ),
        "claim": CLAIM,
        "doesNotClaim": list(DOES_NOT_CLAIM),
        "namedRisks": list(protocol.NAMED_RISKS),
    }


def write_receipt(path: Path, receipt: Mapping[str, object]) -> str:
    """Escreve o recibo e devolve o sha256 dos bytes escritos.

    `sort_keys` e indentacao fixa porque o digesto do recibo e citavel: dois recibos com o
    mesmo conteudo e ordem de chaves diferente teriam digestos diferentes.
    """
    body = json.dumps(receipt, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with Path(path).open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(body)
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


# A ALEGACAO, verbatim do registro (a reescrita do revisor, estendida). Um literal e nao
# uma f-string com os numeros interpolados: os numeros vivem nos campos medidos do
# recibo, e uma segunda copia deles dentro da prosa poderia discordar da primeira.
CLAIM = (
    "Uma projecao de entrada com P pares (id pseudonimizado, digest do texto), digesto I, "
    "foi triada sem rotulo, grupos ou score; k foram sinalizados e TODOS removidos da "
    "elegibilidade, dos quais c confirmados por leitura post-hoc de material ja removido. "
    "A montagem verificou que cada um dos N registros finais, digesto D, corresponde a um "
    "par com disposition `passed` no ledger de disposicoes, digesto L. S_control e seus "
    "limites de Wilson caracterizam apenas esta execucao nos controles pre-inscritos; nao "
    "estimam ausencia ou prevalencia de PII real, nao limitam o corpus, nao validam "
    "transporte controles->real, nao certificam o corpus e nao satisfazem R4. "
    "prevalenceBound: null."
)

# O que o artefato NAO fecha, verbatim do registro.
DOES_NOT_CLAIM: tuple[str, ...] = (
    "prevalencia ou ausencia de PII real no corpus",
    "transporte de sintetico para real (S_control nao e S_real)",
    "R4, nem o selo `release` por si — o selo vem do perfil de garantia",
    "deriva e variancia entre execucoes do triador",
    "governanca de retencao ou transferencia do provedor do modelo",
    "mutacao do pool depois do snapshot",
    "exposicao humana fora deste protocolo",
    "suficiencia pos-drop alem do que o preflight de sobreviventes confere",
    "completude taxonomica: uma categoria que a taxonomia nao nomeia nao e medida",
)
