"""A margem de poda de quase-duplicata da classe MISTA, medida em MATERIAL real.

O pino `test_a_janela_do_PAI_alargada_nao_admite_poda_de_near_dupe_nova` mede um MODELO —
tokens todos distintos — e por isso nao autoriza a janela sozinho: `shingles_of` devolve
CONJUNTO, a multiplicidade desaparece, e texto real repete. Esta medicao roda as mesmas
funcoes de producao de `near_dupes` sobre os pais reais, celula por celula.

A GEOMETRIA de cada operacao segue `make_mixed.MIX_GEOMETRIES`, e o que ela modela e so o
lugar e o tamanho do enxerto. O que ela NAO modela e o que o enxerto DIZ, e ha um caso em
que isso decide: enxerto que reusa as sequencias do proprio pai leva a razao a ~1 em
qualquer nivel.

Esse caso e ECO, o fluxo doador exclui o pai sob edicao, e a exclusao e uma LACUNA declarada
desta medicao e nao uma separacao de autoridade. Quem decide eco do pai e `near_dupes` — e
portanto a propria poda que esta medicao mede. `artifact_gate` recusa-se explicitamente a
julga-lo: as sondas de eco derivam so a parte da receita ANTES de `{reference}`, porque a
referencia e a semente humana e "uma linha que a repete e uma quase-duplicata de linha
humana, que `near_dupes` decide e este gate nao deve contar duas vezes sob outro nome".
Logo um gerador que ecoe o pai nao e apanhado por outro gate: ele e podado aqui, e o que cai
e o pai humano, com a ponte da ilha. Medir esse regime exige saida de gerador real, e nenhuma
existe.

Que excluir o pai por ID BASTE neste material e medido, nao suposto: `near_dupes.prune` sobre
os 2.578 pais propoe 1.477 pares candidatos e aceita ZERO, entao nao ha quase-duplicata entre
pais que a exclusao por id deixaria passar sob outro id.

Deterministica: semente fixa, nenhum relogio, nenhuma escrita.

    py -3.13 measure_mixed_parent_window.py --parents ../data/dataset/reserved.jsonl
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

# A semente do amostrador do fluxo doador. Fixa e nomeada porque a medicao e publicada:
# um numero desta tabela que se mova com a semente nao e reproduzivel.
DONOR_SEED = 0

# Quantos documentos entram no fluxo doador. Mais do que o maior enxerto precisa, para que
# `graft_for` sempre ache uma janela sem o pai.
DONOR_DOCUMENTS = 1400

# Quantos enxertos DISTINTOS por par. Um so mede o maximo de um sorteio e nao o pior caso:
# medido em `substituicao/15` sobre os 2.578 pais, passar de 1 para 12 move o maximo de
# 0,8016 para 0,8080. Doze, e nao mais, porque o custo e linear e o ganho ja e de terceira
# casa — o que este numero compra e nao PUBLICAR margem larga demais.
GRAFTS_PER_PAIR = 12

# A folga do teto de afericao sobre o supremo do modelo, e o teto DERIVA dela e dos niveis
# (`top_level_ceiling`). Tres, e os dois lados sao medidos: o maximo honesto em material no
# nivel mais alto e 0,1360 — 1,36x o supremo, porque texto real repete e o modelo nao —, e os
# dois valores que fixture fabricou foram 0,92 (documento doador repetido) e 0,974 (enxerto
# tirado do proprio pai). Tres poe o teto 2,2x acima do honesto e 3,1x abaixo do fabricado
# mais baixo; dois aproxima-se do honesto e quatro do fabricado.
TOP_LEVEL_HEADROOM = 3.0


class FixtureFabricatesSimilarity(RuntimeError):
    """O fluxo doador fabrica similaridade, e nenhuma linha medida sobre ele vale."""


def top_level_ceiling() -> float:
    """O teto de afericao, DERIVADO do nivel mais alto e nao digitado.

    No nivel mais alto o enxerto ocupa `nivel` % do texto final, entao o supremo do modelo e
    `1 - nivel/100` e o teto e `TOP_LEVEL_HEADROOM` vezes ele. Derivado porque um numero
    digitado sobrevive a uma mudanca de `MIX_LEVELS` e passa a aferir contra a geometria
    errada — que e o defeito do teto de palavras que esta medicao substituiu.
    """
    _lab()
    import assemble_corpus

    return TOP_LEVEL_HEADROOM * (1.0 - max(assemble_corpus.MIX_LEVELS) / 100.0)


def _lab() -> None:
    lab = str(Path(__file__).resolve().parent)
    if lab not in sys.path:
        sys.path.insert(0, lab)


def donor_stream(parents: list[dict]) -> list[str]:
    """Os tokens de `DONOR_DOCUMENTS` pais DISTINTOS, concatenados.

    Distintos e nao um repetido: repetir um documento acrescenta token sem acrescentar
    shingle distinto, entao a uniao do par para de crescer e a razao sobe por artefato.
    """
    _lab()
    import near_dupes

    amostrador = random.Random(DONOR_SEED)
    quantos = min(DONOR_DOCUMENTS, len(parents))
    fluxo: list[str] = []
    for indice in amostrador.sample(range(len(parents)), quantos):
        fluxo.extend(near_dupes.tokens_of(parents[indice]["text"]))
    return fluxo


def donor_owners(parents: list[dict]) -> list[str]:
    """O id do documento de origem de cada token de `donor_stream`, na mesma ordem."""
    _lab()
    import near_dupes

    amostrador = random.Random(DONOR_SEED)
    quantos = min(DONOR_DOCUMENTS, len(parents))
    donos: list[str] = []
    for indice in amostrador.sample(range(len(parents)), quantos):
        linha = parents[indice]
        donos.extend([linha["id"]] * len(near_dupes.tokens_of(linha["text"])))
    return donos


def graft_for(
    stream: list[str], owners: list[str], parent_id: str, size: int, offset: int
) -> list[str]:
    """`size` tokens do fluxo, de uma janela que nao contem UM token do pai `parent_id`.

    `owners` e exigido e nao inferido. Adivinhar o dono pela forma do token — prefixo,
    sufixo — funciona no fixture que o inventou e falha em silencio no material, e o modo
    de falhar e o pior possivel: devolve uma janela que CONTEM o pai, o par mede ~1 e o
    numero publicado diz que a poda morde onde ela nao morde.
    """
    if len(owners) != len(stream):
        raise FixtureFabricatesSimilarity(
            f"o fluxo tem {len(stream)} tokens e a lista de donos {len(owners)}: sem a "
            "correspondencia posicional a exclusao do pai nao vale"
        )
    limite = len(stream) - size - 1
    if limite < 1:
        raise FixtureFabricatesSimilarity(
            f"fluxo de {len(stream)} tokens e curto para um enxerto de {size}"
        )
    for tentativa in range(64):
        inicio = (offset + tentativa * 9973) % limite
        if parent_id not in owners[inicio : inicio + size]:
            return stream[inicio : inicio + size]
    raise FixtureFabricatesSimilarity(
        f"nenhuma janela do fluxo exclui {parent_id}: o fluxo e pequeno demais ou "
        "e feito de copias do proprio pai"
    )


def child_tokens(operation: str, parent: list[str], level: int, graft: list[str]) -> list[str]:
    """O filho misto, na geometria que `MIX_GEOMETRIES[operation]` pede."""
    if operation == "insercao":
        meio = len(parent) // 2
        return parent[:meio] + graft + parent[meio:]
    if operation == "substituicao":
        removidos = len(graft)
        meio = max(0, (len(parent) - removidos) // 2)
        return parent[:meio] + graft + parent[meio + removidos :]
    if operation == "concatenacao":
        return parent[: len(parent) // 2] + graft
    raise AssertionError(f"operacao desconhecida: {operation}")


def graft_size(operation: str, parent_tokens: int, level: int) -> int:
    """Quantos tokens o enxerto tem para ocupar `level` % do texto FINAL."""
    fracao = level / 100.0
    if operation == "substituicao":
        return round(parent_tokens * fracao)
    base = parent_tokens // 2 if operation == "concatenacao" else parent_tokens
    return round(base * fracao / (1.0 - fracao))


def assert_the_top_level_is_dominated_by_the_graft(
    parents: list[dict], stream: list[str], owners: list[str]
) -> float:
    """Recusa um fluxo doador que fabrica similaridade, ANTES de qualquer linha medida.

    No nivel mais alto o enxerto ocupa quase todo o texto final, entao a razao com o pai tem
    de ser baixa. Alta ali nao mede o corpus: mede o fixture.
    """
    _lab()
    import assemble_corpus
    import near_dupes

    nivel = max(assemble_corpus.MIX_LEVELS)
    pior = 0.0
    for indice, linha in enumerate(parents[:20]):
        tokens = near_dupes.tokens_of(linha["text"])
        tamanho = graft_size("insercao", len(tokens), nivel)
        enxerto = graft_for(stream, owners, linha["id"], tamanho, indice * 7)
        pior = max(
            pior,
            near_dupes.jaccard(
                near_dupes.shingles_of(tokens),
                near_dupes.shingles_of(child_tokens("insercao", tokens, nivel, enxerto)),
            ),
        )
    teto = top_level_ceiling()
    if pior >= teto:
        raise FixtureFabricatesSimilarity(
            f"no nivel {nivel} a razao chega a {pior:.4f}, acima do teto "
            f"{teto:.4f}: o enxerto ocupa quase todo o texto final, entao esse "
            "valor vem do fluxo doador e nao do corpus — documento repetido, ou enxerto "
            "tirado do proprio pai"
        )
    return pior


def measure(
    parents: list[dict], old_ceiling: int, threshold: float | None = None
) -> list[dict]:
    """Uma linha por celula, e a grandeza publicavel e a TAXA POR SORTEIO.

    O maximo nao converge em K: medido em `insercao/25` sobre 2.578 pais, os pares com ao
    menos um enxerto que cruza o limite vao de 0 (K de 1 a 4) a 8, 11 e 14 (K de 8, 12, 24).
    Logo "margem = limite − maximo" e propriedade do K escolhido, e dobrar K muda a conclusao
    publicada sem nada acusar. O que nao depende de K e a razao
    `sorteios_que_cruzam / sorteios`, e por isso a linha carrega o denominador.

    `threshold` serve a SENSIBILIDADE: a taxa no limiar de producao e minuscula, e uma taxa
    minuscula nao diz se ela e minuscula por o material estar longe do limiar ou por o limiar
    estar num vale. Correr a mesma medicao com o limiar mais baixo responde isso, e e a unica
    forma de exercitar o contador de cruzamentos sem material que a guarda recusa.
    """
    _lab()
    import assemble_corpus
    import near_dupes

    limite = near_dupes.JACCARD_THRESHOLD if threshold is None else threshold
    fluxo = donor_stream(parents)
    donos = donor_owners(parents)
    assert_the_top_level_is_dominated_by_the_graft(parents, fluxo, donos)

    tokens = [(linha["id"], near_dupes.tokens_of(linha["text"])) for linha in parents]
    shingles = {pid: near_dupes.shingles_of(toks) for pid, toks in tokens}
    palavras = {linha["id"]: len(linha["text"].split()) for linha in parents}

    tabela: list[dict] = []
    for operacao, nivel in assemble_corpus.mix_cells():
        curtos = longos = 0.0
        sorteios = sorteios_que_cruzam = 0
        cruzam: list[tuple[str, int, float]] = []
        for indice, (pid, toks) in enumerate(tokens):
            tamanho = graft_size(operacao, len(toks), nivel)
            if tamanho < 1:
                continue
            razao = 0.0
            for sorteio in range(GRAFTS_PER_PAIR):
                enxerto = graft_for(
                    fluxo, donos, pid, tamanho, indice * 7 + nivel * 131 + sorteio * 104729
                )
                deste = near_dupes.jaccard(
                    shingles[pid],
                    near_dupes.shingles_of(child_tokens(operacao, toks, nivel, enxerto)),
                )
                sorteios += 1
                if deste >= limite:
                    sorteios_que_cruzam += 1
                razao = max(razao, deste)
            if palavras[pid] <= old_ceiling:
                curtos = max(curtos, razao)
            else:
                longos = max(longos, razao)
            if razao >= limite:
                cruzam.append((pid, palavras[pid], razao))
        tabela.append(
            {
                "celula": f"{operacao}/{nivel}",
                "max_ate_o_teto_antigo": curtos,
                "max_acima_do_teto_antigo": longos,
                "sorteios": sorteios,
                "sorteios_que_cruzam": sorteios_que_cruzam,
                "cruzam": cruzam,
            }
        )
    return tabela


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parents", required=True, type=Path)
    parser.add_argument("--old-ceiling", type=int, default=450)
    parser.add_argument(
        "--threshold",
        type=float,
        default=None,
        help="limiar de poda, para sensibilidade; por omissao o de producao",
    )
    args = parser.parse_args()

    _lab()
    import make_mixed
    import near_dupes

    with args.parents.open(encoding="utf-8") as handle:
        linhas = [json.loads(linha) for linha in handle if linha.strip()]
    pais = make_mixed.admissible_parents(linhas)
    print(f"pais admissiveis: {len(pais)} de {len(linhas)} linhas em {args.parents.name}")
    limite = near_dupes.JACCARD_THRESHOLD if args.threshold is None else args.threshold
    print(f"limite de poda: {limite}   teto antigo: {args.old_ceiling}")
    print()

    tabela = measure(pais, args.old_ceiling, args.threshold)
    print(f"sorteios por par: {GRAFTS_PER_PAIR}")
    print()
    print(
        f"{'celula':<22}{'taxa/sorteio':>14}{'pares':>7}{'<=teto':>7}{'>teto':>6}"
        f"{'max<=':>8}{'max>':>8}"
    )
    for linha in tabela:
        curtos = sum(1 for _, palavras, _ in linha["cruzam"] if palavras <= args.old_ceiling)
        taxa = linha["sorteios_que_cruzam"] / linha["sorteios"] if linha["sorteios"] else 0.0
        print(
            f"{linha['celula']:<22}{taxa:>14.2e}{len(linha['cruzam']):>7}{curtos:>7}"
            f"{len(linha['cruzam']) - curtos:>6}{linha['max_ate_o_teto_antigo']:>8.4f}"
            f"{linha['max_acima_do_teto_antigo']:>8.4f}"
        )
    sorteios = sum(linha["sorteios"] for linha in tabela)
    cruzam = sum(linha["sorteios_que_cruzam"] for linha in tabela)
    pares = sum(len(linha["cruzam"]) for linha in tabela)
    acima = sum(
        1
        for linha in tabela
        for _, palavras, _ in linha["cruzam"]
        if palavras > args.old_ceiling
    )
    print()
    print(f"sorteios: {sorteios}   que cruzam: {cruzam}   taxa: {cruzam / sorteios:.3e}")
    print(f"pares com ao menos um cruzamento: {pares}, dos quais {acima} acima do teto")
    print(
        "o maximo NAO e publicado como margem: ele cresce com os sorteios por par, e a "
        "taxa nao"
    )


if __name__ == "__main__":
    main()
