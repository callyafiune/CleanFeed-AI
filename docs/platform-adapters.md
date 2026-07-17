# Guia de adaptadores de plataforma

Um _adapter_ ensina o CleanFeed a ler uma plataforma nova. Ele é o **único**
ponto de extensão: adicionar uma plataforma significa registrar um adapter no
`PlatformRegistry`, nunca editar o núcleo de inferência, armazenamento ou
apresentação. Todo o conhecimento específico da página vive dentro do adapter.

Este guia é copiável: siga os passos, cole o esqueleto de exemplo do fim e
troque os seletores pela sua plataforma.

## Contrato

Um adapter implementa `PlatformAdapter` (`src/shared/types.ts`):

```ts
export interface PlatformAdapter {
  id: string;
  matches(url: URL): boolean;
  findFeedRoot(document: Document): HTMLElement | null;
  findPostElements(root: ParentNode): HTMLElement[];
  extractPost(element: HTMLElement): ExtractedPost | null;
  applyPresentation(
    element: HTMLElement,
    result: ClassificationResult,
    settings: EffectiveSettings,
  ): void;
  restorePresentation(element: HTMLElement): void;
  isPostElement(element: HTMLElement): boolean;
}
```

- `id` é único e estável; o registro **lança erro em ids duplicados**.
- `matches(url)` decide, só pela URL, se o adapter é dono da página.
- `extractPost` devolve `{ platform, text, ... }` ou `null`.

## Arquivos mínimos

Espelhe a estrutura do adapter do LinkedIn (`src/platforms/linkedin/`),
mantendo cada responsabilidade isolada:

- `src/platforms/<plataforma>/selectors.ts` — **todos** os seletores CSS em um
  só lugar, para sobreviver a mudanças de markup.
- `src/platforms/<plataforma>/extractor.ts` — extração do texto do post.
- `src/platforms/<plataforma>/presenter.ts` — `applyPresentation`/
  `restorePresentation` que **delegam ao PresentationController compartilhado**.
- `src/platforms/<plataforma>/<plataforma>-adapter.ts` — a classe que implementa
  `PlatformAdapter` e costura as peças acima.

Nenhum outro módulo precisa saber que a plataforma existe.

## Seletores isolados

- Concentre seletores em `selectors.ts`; nunca espalhe strings CSS pelo código.
- Prefira atributos estruturais e visíveis a classes ofuscadas voláteis.
- Trate `null` em cada `querySelector`: markup muda sem aviso.

## Proibições (privacidade e segurança)

O CleanFeed classifica **apenas o texto editorial do post**. Um adapter
**NÃO PODE**:

- **Coletar dados de autor** — nome, handle, avatar, URL de perfil, conexões
  ou qualquer identificador de pessoa. `extractPost` retorna somente o texto do
  post; jamais preencha campos com dados do autor.
- **Chamar APIs privadas/internas** da plataforma, endpoints não-documentados,
  GraphQL interno ou qualquer requisição de rede pelo conteúdo do post. Toda a
  extração é feita **do DOM já renderizado**, offline.
- Ler `localStorage`/cookies/tokens da plataforma ou exfiltrar qualquer dado.
- Usar `eval`, `new Function` ou `innerHTML` — proibidos em `src/`. Use
  `textContent` e a criação programática de nós.

## Fixtures obrigatórias

Todo adapter **precisa** de uma fixture HTML determinística em
`tests/fixtures/<plataforma>-*.html`, cobrindo os formatos de post reais
(curto, longo, com links, patrocinado, repost, expandido etc.). Os testes de
unidade carregam a fixture com `DOMParser` e validam extração e restauração —
sem depender de rede nem da plataforma ao vivo. Veja
`tests/fixtures/linkedin-feed.html` e `tests/fixtures/generic-adapter.html`.

## Apresentação: delegue ao PresentationController

`applyPresentation` e `restorePresentation` **DEVEM delegar** ao
`PresentationController` compartilhado (`src/content/presentation/`). O
controller é o dono da apresentação reversível: guarda o estado original em um
`WeakMap`, aplica o modo (indicador/blur/collapse/hide) respeitando o teto de
ação da decisão, insere o botão "Mostrar publicação" acessível e restaura o nó
byte a byte. **Nunca** reimplemente blur/collapse/hide, badges ou lógica de
restauração dentro do adapter — isso quebra reversibilidade e acessibilidade.
Um adapter só decide _onde_ (qual elemento); o controller decide _como_.

## Registro

Registrar é o único passo de integração:

```ts
const registry = new PlatformRegistry([new LinkedInAdapter()]);
registry.register(new MinhaPlataformaAdapter(presentationController));
```

`registry.match(url)` devolve o adapter dono da URL (ou `null`). Ids duplicados
lançam erro. Nenhum módulo de inferência/armazenamento precisa ser tocado.

## Manifest: host permission restrita

Adicione **apenas** o host da plataforma às `host_permissions`/`matches` do
content script no `manifest`. Use o padrão mais estreito possível
(`https://*.exemplo.com/*`), nunca `<all_urls>`. Sem permissão de host = sem
acesso ao DOM daquela plataforma.

## Checklist de restore e acessibilidade

Antes de considerar o adapter pronto, confirme com testes:

- [ ] `restorePresentation` devolve o nó ao estado **original** (class, style,
      `aria-hidden`, `hidden`, `inert`) e remove todo nó próprio (badge,
      toolbar, placeholder).
- [ ] Aplicar → revelar → restaurar mantém o post e seu conteúdo **conectados**
      ao DOM (nada é removido de forma destrutiva).
- [ ] O controle de revelar é operável por teclado (Tab/Enter) e o foco não cai
      no `<body>` ao revelar.
- [ ] O placeholder de conteúdo filtrado anuncia via região `aria-live`
      **apenas uma vez** por sessão.
- [ ] Nenhum dado de autor aparece no `ExtractedPost`.
- [ ] Fixture cobre os formatos reais de post.

## Exemplo completo (somente documentação/teste — não vai para o bundle)

O adapter abaixo é um exemplo copiável de um fórum genérico. Ele **não** é
importado por nenhum caminho de produção; vive apenas neste guia e nos testes
(`tests/unit/platforms/registry.test.ts`,
`tests/integration/sample-adapter-contract.test.ts`).

```ts
import { PresentationController } from "@/content/presentation/presentation-controller";
import type { EffectiveSettings } from "@/shared/settings-types";
import type {
  ClassificationResult,
  ExtractedPost,
  PlatformAdapter,
} from "@/shared/types";

// Seletores isolados: o único lugar que conhece o markup do fórum.
const SELECTORS = {
  feedRoot: "[data-test-root='thread']",
  post: ".thread-post",
  body: ".post-body",
} as const;

export class SampleForumAdapter implements PlatformAdapter {
  readonly id = "sample-forum";

  // A apresentação é sempre delegada ao controller compartilhado.
  constructor(private readonly presentation: PresentationController) {}

  matches(url: URL): boolean {
    return url.hostname === "forum.example";
  }

  findFeedRoot(document: Document): HTMLElement | null {
    return document.querySelector<HTMLElement>(SELECTORS.feedRoot);
  }

  findPostElements(root: ParentNode): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(SELECTORS.post)];
  }

  isPostElement(element: HTMLElement): boolean {
    return element.matches(SELECTORS.post);
  }

  extractPost(element: HTMLElement): ExtractedPost | null {
    if (!this.isPostElement(element)) return null;
    const body = element.querySelector<HTMLElement>(SELECTORS.body);
    // Apenas o texto do post. NUNCA dados de autor.
    const text = body?.textContent?.trim() ?? "";
    if (text.length === 0) return null;
    return { platform: this.id, text, element };
  }

  applyPresentation(
    element: HTMLElement,
    result: ClassificationResult,
    settings: EffectiveSettings,
  ): void {
    // Delega: o controller é dono da apresentação reversível e acessível.
    this.presentation.apply(element, result, settings);
  }

  restorePresentation(element: HTMLElement): void {
    this.presentation.restore(element);
  }
}
```
