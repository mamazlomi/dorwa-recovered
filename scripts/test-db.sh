#!/usr/bin/env bash
# Spins up a throwaway local Postgres 16, applies the Supabase shim,
# all migrations, the dev seed, then the test suite.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DATA="$(mktemp -d)"
PORT="${PORT:-54329}"
SOCK="$DATA"

cleanup() { "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT

run_as() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$DATA"

run_as "$PGBIN/initdb -D $DATA -U postgres -A trust --locale=C.UTF-8 -E UTF8" >/dev/null
run_as "$PGBIN/pg_ctl -D $DATA -o '-p $PORT -k $SOCK -c listen_addresses=' -l $DATA/log -w start" >/dev/null

PSQL=(psql -h "$SOCK" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -d postgres -c "create database dorva_test" >/dev/null
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/00_local_supabase_shim.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migration: $(basename "$f")"
  "${PSQL[@]}" -d dorva_test -f "$f" >/dev/null
done
echo "seed: seed.sql"
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/seed.sql" >/dev/null
"${PSQL[@]}" -d dorva_test -c "select (select count(*) from pharmacies) pharmacies, (select count(*) from stock_items) stock_rows, (select count(*) from app.offers) public_offers"
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/10_core_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/20_cart_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/30_search_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/40_discount_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/50_pharmacy_panel_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/60_catalog_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/70_filter_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/80_collection_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/90_address_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/95_shipping_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/96_order_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/97_pharmacy_shipping_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/98_staff_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/99_order_rules_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/100_analytics_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/101_pages_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/102_finder_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/103_look_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/104_theme_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/105_round3_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/106_round4_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/107_stock_bulk_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'

"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/108_scan_enrich_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/109_review_services_officers_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/110_moderation_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/111_seo_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/112_notification_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/113_catalog_sync_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/114_product_admin_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
"${PSQL[@]}" -d dorva_test -f "$ROOT/supabase/tests/115_consult_tests.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
[ -n "${DBG:-}" ] && "${PSQL[@]}" -d dorva_test -f "$DBG"
