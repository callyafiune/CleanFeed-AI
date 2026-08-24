"""O censo de triagem de PII e o LEDGER DE DISPOSICOES, por par `(id, sha256)`.

O que este modulo e, e o que nao e. E um FILTRO AUTOMATICO: nomeia codigo, nunca uma
pessoa, e o registro que sobrevive a ele continua `automated/unreviewed`. Nao e revisao,
nao produz recibo humano, e nao sustenta alegacao de que alguem olhou.

A CEGUEIRA E MECANICA. O triador e um chamavel que recebe `str` e devolve um veredito:
nao ha parametro por onde lhe passar rotulo, grupo, particao ou escore, entao nao ha
nada a esquecer de apagar. `ProjectionRow` carrega tres campos — id, digesto e texto — e
o triador ve so o terceiro.

D-12, E A UNIAO TEM DOIS VALORES. Toda linha sinalizada e `flagged-dropped`, confirmada
ou nao, e nao existe terceiro valor a escrever. A consequencia e a que o desenho quer:
nenhuma linha lida por humano permanece no corpus, porque a leitura humana e post-hoc
sobre material ja removido. O valor do HIBRIDO da v2 (`flagged-human-cleared`, § 5.14b
do ESTADO) e RECUSADO na leitura, de modo que uma execucao da v1 nao o aceita por
acidente.

O DIGESTO DO TEXTO NAO E CALCULADO AQUI. Quem o calcula e `assemble_corpus`, dono do
snapshot (D-19), e este modulo recebe o par ja formado. A direcao da dependencia e
montador -> triagem, e nunca ao contrario: o montador chama a guarda, e um digesto
calculado dos dois lados seria uma segunda autoridade capaz de discordar da primeira.

STDLIB SO, porque o montador e stdlib so e importa este modulo.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Mapping, Protocol, Sequence

import pii_screen_protocol as protocol

# As duas disposicoes, e sao duas. Uma terceira seria um estado de "sinalizado mas
# mantido", que e exactamente a linha exposta a humano dentro do corpus que D-12 fecha.
DISPOSITIONS: tuple[str, ...] = ("passed", "flagged-dropped")

# O valor que o HIBRIDO da v2 usaria. Nomeado aqui para ser RECUSADO por nome: uma
# execucao da v1 que o aceitasse teria material lido por humano dentro do corpus sem
# nenhum dos mecanismos que a v2 exige (recibo ortogonal, verificador independente,
# proibicao do componente conexo nas duas cegas).
V2_HYBRID_DISPOSITION = "flagged-human-cleared"

LEDGER_KEYS = ("id", "textSha256", "disposition", "subtypes")


class PiiScreenError(RuntimeError):
    """Base de toda recusa deste modulo, para o chamador poder apanhar a familia."""


class TriagerFailedOnRow(PiiScreenError):
    """O triador levantou numa linha. O censo ABORTA: um censo com uma linha saltada
    nao e um censo com lacuna, e um censo que nao aconteceu."""


class TriagerNamedUnknownSubtype(PiiScreenError):
    """O triador nomeou categoria que a taxonomia pre-inscrita nao tem. Recusado, e nao
    normalizado: um subtipo que o protocolo nao declara e um rotulo que medicao nenhuma
    cobre, e aceita-lo produziria contagem sobre um estrato inexistente."""


class TriagerContradictedItself(PiiScreenError):
    """Veredito incoerente: sinalizado sem subtipo, ou subtipo sem sinalizacao."""


class LedgerUnreadable(PiiScreenError):
    """O ledger nao e legivel como ledger. Nomeia arquivo, linha e campo."""


class CensusIncomplete(PiiScreenError):
    """Ha par da projecao sem linha no ledger. A alegacao de censo e sobre TODA linha,
    entao uma lacuna falsifica-a para a projecao inteira."""


class SelectedRecordNotScreened(PiiScreenError):
    """Registro selecionado cujo par nao existe no ledger."""


class SelectedRecordWasFlagged(PiiScreenError):
    """Registro selecionado cujo par existe e NAO diz `passed`. Erro distinto do de
    cima de proposito: "ninguem triou esta linha" e "esta linha foi sinalizada" mandam
    quem le a trabalhos diferentes."""


@dataclass(frozen=True)
class ProjectionRow:
    """Uma linha da projecao de entrada: o par, mais o texto que o triador le.

    TRES campos, e a ausencia dos outros e o mecanismo da cegueira: nao ha `label`,
    `groups`, `score` nem `partition` nesta forma, entao o triador nao pode ver o que
    nao lhe foi passado.
    """

    row_id: str
    text_sha256: str
    text: str


@dataclass(frozen=True)
class TriageVerdict:
    """O que o triador devolve. `subtypes` sao chaves da taxonomia pre-inscrita."""

    flagged: bool
    subtypes: tuple[str, ...] = ()


@dataclass(frozen=True)
class Disposition:
    """Uma linha do ledger: o par, a disposicao, e os subtipos quando ha."""

    row_id: str
    text_sha256: str
    disposition: str
    subtypes: tuple[str, ...] = field(default=())


class Triager(Protocol):
    """A porta. Recebe texto, devolve veredito. Nao ha por onde passar mais nada."""

    def __call__(self, text: str) -> TriageVerdict: ...


def taxonomy_keys() -> tuple[str, ...]:
    """As chaves da taxonomia PRE-INSCRITA, lidas do protocolo e nunca copiadas."""
    return tuple(subtype.key for subtype in protocol.TAXONOMY)


def _validate_verdict(row: ProjectionRow, verdict: TriageVerdict) -> tuple[str, ...]:
    subtypes = tuple(verdict.subtypes)
    if verdict.flagged and not subtypes:
        raise TriagerContradictedItself(
            f"linha {row.row_id!r} foi sinalizada sem nomear subtipo nenhum: uma "
            "sinalizacao que nao diz de que categoria e nao entra em estrato nenhum, "
            "logo nao e medivel"
        )
    if not verdict.flagged and subtypes:
        raise TriagerContradictedItself(
            f"linha {row.row_id!r} passou nomeando os subtipos {subtypes}: subtipo numa "
            "linha que passou seria sinalizacao sem disposicao de sinalizacao"
        )
    known = taxonomy_keys()
    for subtype in subtypes:
        if subtype not in known:
            raise TriagerNamedUnknownSubtype(
                f"linha {row.row_id!r}: o triador nomeou o subtipo {subtype!r}, que a "
                f"taxonomia pre-inscrita ({protocol.PROTOCOL_VERSION}) nao tem. "
                f"Vocabulario: {', '.join(known)}"
            )
    return subtypes


def screen_census(
    projection: Sequence[ProjectionRow], triager: Triager | Callable[[str], TriageVerdict]
) -> list[Disposition]:
    """Triage TODA linha da projecao, na ordem em que ela vem.

    ABORTA na primeira linha em que o triador levante, e a razao e a alegacao: um censo
    e sobre toda linha, entao uma linha saltada nao degrada a alegacao — falsifica-a. O
    chamador que quiser retomar retoma da linha nomeada na excecao.
    """
    dispositions: list[Disposition] = []
    for row in projection:
        try:
            verdict = triager(row.text)
        except PiiScreenError:
            raise
        except Exception as error:  # noqa: BLE001 — a causa e do transporte, nao nossa
            raise TriagerFailedOnRow(
                f"o triador levantou na linha {row.row_id!r} depois de "
                f"{len(dispositions)} linha(s): {type(error).__name__}: {error}"
            ) from error
        subtypes = _validate_verdict(row, verdict)
        dispositions.append(
            Disposition(
                row_id=row.row_id,
                text_sha256=row.text_sha256,
                disposition="flagged-dropped" if verdict.flagged else "passed",
                subtypes=subtypes,
            )
        )
    return dispositions


def write_ledger(path: Path, dispositions: Iterable[Disposition]) -> str:
    """Escreve o ledger e devolve o `sha256` dos BYTES escritos.

    Ordenado pelo par e nao pela ordem de chegada: o digesto do ledger entra na alegacao,
    e um digesto que dependesse da ordem em que o funil entregou as linhas mudaria sem
    que o conteudo mudasse. LF explicito, porque a arvore inteira e LF por invariante.
    """
    ordered = sorted(dispositions, key=lambda d: (d.row_id, d.text_sha256))
    body = "".join(
        json.dumps(
            {
                "id": d.row_id,
                "textSha256": d.text_sha256,
                "disposition": d.disposition,
                "subtypes": list(d.subtypes),
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        + "\n"
        for d in ordered
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(body)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ledger_digest(path: Path) -> str:
    """O `sha256` do arquivo, que e o digesto L citado na alegacao."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _lowercase_sha256(value: object, where: str) -> str:
    if not isinstance(value, str) or len(value) != 64:
        raise LedgerUnreadable(f"{where}: textSha256 tem de ser sha256 hex, veio {value!r}")
    if any(character not in "0123456789abcdef" for character in value):
        raise LedgerUnreadable(f"{where}: textSha256 tem de ser hex minusculo")
    return value


def read_ledger(path: Path) -> dict[tuple[str, str], Disposition]:
    """Parser FECHADO do ledger. Recusa nomeando arquivo, linha e campo.

    Fechado porque `json.loads` nao e parse: um objeto com chave a mais, disposicao fora
    da uniao ou subtipo fora da taxonomia carrega-se num dicionario sem reclamar, e a
    guarda da montagem leria dele como se fosse ledger.
    """
    if not Path(path).exists():
        raise LedgerUnreadable(
            f"nao ha ledger de disposicoes em {path}: uma montagem sem ele nao pode "
            "afirmar que triagem nenhuma correu sobre as linhas que selecionou"
        )
    known_subtypes = set(taxonomy_keys())
    ledger: dict[tuple[str, str], Disposition] = {}
    text = Path(path).read_text(encoding="utf-8")
    for number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        where = f"{path}:{number}"
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as error:
            raise LedgerUnreadable(f"{where}: linha nao e JSON ({error})") from error
        if not isinstance(obj, dict):
            raise LedgerUnreadable(f"{where}: linha nao e objeto")
        extra = set(obj) - set(LEDGER_KEYS)
        if extra:
            raise LedgerUnreadable(
                f"{where}: chave(s) que o ledger nao tem: {', '.join(sorted(extra))}"
            )
        missing = set(LEDGER_KEYS) - set(obj)
        if missing:
            raise LedgerUnreadable(
                f"{where}: falta(m) {', '.join(sorted(missing))}"
            )
        row_id = obj["id"]
        if not isinstance(row_id, str) or not row_id:
            raise LedgerUnreadable(f"{where}: id tem de ser texto nao vazio")
        text_sha256 = _lowercase_sha256(obj["textSha256"], where)
        disposition = obj["disposition"]
        if disposition not in DISPOSITIONS:
            extra_reason = (
                " — esse e o valor do hibrido da v2, e uma execucao da v1 nao o aceita: "
                "verificar sinalizado exige recibo ortogonal e proibicao do componente "
                "conexo nas duas cegas, que a v1 nao tem"
                if disposition == V2_HYBRID_DISPOSITION
                else ""
            )
            raise LedgerUnreadable(
                f"{where}: disposicao {disposition!r} nao esta em "
                f"{DISPOSITIONS}{extra_reason}"
            )
        raw_subtypes = obj["subtypes"]
        if not isinstance(raw_subtypes, list) or any(
            not isinstance(s, str) for s in raw_subtypes
        ):
            raise LedgerUnreadable(f"{where}: subtypes tem de ser lista de texto")
        for subtype in raw_subtypes:
            if subtype not in known_subtypes:
                raise LedgerUnreadable(
                    f"{where}: subtipo {subtype!r} fora da taxonomia pre-inscrita"
                )
        key = (row_id, text_sha256)
        if key in ledger:
            raise LedgerUnreadable(
                f"{where}: par duplicado ({row_id!r}, {text_sha256[:12]}...). Uma linha "
                "por par, ou o digesto do ledger deixa de identificar as disposicoes"
            )
        ledger[key] = Disposition(
            row_id=row_id,
            text_sha256=text_sha256,
            disposition=disposition,
            subtypes=tuple(raw_subtypes),
        )
    return ledger


def assert_the_ledger_covers(
    projection: Sequence[ProjectionRow],
    ledger: Mapping[tuple[str, str], Disposition],
) -> None:
    """Todo par da projecao tem linha no ledger. Uma lacuna falsifica o censo inteiro."""
    missing = [
        row for row in projection if (row.row_id, row.text_sha256) not in ledger
    ]
    if missing:
        names = ", ".join(row.row_id for row in missing[:5])
        tail = ", ..." if len(missing) > 5 else ""
        raise CensusIncomplete(
            f"o ledger cobre {len(projection) - len(missing)} de {len(projection)} "
            f"pares da projecao; sem disposicao: {names}{tail}. Um censo com lacuna nao "
            "e um censo, e a lacuna nao e uma fracao dele"
        )


def disposition_of(
    ledger: Mapping[tuple[str, str], Disposition], row_id: str, text_sha256: str
) -> Disposition | None:
    return ledger.get((row_id, text_sha256))


def assert_selected_records_passed(
    pairs: Sequence[tuple[str, str]],
    ledger: Mapping[tuple[str, str], Disposition],
) -> None:
    """D-13 + D-19: por registro selecionado, `disposition == "passed"`.

    PRESENCA DO PAR NAO BASTA, e e a unica coisa que esta funcao existe para dizer:
    presenca inclui os sinalizados, e um sinalizado presente no corpus e exactamente o
    estado que D-12 remove. Os dois modos de falha tem excecoes diferentes porque mandam
    quem le a trabalhos diferentes.
    """
    unscreened: list[str] = []
    flagged: list[tuple[str, str]] = []
    for row_id, text_sha256 in pairs:
        found = ledger.get((row_id, text_sha256))
        if found is None:
            unscreened.append(row_id)
        elif found.disposition != "passed":
            flagged.append((row_id, found.disposition))
    if unscreened:
        names = ", ".join(unscreened[:5])
        tail = ", ..." if len(unscreened) > 5 else ""
        raise SelectedRecordNotScreened(
            f"{len(unscreened)} de {len(pairs)} registros selecionados nao tem par no "
            f"ledger de disposicoes: {names}{tail}. Ou a triagem nao viu estas linhas, "
            "ou o texto mudou depois do snapshot"
        )
    if flagged:
        names = ", ".join(f"{row_id} ({state})" for row_id, state in flagged[:5])
        tail = ", ..." if len(flagged) > 5 else ""
        raise SelectedRecordWasFlagged(
            f"{len(flagged)} de {len(pairs)} registros selecionados tem par no ledger "
            f"com disposicao diferente de 'passed': {names}{tail}. Presenca do par nao "
            "basta — presenca inclui os sinalizados, e todo sinalizado sai (D-12)"
        )


def post_hoc_breakdown(*, flagged: int, reviewed: int, confirmed: int) -> dict:
    """As TRES categorias da revisao post-hoc parcial, e `k - c` nao e nenhuma delas.

    `k` sinalizados, `r` revistos por humano sobre material JA REMOVIDO, `c` confirmados.
    As categorias sao `c`, `r - c` e `k - r`. Publicar `k - c` como falso positivo
    colapsaria os nao revistos em falsos positivos e publicaria uma precisao inventada
    sobre material que ninguem leu.

    `precisionAmongReviewed` e `None` quando `r` e zero, e nao zero: sem denominador nao
    ha taxa, e um zero aqui leria como "nenhum acerto". O nome do campo diz sobre QUEM
    a taxa e, porque a confusao de PPV e um dos nove riscos que o perfil declara.
    """
    if flagged < 0 or reviewed < 0 or confirmed < 0:
        raise ValueError(
            f"contagens nao podem ser negativas: k={flagged} r={reviewed} c={confirmed}"
        )
    if reviewed > flagged:
        raise ValueError(
            f"revistos ({reviewed}) nao pode passar os sinalizados ({flagged})"
        )
    if confirmed > reviewed:
        raise ValueError(
            f"confirmados ({confirmed}) nao pode passar os revistos ({reviewed})"
        )
    return {
        "flagged": flagged,
        "reviewed": reviewed,
        "confirmed": confirmed,
        "falsePositives": reviewed - confirmed,
        "notReviewed": flagged - reviewed,
        "precisionAmongReviewed": (confirmed / reviewed) if reviewed else None,
    }
