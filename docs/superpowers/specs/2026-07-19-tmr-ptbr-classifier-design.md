# Classificador TMR calibrado para PT-BR/LinkedIn — Design

**Data:** 2026-07-19
**Estado:** design aprovado em conversa; aguardando revisão deste documento
**Escopo:** integração, validação e promoção progressiva do TMR como classificador local primário do CleanFeed AI

## 1. Contexto

O CleanFeed AI já possui extração de posts, fila de inferência, execução local em
worker, suporte a ONNX/Transformers.js, cache, apresentação reversível,
diagnósticos e uma heurística estilométrica transparente. A heurística é útil
como fallback e explicação, mas não separa com confiabilidade suficiente prosa
de LLM de estilos humanos formulaicos, especialmente a prosa típica do
LinkedIn.

O candidato desta etapa é o “tmr-ai-text-detector”, um classificador RoBERTa
binário distribuído também em ONNX quantizado. O candidato foi treinado
principalmente em inglês e não possui validação suficiente para PT-BR ou para o
domínio LinkedIn. Portanto, a simples inclusão do arquivo ONNX não autoriza seu
uso como detector calibrado.

A implementação atual também possui lacunas que esta etapa precisa corrigir:

- o worker não injeta um CalibrationRegistry populado no PipelineRunner;
- calibrateWithRegistry consulta apenas calibrated e ignora os limiares e o
  actionCeiling armazenados no perfil encontrado;
- o classificador ONNX devolve confidence “low” de forma fixa, provocando
  abstenção sistemática;
- a segmentação heurística e o tokenizer do modelo aplicam limites diferentes;
- o benchmark exclui textos hybrid dos cálculos e não gera intervalos de
  confiança;
- a elegibilidade de um relatório depende do tipo de split, mas não da
  qualidade, cobertura, proveniência ou completude das previsões;
- public/models está ignorado e os arquivos locais do tokenizer não formam um
  bundle versionado ou reprodutível.

## 2. Objetivo e princípio de produto

O objetivo é tornar o TMR o classificador local primário somente quando o
artefato exato demonstrar utilidade e limites conhecidos em um benchmark
PT-BR/LinkedIn bloqueado.

O produto nunca afirmará que um texto “é de IA”. Ele comunicará que o texto
apresenta sinais compatíveis com geração ou edição por IA e explicará que isso
não comprova a origem. Uma pequena taxa de falsos positivos é aceita porque a
mensagem é probabilística e todas as intervenções são reversíveis.

Os orçamentos aprovados são:

- aviso probabilístico: limite superior unilateral de 95% do FPR menor ou igual
  a 5%;
- desfocar, recolher ou ocultar: limite superior unilateral de 95% do FPR menor
  ou igual a 2%, com configuração explícita do usuário;
- os mesmos limites precisam ser satisfeitos em cada segmento crítico usado
  como gate; segmento sem amostra mínima não autoriza ação visual.

## 3. Não objetivos

Esta etapa não inclui:

- treinar um novo encoder do zero;
- combinar TMR e estilometria em um ensemble numérico;
- criar backend, conta, sincronização ou telemetria remota;
- inferir intenção, qualidade, veracidade ou autoria individual;
- prometer detecção universal de qualquer modelo gerador;
- validar idiomas além de PT-BR;
- implementar watermarking, proveniência criptográfica de conteúdo ou análise
  server-side;
- implementar novos adaptadores de plataforma. As interfaces existentes devem
  continuar aptas a receber Reddit, X/Twitter, Facebook, Instagram, Medium,
  fóruns, artigos e páginas genéricas posteriormente.

## 4. Abordagem escolhida

O TMR será promovido por evidência em quatro estágios: bundle verificado, modo
sombra, avisos e ações visuais. O classificador produz evidência; uma política
separada decide como essa evidência pode afetar a página. A heurística
estilométrica permanece como fallback indicativo e explicação, nunca como voto
positivo somado ao TMR.

Abordagens rejeitadas nesta etapa:

- ativar o TMR imediatamente com limiares fixos: mais rápido, mas sem proteção
  contra mudança de idioma, domínio, gerador ou prevalência;
- criar um ensemble desde o início: aumenta custo e complexidade de calibração
  sem garantir erros independentes.

## 5. Arquitetura

    Post extraído
      -> elegibilidade e normalização
      -> tokenizer e janelas do modelo
      -> TMR ONNX local
      -> scores por janela e agregação versionada
      -> qualidade da evidência/OOD
      -> perfil de calibração exato
      -> política de decisão
      -> apresentação limitada pelo perfil e pela preferência do usuário

### 5.1 Bundle do modelo

O bundle é uma unidade fechada e verificável. A fonte candidata é a revisão
imutável b9aa251e5bcda7e429fcc936767d921435945b60 do repositório
onnx-community/tmr-ai-text-detector-ONNX, usando onnx/model_int8.onnx.

O repositório versionará:

- manifesto fechado do CleanFeed;
- URL e revisão imutáveis da origem;
- nome, versão e finalidade do modelo;
- licença do modelo e relatório de compatibilidade de redistribuição;
- SHA-256 e tamanho esperado de cada arquivo de runtime;
- script explícito de aquisição e verificação;
- inventário do conteúdo que precisa entrar no pacote da extensão.

O inventário inclui, no mínimo, ONNX, config.json, tokenizer.json,
tokenizer_config.json, vocab.json, merges.txt e special_tokens_map.json. Nenhum
arquivo auxiliar usado pelo loader pode ficar fora da verificação.

O binário ONNX não será gravado no histórico Git comum. Ele será publicado como
artefato imutável do projeto e colocado em public/models pelo script de
aquisição. O build de release falhará quando um arquivo faltar, tiver tamanho ou
hash divergente, vier de caminho inseguro ou não constar no inventário. O pacote
final contém o modelo e executa sem rede; não existe download em runtime.

Antes de distribuir o bundle, a licença e as obrigações de aviso devem ser
registradas e aprovadas. Falha nessa verificação produz decisão de release
reject, mesmo que o modelo passe no benchmark.

### 5.2 Catálogo, loader e lifecycle

O ModelCatalog mantém a identidade lógica do TMR e referencia seu manifesto. O
WorkerInitializePayload transporta manifesto e perfis de calibração. O
WorkerRuntime valida o bundle, seleciona WebGPU quando habilitado e disponível e
executa um único fallback para WASM.

O TMR só se torna primário quando:

1. o bundle passa na validação de integridade e licença;
2. existe perfil não expirado para as coordenadas exatas da requisição;
3. o relatório de evidência autoriza pelo menos avisos;
4. o smoke real está habilitado e aprovado no job de release.

Falha de inicialização encerra qualquer sessão parcial e ativa o estilométrico
indicativo. Falha de uma inferência não gera loop de reinicialização. Três
falhas do TMR em uma janela móvel de dez minutos abrem um circuit breaker local,
descartam a sessão ONNX e mantêm o fallback até uma tentativa explícita do
usuário ou reinício/atualização da extensão.

### 5.3 Tokenização, janelas e agregação

O tokenizer efetivamente carregado para o TMR é a única fonte do orçamento de
tokens. As configurações deixam de limitar maximumTokens a 256 e passam a
aceitar a capacidade declarada pelo modelo. Para o candidato TMR, cada janela
usa até 510 tokens de conteúdo, reserva dois tokens especiais e sobrepõe 64
tokens com a janela anterior. O release v1 analisa no máximo oito janelas. Se o
texto exigir mais, preserva a primeira e a última e distribui as outras seis em
intervalos uniformes pelo texto; cobertura e truncamento registram exatamente o
que foi analisado. Tamanho, overlap e limite de janelas fazem parte da versão da
agregação e não são alteráveis pelo usuário para um perfil calibrado.

Textos que ultrapassarem uma entrada serão divididos em janelas sobrepostas. O
resultado preserva:

- score bruto de cada janela;
- intervalo de caracteres e quantidade de tokens coberta;
- documentRawScore: média ponderada por tokens únicos, descontando a
  sobreposição;
- localizedRawScore: maior score válido entre as janelas;
- cobertura total;
- concordância e dispersão entre janelas;
- versão da regra de agregação.

A agregação v2 não mistura esses dois scores. O aviso pode ser acionado pelo
documentRawScore ou pelo localizedRawScore, cada um com seu próprio mapeamento e
limiar calibrado dentro do orçamento total de 5%. Ações visuais exigem o
documentRawScore acima do limiar de 2% e evidência sufficient; uma janela
isolada nunca desfoca, recolhe ou oculta o post inteiro. highScoreRatio,
mediana, máximo, dispersão e concordância permanecem como diagnósticos e sinais
de qualidade, mas não entram numa soma de pesos arbitrária.

A regra de agregação é parte do classificador, possui versão própria e seu hash
entra no perfil de calibração. Alterá-la invalida todos os perfis anteriores.

### 5.4 Qualidade da evidência e OOD

O classificador ONNX deixa de retornar confiança baixa fixa. Em vez disso, a
etapa de evidência produz:

- sufficient: idioma, tamanho, cobertura, tokenizer e consistência atendem ao
  perfil calibrado;
- limited: há score utilizável, mas uma condição reduz o teto para indicator;
- unsupported: não há base para marcar; o pipeline se abstém.

Cada redução inclui um código de motivo. São motivos obrigatórios: idioma fora
de PT-BR, menos de 50 palavras, perfil ausente ou vencido, cobertura
insuficiente, truncamento, dispersão excessiva entre janelas, entrada dominada
por links/hashtags/emoji, erro do backend e incompatibilidade de artefato.

Na agregação v2, sufficient exige tokenização exata, cobertura de ao menos 95%,
conteúdo lexical de ao menos 60%, desvio-padrão entre janelas de no máximo 0,25
e concordância de ao menos 0,50. Cobertura entre 50% e menos de 95%, conteúdo
lexical entre 40% e menos de 60% ou divergência acima desses limites produz
limited. Cobertura abaixo de 50%, conteúdo lexical abaixo de 40%, tokenizer
aproximado no caminho TMR, idioma não PT-BR, menos de 50 palavras ou
erro/integridade inválida produz unsupported. A regra já
existente que considera links, hashtags ou emojis dominantes a partir de 60%
continua impedindo ação visual.

Textos de 50 a 79 palavras podem receber aviso se houver perfil próprio, mas
permanecem com teto indicator na primeira versão. Textos abaixo de 50 palavras
são unsupported, salvo em ferramentas experimentais que não atuam no feed.

### 5.5 Calibração e política de decisão

O perfil é imutável e indexado por:

- modelId e modelVersion;
- digest completo do bundle;
- plataforma;
- idioma;
- faixa de tamanho;
- versão da agregação;
- digest do dataset, split e avaliador;
- datas de emissão e expiração.

O perfil contém mapeamentos monotônicos separados para documentRawScore e
localizedRawScore, limiares de aviso para ambos, limiar visual exclusivo do
documento, critérios de evidência, segmentos cobertos, resultados com
intervalos de confiança e actionCeiling.

calibrateWithRegistry deve aplicar o perfil retornado, e não apenas consultar o
booleano calibrated. Os dois caminhos de aviso são calibrados conjuntamente:
o FPR de 5% é medido sobre a união das marcações, não como 5% para cada caminho.
Na primeira versão, blur, collapse e hide compartilham o mesmo limiar
estatístico de ação visual; a preferência do usuário define o efeito, não um
novo nível de certeza. O teto será:

- indicator quando somente o gate de 5% passar;
- hide quando os gates de 5% e 2% passarem, permitindo qualquer modo escolhido
  pelo usuário até esse teto;
- nenhuma promoção do TMR quando o gate de aviso falhar.

Perfil ausente, incompatível, expirado ou sem cobertura exata produz perfil
conservador e teto indicator. A preferência do usuário nunca aumenta o teto.

## 6. Benchmark PT-BR/LinkedIn

### 6.1 Composição

A versão inicial possui 10.000 registros:

- 4.000 humanos;
- 4.000 gerados por IA;
- 2.000 mistos.

Os textos humanos cobrem prosa corporativa, broetry, recrutamento, vendas,
carreira, tecnologia e escrita formal. Conteúdo de domínio LinkedIn só pode vir
de contribuição autorizada ou fonte com licença compatível; não haverá coleta
indiscriminada de perfis. Corpora PT-BR licenciados podem compor validação OOD,
mas não substituem o subconjunto LinkedIn na calibração.

Os textos de IA registram provedor, família, modelo, versão, prompt,
temperatura, seed quando disponível e data. Pelo menos uma família geradora
inteira fica reservada ao teste como gerador não visto.

Os textos mistos registram texto pai, método de edição, faixas aproximadas de
contribuição humana/IA e spans anotados quando possível. Mistos não são
descartados das métricas. Exemplos com contribuição de IA igual ou superior a
50% participam do gate de recall de aviso; os demais são reportados por faixa e
entram na análise de risco, mas não são negativos humanos.

O rótulo de origem é derivado da proveniência documentada, nunca da opinião de
um detector. Dois revisores conferem rótulo, licença, linhagem e remoção de PII;
divergências são resolvidas por um terceiro revisor antes de o item entrar no
manifesto publicado.

### 6.2 Schema e proveniência

O dataset possui manifesto próprio e registros fechados. Cada item inclui:

- ID único e hash do conteúdo normalizado;
- classe human, ai ou mixed;
- domínio LinkedIn, tamanho, idioma e coorte temporal;
- origem, licença, identificador imutável e data de coleta;
- base legal/consentimento e auditoria de remoção de PII;
- protocolo de anotação, anotadores, concordância e adjudicação;
- receita de geração para IA;
- pai, cadeia de derivação, ataque, operador e severidade para transformações;
- grupos de autor, fonte, prompt e quase duplicata usados pelo split.

IDs repetidos, campos desconhecidos, score fora de [0,1], metadados
contraditórios ou previsão ausente tornam a execução inelegível. Não existe
comportamento last-write-wins.

### 6.3 Transformações e hard negatives

O benchmark inclui paráfrase por famílias diferentes, tradução ida e volta,
pós-edição humana, erros e ruído, Unicode/homoglyph, emojis, hashtags, links,
truncamento, expansão, imitação de estilo LinkedIn e mistura humano/IA.

Hard negatives humanos incluem textos altamente polidos, repetitivos,
formulaicos, motivacionais, produzidos por falantes não nativos e com estrutura
corporativa. Esse conjunto mede diretamente o risco que motivou o retuning da
heurística estilométrica.

### 6.4 Split

A divisão é 20% desenvolvimento, 30% calibração e 50% teste temporal bloqueado.
O algoritmo agrupa e audita simultaneamente:

- autor;
- tempo;
- domínio/fonte;
- família geradora e versão;
- template de prompt;
- lote de coleta;
- cluster de quase duplicata;
- pai e derivados.

Nenhum grupo pode cruzar divisões. O teste contém ao menos 2.000 negativos
humanos. Todo segmento crítico usado como gate contém ao menos 300 negativos;
segmentos menores continuam no relatório, mas não autorizam ação visual.

Os segmentos críticos de FPR são faixa de tamanho, domínio LinkedIn, tipo de
fonte humana, coorte temporal e família de hard negative. Os segmentos críticos
de recall são faixa de tamanho, domínio, gerador visto/não visto, transformação
e proporção mista; cada um precisa de ao menos 200 positivos para servir como
gate. As proporções de 20/30/50 são aplicadas por classe com tolerância máxima
de dois pontos percentuais depois do agrupamento.

O teste bloqueado não é usado para escolher calibrador, agregação, limiar ou
regra OOD. Uma tentativa reprovada consome o holdout; a próxima tentativa exige
nova versão do modelo/regra e novo holdout temporal.

### 6.5 Calibração e métricas

Desenvolvimento e calibração comparam Platt scaling, beta calibration e
regressão isotônica, separadamente para documentRawScore e localizedRawScore.
Uma validação cruzada de cinco folds agrupada por autor escolhe o menor Brier
entre candidatos com ECE de no máximo 0,05; empate com diferença de Brier menor
que 0,002 favorece Platt scaling por simplicidade. O candidato escolhido é
reajustado usando toda a divisão de calibração. Em seguida:

1. escolhe-se o menor limiar que maximiza recall com limite superior unilateral
   de 95% do FPR menor ou igual a 5%;
2. escolhe-se um limiar igual ou maior para ações com limite superior menor ou
   igual a 2%;
3. regras, mapeamento e limiares são congelados;
4. o teste bloqueado é executado uma vez;
5. o relatório emite pass, indicator-only ou reject.

O relatório publica FPR, FNR, recall nos dois orçamentos, precisão observada e
simulada para prevalências de 1%, 5% e 10%, ROC-AUC, PR-AUC, Brier, ECE,
cobertura, abstenção, latência, memória e intervalos de confiança. Intervalos de
proporção usam Wilson unilateral para gates; AUC e calibração usam bootstrap
clusterizado por autor. Resultados são overall, macro, pior segmento e por
tamanho, domínio, fonte, gerador visto/não visto, transformação, severidade,
coorte temporal e proporção mista.

Os gates estatísticos são:

| Gate | Critério no teste bloqueado |
| --- | --- |
| Aviso | UCB95(FPR) ≤ 5% overall e em cada segmento crítico |
| Ação visual | UCB95(FPR) ≤ 2% overall e em cada segmento crítico |
| Utilidade do aviso | LCB95(recall) ≥ 60% |
| Utilidade da ação | LCB95(recall) ≥ 35% |
| Cobertura | ≥ 80% dos posts elegíveis sem abstenção |
| Calibração | ECE ≤ 0,05 |
| Mistos ≥ 50% IA | recall de aviso ≥ 50% |

Falhar no gate de ação, mas passar no gate de aviso, produz indicator-only.
Falhar no gate de aviso produz reject e mantém o estilométrico como
classificador ativo.

## 7. Experiência do usuário

O feed usa faixas qualitativas, não uma porcentagem de autoria:

- Sinais detectados para o gate de aviso;
- Sinais mais fortes para o gate de ação;
- Evidência limitada quando há score, mas não cobertura para decisão plena.

Texto explicativo obrigatório:

> Este texto apresenta padrões compatíveis com conteúdo gerado ou editado por
> IA. Isso não comprova sua origem.

O score pode aparecer apenas no diagnóstico avançado como score calibrado do
modelo, acompanhado da ressalva de que não equivale à probabilidade real de
autoria.

Desfocar, recolher e ocultar exigem escolha explícita e permanecem reversíveis.
No modo hide, o conteúdo é substituído por controle acessível com o motivo
probabilístico e a ação “Mostrar texto”. Revelar não remove o aviso; restaurar
remove toda a apresentação da extensão.

Feedback como “não deveria ter sido marcado” permanece local, não armazena o
texto e não vira ground truth automaticamente. O diagnóstico exportável contém
somente metadados técnicos e métricas agregadas.

## 8. Rollout, expiração e rollback

Os estados de rollout são:

1. bundle-verified: integração e smoke, sem classificar o feed;
2. shadow: inferência apenas em builds de desenvolvimento, sem apresentação;
3. indicator: gate de 5% aprovado;
4. actions: gates de 5% e 2% aprovados.

Perfis expiram 180 dias após a emissão. Mudança de modelo, arquivo, tokenizer,
agregação, dataset, split ou avaliador invalida o perfil imediatamente. A
revalidação usa novo holdout temporal. Durante expiração ou incompatibilidade,
o teto volta a indicator.

Não haverá kill switch remoto. Integridade, circuit breaker e atualização da
extensão fazem o rollback local. O estado degradado é visível em opções e
diagnósticos.

## 9. Privacidade e segurança

- Todo texto e toda inferência permanecem no navegador.
- O loader aceita somente origem da própria extensão e local_files_only.
- CSP continua sem endpoints de inferência.
- Métricas locais usam contadores e histogramas limitados, nunca texto, URL,
  autor ou traces individuais.
- Cache e histórico são separados pela identidade completa do modelo e perfil.
- Resultados de modelo anterior não podem ser reutilizados depois de troca de
  bundle, agregação ou calibração.
- Manifesto, protocolo de mensagens e perfis usam schemas fechados e rejeitam
  campos desconhecidos.
- Falhas são fail-closed quanto a ações visuais.

## 10. Desempenho operacional

Na referência mínima — Windows 11, quatro processadores lógicos disponíveis,
8 GiB de RAM, Chrome Stable e backend WASM, registrada com versões completas no
relatório de release — devem ser atendidos:

- nenhuma tarefa síncrona da extensão pode exceder 50 ms;
- inicialização fria do TMR deve concluir em até 10 s;
- inferência quente p95 deve concluir em até 2 s por post;
- memória incremental máxima é 512 MiB;
- taxa de erro de inferência deve permanecer abaixo de 1%;
- filas respeitam cancelamento, backpressure e os limites configurados;
- WebGPU pode acelerar, mas WASM continua sendo fallback funcional obrigatório.

Uma reprovação de desempenho bloqueia a promoção, mesmo que a acurácia passe.

## 11. Estratégia de testes

### 11.1 Unitários

Cobrir:

- manifesto, paths, origem, todos os hashes e inventário;
- catálogo e identidade de cache;
- seleção WebGPU/WASM, descarte de sessão e circuit breaker;
- tokenizer, janelas, cobertura e agregação;
- qualidade de evidência e códigos OOD;
- registro, correspondência exata, expiração e aplicação integral do perfil;
- cálculo de intervalos, métricas, split e auditoria de vazamento;
- validação estrita de dataset e previsões;
- limites de apresentação e reversibilidade.

### 11.2 Integração

Cobrir:

- carga real do bundle sem rede;
- manifesto e perfis atravessando offscreen/worker;
- TMR primário, fallback estilométrico e status degradado;
- cache invalidado por mudança de modelo/perfil;
- textos curtos, longos, mistos e adversariais;
- ausência de bypass do actionCeiling;
- build e pacote contendo exatamente os ativos inventariados.

### 11.3 Chrome E2E

Validar numa fixture LinkedIn:

- aviso probabilístico e cópia aprovada;
- blur, collapse e hide somente com perfil e preferência válidos;
- teclado, leitor de tela, foco e “Mostrar texto”;
- restauração total;
- operação offline;
- orçamento da thread principal;
- reinício do service worker, fila, cancelamento e fallback.

### 11.4 Benchmark e release

O job de validação real deve fornecer o bundle; smoke pulado é falha. A suíte
existente, atualmente com 703 testes, permanece verde, e todos os novos testes
são obrigatórios. O relatório final contém o digest da evidência e motivos
estruturados para cada gate.

Também são condições de release:

- licença aprovada e avisos incluídos;
- nenhum hash ou previsão ausente;
- nenhum segmento crítico abaixo da amostra mínima;
- zero violações graves/críticas de acessibilidade nos roots da extensão;
- nenhuma nova origem de rede ou permissão não justificada;
- pacote auditado e executado offline em Chrome real.

## 12. Decisões de release

pass significa que o TMR pode ser primário e o perfil autoriza modos até hide,
sempre conforme a preferência do usuário.

indicator-only significa que o TMR pode ser primário para avisos, mas o perfil
tem actionCeiling indicator.

reject significa que o TMR não entra como primário; o CleanFeed continua com o
estilométrico transparente e não publica alegação de qualidade do candidato.

Nenhum resultado parcial, score alto isolado ou métrica do model card substitui
esses gates.

## 13. Sequência de entrega

O plano de implementação derivado deste design deverá executar, em ordem:

1. corrigir os contratos de benchmark, dados e evidência;
2. adquirir, licenciar e fechar o bundle do TMR;
3. integrar catálogo, loader, worker, tokenizer e agregação;
4. corrigir calibração e política de decisão;
5. construir e auditar o corpus PT-BR/LinkedIn;
6. calibrar sem consultar o teste bloqueado;
7. executar os gates de teste, desempenho, privacidade e acessibilidade;
8. publicar o estágio máximo autorizado pelo relatório.

Essa sequência mantém cada entrega testável e impede que o arquivo ONNX seja
confundido com um classificador validado antes da evidência correspondente.
