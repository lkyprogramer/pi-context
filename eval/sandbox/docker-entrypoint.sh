#!/bin/sh
set -eu
if [ -S /run/pctx/broker.sock ]; then
  socat TCP-LISTEN:8080,bind=127.0.0.1,reuseaddr,fork UNIX-CONNECT:/run/pctx/broker.sock &
fi
exec "$@"
