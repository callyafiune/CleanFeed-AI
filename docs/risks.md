# Registro de riscos

Riscos conhecidos do CleanFeed AI e como são contidos. Cada linha traz o
**responsável** (quem monitora e decide a resposta), o **sinal** (como o risco se
manifesta e é observado) e a **mitigação** (o que já está no produto ou é a ação
esperada). O registro é vivo: revise-o a cada mudança relevante de plataforma ou
de modelo.

| Risco                             | Responsável             | Sinal                                                                                     | Mitigação                                                                                                              |
| --------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Drift do DOM da plataforma        | Mantenedor do adaptador | Selos deixam de aparecer; extração retorna vazio; fixtures divergem do markup ao vivo.    | Seletores isolados em `selectors.ts`; tratamento de `null`; fixtures determinísticas; revisão dos seletores.           |
| Idioma fora do escopo             | Dono do modelo          | Texto não-pt-BR classificado; distribuição de score sem sentido.                          | Suporte declarado a pt no metadata; calibração por idioma; textos fora do idioma tendem à abstenção.                   |
| Tamanho de texto (curto/longo)    | Dono do modelo          | Conclusões frágeis em textos curtos; truncamento em textos muito longos.                  | Mínimo configurável ignora textos curtos; calibração por faixa de tamanho (`actionCeiling`); chunking com limite.      |
| Drift do modelo                   | Dono do modelo          | Calibração não bate com o artefato ativo; qualidade cai após atualização.                 | Calibração versionada por 5 coordenadas; falha de correspondência cai em perfil conservador não calibrado.             |
| Falsos positivos                  | Dono do produto         | Conteúdo humano marcado/filtrado; reclamação do usuário.                                   | Métrica principal é a precisão entre bloqueados; ação só acima do limiar e do teto de calibração; reversível.          |
| Falsos negativos                  | Dono do produto         | Conteúdo de IA não marcado.                                                               | Aceito por design: o produto prefere errar para o lado de não agir; linguagem probabilística; recall reportado à parte. |
| ReDoS em regras regex do usuário  | Mantenedor de regras    | Regra regex trava a avaliação; uso de CPU alto.                                            | Validador estático rejeita formas perigosas; compilação em worker descartável com kill-switch; flags restritas.        |
| Cota de armazenamento             | Mantenedor de storage   | `chrome.storage.local` perto do limite; escritas falham.                                  | Cache e histórico com teto de entradas e retenção; paginação; `clear()` determinístico; texto completo só sob opt-in.  |
| Novos geradores e paráfrase       | Dono do modelo          | Textos de geradores recentes ou parafraseados escapam ao TMR; recall cai após drift.       | TMR é candidato PT-BR/LinkedIn revalidado por novo holdout temporal; perfis expiram em 180 dias; fallback só indica.    |
| Texto misto (humano + IA)         | Dono do modelo          | Trechos localizados de IA em post majoritariamente humano; sinal global do documento fraco. | Faixa `50–79` e trigger apenas localizado permanecem indicator; ação exige sinal global do documento e ≥ 80 palavras.  |
| TMR tratado como validado         | Dono do release         | Bundle roda no smoke e é confundido com detector aprovado antes da evidência.               | Rollout governado por decisão selada; gate de publicação falha fechado em `pending`; nenhuma acurácia publicada.        |

## Riscos aceitos explicitamente

- **Nenhuma métrica de qualidade** é afirmada enquanto o backend for o mock. O
  produto não deve ser usado para decisões sobre pessoas.
- **Falsos negativos** são preferíveis a falsos positivos: agir sobre incerteza é
  o pior resultado, então o teto de ação é conservador por padrão.
