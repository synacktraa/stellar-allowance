# Live payment plan

**Goal:** one payment on Stellar testnet, made by an agent from an allowance it does not own,
to an API at a public URL, settled by a facilitator nobody on this project runs.

**Architecture:** three parties, and only one of them is ours.

| | what | who runs it |
|---|---|---|
| seller | a Next.js route protected with `withX402`, on Vercel | us, for the demo |
| facilitator | verifies the payload, submits the transaction, pays the fee | OpenZeppelin |
| agent | a script using `@stellar-allowance/sdk` | us, locally |

**Tech stack:** Next.js on Vercel, `@x402/next` 2.25.0, `stellar-cli` 27.1.0, the SDK by
`file:` link so it is exercised before anything is published.

This is the phase the whole positioning rests on. Until a payment settles, "an allowance is
the missing contract-account signer in someone else's x402 stack" is a claim about code that
has never met a counterparty.

---

## Outcome

The payment settled on 2026-09-07. Transaction
`574370730f5f1616f56beec3b99c6714a1325aea8065e195fa8959a90e7c69a5`, payer
`CD7MXKE263USEVT7ECVUAFH2PSDTHVKRNWHUOF5AQZNDNAVXWO43T4TC`, which is the allowance contract
and not any account. The facilitator paid the fee. All three refusal rules were then proven
on chain in `bbd283e`.

Two details here did not survive the run. Task 3 creates `sdk/test/e2e/deploy.mjs`; the
deploy became a step inside `setup.mjs`. The failure table in Task 6 names a first and a
second simulation; there is one, for the reason recorded on
[the SDK plan](2026-09-06-sdk.md#outcome).

---

## What is already established

Measured 2026-09-07, not assumed.

**The facilitator exists and takes exactly our kind.**

```
GET https://channels.openzeppelin.com/x402/testnet/supported
Authorization: Bearer <key from https://channels.openzeppelin.com/testnet/gen>

{"kinds":[{"extra":{"areFeesSponsored":true},
           "network":"stellar:testnet",
           "scheme":"exact",
           "x402Version":2}],
 "signers":{"stellar:testnet":["GCNJB6V5YIODDSSCWXZ2VOKMRPRVZ2V723RRQS6STXE6NWTGVOJY35CN"]}}
```

`areFeesSponsored: true` is the flag `ExactAllowanceScheme` refuses payments without. The
signer held 7731 XLM, so it is live rather than a stub. `x-api-key` is rejected; the header is
`Authorization: Bearer`.

**The key is already generated** and sits in `sdk/test/e2e/.env.local`, covered by
`.gitignore:16` (`.env*.local`), confirmed with `git check-ignore`.

**USDC on testnet is a wrapped classic asset.**
`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` is the SAC for
`USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, verified with
`stellar contract id asset`. A G account holding it needs a trustline. A contract holding it
does not, because contract balances live in the token's own storage.

**The CLI can deploy at a chosen salt.** `stellar contract deploy --salt <hex>` exists, which
means the allowance can be deployed at the address `deriveAllowanceAddress` computes, and the
two can be compared.

## What is not established

**Whether the facilitator settles a contract-account payment.** Its `/supported` says it takes
the kind. Nothing says it has ever seen a `from` that is a `C` address, and the transaction it
builds has to carry our auth entry untouched. This is the single thing this phase exists to
find out, and it is the most likely place to fail.

**Whether Circle's testnet faucet can be scripted.** Task 2 assumes a browser visit.

**Whether Vercel needs anything unusual** for a route that calls out to a facilitator on every
402.

---

## Decisions this plan makes

**USDC, with a named fallback.** It is what the facilitator lists as a default asset, what a
reviewer recognizes, and what `price: "$0.01"` converts to without extra code. The cost is one
manual faucet visit. If the faucet blocks us, Task 2b issues our own SAC-wrapped asset and the
seller declares an explicit `AssetAmount` instead of a dollar price. The demo's claim does not
depend on which token moves.

**The seller lives at `demo/seller/`.** It is a deployable, not an example to copy, and it is
not the allowance interface that comes later. Keeping it out of `web/` leaves that name free.

**Secrets go file to CLI to Vercel.** The owner secret, the agent secret and the facilitator
key never appear in the conversation, in a commit, or in a log line. `sdk/test/e2e/.env.local`
is the local home; Vercel's environment holds the seller's copy.

**The e2e runner is not in CI.** It needs funded accounts and a live third party. It runs by
hand, and what it produces is recorded in the repo as transaction hashes.

---

## Phase 1: the fixtures

### Task 1: Accounts

**Files:**
- Modify: `sdk/test/e2e/.env.local` (gitignored)
- Create: `sdk/test/e2e/README.md`

- [ ] **Step 1: Three keypairs**

  Owner, seller payout, and the agent. Generated locally, written straight to `.env.local`,
  never echoed:

  ```bash
  stellar keys generate --network testnet --fund e2e-owner
  stellar keys generate --network testnet --fund e2e-seller
  ```

  The agent's keypair is not a Stellar account and must not be funded. It is a raw ed25519 key
  that only ever signs auth payloads. Generate it with the SDK's own dependency so the demo
  uses the same path the interface will:

  ```bash
  node -e "const {Keypair}=require('@stellar/stellar-sdk');const k=Keypair.random();
    console.log('agent public:', k.publicKey())" # secret written to .env.local by the script
  ```

- [ ] **Step 2: Record the public halves**

  `sdk/test/e2e/README.md` names the owner address, the seller payout address, the agent
  public key and the allowance address once Task 3 produces it. Public halves only.

- [ ] **Step 3: Verify**

  ```bash
  stellar keys address e2e-owner
  curl -s "https://horizon-testnet.stellar.org/accounts/$(stellar keys address e2e-owner)" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).balances))"
  ```

  Expected: the owner funded with 10000 XLM, the agent address absent from Horizon.

### Task 2: USDC into the owner

- [ ] **Step 1: Trustline**

  ```bash
  stellar tx new change-trust \
    --source e2e-owner --network testnet \
    --line USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
  ```

- [ ] **Step 2: Faucet**

  Circle's testnet faucet, by hand, to the owner address. This is the one step in the phase
  that cannot be scripted.

- [ ] **Step 3: Verify, and stop here if it failed**

  The owner's balances must include USDC. If the faucet is unavailable or rate limited, go to
  Task 2b rather than working around it.

### Task 2b: Fallback, our own asset

Only if Task 2 is blocked.

- [ ] **Step 1: Issue and wrap**

  A new issuer account, an asset code, a trustline from the owner, a payment, then
  `stellar contract asset deploy --asset <CODE>:<issuer>` to get its SAC address.

- [ ] **Step 2: Carry the change forward**

  The seller declares `price: { asset, amount }` rather than `"$0.01"`, because the default
  money parser assumes USDC. Everything else in this plan is unchanged.

### Task 3: Deploy the allowance at its derived address

This task double-checks Task 1 of the SDK plan against reality: the address the CLI deploys to
must be the address `deriveAllowanceAddress` computed offline.

**Files:**
- Create: `sdk/test/e2e/deploy.mjs`

- [ ] **Step 1: Compute the address and the salt first**

  ```js
  import { deriveAllowanceAddress, generateAllowanceSalt } from '@stellar-allowance/sdk';

  const owner = process.env.E2E_OWNER_ADDRESS;
  const salt = generateAllowanceSalt(owner, 0).toString('hex');
  const expected = deriveAllowanceAddress({ owner, index: 0 });
  console.log('salt   ', salt);
  console.log('expects', expected);
  ```

- [ ] **Step 2: Deploy with that salt**

  The wasm is the released `allowance-contract-v0.2.0` artifact, downloaded from the release
  rather than built locally, because a local build omits the `source_repo` and `version` meta
  and produces different bytes.

  ```bash
  stellar contract upload --wasm allowance.wasm --source e2e-owner --network testnet
  stellar contract deploy \
    --wasm-hash <hash> --salt <salt from step 1> \
    --source e2e-owner --network testnet \
    -- --setup '{
      "owner": "<owner>",
      "agent_key": "<agent public key as 32 hex bytes>",
      "name": "Research agent",
      "spending": { "token": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
                    "initial_deposit": "5000000" },
      "rules": { "window_ledgers": 17280, "window_cap": "2000000",
                 "allowlist": ["<seller payout address>"] }
    }'
  ```

  `initial_deposit` is 0.5 USDC in stroops; the window cap is 0.2. Both are deliberately small,
  and the cap is below the deposit so Task 7 can exceed the window without exhausting the
  balance.

  `agent_key` is the raw ed25519 public key, not the G address. Deriving one from the other is
  the asymmetry recorded in the contract's own docs.

- [ ] **Step 3: Verify the address matches**

  The address the CLI prints must equal `expected` from step 1. If it does not, stop: either
  the salt convention or the derivation is wrong, and every later step would be built on it.

- [ ] **Step 4: Verify the allowance holds what it should**

  ```bash
  stellar contract invoke --id <allowance> --source e2e-owner --network testnet -- get_config
  ```

  Expected: the owner, the agent key, the name, the token, the rules, `enabled: true`.

---

## Phase 2: the seller

### Task 4: A paid route, running locally

**Files:**
- Create: `demo/seller/` (Next.js app), `demo/seller/app/api/quote/route.ts`
- Create: `demo/seller/.env.local` (gitignored)

- [ ] **Step 1: The route**

  ```ts
  import { NextRequest, NextResponse } from 'next/server';
  import { HTTPFacilitatorClient } from '@x402/core/server';
  import { withX402, x402ResourceServer } from '@x402/next';
  import { ExactStellarScheme } from '@x402/stellar/exact/server';

  const facilitator = new HTTPFacilitatorClient({
    url: process.env.FACILITATOR_URL!,
    // Keyed by path. A flat { Authorization } object throws rather than silently
    // dropping auth on every request.
    createAuthHeaders: async () => {
      const headers = { Authorization: `Bearer ${process.env.FACILITATOR_KEY}` };
      return { verify: headers, settle: headers, supported: headers };
    },
  });

  const server = new x402ResourceServer(facilitator)
    .register('stellar:testnet', new ExactStellarScheme());

  const handler = async (_: NextRequest) =>
    NextResponse.json({ quote: 'XLM/USD 0.1043', at: new Date().toISOString() });

  export const GET = withX402(
    handler,
    {
      '/api/quote': {
        accepts: {
          scheme: 'exact',
          network: 'stellar:testnet',
          price: '$0.01',
          payTo: process.env.SELLER_PAYOUT_ADDRESS!,
        },
        description: 'One price quote',
      },
    },
    server,
  );
  ```

  `withX402` rather than `paymentProxy`, because it settles only after the handler returns
  under 400. A proxy charges for failures.

- [ ] **Step 2: Verify the 402 by hand**

  ```bash
  curl -s -D- http://localhost:3000/api/quote -o /dev/null
  ```

  Expected: `402`, and a `PAYMENT-REQUIRED` header. The requirements are in that header, not in
  the body; the JSON body path is x402 v1 only. Decode it and check `network`, `payTo`, `asset`
  and `extra.areFeesSponsored`.

- [ ] **Step 3: Verify the facilitator was actually reached**

  `areFeesSponsored` in the response comes from the facilitator's `/supported`, not from our
  config. If it is absent, the auth headers are wrong and the seller fell back to defaults.

### Task 5: On Vercel

- [ ] **Step 1: Deploy**

  Environment variables set through the Vercel CLI or dashboard, never pasted into the repo or
  this conversation: `FACILITATOR_URL`, `FACILITATOR_KEY`, `SELLER_PAYOUT_ADDRESS`.

- [ ] **Step 2: Verify the public URL 402s**

  The same curl against the deployed URL. Record the URL in `sdk/test/e2e/README.md`.

- [ ] **Step 3: Check CORS**

  Ask for the 402 with an `Origin` header. A browser-based interface will need this later, and
  finding out now is free.

---

## Phase 3: the payment

### Task 6: Pay it

**Files:**
- Create: `sdk/test/e2e/pay.mjs`

- [ ] **Step 1: The runner**

  ```js
  import { Allowance, AllowanceRefused } from '@stellar-allowance/sdk';

  const { fetch } = new Allowance();               // reads STELLAR_ALLOWANCE_ID and _SECRET
  try {
    const res = await fetch(process.env.E2E_PAID_URL);
    console.log(res.status, await res.text());
  } catch (error) {
    if (error instanceof AllowanceRefused) console.log('refused:', error.rule, error.detail);
    else throw error;
  }
  ```

  The SDK is linked by `file:` path, not installed from npm, because nothing is published yet.

- [ ] **Step 2: Run it**

  Expected: `200` and the quote body.

  This is the step that either proves the phase or does not. The likely failure modes, in the
  order they would appear:

  | where | what it would mean |
  |---|---|
  | first simulation | the allowance holds no USDC, or the token address is wrong |
  | `authorizeEntry` | our signature shape is wrong after all |
  | second simulation | a rule refused, which is `AllowanceRefused` and correct behavior |
  | facilitator `verify` | it rejects a `from` that is a contract |
  | facilitator `settle` | it rebuilt the transaction and dropped our auth entry |

  The last two are the ones nothing so far has tested.

- [ ] **Step 3: Verify on chain, not in the response**

  Take the transaction hash from the `PAYMENT-RESPONSE` header and read it from Horizon.
  Confirm the USDC moved from the allowance to the seller payout address, and that the fee was
  paid by the facilitator's signer rather than by anything of ours.

- [ ] **Step 4: Verify the window moved**

  ```bash
  stellar contract invoke --id <allowance> --source e2e-owner --network testnet -- spent_in_window
  ```

  Expected: the amount just paid. This is the rule doing its job, read off the chain.

### Task 7: The three refusals, on chain

Each one proves a rule fired in the contract rather than a check in the client. This is also
the first time `refusalFrom` meets real host output rather than strings written by hand.

- [ ] **Step 1: Off the allowlist**

  Point the seller's `payTo` at an address the allowance does not allow, or deploy a second
  seller route. Expected: `AllowanceRefused`, rule `allowlist`, discriminant 102.

- [ ] **Step 2: Over the window**

  Raise the route's price above `window_cap`. Expected: rule `window`, discriminant 106.

- [ ] **Step 3: Stopped**

  ```bash
  stellar contract invoke --id <allowance> --source e2e-owner --network testnet -- disable
  ```

  Expected: rule `stopped`, discriminant 107. Then `enable` again.

- [ ] **Step 4: Record the real messages**

  Paste the actual host error text into `sdk/test/e2e/README.md`. If the format differs from
  what `refusals.test.mjs` assumes, the parser is wrong and the fix belongs in the SDK with a
  test case taken from the real string.

### Task 8: Evidence

- [ ] **Step 1: Write it down**

  `sdk/test/e2e/README.md` gets the seller URL, the allowance address, the transaction hash for
  the successful payment, and the three refusals with their discriminants. Public values only.

- [ ] **Step 2: Commit**

  `git commit -m "test(sdk): pay a live x402 API from an allowance"`

---

## Phase 4: what it changes

### Task 9: Fold it back

- [ ] **Step 1: Fix whatever the live run found**

  Anything discovered in Phase 3 lands as its own commit with a test, not as a patch to the e2e
  script. The build and simulate path in `scheme.ts` currently has no test at all, so a real
  failure there is the first evidence it has ever had.

- [ ] **Step 2: Update the PR**

  [#15](https://github.com/synacktraa/stellar-allowance/pull/15) says the build and simulate
  path is unproven. Replace that section with the transaction hash and the seller URL.

- [ ] **Step 3: The README**

  Task 9 of the SDK plan, now writable with a working example rather than an imagined one.

- [ ] **Step 4: Publish**

  Only after all of the above, and only by the user. `publishConfig.access` is already
  `public`, without which the first publish is refused with an error about paid plans.

---

## What this phase does not do

**No facilitator of our own.** OpenZeppelin's is running, takes our kind, and a third party
settling the payment is stronger evidence than one we control.

**No allowance creation flow.** The allowance is deployed with the CLI here. Creating one from
a browser with Freighter is the web interface's job.

**No seller that stays up forever.** The Vercel deployment exists to be pointed at in a PR and
a grant application. If it goes away, the transaction hashes remain.
