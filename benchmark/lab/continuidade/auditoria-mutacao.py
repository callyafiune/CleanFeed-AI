"""Auditoria de mutacao das guardas do artefato de split.

Para cada codigo de erro, desliga TODOS os `throw` daquele codigo trocando
`throw new SplitArtifactError(` por `void new SplitArtifactError(` — mesma aridade, mesmo
construtor, sem lancar — roda as suites e registra se algum teste ficou vermelho.

Guarda cuja remocao deixa a suite VERDE nao tem teste que a exercite: e o defeito que este
cross-review encontrou quatro vezes, agora medido em lote em vez de um por vez.

Captura BYTES e decodifica a mao: `text=True` usa cp1252 no Windows e o vitest emite UTF-8,
o que matou as duas primeiras tentativas — falha do arnes, nao do alvo.
"""

import pathlib
import re
import subprocess

# Derivada do proprio arquivo, para a ferramenta sobreviver a clone: .../benchmark/lab/continuidade
RAIZ = pathlib.Path(__file__).resolve().parents[3]
FONTE = RAIZ / "benchmark/split-artifact.ts"
SUITES = [
    "benchmark/tests/split-artifact.test.ts",
    "benchmark/tests/evidence-sanitizer.test.ts",
]

original = FONTE.read_text(encoding="utf-8")
codigos = sorted(set(re.findall(r'"(SPLIT_ARTIFACT_[A-Z_]+)"', original)))
print(f"guardas encontradas: {len(codigos)}", flush=True)


def roda_suites() -> str:
    proc = subprocess.run(
        ["npx", "vitest", "run", *SUITES],
        cwd=RAIZ,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        shell=True,
        timeout=900,
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
            r"throw new SplitArtifactError\(\s*\n(\s*)\"" + re.escape(codigo) + '"',
            lambda m: "void new SplitArtifactError(\n" + m.group(1) + '"' + codigo + '"',
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
