# Decisões de arquitetura (ADRs)

Registro curto e datado das decisões estruturais do CleanFeed AI. Cada ADR
descreve o contexto, a decisão e as consequências. Decisões futuras devem
acrescentar novos registros em vez de reescrever os antigos.

## ADR-001 — Worker de inferência em documento offscreen

**Status:** aceito.

**Contexto.** A classificação precisa de um worker dedicado (e, no futuro, de um
runtime WASM/WebGPU) sem bloquear a thread da página nem depender de uma aba
aberta. Um service worker MV3 é efêmero e não é um ambiente adequado para manter
um worker de longa duração ou o runtime de um modelo.

**Decisão.** Hospedar o worker de inferência em um **documento offscreen**
(`offscreen`), coordenado pelo service worker. A página nunca executa o modelo
diretamente; o content script só envia texto normalizado por mensagens
validadas.

**Consequências.** Requer a permissão `offscreen` e uma CSP restrita
(`script-src 'self' 'wasm-unsafe-eval'`). Isola o custo de inferência da thread
da página e sobrevive à natureza efêmera do service worker. O contrato de
classificação é preservado quando o backend real substituir o mock.

## ADR-002 — Modelo local com Transformers.js, sem inferência remota

**Status:** aceito (infraestrutura pronta; backend real inativo).

**Contexto.** A proposta é um detector que rode **offline**, sem enviar conteúdo
de posts para nenhum servidor. Precisamos de um runtime que rode ONNX no
navegador com seleção de backend.

**Decisão.** Usar `@huggingface/transformers` (Transformers.js) com assets
**empacotados localmente** sob `chrome-extension://<id>/models/...`, seleção
WebGPU/WASM com fallback e `connect-src 'self'` no manifesto. Nenhuma etapa de
inferência consulta rede HTTP(S).

**Consequências.** O bundle cresce com os assets do runtime, mitigado por um
passo de sanitização offline no build. A integração de um modelo exige
manifesto, checksums e calibração (veja
[model-integration.md](model-integration.md)). Enquanto não houver artefato
aprovado, o backend ativo permanece o mock.

## ADR-003 — Armazenamento e cache sem conteúdo de post

**Status:** aceito.

**Contexto.** O cache precisa evitar reclassificações repetidas, e o histórico
opcional precisa ser útil, sem jamais reter texto, autor ou URL por padrão.

**Decisão.** Indexar o cache por **hash de texto** + plataforma + modelo +
versões de configuração. Persistir apenas configurações, hashes e métricas
agregadas em `chrome.storage.local`. Cada repositório valida por allowlist,
serializa mutações e recupera de estado corrompido. O texto completo do histórico
só existe sob opt-in explícito, em uma chave separada e independentemente
apagável.

**Consequências.** Um resultado não pode ser reidentificado a partir do
armazenamento. O hash é uma conveniência local, não um segredo. `clear()` varre
um superconjunto determinístico de chaves para nunca deixar dados órfãos.

## ADR-004 — Abstenção e teto de ação por calibração

**Status:** aceito.

**Contexto.** Um detector probabilístico erra. Agir de forma agressiva sobre um
resultado incerto é pior do que não agir.

**Decisão.** Só `possibly_ai` e `strong_ai_indication` acima do limiar de marcação
podem ser desfocados/recolhidos/ocultados, e sempre limitados pelo teto de ação
(`actionCeiling`) da calibração por tamanho. Resultados humanos, inconclusivos,
com evidência insuficiente ou **abstidos** nunca são filtrados. Um modelo não
calibrado é rebaixado para `"indicator"` — só pode indicar.

**Consequências.** A agressividade máxima é uma função da calibração comprovada,
não do score bruto. O mock é sempre tratado como demonstração não calibrada.

## ADR-005 — Regra do "sem dados de autor" e linguagem probabilística

**Status:** aceito.

**Contexto.** Classificar texto de pessoas cria risco de dano se a extensão
afirmar autoria ou coletar identidade.

**Decisão.** O `ExtractedPost` carrega **apenas o texto editorial do post** —
nunca nome, handle, avatar ou URL de perfil. As explicações usam somente sinais
calculados e linguagem probabilística e **nunca afirmam autoria**. Um teste de
fronteira despeja o armazenamento e falha se qualquer identidade de autor
aparecer.

**Consequências.** Adaptadores de plataforma são proibidos de preencher campos de
autor (veja [platform-adapters.md](platform-adapters.md)). Nenhuma decisão sobre
pessoas deve ser tomada com base na saída da extensão.
