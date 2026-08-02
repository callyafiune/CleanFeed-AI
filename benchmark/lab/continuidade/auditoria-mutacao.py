"""Auditoria de mutacao das guardas de um modulo.

Para cada codigo de erro do modulo, desliga TODOS os `throw` daquele codigo trocando
`throw new <Erro>(` por `void new <Erro>(` — mesma aridade, mesmo construtor, sem lancar —
roda as suites e registra se algum teste ficou vermelho.

Guarda cuja remocao deixa a suite VERDE nao tem teste que a exercite: e a familia de defeito
que apareceu em quatro rodadas de cross-review desta unidade.

Uso:
  python benchmark/lab/continuidade/auditoria-mutacao.py                 # alvo padrao
  python .../auditoria-mutacao.py <modulo> <ClasseDeErro> <suite> [suite...]

Exemplo:
  python .../auditoria-mutacao.py benchmark/commands/split.ts CommandError \\
      benchmark/tests/cli.test.ts benchmark/tests/corpus-import.test.ts

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


resultados = []
try:
    base = roda_suites()
    if "failed" in base:
        print("ABORTADO: a suite ja esta vermelha antes de mutar", flush=True)
        raise SystemExit(1)
    print("linha de base verde", flush=True)

    for codigo in codigos:
        mutado = re.sub(
            r"throw new " + re.escape(ERRO) + r"\(\s*\n(\s*)\"" + re.escape(codigo) + '"',
            lambda m: "void new " + ERRO + "(\n" + m.group(1) + '"' + codigo + '"',
            original,
        )
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
