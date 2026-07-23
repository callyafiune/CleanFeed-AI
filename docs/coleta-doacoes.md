# Coleta de doações — slice de transferência (OPCIONAL)

> **Papel (decidido 2026-07-23, junto com o pivô de escopo):** o modelo e o
> corpus selado são **genéricos pt-BR** — a avaliação/calibração NÃO depende de
> doações. Este kit existe para uma medição COMPLEMENTAR: um pequeno slice
> (~30–50 posts reais de feed, doados com consentimento) que quantifica a
> transferência de domínio ("no registro de feed, observamos X") publicada ao
> lado da evidência principal — nunca como gate. Diferente das fontes pré-2022
> (rótulo humano pela DATA), aqui o rótulo se sustenta em **consentimento +
> autodeclaração de autoria** — por isso o termo abaixo é parte da
> proveniência, não burocracia.

## 1. O que pedir ao doador

- Posts **de autoria própria**, publicados no LinkedIn (ou escritos para lá);
- **≥ 50 palavras** cada; quantos quiser (ideal 2–5 por pessoa);
- **Sem uso de IA na escrita** daquele post (nem "melhorado pelo ChatGPT") —
  autodeclarado por post;
- O texto pode ser colado com pequenas edições de privacidade (trocar nomes de
  terceiros por cargos) — instrua o doador a NÃO incluir e-mail/telefone/@.

Cobertura desejada (uma pergunta de categoria no formulário):

| Categoria (`humanSourceType`) | Exemplo |
| --- | --- |
| `career` | conquista pessoal, mudança de emprego |
| `technology` | opinião/experiência técnica |
| `recruiting` | vaga aberta, busca por candidatos |
| `sales` | oferta de produto/serviço |
| `broetry` | storytelling motivacional em linhas curtas |
| `formal` | comunicado institucional |

Hard-negatives (opcional, vale ouro): posts humanos **bem polidos, formulaicos
ou motivacionais** — são os que detectores comerciais mais acusam injustamente.

## 2. Termo de consentimento (texto pronto para o formulário)

> **Consentimento para uso de texto em pesquisa (LGPD, art. 7º, I)**
>
> Doo voluntariamente o(s) texto(s) abaixo, de minha autoria, ao projeto
> CleanFeed AI, para uso EXCLUSIVO em avaliação científica local de detectores
> de texto gerado por IA. Entendo que: (1) o texto será pseudonimizado — nome,
> perfil e quaisquer dados pessoais não entram no conjunto de dados; (2) o
> conjunto NÃO é redistribuído nem publicado; apenas estatísticas agregadas e
> auditáveis são divulgadas; (3) declaro que o(s) texto(s) foi(ram) escrito(s)
> por mim, sem uso de ferramentas de IA generativa; (4) posso revogar este
> consentimento a qualquer momento pelo contato do projeto, com remoção do(s)
> texto(s) em até 15 dias; (5) nenhuma decisão automatizada será tomada sobre
> mim com base nesta doação.
>
> ( ) Li e concordo. — data e identificação ficam registradas na resposta.

## 3. Formulário (Google Forms) — campos

1. Consentimento (checkbox obrigatório com o termo acima);
2. Texto do post (parágrafo);
3. Categoria (múltipla escolha com as 6 acima);
4. "Este post é 100% de sua autoria, sem IA?" (sim obrigatório);
5. Ano aproximado de publicação (lista);
6. E-mail (para revogação — **fica na planilha do operador, NUNCA entra no
   corpus**; o pipeline recebe apenas um hash da resposta).

## 4. Do CSV ao corpus

Exporte as respostas em CSV e rode:

```bash
cd benchmark/lab
python import_donations.py --csv <respostas.csv> \
  --output ../data/candidates/doacoes.jsonl
```

O importador: exige consentimento e autodeclaração marcados; aplica o pipeline
padrão (janela de palavras, PII-drop — respostas com e-mail/telefone/@ no TEXTO
são descartadas e contadas); gera `consentReceiptDigest` = SHA-256 da resposta
(o recibo auditável, sem dado pessoal); mapeia a categoria para
`humanSourceType`. A planilha original (com e-mails) fica com o operador, fora
do repositório e fora do corpus — ela é o registro de revogação.

## 5. Uso

- **Portão D**: os primeiros ~100 textos viram o slice de teste de registro
  real (scoring pelo harness + relatório de FPR observado);
- **Corpus selado**: doações somam à classe `human` com
  `sourceKind: authorized-contribution` e `legalBasis: consent`, no bloco
  temporal correspondente.

*Vinculado a [uso-responsavel.md](uso-responsavel.md),
[corpus-sources.md](corpus-sources.md) e ao
[runbook de coleta](corpus-collection-runbook.md).*
