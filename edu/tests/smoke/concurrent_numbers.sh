#!/usr/bin/env bash
# Complaint numbers under real contention (TEST_SPEC.md, S7.8): PROCS artisan
# processes each file PER complaints in the same district at the same time,
# through whatever DB_CONNECTION / DB_URL the shell exports (the pooled URL in
# S7). Every complaint must be created and every number must be different.
#
#   PROCS=6 PER=10 bash tests/smoke/concurrent_numbers.sh
#
# Needs a database seeded by `php artisan db:seed` (school 1, category 1).
# WRITES complaints with the subject "Concurrency probe" and deletes them again
# at the end. Run it only against a scratch database.
set -uo pipefail
cd "$(dirname "$0")/../.."
PROCS=${PROCS:-6}
PER=${PER:-10}
LOGS=$(mktemp -d)
trap 'rm -rf "$LOGS"' EXIT

PROBE='$s = App\Models\School::with("state", "district")->findOrFail(1); $n = 0;
foreach (range(1, '"$PER"') as $i) {
    App\Models\Complaint::createNumbered($s->state, $s->district, [
        "school_id" => $s->id, "complaint_category_id" => 1, "district_id" => $s->district_id,
        "state_id" => $s->state_id, "anonymous_ref" => "ANON-CONCURRENCY", "submitted_role" => "parent",
        "subject" => "Concurrency probe", "description" => "Concurrency probe for complaint numbers.",
        "status" => "submitted"]);
    $n++;
}
echo "ok=$n\n";'

for i in $(seq 1 "$PROCS"); do
  php artisan tinker --execute "$PROBE" > "$LOGS/$i.log" 2>&1 &
done
wait

failed=0
for i in $(seq 1 "$PROCS"); do
  if grep -q "^ok=$PER$" "$LOGS/$i.log"; then
    echo "process $i: ok=$PER"
  else
    failed=1
    echo "process $i FAILED: $(grep -m1 -oE '[A-Za-z\\]*Exception[^(]{0,160}' "$LOGS/$i.log" || tail -c 300 "$LOGS/$i.log")"
  fi
done

counts=$(php artisan tinker --execute '$q = App\Models\Complaint::where("subject", "Concurrency probe");
echo $q->count(), "|", $q->distinct()->count("complaint_number"), "\n";
App\Models\Complaint::where("subject", "Concurrency probe")->each(function ($c) { $c->statusHistory()->delete(); $c->delete(); });' 2>&1 | tail -1)
want="$((PROCS * PER))|$((PROCS * PER))"
echo "created|distinct numbers: $counts (want $want)"
[[ $failed == 0 && "$counts" == "$want" ]]
