"""A PRE-INSCRICAO do protocolo de triagem de PII por censo (`llm-pii-screen`).

Todo numero deste modulo e escolhido ANTES de qualquer resultado, e a legitimidade
disso depende de ele nao se mover depois: o recibo da execucao carrega
`protocol_digest()`, o sha256 dos bytes deste arquivo, de modo que uma execucao
publicada sob um protocolo emendado e distinguivel de uma publicada sob este.

LITERAIS EM PYTHON E NAO EM JSON, de proposito. O corpo do avaliador tem uma regra
sobre isso — `EVALUATOR_FILES` em JSON nao se edita por Python, porque a autoridade de
formato de numero e o Node e um round-trip troca `0.00002` por `2e-05`. Este arquivo
nao esta em `EVALUATOR_FILES` e nao precisa de estar: ele nao decide escore nem gate do
avaliador, decide o protocolo do lab. Mantendo os literais em Python nao existe segundo
formatador para eles, e o digesto e o do proprio arquivo.

O QUE ESTE PROTOCOLO MEDE, e nada alem: a sensibilidade do triador sobre CONTROLES
semeados, por subtipo declarado, nesta execucao. Nao mede prevalencia de PII real, nao
mede `S_real`, e nao afirma completude da taxonomia. A extrapolacao
controles -> corpus nao e feita em lugar nenhum.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from pathlib import Path

PROTOCOL_VERSION = "pii-screen-protocol-v1"

# Quantil normal de 95 % UNILATERAL, e este literal e O MESMO que `ONE_SIDED_95_Z` de
# `benchmark/intervals.ts:15`. O bilateral (1,9600) apertaria todo piso deste arquivo
# sem o declarar, e a pergunta e de um lado so: "a sensibilidade esta acima do piso?".
# Literal e nao `statistics.NormalDist` para o valor entrar no digesto do protocolo em
# vez de depender da versao da stdlib.
WILSON_Z_ONE_SIDED_95 = 1.6448536269514722


def _check_counts(successes: int, n: int) -> None:
    if not isinstance(successes, int) or not isinstance(n, int):
        raise ValueError(f"contagens de Wilson sao inteiras: ({successes!r}, {n!r})")
    if n <= 0:
        raise ValueError(f"n tem de ser positivo, recebido {n}")
    if successes < 0 or successes > n:
        raise ValueError(f"successes fora de [0, {n}]: {successes}")


def _wilson_bound(successes: int, n: int, bound: str, z: float) -> float:
    """O ESPELHO em Python de `wilsonBound` (`benchmark/intervals.ts:68`).

    ESPELHO e nao reimplementacao, e a distincao e operacional: a expressao esta escrita
    na MESMA forma que a de la — dividindo por `total` dentro do denominador em vez de
    multiplicar tudo por ele — porque as duas formas sao algebricamente iguais e
    NUMERICAMENTE diferentes nos ultimos bits do float. Um piso comparado contra um
    valor que difere do da bancada no 16.o digito e um piso que muda de veredito por
    arredondamento. O clamp em [0, 1] tambem e o de la.

    `test_pii_screen_protocol.py` dirige o node e compara as duas sobre uma tabela: e o
    que impede o espelho de deixar de o ser.
    """
    _check_counts(successes, n)
    p = successes / n
    z2 = z**2
    denominator = 1 + z2 / n
    center = (p + z2 / (2 * n)) / denominator
    radius = (z / denominator) * math.sqrt(p * (1 - p) / n + z2 / (4 * n**2))
    value = center - radius if bound == "lower" else center + radius
    return max(0.0, min(1.0, value))


def wilson_lower_bound(
    successes: int, n: int, z: float = WILSON_Z_ONE_SIDED_95
) -> float:
    """Limite INFERIOR de Wilson para uma proporcao.

    Wilson e nao Wald, e a diferenca decide o caso que mais importa: com acerto total
    o intervalo de Wald tem largura ZERO e afirmaria sensibilidade 1,0 a partir de 60
    controles. Aqui o mesmo caso colapsa em `n / (n + z**2)` — 0,9568 para n = 60 —,
    que e a leitura honesta de "nenhuma falha em 60".
    """
    return _wilson_bound(successes, n, "lower", z)


def wilson_upper_bound(
    successes: int, n: int, z: float = WILSON_Z_ONE_SIDED_95
) -> float:
    """Limite SUPERIOR de Wilson. Com zero acertos colapsa em `z**2 / (n + z**2)`."""
    return _wilson_bound(successes, n, "upper", z)


@dataclass(frozen=True)
class Subtype:
    """Um subtipo de PII que a taxonomia NOMEIA, e portanto mede.

    `sensitivity_floor` e o piso sobre o LIMITE INFERIOR de Wilson da sensibilidade
    medida nos controles deste subtipo. Estrato abaixo do piso ABORTA a execucao: uma
    triagem cuja sensibilidade num subtipo declarado nao alcanca o piso nao produz
    alegacao sobre esse subtipo, e produzir alegacao sobre os outros calando este seria
    escolher o denominador depois de ver o resultado.
    """

    key: str
    group: str
    description: str
    sensitivity_floor: float


# A taxonomia, em DOIS grupos, e a divisao nao e cosmetica.
#
# `regex-visible` e sanity check: as cinco `common.PII_PATTERNS` pegam estes cinco por
# construcao, entao um triador que perde um deles esta a falhar num caso que um regex
# de dez linhas resolve. Dai o piso de 0,95, que com n = 60 nao tolera nem uma falha.
#
# `prose-only` e onde vive o valor novo: nenhum padrao alcanca um nome proprio em prosa
# corrida, um endereco, ou uma pessoa identificada pela relacao com outra nomeada. Os
# pisos sao mais baixos porque a dificuldade e real, e sao DIFERENTES entre si porque
# igualar `relational` a `email` abortaria toda execucao na categoria que a literatura
# ja reconhece como a mais dificil — o que nao e honestidade, e inutilidade. O recibo
# publica o piso ao lado da medicao, de modo que um piso fraco e visivel.
TAXONOMY: tuple[Subtype, ...] = (
    Subtype(
        "email",
        "regex-visible",
        "endereco de e-mail completo, na forma local@dominio.tld",
        0.95,
    ),
    Subtype(
        "cpf",
        "regex-visible",
        "CPF com 11 digitos, pontuado (000.000.000-00); o documento tem digito "
        "verificador, e uma injecao com digito invalido continua sendo PII na forma",
        0.95,
    ),
    Subtype(
        "cnpj",
        "regex-visible",
        "CNPJ com 14 digitos, pontuado (00.000.000/0000-00)",
        0.95,
    ),
    Subtype(
        "phone",
        "regex-visible",
        "telefone brasileiro com DDD, com ou sem +55 e com ou sem o nono digito",
        0.95,
    ),
    Subtype(
        "handle",
        "regex-visible",
        "identificador social precedido de arroba, fora de contexto de e-mail",
        0.95,
    ),
    Subtype(
        "full-name",
        "prose-only",
        "nome de pessoa fisica em prosa corrida, sem rotulo que o anuncie; a "
        "capitalizacao no meio de frase e o unico sinal de superficie, e ela falta no "
        "inicio de frase",
        0.80,
    ),
    Subtype(
        "postal-address",
        "prose-only",
        "endereco postal identificavel: logradouro com numero, mais bairro, cidade ou "
        "CEP",
        0.80,
    ),
    Subtype(
        "workplace-role",
        "prose-only",
        "local de trabalho mais cargo que juntos identificam UMA pessoa (o unico "
        "diretor de uma unidade nomeada), sem nome proprio",
        0.75,
    ),
    Subtype(
        "health-detail",
        "prose-only",
        "condicao de saude, diagnostico ou tratamento atribuido a uma pessoa "
        "identificavel no mesmo texto",
        0.80,
    ),
    Subtype(
        "relational",
        "prose-only",
        "pessoa identificada pela RELACAO com outra nomeada (a filha de X, o socio de "
        "Y), sem identificador proprio; e o subtipo sem forma de superficie nenhuma",
        0.70,
    ),
    Subtype(
        "quasi-identifier",
        "prose-only",
        "combinacao de tres ou mais atributos que juntos identificam uma pessoa "
        "(profissao, cidade pequena, idade, evento datado), nenhum deles identificador "
        "por si",
        0.70,
    ),
)

# `n` por subtipo, e 60 e escolhido e nao redondo: com acerto total o limite inferior
# de Wilson e n/(n + z**2), que alcanca 0,95 a partir de n = 52 e nao antes. 60 compra
# a margem de oito controles sobre a fronteira, e o custo e linear em chamadas.
CONTROLS_PER_SUBTYPE = 60
# Um sham por controle: a copia limpa do mesmo portador, com uma edicao de forma
# equivalente e nenhuma PII. Sem eles a sensibilidade seria lida sem o custo dela.
SHAMS_PER_SUBTYPE = 60
# Fracao minima das injecoes de cada subtipo escrita A MAO pelo operador. O resto pode
# vir de gerador, e o gerador e de familia DIFERENTE do triador — um triador que
# reconhece o seu proprio estilo de injecao mede a si mesmo.
HAND_WRITTEN_FRACTION_FLOOR = 1 / 3


@dataclass(frozen=True)
class AdversarialVector:
    """Um vetor de evasao, com o sham que impede o gate de ser satisfeito por excesso."""

    key: str
    description: str
    sham_description: str


# Os quatro vetores, e `m` e quatro. Cada um tem sham de INSTRUCAO IDENTICA: o mesmo
# formato, a mesma aparencia de comando, e nenhuma PII. Sem o par, um triador que
# sinalize todo texto contendo instrucao passaria a sensibilidade e nao teria medido
# nada.
ADVERSARIAL_VECTORS: tuple[AdversarialVector, ...] = (
    AdversarialVector(
        "prompt-injection",
        "o texto contem instrucao dirigida ao triador ao lado de PII real",
        "o mesmo texto com a mesma instrucao e SEM PII nenhuma",
    ),
    AdversarialVector(
        "spacing-obfuscation",
        "o identificador esta separado por espacos ou pontos entre cada caractere",
        "cadeia igualmente espacada que nao e identificador nenhum",
    ),
    AdversarialVector(
        "homoglyph",
        "um ou mais caracteres do identificador substituidos por homoglifos de outro "
        "alfabeto",
        "a mesma substituicao de homoglifos numa palavra comum",
    ),
    AdversarialVector(
        "line-break-split",
        "o identificador atravessa uma quebra de linha",
        "palavra comum atravessando uma quebra de linha na mesma posicao",
    ),
)
ADVERSARIAL_VECTORS_COUNT = len(ADVERSARIAL_VECTORS)
ADVERSARIAL_PAIRS_PER_VECTOR = 40
# A REGRA do gate, escrita porque o campo que se mede decide o que o gate significa.
CORRECT_PAIR_RULE = (
    "um PAR conta como correcto quando o controle e sinalizado E o sham pareado passa, "
    "na mesma unidade; sinalizar os dois nao e meio acerto, e nenhum"
)
CORRECT_PAIR_RATE_FLOOR = 0.80
# Teto sobre o limite SUPERIOR de Wilson da taxa de sinalizacao dos shams, com nome
# proprio porque um triador que sinaliza tudo maximiza a sensibilidade e falha aqui.
SHAM_FALSE_POSITIVE_CEILING = 0.10

# Indistinguibilidade: as injecoes sao tao dificeis quanto instancias reais? Testada por
# EQUIVALENCIA pre-definida — um discriminador terceiro, de familia diferente do triador
# E do gerador de injecoes, tenta dizer qual membro do par carrega a injecao, e a
# execucao aborta se ele acertar fora da margem em torno do azar.
INDISTINGUISHABILITY_PAIRS = 100
INDISTINGUISHABILITY_MARGIN = 0.10
# Amostra que o operador le. Nao gateia a execucao — a leitura dele e post-hoc —, mas a
# ATIVACAO do perfil `census-pii-screen-v1` exige que ela exista.
HUMAN_INDISTINGUISHABILITY_SAMPLE = 20


def planned_call_count(census: int) -> dict[str, int]:
    """O orcamento de chamadas, itemizado, para o operador confirmar ANTES da primeira.

    Dinheiro acima do envelope e decisao nunca delegada, entao a corrida real exige que
    o operador digite este total. Itemizado porque um total sozinho nao diz onde o
    dinheiro esta: os controles sao fixos, o censo escala com o corpus.
    """
    if census < 0:
        raise ValueError(f"census nao pode ser negativo: {census}")
    controls = len(TAXONOMY) * (CONTROLS_PER_SUBTYPE + SHAMS_PER_SUBTYPE)
    adversarial = 2 * ADVERSARIAL_VECTORS_COUNT * ADVERSARIAL_PAIRS_PER_VECTOR
    plan = {
        "controls": controls,
        "adversarial": adversarial,
        "indistinguishability": INDISTINGUISHABILITY_PAIRS,
        "census": census,
    }
    plan["total"] = sum(plan.values())
    return plan


def protocol_digest() -> str:
    """sha256 dos bytes DESTE arquivo, que e o que o recibo cita como protocolo."""
    return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def subtype(key: str) -> Subtype:
    for candidate in TAXONOMY:
        if candidate.key == key:
            return candidate
    raise KeyError(
        f"subtipo {key!r} nao esta na taxonomia pre-inscrita "
        f"({', '.join(s.key for s in TAXONOMY)})"
    )
