import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import manifest from "../../../manifest.config";

describe("README required content", () => {
  it.each([
    "não prova autoria",
    "classificação é probabilística",
    "falsos positivos",
    "falsos negativos",
    "processamento ocorre localmente",
    "MockClassifier não é um detector real",
    "como adicionar uma plataforma",
    "como integrar um modelo",
    // The TMR candidate is framed honestly: probabilistic "signals", a
    // PT-BR/LinkedIn candidate (not a universal detector), and no earned
    // accuracy claim while the decision is pending.
    "sinais compatíveis",
    "detector universal",
    "fallback estilométrico",
    "pending",
  ])("README contains %s", async (phrase) => {
    expect(
      (await readFile("README.md", "utf8")).toLocaleLowerCase("pt-BR"),
    ).toContain(phrase.toLocaleLowerCase("pt-BR"));
  });

  it("points readers to the versioned release-evidence report for any numbers", async () => {
    const readme = await readFile("README.md", "utf8");
    expect(readme).toContain("docs/releases/tmr-ptbr-v1.md");
    expect(readme).toContain("npm run release:evidence");
  });

  it("makes no earned accuracy/quality claim about the TMR in the README", async () => {
    const readme = (await readFile("README.md", "utf8")).toLocaleLowerCase(
      "pt-BR",
    );
    expect(readme).not.toMatch(/acur[áa]cia de \d|precis[ãa]o de \d|\bf1 de\b/u);
  });

  it("documents every manifest permission", async () => {
    const readme = await readFile("README.md", "utf8");
    for (const permission of manifest.permissions ?? [])
      expect(readme).toContain(`\`${permission}\``);
  });
});
