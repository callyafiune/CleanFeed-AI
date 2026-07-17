import type { ReactNode } from "react";

export function PrivacyNotice({ children }: { children?: ReactNode }) {
  return (
    <section aria-labelledby="privacy-heading">
      <h2 id="privacy-heading">Privacidade</h2>
      <p>
        A análise é local. A extensão não envia texto, autor, URL ou conteúdo da
        página para servidores externos.
      </p>
      <p>
        Textos curtos são ignorados por padrão. Resultados são probabilísticos e
        podem gerar falsos positivos ou falsos negativos.
      </p>
      <p>
        O histórico permanece desativado e nenhum texto integral é armazenado
        por padrão.
      </p>
      {children}
    </section>
  );
}
