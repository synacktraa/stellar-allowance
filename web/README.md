# web

The interface: a landing page that runs the demo live, and a dashboard an owner creates and
manages allowances from. Deployed at
[stellar-allowance.vercel.app](https://stellar-allowance.vercel.app).

## How an allowance is created

The owner signs once. The agent's keypair is generated in the browser during that same step and
its secret is shown one time; nothing stores it. The rest is the interface reading the chain and
submitting what was signed.

![Sequence diagram in two groups. In the browser: the owner gives a name, a deposit, a cap, a
window and the URLs the agent may pay; the interface fetches each URL and reads its payout
address, asks a Soroban RPC for the instance entries of sixty derived addresses to find the
first free index, and hands the deploy transaction to Freighter, which the owner approves once.
The network: the signed envelope is submitted, the allowance runs its constructor, and the
interface returns the contract id and the agent secret, shown once.](assets/create-flow.svg)

Fetching those URLs happens in `/api/offer`, not on the page. Sellers send no cross-origin
headers, so a browser cannot read a 402 for itself. That route holds no keys, signs nothing, and
makes the same unpaid GET anyone can make.

Nobody is asked which index to use. Sixty addresses are derived from the owner, their contract
instance entries are fetched in one `getLedgerEntries` call, and the first address that answers
with nothing is where the next allowance goes.

## Running it

The SDK is linked from `../sdk`, so build it once before the first run.

```bash
npm --prefix ../sdk install && npm --prefix ../sdk run build
npm install
npm run dev
```

## Environment

Nothing here holds a key. The demo generates every keypair it uses per run and discards it.

| | |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | absolute base for the link preview. Defaults to `http://localhost:3000` |
| `SELLER_URL` | the x402 API the demo pays |
| `WASM_URL` | the contract release the demo deploys from |
| `BAKE_URL` | which host `npm run bake` records a run against |

## Tests

```bash
npm test              # unit
npx playwright test   # end to end, against a dev server it starts itself
npm run bake          # re-record the run the landing page loads with
```
