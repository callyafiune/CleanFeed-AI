# Limitações conhecidas

- O adaptador MVP depende da estrutura atual do DOM do LinkedIn; mudanças no
  site podem impedir a detecção ou extração até que os seletores sejam revisados.
- A classificação nesta fase usa uma heurística estilométrica transparente
  (`stylometric-v1`): sinais calculados e explicáveis, porém sem calibração e
  sem qualquer validação de acurácia. O resultado é probabilístico e serve
  apenas como indício; ele não mede autoria, qualidade, intenção ou veracidade
  e não deve ser usado para decisões sobre pessoas.
- Mesmo quando houver modelo real, classificações serão probabilísticas e podem
  produzir falsos positivos e falsos negativos.
- O candidato de modelo real (`cleanfeed-ptbr-v1`, BERTimbau fine-tunado; substitui
  o antigo `tmr-ai-text-detector`) é um classificador
  local para **português/LinkedIn**, não um detector universal, e está
  `bundle-verified`/`pending`: nenhuma decisão científica foi emitida, então ele
  não classifica o feed e nenhum número de acurácia é publicado (a evidência, se
  existir, virá de [releases/tmr-ptbr-v1.md](releases/tmr-ptbr-v1.md)). Novos
  geradores, paráfrase, textos mistos (humano + IA), drift do modelo e mudanças do
  DOM permanecem riscos que degradam qualquer detecção.
- Reddit, X/Twitter, Facebook, Instagram, Medium, fóruns, artigos e comentários
  genéricos permanecem apenas como adaptadores futuros; hoje só o LinkedIn tem
  adaptador com apresentação visual.
- Textos abaixo do mínimo configurado são ignorados por padrão para evitar
  conclusões frágeis.
- O filtro automático desta fase está limitado ao LinkedIn. Outros adaptadores
  dependem do mesmo contrato, mas ainda não foram implementados.

## L1 — Sem coleta individual autorizada: o que isso fecha, definitivamente

Decidido em 2026-07-26 (B3). O projeto não recruta pessoas para doar texto, não
obtém autorização por documento e não registra sessões de escrita próprias: a
coleta humana se limita a **bases de dados públicas com licença compatível**. A
restrição é de **aquisição**, não de categoria de evidência — base pública que já
contenha sessões instrumentadas continua admissível, e com base de rótulo mais
forte (`observed-process`). É limitação de projeto declarada, não pendência.

O que sustenta o rótulo `human` é o corte de data `< 2022-11-30`, e ele é
**mitigação declarada** de risco: não é prova de autoria humana, e a autoria
humana **não pode ser garantida em 100%** (a formulação é a que o MultiSocial usa
sobre a mesma política). O detalhe por fonte — qual campo de data ancora os bytes
de cada uma — está em [corpus-sources.md](corpus-sources.md).

Três consequências, e são definitivas:

1. **O rótulo humano fica ancorado em texto pré-nov/2022.** "Público +
   contemporâneo + verificavelmente humano" é quase contraditório depois dessa
   data. Bases públicas contemporâneas e instrumentadas existem, mas não atingem
   a escala nem as fatias de calibração exigidas.
2. **Não existe base pública licenciada de publicação profissional pt-BR**, e por
   isso o FPR no domínio de operação do produto **não será medido**. Não é que
   ele seja bom ou ruim: ele não é medido, e nada neste repositório o estima.
3. **O falso alarme varia de 0% a 7,12% entre os estratos linguísticos
   disponíveis**, então extrapolar dos estratos calibrados para o feed
   profissional é inferência **sem cota superior**.

Sobre esse intervalo, e isto é obrigatório: **0%–7,12% é diagnóstico da execução
reprovada de 2026-07-25**, não alegação de desempenho do detector v3. Nenhum
número de desempenho da v3 existe antes de um holdout válido, e nenhum será
escrito aqui até então.

Quatro respostas do projeto, em vez de ignorar:

1. **Limiar escolhido contra o pior estrato linguístico calibrado**, nunca contra
   a média (G2). Entre os estratos disponíveis, o mais próximo de um post de feed
   é o informal curto — que é exatamente onde o falso alarme foi pior.
2. **Teto de ação rebaixado** em plataforma sem perfil calibrado, com o motivo
   exposto ao usuário (E4).
3. **Cota conformal unilateral** sobre texto humano (G3), que dá cota de **taxa de
   falso positivo sinalizado** sem modelar a distribuição de geradores — enunciada
   com a sua condição: exige exchangeability do domínio humano e **não** cobre
   mudança de estrato linguístico. O nome importa: o produto **sinaliza**, e se um
   sinal se torna acusação depende do que o leitor faz, num processo que este
   projeto **não mede** — por isso a grandeza não se chama "taxa de acusação falsa".
4. **Comunicação como detector de pt-BR genérico**, nunca como calibrado para
   feed profissional (H4).

## Fatores que degradam a detecção

Estas quatro dimensões limitam qualquer resultado e são tratadas como riscos no
[registro de riscos](risks.md):

- **DOM**: o adaptador depende da estrutura atual do site. Uma mudança de markup
  pode impedir a detecção ou a extração até que os seletores isolados sejam
  revisados. Fixtures determinísticas cobrem os formatos conhecidos, mas não o
  site ao vivo.
- **Idioma**: o suporte declarado é para português. Textos em outros idiomas
  podem produzir distribuições de score sem sentido e tendem a ser abstidos; a
  calibração é por idioma e não vale para idiomas não suportados.
- **Tamanho**: textos abaixo do mínimo configurado são ignorados para evitar
  conclusões frágeis; textos muito longos são divididos em chunks com limite. A
  calibração é por faixa de tamanho e define o teto de ação de cada faixa.
- **Drift do modelo**: a calibração é vinculada ao artefato exato que a produziu.
  Se o modelo ativo não corresponder à calibração registrada, o resultado cai em
  um perfil conservador não calibrado, que só pode indicar.

## Apresentação e explicações

- Apenas `possibly_ai` e `strong_ai_indication` acima do limiar de marcação
  podem ser desfocados, recolhidos ou ocultados; humano, inconclusivo,
  evidência insuficiente e resultados abstidos nunca são filtrados.
- A agressividade é sempre limitada pelo teto de ação (`actionCeiling`) da
  calibração por tamanho; um modelo não calibrado só pode indicar.
- As explicações listam somente sinais calculados e usam linguagem
  probabilística; não interpretam neurônios, estilo ou intenção e não afirmam que
  um texto "foi escrito por IA".
- O feedback local não altera o modelo nem os limiares; ele só é registrado para
  uso futuro neste navegador.

## Análise manual

- Em sites genéricos, a análise manual apenas exibe o resultado no próprio painel
  e não aplica nenhum modo visual automaticamente; ações visuais só ocorrem em
  plataformas com adaptador e sob clique explícito do usuário.

## Desempenho

- O observador do feed processa no máximo 100 candidatos por ciclo síncrono e
  cede a thread principal (`scheduler.yield`, com fallback `setTimeout(0)`) entre
  ciclos, para que uma inserção grande da rolagem virtual não bloqueie a página.
  O orçamento real de 50 ms por tarefa é verificado em Chrome real no portão E2E.
