# Ferramentas de continuidade e de verificação

Vivem aqui, versionadas, porque `.codex-reviews/` é **ignorado pelo git** — os vereditos e mandatos
do cross-review são transitórios e volumosos, mas estas duas são ativos do projeto e num clone novo
precisam existir.

## `batimento.sh`

Batimento permanente: escreve uma sentinela em `.codex-reviews/.sentinelas.log` a cada intervalo,
para sempre, até ser morto. Serve à única falha que as três camadas do § 6b não conseguem ver —
**turno que encerra com nada em voo**. As três detectam trabalho que existe; se não existe, não há
o que detectar.

```bash
nohup bash benchmark/lab/continuidade/batimento.sh 1200 > /dev/null 2>&1 &
pkill -f batimento.sh   # parar
```

Armado UMA vez por sessão, e nunca rearmado por turno: a versão anterior pedia acionamento ao fim de
cada turno, e falhar em acionar é a mesma falha volitiva que ela cobria. Com o batimento, "continuar
ou parar" passa a ser decidido ACORDADO, e parar vira ato explícito em vez da ausência de um.

O token da sentinela **tem** de casar o padrão do `Monitor` vivo (`CONCLUIDA|VEREDITO|FALHOU`);
sentinela que não casa cai num log que ninguém observa.

## `auditoria-mutacao.py`

Auditoria de mutação das guardas de um módulo: para cada código de erro, desliga TODOS os `throw`
daquele código (`throw new X(` → `void new X(`) e roda as suítes. Guarda cuja remoção deixa tudo
verde não tem teste que a exercite — a família de defeito que apareceu em quatro rodadas de
cross-review.

```bash
python benchmark/lab/continuidade/auditoria-mutacao.py
```

Medido em `benchmark/split-artifact.ts` (2026-08-02): 29 guardas, 17 exercitadas, **7 sem teste
nenhum** — inclusive as duas do atestado de composição. Depois dos testes escritos: 24 exercitadas.

Três exigências do arnês, aprendidas errando:

1. **linha de base VERDE antes de mutar** — senão "vermelho" não distingue mutação eficaz de suíte
   já quebrada;
2. **restaurar num `finally`**, e conferir por `diff` depois — o script muta o mesmo arquivo dezenas
   de vezes;
3. **capturar bytes e decodificar à mão** — `text=True` usa cp1252 no Windows e o vitest emite UTF-8.

**Dois idiomas de lançamento**, e o segundo argumento diz qual: a CLASSE de erro para
`throw new XError("CODIGO", ...)`, ou o nome do HELPER para `fail("CODIGO", ...)`. O idioma do helper é
o majoritário — 14 módulos — e a primeira versão desta ferramenta só entendia o outro, devolvendo dez
"NAO-MUTAVEL" e zero informação em `holdout-ledger.ts`. **Zero mutável não é zero lacuna.**

Para o helper, não serve `void fail(...)`: `fail` lança por dentro e `void` só avalia. A mutação
substitui o lançador por um inerte injetado no módulo.

Medições até agora: `split-artifact.ts` 7 de 29 sem teste; `commands/split.ts` 3 de 5;
`holdout-ledger.ts` **2 de 8**.

**A ferramenta RECUSA rodar sem a suíte dedicada ao módulo**, quando existe
`benchmark/tests/<modulo>.test.ts`. Isso não é zelo: a auditoria de `holdout-ledger.ts` rodou sem ela e
reportou QUATRO lacunas; com a suíte, são duas, e a mais consequente estava testada desde sempre.
Escolher suítes por conveniência produz achado falso, e achado falso publicado é pior que nenhum.

Limite do método: só muta lançamento cujo código é literal ali. Guarda que lança de dentro de um helper
aparece como "não mutável" e tem de ser conferida à mão.
