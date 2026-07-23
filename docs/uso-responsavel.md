# Uso responsável — o detector indica; humanos decidem

> Este documento é normativo para o projeto e condição de uso para
> instituições. Ele existe porque detectores de texto-IA erram, erram de forma
> enviesada, e o dano de acusar um humano inocente é maior e irreversível em
> comparação ao dano de deixar passar um texto de IA. Toda a arquitetura do
> CleanFeed (fail-closed, gates de FPR, abstenção, divulgações) implementa o
> que está escrito aqui.

## O que esta ferramenta É — e o que ela NUNCA é

- É um **indicador probabilístico** de padrões compatíveis com texto gerado ou
  editado por IA, com erro **quantificado e publicado** (quando calibrada) ou
  **explicitamente desconhecido** (modo experimental, rotulado como tal).
- **NÃO é prova de autoria.** A copy do produto é invariante:
  *"Isso não comprova sua origem."* Nenhuma saída — score, selo, destaque —
  constitui alegação de que uma pessoa específica usou IA.
- **NÃO é fundamento para punição.** Reprovação, sanção disciplinar, demissão,
  rejeição de trabalho ou qualquer decisão adversa **não podem** ter um score
  de detector como evidência única ou determinante.

## Por que a regra é dura: três fatos

1. **Matemática da taxa-base.** Com FPR de 2% (o nosso gate mais rígido) e
   10.000 textos majoritariamente humanos, ~180 humanos inocentes são
   sinalizados. Um FPR "baixo" em porcentagem é um número alto em pessoas.
   Precisão real depende da prevalência — que ninguém conhece de antemão.
2. **Viés documentado na classe de ferramentas.** Pesquisas independentes
   mostraram detectores comerciais sinalizando desproporcionalmente escritores
   **não-nativos** e textos curtos/informais; universidades desativaram
   detectores comerciais por falsos positivos; a própria OpenAI descontinuou o
   classificador dela por baixa acurácia. Texto "torto", simples ou fora do
   registro esperado NÃO é evidência de IA.
3. **LGPD, Art. 20.** No Brasil, o titular tem direito à **revisão de decisões
   tomadas unicamente com base em tratamento automatizado** que afetem seus
   interesses. Punir com base em score de caixa-preta, sem revisão humana
   documentada e contraditório, expõe a instituição juridicamente.

## Regras para uso institucional (condições, não sugestões)

1. **Nunca evidência única.** O indicador pode, no máximo, iniciar uma conversa
   ou uma revisão humana qualificada — jamais encerrá-la.
2. **Erro divulgado a quem é avaliado.** Quem for sujeito à triagem deve saber
   que a ferramenta é usada, qual é a taxa de erro medida (com intervalo de
   confiança) e em qual população foi medida.
3. **Contraditório e revisão humana obrigatórios** para qualquer consequência
   adversa, com registro de quem revisou e por quê (LGPD Art. 20).
4. **Proibido o veredito por sentença sem validação própria.** Scores por
   trecho são menos confiáveis que o score de documento (o projeto abstém em
   textos < 50 palavras por isso); interfaces que pintam frases de vermelho
   induzem confiança indevida.
5. **População fora do domínio medido = resultado inválido.** Um detector
   calibrado em posts pt-BR de rede social não licencia conclusões sobre
   redações escolares, teses ou outros idiomas sem nova medição.
6. **Sem uso punitivo em massa.** Triagem automatizada seguida de sanção em
   lote é incompatível com este projeto, com a LGPD e com a matemática acima.

## Como o produto aplica isso por design

| Mecanismo | Onde |
| --- | --- |
| Release fail-closed: sem decisão científica selada, o modelo não age no feed | `release.json` (`gateDecision: pending`), rollout `bundle-verified` |
| Modo experimental SEMPRE rotulado ("preview experimental / não calibrado… Pode errar.") | copy selada em `src/shared/classification-copy.json` |
| Nenhuma alegação de autoria, nunca | `probabilisticDisclosure` invariante + testes que a fixam |
| Abstenção em texto curto (< 50 palavras) e evidência insuficiente | avaliador de evidência + teto `indicator` no bucket 50–79 |
| Limiares fora do alcance do usuário — decisão científica, não preferência | perfis de calibração selados; settings sem limiar |
| Erro publicado com intervalo de confiança, por fatia | gates de release (FPR UCB95 ≤ 2%/5%, bootstrap por autor) |
| Evidência sem texto/autor/URL | sanitizador de evidência + schema zero-PII |

## Compromissos do projeto

- Publicar métricas **com** limitações na primeira linha (model card honesto).
- Publicar a **composição exata da população medida** (tabela por
  registro/fonte) e as métricas **por fatia de registro** — nunca só um número
  global. Registros não presentes na tabela não estão validados; a validação de
  um registro novo se faz por extensão de fatia com o mesmo pipeline (que roda
  100% local — uma instituição pode medir no próprio dado sem compartilhá-lo).
- Declarar a **âncora temporal da classe humana** (pré-nov/2022, rótulo puro
  pela data) e a limitação correspondente: a escrita humana DERIVA — humanos de
  hoje absorvem estilo de IA ("efeito delve") e escrevem sobre tópicos novos —
  então o FPR medido pode SUBESTIMAR o real em texto contemporâneo. Mitigações
  vinculantes: perfis de calibração expiram em 180 dias (re-medição forçada);
  sonda de deriva com humanos contemporâneos consentidos e autodeclarados
  ([coleta-doacoes.md](coleta-doacoes.md)); fatias hard-negative de humanos
  polidos (onde a deriva morde primeiro).
- Não publicar granularidade por sentença sem corpus misto validado (spans).
- Manter o corpus sob governança de licença/PII; nunca redistribuir textos.
- Documentar rejeições e falhas (este repositório registra os experimentos que
  deram errado — incluindo o detector anterior, invertido em pt-BR, e um
  detector comercial marcando como IA a única frase humana de um texto misto).

*Vinculado ao inventário de fontes ([corpus-sources.md](corpus-sources.md)), ao
runbook de coleta ([corpus-collection-runbook.md](corpus-collection-runbook.md))
e à superfície de evidência de release ([releases/tmr-ptbr-v1.md](releases/tmr-ptbr-v1.md)).*
