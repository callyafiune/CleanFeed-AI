import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// `rejects.toThrow()` sem argumento aceita QUALQUER erro, inclusive um estouro posterior por
// motivo nenhum a ver com o cenario. Uma auditoria de mutacao mostrou o efeito: com a guarda
// desligada, `it("refuses an unfinished ledger")` seguia verde, porque a execucao ia adiante e
// morria mais tarde. O teste vizinho, escrito igual, era pego — nao por criterio, e sim porque
// ali desligar a guarda fazia o comando concluir. O veredito dependia de haver estouro posterior,
// nao do que o teste afirma.
//
// Daqui em diante a assercao tem de nomear o que recusa: `toMatchObject({ code })` para erro
// codificado, ou `toThrow(/.../)` quando o que importa e a mensagem.
//
// O detector cobre `rejects.toThrow()` E o sincrono `expect(() => f()).toThrow()`, porque a falha
// e a mesma nos dois. Nao ha sitio sincrono a consertar hoje — a arvore esta em zero —, e a guarda
// existe para o que alguem escreva amanha.
//
// `.not.toThrow()` fica FORA: aquilo afirma que nada estourou, e nao existe erro a nomear. A
// distincao nao e cosmetica. Eu contei 22 sitios sincronos "pelados" com um regex que so excluia o
// prefixo `rejects`, escrevi no registro que a guarda era metade, e ao LER os 22 vi que todos eram
// `.not.toThrow()` — uso correto. A contagem sem leitura produziu o achado errado.
const PELADO = /(?<!\.not)\s*\.\s*toThrow\s*\(\s*\)/u;

const AQUI = dirname(fileURLToPath(import.meta.url));

describe("assertion discipline", () => {
  it("detects both bare forms and accepts the specified ones", () => {
    // O detector e provado contra amostra, nao so contra a arvore: uma arvore limpa passaria
    // por um detector que nunca casa com nada.
    expect(PELADO.test("await expect(f()).rejects.toThrow();")).toBe(true);
    expect(PELADO.test("await expect(f()).rejects.toThrow( );")).toBe(true);
    expect(PELADO.test("expect(() => f()).toThrow();")).toBe(true);

    expect(PELADO.test("expect(() => f()).not.toThrow();")).toBe(false);
    expect(PELADO.test("await expect(f()).rejects.toThrow(/CODE/u);")).toBe(
      false,
    );
    expect(PELADO.test("expect(() => f()).toThrow(ClusterFoldError);")).toBe(
      false,
    );
    expect(
      PELADO.test('await expect(f()).rejects.toMatchObject({ code: "X" });'),
    ).toBe(false);
  });

  it("no suite asserts merely that something threw", async () => {
    // Este arquivo e excluido porque as amostras do detector acima SAO o padrao proibido,
    // escritas como string. Excluir a si mesmo e o preco de provar o detector aqui.
    const nomes = (await readdir(AQUI)).filter(
      (nome) =>
        nome.endsWith(".test.ts") && nome !== "assertion-discipline.test.ts",
    );
    expect(nomes.length).toBeGreaterThan(0);

    const infratores: string[] = [];
    for (const nome of nomes) {
      const linhas = (await readFile(join(AQUI, nome), "utf8")).split(/\r?\n/u);
      linhas.forEach((linha, indice) => {
        if (PELADO.test(linha)) infratores.push(`${nome}:${indice + 1}`);
      });
    }
    expect(infratores).toEqual([]);
  });
});
