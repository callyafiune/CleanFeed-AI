# Limitações conhecidas

- O adaptador MVP depende da estrutura atual do DOM do LinkedIn; mudanças no
  site podem impedir a detecção ou extração até que os seletores sejam revisados.
- A classificação é mock e determinística nesta fase. Ela não mede autoria,
  qualidade, intenção ou veracidade e não deve ser usada para decisões sobre
  pessoas.
- Mesmo quando houver modelo real, classificações serão probabilísticas e podem
  produzir falsos positivos e falsos negativos.
- Textos abaixo do mínimo configurado são ignorados por padrão para evitar
  conclusões frágeis.
- O filtro automático desta fase está limitado ao LinkedIn. Outros adaptadores
  dependem do mesmo contrato, mas ainda não foram implementados.
