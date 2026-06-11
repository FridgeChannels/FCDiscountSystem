# Dynamic Game Onboarding Runbook

This runbook covers end-to-end local testing:

1. Create game template in admin API
2. Create game instance for a customer
3. Run FC flow: reward-plan -> session/start -> session/complete -> redeem

## 0) Prerequisites

- `fc-platform` engine is running and reachable from BFF (`ENGINE_BASE_URL`).
- BFF has Supabase admin credentials if you want to create template/instance:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Restart BFF after editing env or server code.

## 1) Check runtime catalog

Only runtimes in catalog can be used for dynamic template creation.

```bash
curl -s "http://localhost:3001/api/admin/runtime-catalog" | jq
```

## 2) Create game template

```bash
curl -s -X POST "http://localhost:3001/api/admin/game-templates" \
  -H "content-type: application/json" \
  -d '{
    "templateKey":"match_product_to_scene_v2",
    "name":"Match Product To Scene V2",
    "description":"A/B version of match gameplay",
    "runtimeComponent":"MatchGameRuntime",
    "runtimeTier":"react_dom",
    "gameType":"timing",
    "interactionType":"tap"
  }' | jq
```

Response contains `template.id`, required by next step.

## 3) Create game instance for customer

```bash
curl -s -X POST "http://localhost:3001/api/admin/game-instances" \
  -H "content-type: application/json" \
  -d '{
    "customerId": 1,
    "templateId": "<PUT_TEMPLATE_ID_HERE>",
    "instanceKey": "clovia_match_v2",
    "name": "Clovia Match V2",
    "brandTheme": { "primary":"#E91E63", "logo":"clovia_logo.png" },
    "contentConfig": { "itemSet":"clovia_lingerie_v2", "pairs":6 },
    "defaultDifficultyProfile": { "rounds":4, "choicesPerRound":4, "timePerRound":8, "targetScore":80 }
  }' | jq
```

## 4) Validate it appears in engine config view

```bash
curl -s "http://localhost:3001/api/admin/customers/1/engine-config" | jq '.gameInstances[] | {id,instance_key,name}'
```

## 5) Play flow verification (Gate 7 API path)

Use touchId in your seeded data:

```bash
export TOUCH_ID="A8SQN3V2OW"
```

```bash
# reward plan
curl -s "http://localhost:3001/api/fc/reward-plan?touchId=${TOUCH_ID}" | tee /tmp/fc-plan.json | jq

# start session (replace rewardPlanId / gameInstanceId)
curl -s -X POST "http://localhost:3001/api/fc/session/start" \
  -H "content-type: application/json" \
  -d "{
    \"rewardPlanId\":\"$(jq -r '.rewardPlanId' /tmp/fc-plan.json)\",
    \"gameInstanceId\":\"$(jq -r '.recommendedGames[0].gameInstanceId' /tmp/fc-plan.json)\"
  }" | tee /tmp/fc-start.json | jq

# complete session
curl -s -X POST "http://localhost:3001/api/fc/session/complete" \
  -H "content-type: application/json" \
  -d "{
    \"sessionId\":\"$(jq -r '.sessionId' /tmp/fc-start.json)\",
    \"completed\":true,
    \"rawScore\":100,
    \"accuracy\":1,
    \"durationSeconds\":25
  }" | jq

# redeem (campaignId fallback from plan)
curl -s -X POST "http://localhost:3001/api/fc/coupons/redeem" \
  -H "content-type: application/json" \
  -d "{
    \"rewardPlanId\":\"$(jq -r '.rewardPlanId' /tmp/fc-plan.json)\",
    \"campaignId\":\"$(jq -r '.targetCampaignId // .currentCampaignId // .campaignId' /tmp/fc-plan.json)\"
  }" | jq
```

## 6) Important limitation (current architecture)

Dynamic creation currently supports **new template/instance using existing runtime components**.

If you need a truly brand-new runtime component, you must add it to:

- `server/runtime-manifest.js` (`RUNTIME_CATALOG`)
- `src/lib/runtimeRegistry.js` (loader map / fallback map)

Then redeploy FCDiscountSystem web+BFF.
