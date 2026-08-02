#!/usr/bin/env bash
# BATIMENTO PERMANENTE — a correção da camada 4, que dependia de eu lembrar de armar.
#
# O problema medido (2026-08-02, duas vezes): o interruptor de homem morto funcionava, mas
# tinha de ser armado ao fim de cada turno. Falhar em armá-lo é a MESMA falha volitiva que ele
# existia para cobrir. Um mecanismo que depende do agente lembrar não conserta esquecimento.
#
# Este roda uma vez por sessão e nunca precisa ser rearmado: escreve uma sentinela a cada
# intervalo, para sempre, até ser morto. Assim NUNCA existe um turno sem fonte de despertar
# pendente — a decisão "continuar ou parar" passa a ser tomada ACORDADO, ao receber o
# batimento, e não no fim do turno, que é quando eu erro.
#
# Feito só de mecanismos provados neste ambiente: nohup + sentinela + Monitor persistent.
# NADA de cron, que aqui nunca disparou.
#
# Uso:   nohup bash batimento.sh [intervalo_segundos] > /dev/null 2>&1 &
# Parar: pkill -f batimento.sh   (ou TaskStop no id, se lançado pela ferramenta)
set -u
INTERVALO="${1:-1200}"
# Derivado, nao absoluto: o script vive versionado e tem de funcionar em qualquer clone.
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LOG="${RAIZ}/.codex-reviews/.sentinelas.log"
mkdir -p "$(dirname "$LOG")"
N=0
while true; do
  sleep "$INTERVALO"
  N=$((N + 1))
  # O token casa o padrão do Monitor vivo (`CONCLUIDA|VEREDITO|FALHOU`), medido — sentinela
  # que não casa cai num log que ninguém observa.
  echo "===BATIMENTO-CONCLUIDA n=${N} intervalo=${INTERVALO}s===" >> "$LOG"
done
