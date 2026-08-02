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

**A capacidade que falta, exatamente — e isto foi reescrito depois da medição da seção seguinte.**
Pelo CATÁLOGO nenhum estado produz TMR primária com zero perfis; mas a ativação não passa pelo
catálogo, e por lá o preview já roda. O que falta, então, não é capacidade de runtime: é um
`gateDecision` que diga "não há decisão científica" **e** seja aceito no empacotamento. Hoje o único
valor honesto para isso é `pending`, e `pending` é justamente o que a política recusa — daí a lane
travar na publicação, não na execução.

## A pergunta que estava aberta — RESOLVIDA por medição, contra a minha hipótese

O caminho experimental em `inference-worker.ts` exige `runtimeIdentity.kind === "bundle"`, e a
identidade vem da seleção do catálogo. Como o catálogo só escolhe TMR com ≥1 perfil, **o preview de
hoje parece só ser alcançável num release já promovido cujo perfil não casa as coordenadas exatas** —
um MISS de perfil, não a ausência de decisão.

**Não se confirmou.** A medição mostra o contrário, e o próprio código o diz:
`src/inference/runtime-activation.ts:104-133` calcula `experimental = !calibrated && flag === true` e,
nesse caso, **carrega o manifesto do modelo** — o comentário da função é explícito, "in the
experimental case the release is still `pending`, so the worker loads the model but runs it
UNCALIBRATED".

Ou seja: o preview **já funciona hoje num release não promovido**, por um caminho de ativação que
**não passa** por `selectCatalogRuntime`. Minha hipótese estava errada, e a consequência é que o
defeito 2 não é de runtime: **é de empacotamento**. O runtime já implementa a lane; o que falta é um
estado de descritor que a política de empacotamento aceite, para que a coisa possa ser publicada.

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

No catálogo (`selectCatalogRuntime`): **nada muda**, e este item do desenho original estava errado.
A ativação do preview não passa pelo catálogo — `buildWorkerInitializePayload` carrega o manifesto por
conta própria quando não há calibração e o usuário optou. Dar ao catálogo uma permissão nova seria
acrescentar um segundo caminho para a mesma coisa, e o segundo caminho é onde as promessas se perdem.

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
