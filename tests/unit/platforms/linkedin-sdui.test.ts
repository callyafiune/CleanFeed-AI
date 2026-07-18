import { describe, expect, it } from "vitest";

import { LinkedInAdapter } from "@/platforms/linkedin/linkedin-adapter";

// A faithful slice of the current LinkedIn Server-Driven UI (SDUI) feed markup:
// hashed classes are omitted (they are never selected on); the post is anchored
// on role/componentkey/aria-label/data-testid, and a comment is nested inside
// the same list item (as LinkedIn now renders it) to prove separation.
const SDUI_FEED = `
<main id="workspace">
  <div role="list" data-testid="mainFeed" data-component-type="LazyColumn">
    <div role="listitem" componentkey="expandedABC123FeedType_MAIN_FEED_RELEVANCE">
      <h2><span>Publicação no feed</span></h2>
      <button type="button" aria-label="Abrir menu de controle da publicação de Fulano Autor"></button>
      <a href="https://www.linkedin.com/in/fulano-autor/"><span>Fulano Autor</span></a>
      <p componentkey="feed-commentary_uuid-1"><span data-testid="expandable-text-box">Primeira linha do post sobre um tema qualquer.<br><br>Segunda parte com uma menção <a href="/in/mencionado/"><strong>Pessoa Mencionada</strong></a> e mais conteúdo relevante para análise.</span></p>
      <button type="button" aria-label="Comentar"><span>15</span></button>
      <button type="button" aria-label="Compartilhar"><span>14</span></button>
      <a aria-label="Enviar" href="#"></a>
      <div componentkey="commentsSectionContainerABC123FeedType_MAIN_FEED_RELEVANCE">
        <div componentkey="replaceableComment_urn:li:comment:(x,y)">
          <p componentkey="comment-commentary_uuid-2"><span data-testid="expandable-text-box">Texto de um comentario que jamais deveria ser extraido como corpo do post.</span></p>
        </div>
      </div>
    </div>
  </div>
</main>`;

function render(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

describe("LinkedInAdapter — SDUI feed", () => {
  it("detects an SDUI feed post via role/componentkey anchors", () => {
    const adapter = new LinkedInAdapter();
    const posts = adapter.findPostElements(render(SDUI_FEED));

    expect(posts).toHaveLength(1);
    expect(posts[0]?.getAttribute("componentkey")).toContain(
      "FeedType_MAIN_FEED",
    );
  });

  it("extracts the post body only — never a comment, never the author", () => {
    const adapter = new LinkedInAdapter();
    const post = adapter.findPostElements(render(SDUI_FEED))[0]!;

    const extracted = adapter.extractPost(post);
    expect(extracted).not.toBeNull();
    const text = extracted!.text;

    expect(text).toContain("Primeira linha do post");
    expect(text).toContain("conteúdo relevante para análise");
    // The nested comment body must never be taken as the post text.
    expect(text).not.toContain("comentario que jamais deveria ser extraido");
    // Neither the post author nor an inline @mention profile name is captured.
    expect(text).not.toContain("Fulano Autor");
    expect(text).not.toContain("Pessoa Mencionada");
  });

  it("never treats a comment subtree as a post", () => {
    const adapter = new LinkedInAdapter();
    const root = render(SDUI_FEED);
    const comment = root.querySelector<HTMLElement>(
      "[componentkey^='replaceableComment_']",
    );

    expect(comment).not.toBeNull();
    expect(adapter.isPostElement(comment!)).toBe(false);
  });
});
