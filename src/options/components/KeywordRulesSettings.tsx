import { useEffect, useState } from "react";

import type { KeywordRulesApi } from "@/options/api-types";
import { KeywordRuleEditor } from "@/options/components/KeywordRuleEditor";
import { validateRegexPattern } from "@/rules/regex-safety";
import type { KeywordRule, KeywordRuleAction } from "@/rules/rule-engine";

const MATCH_LABELS: Record<string, string> = {
  contains: "Contém",
  exact: "Exata",
  regex: "Regex",
};

const ACTION_LABELS: Record<KeywordRuleAction, string> = {
  label: "Rotular",
  blur: "Desfocar",
  collapse: "Recolher",
  hide: "Ocultar",
};

const TRUNCATE_STYLE: React.CSSProperties = {
  display: "inline-block",
  maxWidth: "24ch",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  verticalAlign: "bottom",
};

type EditorState =
  { mode: "closed" } | { mode: "create" } | { mode: "edit"; rule: KeywordRule };

function safetyError(rule: KeywordRule): string | null {
  if (rule.matchType !== "regex") return null;
  const safety = validateRegexPattern(rule.pattern);
  return safety.safe ? null : (safety.reason ?? "UNSAFE_REGEX");
}

/**
 * Lists the personal keyword rules and drives create / edit / enable-disable /
 * delete against the repository. The pattern is shown VISUALLY truncated (CSS
 * ellipsis) while the full text remains the element's text content, so screen
 * readers and per-row controls always expose the complete pattern. Deletion is
 * an explicit two-step confirmation; a regex rule the safety analyzer rejects is
 * surfaced with its reason so the user can see why it stays disabled.
 */
export function KeywordRulesSettings({ api }: { api: KeywordRulesApi }) {
  const [rules, setRules] = useState<KeywordRule[]>([]);
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load through an inline async task (setState only after `await`) so the
  // initial fetch never triggers a synchronous state update inside the effect.
  const refresh = (): Promise<void> =>
    api.list().then(
      (loaded) => {
        setRules(loaded);
        setError(null);
      },
      () => setError("Não foi possível carregar as regras."),
    );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const loaded = await api.list();
        if (active) {
          setRules(loaded);
          setError(null);
        }
      } catch {
        if (active) setError("Não foi possível carregar as regras.");
      }
    })();
    return () => {
      active = false;
    };
  }, [api]);

  const handleSubmit = (rule: KeywordRule) => {
    const persist =
      editor.mode === "edit" ? api.update(rule) : api.create(rule);
    void persist
      .then(() => {
        setEditor({ mode: "closed" });
        return refresh();
      })
      .catch(() => setError("Não foi possível salvar a regra."));
  };

  const toggleEnabled = (rule: KeywordRule) => {
    void api
      .update({ ...rule, enabled: !rule.enabled })
      .then(refresh)
      .catch(() => setError("Não foi possível atualizar a regra."));
  };

  const confirmDelete = (id: string) => {
    void api
      .remove(id)
      .then(() => {
        setPendingDelete(null);
        return refresh();
      })
      .catch(() => setError("Não foi possível excluir a regra."));
  };

  return (
    <section aria-labelledby="keyword-rules-heading">
      <h2 id="keyword-rules-heading">Regras personalizadas</h2>
      <p>
        Regras aplicam uma ação com base no texto do post. Elas são separadas da
        detecção por IA e nunca alteram a pontuação do modelo.
      </p>

      {editor.mode === "closed" ? (
        <button type="button" onClick={() => setEditor({ mode: "create" })}>
          Criar regra
        </button>
      ) : (
        <KeywordRuleEditor
          initialRule={editor.mode === "edit" ? editor.rule : null}
          onCancel={() => setEditor({ mode: "closed" })}
          onSubmit={handleSubmit}
        />
      )}

      {error === null ? null : <p role="alert">{error}</p>}

      <table aria-label="Regras personalizadas">
        <thead>
          <tr>
            <th scope="col">Padrão</th>
            <th scope="col">Tipo</th>
            <th scope="col">Ação</th>
            <th scope="col">Situação</th>
            <th scope="col">Ações</th>
          </tr>
        </thead>
        <tbody>
          {rules.length === 0 ? (
            <tr>
              <td colSpan={5}>Nenhuma regra cadastrada.</td>
            </tr>
          ) : (
            rules.map((rule) => {
              const unsafe = safetyError(rule);
              return (
                <tr key={rule.id}>
                  <td>
                    <span style={TRUNCATE_STYLE} title={rule.pattern}>
                      {rule.pattern}
                    </span>
                    {unsafe === null ? null : (
                      <span role="alert">
                        {" "}
                        Regra desativada: padrão inseguro ({unsafe}).
                      </span>
                    )}
                  </td>
                  <td>{MATCH_LABELS[rule.matchType] ?? rule.matchType}</td>
                  <td>{ACTION_LABELS[rule.action]}</td>
                  <td>{rule.enabled ? "Ativa" : "Desativada"}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => setEditor({ mode: "edit", rule })}
                    >
                      Editar regra: {rule.pattern}
                    </button>
                    <button type="button" onClick={() => toggleEnabled(rule)}>
                      {rule.enabled ? "Desativar" : "Ativar"} regra:{" "}
                      {rule.pattern}
                    </button>
                    {pendingDelete === rule.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => confirmDelete(rule.id)}
                        >
                          Confirmar exclusão
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(null)}
                        >
                          Cancelar exclusão
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPendingDelete(rule.id)}
                      >
                        Excluir regra: {rule.pattern}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </section>
  );
}
