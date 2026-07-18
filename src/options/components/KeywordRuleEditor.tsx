import { useState } from "react";

import { validateRegexPattern } from "@/rules/regex-safety";
import type {
  KeywordMatchType,
  KeywordRule,
  KeywordRuleAction,
} from "@/rules/rule-engine";

interface KeywordRuleEditorProps {
  initialRule: KeywordRule | null;
  onSubmit: (rule: KeywordRule) => void;
  onCancel: () => void;
}

const MATCH_TYPES: readonly { value: KeywordMatchType; label: string }[] = [
  { value: "contains", label: "Contém" },
  { value: "exact", label: "Correspondência exata" },
  { value: "regex", label: "Expressão regular" },
];

const ACTIONS: readonly { value: KeywordRuleAction; label: string }[] = [
  { value: "label", label: "Rotular" },
  { value: "blur", label: "Desfocar" },
  { value: "collapse", label: "Recolher" },
  { value: "hide", label: "Ocultar" },
];

const PLATFORMS: readonly { id: string; label: string }[] = [
  { id: "linkedin", label: "Aplicar no LinkedIn" },
  { id: "manual", label: "Aplicar em análises manuais" },
];

const SAFETY_MESSAGES: Record<string, string> = {
  EMPTY_PATTERN: "Informe uma expressão regular.",
  PATTERN_TOO_LONG: "A expressão regular é muito longa.",
  BACKREFERENCE: "Retrocedências (\\1) não são permitidas.",
  NAMED_BACKREFERENCE: "Retrocedências nomeadas não são permitidas.",
  LOOKBEHIND: "Lookbehind não é permitido.",
  NESTED_QUANTIFIER: "Quantificadores aninhados podem travar o navegador.",
  AMBIGUOUS_ALTERNATION: "Alternância ambígua pode travar o navegador.",
  ADJACENT_QUANTIFIERS: "Quantificadores adjacentes podem travar o navegador.",
};

function generateId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (typeof uuid === "string") return uuid;
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isKnownPlatform(
  value: string,
): value is (typeof PLATFORMS)[number]["id"] {
  return PLATFORMS.some((platform) => platform.id === value);
}

/**
 * Form to create or edit one keyword rule. A regex pattern is validated with the
 * pure {@link validateRegexPattern} safety analyzer BEFORE the rule leaves the
 * form, so an unsafe pattern surfaces an inline error and is never submitted (it
 * never compiles or runs here). The pattern itself is never evaluated in the UI.
 */
export function KeywordRuleEditor({
  initialRule,
  onSubmit,
  onCancel,
}: KeywordRuleEditorProps) {
  const [pattern, setPattern] = useState(initialRule?.pattern ?? "");
  const [matchType, setMatchType] = useState<KeywordMatchType>(
    initialRule?.matchType ?? "contains",
  );
  const [action, setAction] = useState<KeywordRuleAction>(
    initialRule?.action ?? "label",
  );
  const [caseSensitive, setCaseSensitive] = useState(
    initialRule?.caseSensitive ?? false,
  );
  const [enabled, setEnabled] = useState(initialRule?.enabled ?? true);
  const [platforms, setPlatforms] = useState<string[]>(
    initialRule?.platforms ?? ["linkedin"],
  );
  const [error, setError] = useState<string | null>(null);

  const togglePlatform = (id: string, checked: boolean) => {
    setPlatforms((current) =>
      checked
        ? [...new Set([...current, id])]
        : current.filter((platform) => platform !== id),
    );
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = pattern.trim();
    if (trimmed.length === 0) {
      setError("Informe uma palavra ou expressão.");
      return;
    }
    if (platforms.length === 0) {
      setError("Selecione ao menos uma plataforma.");
      return;
    }
    if (matchType === "regex") {
      const safety = validateRegexPattern(trimmed);
      if (!safety.safe) {
        const reason = safety.reason ?? "";
        setError(
          SAFETY_MESSAGES[reason] ??
            "A expressão regular não é segura e não pode ser salva.",
        );
        return;
      }
    }
    setError(null);
    onSubmit({
      id: initialRule?.id ?? generateId(),
      pattern: trimmed,
      matchType,
      caseSensitive,
      action,
      platforms: [...platforms],
      enabled,
    });
  };

  return (
    <form
      aria-label={initialRule === null ? "Nova regra" : "Editar regra"}
      onSubmit={submit}
    >
      <label>
        Palavra ou expressão
        <input
          aria-label="Palavra ou expressão"
          maxLength={256}
          type="text"
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
        />
      </label>
      <label>
        Tipo de correspondência
        <select
          aria-label="Tipo de correspondência"
          value={matchType}
          onChange={(event) =>
            setMatchType(event.target.value as KeywordMatchType)
          }
        >
          {MATCH_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Ação
        <select
          aria-label="Ação"
          value={action}
          onChange={(event) =>
            setAction(event.target.value as KeywordRuleAction)
          }
        >
          {ACTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          checked={caseSensitive}
          type="checkbox"
          onChange={(event) => setCaseSensitive(event.target.checked)}
        />
        Diferenciar maiúsculas de minúsculas
      </label>
      <fieldset>
        <legend>Plataformas</legend>
        {PLATFORMS.map((platform) => (
          <label key={platform.id}>
            <input
              checked={platforms.includes(platform.id)}
              type="checkbox"
              onChange={(event) =>
                isKnownPlatform(platform.id) &&
                togglePlatform(platform.id, event.target.checked)
              }
            />
            {platform.label}
          </label>
        ))}
      </fieldset>
      <label>
        <input
          checked={enabled}
          type="checkbox"
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Ativar regra
      </label>
      {error === null ? null : <p role="alert">{error}</p>}
      <button type="submit">Salvar regra</button>
      <button type="button" onClick={onCancel}>
        Cancelar
      </button>
    </form>
  );
}
