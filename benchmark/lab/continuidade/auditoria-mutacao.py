"""Auditoria de mutacao das guardas de um modulo.

Para cada codigo de erro do modulo, desliga TODOS os `throw` daquele codigo trocando
`throw new <Erro>(` por `void new <Erro>(` — mesma aridade, mesmo construtor, sem lancar —
roda as suites e registra se algum teste ficou vermelho.

Guarda cuja remocao deixa a suite VERDE nao tem teste que a exercite: e a familia de defeito
que apareceu em quatro rodadas de cross-review desta unidade.

Uso:
  python benchmark/lab/continuidade/auditoria-mutacao.py                 # alvo padrao
  python .../auditoria-mutacao.py <modulo> <lancador> <suite> [suite...]

O `lancador` e a CLASSE de erro quando o modulo faz `throw new XError("CODIGO", ...)`, ou o
nome do HELPER quando faz `fail("CODIGO", ...)`. Os dois idiomas existem no repositorio, e a
primeira versao desta ferramenta so entendia o primeiro: apontada para `holdout-ledger.ts`, que
usa helper, ela devolveu dez "NAO-MUTAVEL" e ZERO informacao. Zero mutavel nao e zero lacuna.

Exemplos:
  python .../auditoria-mutacao.py benchmark/commands/split.ts CommandError \\
      benchmark/tests/cli.test.ts benchmark/tests/corpus-import.test.ts
  python .../auditoria-mutacao.py benchmark/holdout-ledger.ts fail \\
      benchmark/tests/consume-holdout.test.ts

Tres exigencias do arnes, aprendidas errando:
  1. conferir a LINHA DE BASE verde antes de mutar — senao "vermelho" nao distingue mutacao
     eficaz de suite ja quebrada;
  2. restaurar num `finally`, e conferir por `diff` depois — o script muta o mesmo arquivo
     dezenas de vezes, e a restauracao e a unica parte que nao pode falhar;
  3. capturar BYTES e decodificar a mao — `text=True` usa cp1252 no Windows e o vitest emite
     UTF-8, o que matou duas tentativas por falha do arnes e nao do alvo.

Limite do metodo: so muta `throw` cujo codigo e literal ali. Guarda que lanca de dentro de um
helper (o codigo vira parametro) aparece como NAO-MUTAVEL e tem de ser conferida a mao.
"""

import pathlib
import re
import subprocess
import sys

# Derivada do proprio arquivo, para a ferramenta sobreviver a clone: .../benchmark/lab/continuidade
RAIZ = pathlib.Path(__file__).resolve().parents[3]

if len(sys.argv) >= 4:
    MODULO = sys.argv[1]
    ERRO = sys.argv[2]
    SUITES = sys.argv[3:]
else:
    MODULO = "benchmark/split-artifact.ts"
    ERRO = "SplitArtifactError"
    SUITES = [
        "benchmark/tests/split-artifact.test.ts",
        "benchmark/tests/evidence-sanitizer.test.ts",
    ]

FONTE = RAIZ / MODULO

# RECUSA rodar sem a suite dedicada ao modulo, se ela existir. Este erro foi cometido: a
# auditoria de `holdout-ledger.ts` rodou sem `tests/holdout-ledger.test.ts` e reportou QUATRO
# guardas sem teste; com a suite incluida sao duas, e a mais consequente
# (`HOLDOUT_TUPLE_MISMATCH`) estava testada desde sempre. Escolher suites por conveniencia
# produz achado falso, e achado falso publicado e pior que nenhum.
irma = pathlib.Path("benchmark/tests") / (FONTE.stem + ".test.ts")
if (RAIZ / irma).exists() and irma.as_posix() not in [s.replace("\\", "/") for s in SUITES]:
    raise SystemExit(
        f"ABORTADO: existe {irma.as_posix()} e ela nao esta nas suites. "
        "Rodar sem a suite dedicada ao modulo reporta lacuna que nao existe."
    )

original = FONTE.read_text(encoding="utf-8")
codigos = sorted(set(re.findall(r'"([A-Z][A-Z0-9_]{5,})"', original)))
print(f"alvo: {MODULO} ({ERRO})", flush=True)
print(f"suites: {', '.join(SUITES)}", flush=True)
print(f"codigos encontrados: {len(codigos)}", flush=True)


def roda_suites() -> str:
    proc = subprocess.run(
        ["npx", "vitest", "run", *SUITES],
        cwd=RAIZ,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        shell=True,
        timeout=1800,
    )
    return (proc.stdout or b"").decode("utf-8", errors="replace")


def muta(fonte: str, codigo: str) -> str:
    """Desliga o lancamento daquele codigo, cobrindo os dois idiomas do repositorio.

    `throw new XError("CODIGO"` -> `void new XError("CODIGO"`: mesmo construtor, sem lancar.

    `fail("CODIGO"` -> `voidFail("CODIGO"`, com um `voidFail` inerte injetado. Nao serve trocar
    por `void fail(...)`: `fail` lanca por dentro, e `void` avalia a chamada. O que desliga e
    substituir o proprio lancador.
    """
    alvo = re.sub(
        r"throw new " + re.escape(ERRO) + r"\(\s*\n(\s*)\"" + re.escape(codigo) + '"',
        lambda m: "void new " + ERRO + "(\n" + m.group(1) + '"' + codigo + '"',
        fonte,
    )
    if alvo != fonte:
        return alvo

    # idioma do helper: a chamada pode ter o codigo na mesma linha ou na seguinte
    alvo = re.sub(
        re.escape(ERRO) + r"\(\s*\n(\s*)\"" + re.escape(codigo) + '"',
        lambda m: "voidFail(\n" + m.group(1) + '"' + codigo + '"',
        fonte,
    )
    alvo = re.sub(
        re.escape(ERRO) + r'\("' + re.escape(codigo) + '"',
        'voidFail("' + codigo + '"',
        alvo,
    )
    if alvo == fonte:
        return fonte
    # injeta o lancador inerte depois dos imports, sem depender de assinatura
    linhas = alvo.split("\n")
    for i, linha in enumerate(linhas):
        if linha.startswith("import ") or linha.startswith("} from"):
            continue
        if linha.strip() == "" and i > 0:
            linhas.insert(
                i,
                "const voidFail = (..._ignorado: unknown[]): never =>\n"
                "  undefined as unknown as never;",
            )
            break
    return "\n".join(linhas)


resultados = []
try:
    base = roda_suites()
    if "failed" in base:
        print("ABORTADO: a suite ja esta vermelha antes de mutar", flush=True)
        raise SystemExit(1)
    print("linha de base verde", flush=True)

    for codigo in codigos:
        mutado = muta(original, codigo)
        if mutado == original:
            resultados.append((codigo, "NAO-MUTAVEL"))
            print(f"  {codigo}: NAO-MUTAVEL", flush=True)
            continue
        FONTE.write_text(mutado, encoding="utf-8", newline="")
        saida = roda_suites()
        estado = "PEGA" if "failed" in saida else "SEM TESTE"
        resultados.append((codigo, estado))
        print(f"  {codigo}: {estado}", flush=True)
finally:
    FONTE.write_text(original, encoding="utf-8", newline="")
    print("fonte restaurada", flush=True)

pega = [c for c, s in resultados if s == "PEGA"]
sem = [c for c, s in resultados if s == "SEM TESTE"]
nao = [c for c, s in resultados if s == "NAO-MUTAVEL"]
print("\n=== RESUMO ===")
print(f"guardas exercitadas por teste: {len(pega)}")
print(f"guardas SEM teste: {len(sem)}")
for c in sem:
    print("  -", c)
if nao:
    print(f"nao mutaveis pelo padrao (conferir a mao): {len(nao)}")
    for c in nao:
        print("  -", c)
