# IntegraÃ§Ã£o de modelos locais

O CleanFeed AI aceita somente bundles locais abaixo de
`chrome-extension://<id>/models/<model-id>/`. O manifesto `cleanfeed-model.json`
declara o contrato do classificador, os labels binÃ¡rios, a licenÃ§a, a origem de
proveniÃªncia, a versÃ£o de calibraÃ§Ã£o e os checksums SHA-256 de cada artefato.

Antes de carregar qualquer modelo, o offscreen passa a URL base local ao
verificador. Ele rejeita manifestos com schema desconhecido, caminhos relativos
inseguros, labels ambÃ­guos, respostas redirecionadas ou de outra origem e hashes
incompatÃ­veis. Nenhuma etapa consulta rede HTTP(S).

O diretÃ³rio `public/models/` fica vazio atÃ© que um candidato licenciado e
calibrado seja fornecido. Enquanto isso, o classificador ativo permanece
`mock-v1`; a presenÃ§a deste contrato nÃ£o afirma a disponibilidade de um detector
real.
