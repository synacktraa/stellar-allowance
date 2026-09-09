# web

The interface: a landing page that runs the demo live, and a dashboard an owner creates and
manages allowances from. Deployed at
[stellar-allowance.vercel.app](https://stellar-allowance.vercel.app).

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
