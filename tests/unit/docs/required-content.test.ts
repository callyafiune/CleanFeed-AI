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
  ])("README contains %s", async (phrase) => {
    expect(
      (await readFile("README.md", "utf8")).toLocaleLowerCase("pt-BR"),
    ).toContain(phrase.toLocaleLowerCase("pt-BR"));
  });

  it("documents every manifest permission", async () => {
    const readme = await readFile("README.md", "utf8");
    for (const permission of manifest.permissions ?? [])
      expect(readme).toContain(`\`${permission}\``);
  });
});
