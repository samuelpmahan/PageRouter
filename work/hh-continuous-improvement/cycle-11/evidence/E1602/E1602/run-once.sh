#!/usr/bin/env bash
set +e
for artifact in \
  hh-cycle11/H2/E1602/stdout.raw.txt \
  hh-cycle11/H2/E1602/stderr.raw.txt \
  hh-cycle11/H2/E1602/exit.txt
do
  if [ -e "$artifact" ]; then
    printf 'Refusing to overwrite first-run evidence: %s\n' "$artifact" >&2
    exit 73
  fi
done
node hh-cycle11/H2/E1602/probe.mjs \
  > hh-cycle11/H2/E1602/stdout.raw.txt \
  2> hh-cycle11/H2/E1602/stderr.raw.txt
status=$?
printf '%s\n' "$status" > hh-cycle11/H2/E1602/exit.txt
exit "$status"
