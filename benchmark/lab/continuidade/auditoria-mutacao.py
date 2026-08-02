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

A lista de suites nao e escolha: a ferramenta ABORTA se qualquer suite que ALCANCA o modulo
ficar de fora, e o alcance e calculado sobre o grafo de imports do codigo-fonte. Tres vezes a
selecao estreita quase publicou lacuna inexistente — `holdout-ledger.ts` (suite homonima
omitida), `commands/publish-evidence.ts` (nao tem homonima; quem o exercita e
`tests/evidence-sanitizer.test.ts`) e `commands/evaluate.ts` (alcancado por
`tests/consume-holdout.test.ts` por dentro de outro comando).

Tres exigencias do arnes, aprendidas errando:
  1. conferir a LINHA DE BASE verde antes de mutar — senao "vermelho" nao distingue mutacao
     eficaz de suite ja quebrada;
  2. restaurar num `finally`, e conferir por `diff` depois — o script muta o mesmo arquivo
     dezenas de vezes, e a restauracao e a unica parte que nao pode falhar;
  3. capturar BYTES e decodificar a mao — `text=True` usa cp1252 no Windows e o vitest emite
     UTF-8, o que matou duas tentativas por falha do arnes e nao do alvo;
  4. sobreviver a MORTE VIOLENTA. `finally` nao roda sob SIGTERM, e um `timeout 30` em volta desta
     ferramenta deixou `commands/publish-evidence.ts` mutado na arvore. Daqui em diante a fonte
     original vai para um arquivo `.auditoria-original` antes da primeira mutacao, SIGTERM/SIGINT
     restauram, e a existencia do arquivo na entrada ABORTA — porque auditar um modulo que ficou
     mutado mede a linha de base com uma guarda desligada, o que e pior que nao medir.

Limite do metodo: so muta `throw` cujo codigo e literal ali. Guarda que lanca de dentro de um
helper (o codigo vira parametro) aparece como NAO-MUTAVEL e tem de ser conferida a mao.
"""

import pathlib
import re
import signal
import subprocess
import sys

# Derivada do proprio arquivo, para a ferramenta sobreviver a clone: .../benchmark/lab/continuidade
RAIZ = pathlib.Path(__file__).resolve().parents[3]

# RECUSA invocacao pela metade. Com 2 ou 3 argumentos a versao anterior caia no alvo PADRAO em
# silencio, entao `... auditoria-mutacao.py benchmark/dataset-manifest.ts fail` calculava o fecho de
# `split-artifact.ts` e imprimia uma lista de suites que nada tinha a ver com o modulo pedido. Foi
# esse silencio que me fez ler uma lista errada como se fosse a do modulo. Alvo pela metade agora
# aborta.
if len(sys.argv) in (2, 3):
    raise SystemExit(
        "ABORTADO: alvo pela metade. Use nenhum argumento (alvo padrao) ou "
        "<modulo> <lancador> <suite> [suite...]. Com 2 ou 3 argumentos a versao anterior media "
        "o alvo PADRAO em silencio."
    )

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

def _importados_por(arquivo: pathlib.Path) -> set[str]:
    """Modulos de fonte que este arquivo importa, resolvidos a caminho do repositorio.

    Cobre as TRES formas que o repositorio usa, e as tres foram necessarias:
      * relativo com extensao — `../split.ts`, o idioma de `benchmark/`;
      * relativo sem extensao;
      * alias `@/x` -> `src/x`, o idioma de `tests/unit` e `tests/integration`.

    A terceira forma foi o que revelou o furo: sem ela, um modulo de `src/` apontava ZERO suites e
    a ferramenta o auditava em silencio, sem nada para medir.
    """
    texto = arquivo.read_text(encoding="utf-8")
    alvos = set()

    def registra(caminho: pathlib.Path) -> None:
        for tentativa in (caminho, caminho.with_suffix(".ts"), caminho.with_suffix(".tsx")):
            if tentativa.suffix in (".ts", ".tsx") and tentativa.exists():
                try:
                    alvos.add(tentativa.resolve().relative_to(RAIZ).as_posix())
                except ValueError:
                    pass
                return

    for relativo in re.findall(r'from\s+"((?:\./|\.\./)[^"]+)"', texto):
        registra((arquivo.parent / relativo).resolve())
    for aliased in re.findall(r'from\s+"@/([^"]+)"', texto):
        registra((RAIZ / "src" / aliased).resolve())

    return alvos


def quem_dirige(modulo: str) -> tuple[set[str], set[str]]:
    """Suites que ALCANCAM o modulo, direta ou transitivamente, e os auxiliares.

    Importador direto nao e a mesma coisa que quem dirige. `commands/evaluate.ts` e importado
    por uma suite so, mas `commands/consume-holdout.ts` chama `assertEvaluatorIdentity` e
    `runEvaluate`, e a suite daquele comando faz corridas completas com stubs — entao as guardas
    de `evaluate.ts` SAO alcancadas por ela. Medir sem essa suite reporta lacuna que nao existe,
    que e o mesmo defeito da suite homonima e do nome de arquivo, na terceira aparicao.

    Por isso o fecho e calculado sobre o grafo de imports do codigo-fonte: parte do modulo, sobe
    para todo modulo que o importa (transitivamente) e so entao pergunta quais arquivos de teste
    tocam qualquer um deles.

    CUSTO DECLARADO: para um modulo de base (`digests.ts`, por exemplo) o fecho tende a quase
    todas as suites, e a auditoria fica caro. E o preco de medir certo; achado falso e pior.
    """
    modulo = modulo.replace("\\", "/")
    # Tres arvores de FONTE, e nao so `benchmark/`: `contracts/` guarda os contratos selados e
    # `src/` o runtime que faz cumprir as promessas do produto. Enquanto o grafo cobria so uma
    # delas, uma aresta contrato->contrato ou src->src ficava invisivel, e um modulo de `src/`
    # apontaria ZERO suites — a ferramenta o pularia em silencio, que e o balde de erro que ela ja
    # foi endurecida para nao ter.
    fontes = [
        f
        for arvore in ("benchmark", "contracts", "src")
        for f in RAIZ.glob(f"{arvore}/**/*.ts")
        if "tests" not in f.relative_to(RAIZ).parts and not f.name.endswith(".d.ts")
    ]
    grafo = {f.relative_to(RAIZ).as_posix(): _importados_por(f) for f in fontes}

    alcancam = {modulo}
    mudou = True
    while mudou:
        mudou = False
        for quem, importa in grafo.items():
            if quem not in alcancam and importa & alcancam:
                alcancam.add(quem)
                mudou = True

    # Duas arvores de TESTE: `benchmark/tests/` e `tests/` (unit e integration). A resolucao de
    # import ja lida com qualquer profundidade, entao o que faltava era so procurar nos dois lugares.
    achados = set()
    candidatos = sorted((RAIZ / "benchmark" / "tests").glob("*.ts"))
    if (RAIZ / "tests").exists():
        candidatos += sorted((RAIZ / "tests").rglob("*.ts"))
    for arquivo in candidatos:
        if _importados_por(arquivo) & alcancam:
            achados.add(arquivo.relative_to(RAIZ).as_posix())
    rodaveis = {a for a in achados if a.endswith(".test.ts")}
    return rodaveis, achados - rodaveis


# RECUSA rodar sem TODA suite que ALCANCA o modulo. Esta guarda foi endurecida duas vezes, cada
# vez porque a versao anterior quase publicou lacuna inexistente:
#   1. conferia so a suite HOMONIMA — e `commands/publish-evidence.ts` nao tem homonima, sendo
#      exercitado por `tests/evidence-sanitizer.test.ts`;
#   2. conferia so o importador DIRETO — e `commands/evaluate.ts` e alcancado por
#      `tests/consume-holdout.test.ts` atraves de `commands/consume-holdout.ts`.
# Nem nome de arquivo nem import direto sao prova de cobertura. Quem alcanca o modulo e.
_rodaveis, _auxiliares = quem_dirige(MODULO)
_faltando = sorted(_rodaveis - {s.replace("\\", "/") for s in SUITES})
if _faltando:
    raise SystemExit(
        "ABORTADO: estas suites importam o modulo e nao estao na lista:\n  "
        + "\n  ".join(_faltando)
        + "\nRodar sem elas reporta lacuna que nao existe."
    )
if _auxiliares:
    print(
        "AVISO: arquivos auxiliares importam o modulo e nao sao rodaveis por si; "
        "confira a mao quem os roda:",
        flush=True,
    )
    for _aux in sorted(_auxiliares):
        print("  -", _aux, flush=True)

RESGATE = FONTE.with_suffix(FONTE.suffix + ".auditoria-original")
if RESGATE.exists():
    raise SystemExit(
        f"ABORTADO: {RESGATE.name} existe, entao uma execucao anterior morreu antes de restaurar.\n"
        f"Restaure primeiro:  git checkout -- {MODULO}   (e apague {RESGATE.name})\n"
        "Auditar um modulo mutado mede a linha de base com uma guarda desligada."
    )

original = FONTE.read_text(encoding="utf-8")


def restaura() -> None:
    FONTE.write_text(original, encoding="utf-8", newline="")
    RESGATE.unlink(missing_ok=True)


def _restaura_e_morre(_sinal: int, _quadro: object) -> None:
    restaura()
    print("\nINTERROMPIDO: fonte restaurada", flush=True)
    raise SystemExit(130)


for _s in (signal.SIGINT, signal.SIGTERM):
    signal.signal(_s, _restaura_e_morre)
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
        RESGATE.write_text(original, encoding="utf-8", newline="")
        FONTE.write_text(mutado, encoding="utf-8", newline="")
        saida = roda_suites()
        estado = "PEGA" if "failed" in saida else "SEM TESTE"
        resultados.append((codigo, estado))
        print(f"  {codigo}: {estado}", flush=True)
finally:
    restaura()
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
    print(
        f"sem `throw` literal deste codigo: {len(nao)} — CONFERIR A MAO. Cada um e uma de "
        "duas coisas MUITO diferentes: um motivo de REJEICAO (o modulo devolve o codigo em "
        "vez de lancar, e a suite o confere no resultado) ou uma guarda que lanca de dentro "
        "de um helper. So o segundo caso e candidato a lacuna."
    )
    for c in nao:
        print("  -", c)
