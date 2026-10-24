#!/usr/bin/env bash
# Smoke-tests role enforcement against a running API server (default http://localhost:8080).
# Usage: bash scripts/rbac-smoke.sh [base-url]
BASE="${1:-http://localhost:8080}/api"
PASS=0; FAIL=0
J=$(mktemp -d)

check() { # name expected actual
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1 (expected $2, got $3)"; fi
}
code() { # jar method path [json]
  if [ -n "$4" ]; then
    curl -s -o /dev/null -w "%{http_code}" -b "$J/$1" -X "$2" -H "Content-Type: application/json" -d "$4" "$BASE$3"
  else
    curl -s -o /dev/null -w "%{http_code}" -b "$J/$1" -X "$2" "$BASE$3"
  fi
}
body() { curl -s -b "$J/$1" "$BASE$2"; }
login() { curl -s -o /dev/null -c "$J/$1" -X POST -H "Content-Type: application/json" -d "{\"userId\":$2}" "$BASE/auth/login"; }

USERS=$(curl -s "$BASE/auth/demo-users")
uid() { echo "$USERS" | python -c "import sys,json; print(next(u['id'] for u in json.load(sys.stdin) if u['role']=='$1' and '$2' in u['name']))"; }
ADMIN=$(uid admin ""); TEACHER=$(uid teacher "Meera"); OTHER_TEACHER=$(uid teacher "Rahul"); STUDENT=$(uid student "Aarav")
login admin "$ADMIN"; login teacher "$TEACHER"; login other "$OTHER_TEACHER"; login student "$STUDENT"

CLASSES=$(body admin /classes)
MATH=$(echo "$CLASSES" | python -c "import sys,json; print(next(c['id'] for c in json.load(sys.stdin) if 'Math' in c['name']))")
SCI=$(echo "$CLASSES" | python -c "import sys,json; print(next(c['id'] for c in json.load(sys.stdin) if 'Science' in c['name']))")

echo "Anonymous"
check "classes needs sign-in" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/classes")"
check "admin routes need sign-in" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/admin/users")"

echo "Admin console is admin-only"
check "admin can list users" 200 "$(code admin GET /admin/users)"
check "teacher blocked" 403 "$(code teacher GET /admin/users)"
check "student blocked" 403 "$(code student GET /admin/audit)"

echo "Class scoping"
check "teacher sees own class sources" 200 "$(code teacher GET "/materials?classId=$MATH")"
check "teacher blocked from other class" 403 "$(code teacher GET "/materials?classId=$SCI")"
check "student enrolled in class" 200 "$(code student GET "/materials?classId=$MATH")"
check "teacher classes list is filtered" 1 "$(body teacher /classes | python -c 'import sys,json; print(len(json.load(sys.stdin)))')"

echo "Uploads"
SRC='{"title":"Smoke note","sourceName":"smoke","topic":"Smoke","sourceText":"Twelve plus eight equals twenty for the smoke test."}'
check "teacher uploads to own class" 201 "$(code teacher POST /materials "{\"classId\":$MATH,\"title\":\"Smoke note\",\"sourceName\":\"smoke\",\"topic\":\"Smoke\",\"sourceText\":\"Twelve plus eight equals twenty for the smoke test.\"}")"
check "teacher blocked from other class upload" 403 "$(code teacher POST /materials "{\"classId\":$SCI,\"title\":\"x\",\"sourceName\":\"x\",\"topic\":\"x\",\"sourceText\":\"Twelve plus eight equals twenty for the smoke test.\"}")"
check "teacher cannot upload school-level" 403 "$(code teacher POST /materials '{"scope":"school","title":"x","sourceName":"x","topic":"x","sourceText":"Twelve plus eight equals twenty for the smoke test."}')"
check "student cannot upload" 403 "$(code student POST /materials "{\"classId\":$MATH,\"title\":\"x\",\"sourceName\":\"x\",\"topic\":\"x\",\"sourceText\":\"Twelve plus eight equals twenty for the smoke test.\"}")"
check "admin uploads school-level" 201 "$(code admin POST /materials '{"scope":"school","grade":"Grade 10","subject":"Mathematics","title":"Smoke ref","sourceName":"ref","topic":"Smoke","sourceText":"A school reference sentence used only by the smoke test."}')"

echo "Visibility rules"
STUDENT_TITLES=$(body student "/materials?classId=$MATH")
check "student sees published class note" yes "$(echo "$STUDENT_TITLES" | grep -q 'Smoke note' && echo yes || echo no)"
check "student cannot read ai_only school reference" no "$(echo "$STUDENT_TITLES" | grep -q 'Smoke ref' && echo yes || echo no)"
check "teacher reads school reference" yes "$(body teacher "/materials?classId=$MATH" | grep -q 'Smoke ref' && echo yes || echo no)"
NOTE_ID=$(body teacher "/materials?classId=$MATH" | python -c "import sys,json; print(next(m['id'] for m in json.load(sys.stdin) if m['title']=='Smoke note'))")
check "teacher drafts own note" 200 "$(code teacher PATCH "/materials/$NOTE_ID" '{"status":"draft"}')"
check "student no longer sees draft" no "$(body student "/materials?classId=$MATH" | grep -q 'Smoke note' && echo yes || echo no)"
check "other teacher cannot edit it" 403 "$(code other PATCH "/materials/$NOTE_ID" '{"status":"published"}')"

echo "Assignments and submissions"
check "student cannot create assignment" 403 "$(code student POST /assignments "{\"classId\":$MATH,\"title\":\"x\",\"topic\":\"x\",\"dueDate\":\"2030-01-01\",\"questions\":[]}")"
check "student cannot read mastery" 403 "$(code student GET "/learning/mastery?classId=$MATH")"
check "student cannot generate practice" 403 "$(code student POST /learning/practice "{\"classId\":$MATH,\"topic\":\"x\",\"count\":1}")"

echo "Audit"
check "uploads are audited" yes "$(body admin /admin/audit | grep -q 'class_source_added' && echo yes || echo no)"

rm -rf "$J"
echo; echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" -eq 0 ]
