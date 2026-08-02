# Lane publicável para o preview experimental — desenho antes do código

**Estado:** desenho, escrito em 2026-08-02. É o defeito 2 dos três que a seção 5 de
`2026-07-30-v1-escopo-e-retomada.md` nomeia como bloqueadores da v1.0. Passo de desenho separado do
código de propósito: a mudança toca doze arquivos de runtime, e uma lane que publica modelo **não
calibrado** é decisão de governança, não detalhe de implementação.

## O que foi medido, não suposto

| fato | onde |
|---|---|
| `pending` é recusado no empacotamento | `scripts/release-policy.mjs:69-71`, `RELEASE_DECISION_PENDING` |
| `indicator` exige decisão científica **mais** perfil **mais** evidência | `contracts/model-release.ts:217-235` |
| `shadow` nunca autoriza apresentação em runtime | `contracts/model-release.ts:212-216` |
| a TMR só é primária em `indicator`/`actions` **e** com ≥1 perfil | `src/inference/model-catalog.ts:99-108` |
| `bundle-verified` e qualquer estado não promovido ⇒ só estilométrico | `src/inference/model-catalog.ts:118` |

**A capacidade que falta, exatamente:** nenhum estado produz TMR primária com **zero** perfis
verificados. Publicar o preview exige isso, e `pending` — o único `gateDecision` honesto para "não há
decisão científica" — é justamente o que o empacotamento recusa.

## A pergunta ABERTA que a implementação tem de resolver primeiro

O caminho experimental em `inference-worker.ts` exige `runtimeIdentity.kind === "bundle"`, e a
identidade vem da seleção do catálogo. Como o catálogo só escolhe TMR com ≥1 perfil, **o preview de
hoje parece só ser alcançável num release já promovido cujo perfil não casa as coordenadas exatas** —
um MISS de perfil, não a ausência de decisão.

Se isso se confirmar, a lane nova não é só um estado a mais: é a diferença entre "preview de modelo
sem decisão científica" e "release promovido com perfil que não casa", que são situações diferentes e
merecem recusas diferentes. **Medir isso é o primeiro passo da implementação**, e o desenho abaixo
vale sob a hipótese de que a lane precisa existir para o primeiro caso.

## O estado proposto: `experimental`

Invariantes no contrato (`assertRolloutInvariants`), todos fail-closed:

1. `gateDecision === "pending"` — é o único valor honesto. Reusar `indicator-only` seria apresentar
   preview não calibrado com o rótulo de uma decisão científica, que é o que o plano proíbe em
   palavras;
2. `profileDigests.length === 0` — não existe perfil verificado; declarar um seria alegar calibração;
3. `evidenceDigest === null` — não há evidência científica a que apontar;
4. `issuedAt !== null` — a data de empacotamento é fato de build, não alegação científica, e serve
   para expirar o preview.

No empacotamento (`resolveReleasePolicy`): `pending` **continua** lançando, com uma exceção única e
escrita — `rolloutState === "experimental"` devolve
`{ includeTmr: true, activeRuntimeKind: "bundle", maximumActionCeiling: "indicator" }`.

No catálogo (`selectCatalogRuntime`): `experimental` ⇒ `primary: "tmr"` com zero perfis, e nenhum
outro estado ganha essa permissão.

## O que este desenho NÃO decide

Não decide se o preview será publicado — isso é o botão externo, que é do operador. Decide apenas que
**se** for, existe um estado que o diz sem mentir sobre calibração.

Não decide a expiração do preview (quantos dias após `issuedAt`), porque isso é escolha de produto com
consequência de suporte, e o número não sai de nenhuma medição que eu tenha.

## Por que o teto não entra nos invariantes

Porque já é estrutural do outro lado, desde `218f3ca`: `decideExperimentalUncalibrated` tem o tipo de
retorno pinado em `actionCeiling: "indicator"`. O `maximumActionCeiling` da política de empacotamento é
a segunda tranca, e as duas juntas são o que a promessa de `docs/model-validation.md` pede — nenhuma
delas sozinha depende de alguém lembrar.
