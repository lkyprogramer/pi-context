#!/usr/bin/env bash
set -euo pipefail
rm -rf out; mkdir out
javac -d out $(find src/main/java src/test/java -name '*.java' | sort)
java -cp out com.acme.order.OrderServiceTest
