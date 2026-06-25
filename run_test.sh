#!/bin/bash
npx --yes kill-port 3000 2>/dev/null
npx tsx server/index.ts > server_test.log 2>&1 &
SERVER_PID=$!
sleep 4
echo "Running Test 1..."
npx playwright test tests/collision_player_building.spec.ts
echo "Running Test 2..."
npx playwright test tests/collision_drone_building.spec.ts
echo "Running Test 3..."
npx playwright test tests/collision_entity_entity.spec.ts
echo "Running Test 4..."
npx playwright test tests/match_ready_handshake.spec.ts
npx --yes kill-port 3000
