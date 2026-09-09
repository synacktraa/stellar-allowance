# Web design

**Status:** design agreed 2026-09-08, not yet implemented.

Directory `web/`, deployed to Vercel. It is where an allowance id comes from. The SDK's README
assumes one exists, and until this interface does, nobody can obtain one.

## Who it is for, and what it has to do

One reader first: someone who already runs an agent and wants it to pay for things without
handing it a wallet. The page answers in that reader's own words, which are an agent account,
an allowance, and permission to take care of things.

The value is shown rather than claimed. The agent never holds the money. The allowance is a
contract, and the limit is enforced by the chain rather than by the agent's code. `@x402/core`
ships spend controls of its own, and they are client side, so an agent can ignore them. That is
the sentence no client side limit can say.

The channel is one email, so the page has one reader before it has an audience. The ask is
sized to zero trust: click once and watch, with no wallet, nothing to install and nothing to
sign. The email does discover. The page does understand and trust. The create flow is try,
which is why it is a second page and not the hero.

Features appear in the order they matter: the agent holds nothing, nothing of ours is in the
payment path, the allowlist, and the window last.

## The demo

Self-provisioning, the way `sdk/test/e2e/setup.mjs` is. A server route generates an owner and
an agent keypair, funds the owner from friendbot, adds the USDC trustline, swaps 10 XLM for
USDC on the testnet DEX, and deploys an allowance at its derived address with the seller as the
only allowlisted address and a 0.025 USDC cap on a 24 hour window. Then it pays four times:

```
pay the seller 0.01        settled, the payer is the contract
told to pay a stranger     refused: allowlist, at simulation, nothing leaves the contract
pay the seller 0.01        settled, 0.02 in the window
pay the seller 0.01        refused: window, 0.03 would exceed 0.025
```

The stranger is a fresh random address handed to `scheme.createPaymentPayload` as `payTo`
inside the seller's own requirements. The contract refuses before any facilitator is involved.

The route streams one event per step as server-sent events, and the page renders each event as
a row that resolves in place. The page loads with a completed run baked at build time, so there
is proof on screen before there is a wait, and the button starts a fresh one.

The server holds no secrets. Every key is generated inside a run and discarded with it. The
route needs two public values: the seller URL and the wasm release URL. One run at a time per
instance. Friendbot's rate limit is the ceiling, and a run that hits it says so in its last
row.

## The create flow

`/create`. Freighter connects, the network is checked against testnet, and the owner's XLM and
USDC balances are read and shown before anything is asked, because a number already on screen
makes "not enough" visible before a transaction fails. The first free index is found the way
`setup.mjs` finds it, in one `getLedgerEntries` call over a window of derived addresses.

The form takes a name, a deposit, a cap, a window and an allowlist. An agent keypair is
generated in the browser. The deploy transaction is signed by Freighter, whose
`signTransaction` returns `{ signedTxXdr, signerAddress }`, the shape the SDK's
`contract.Client` accepts as a signer. If the wasm is not on the network yet, the flow uploads
it first with a second signature.

After deployment the page shows `STELLAR_ALLOWANCE_ID` and `STELLAR_ALLOWANCE_SECRET` once,
with copy buttons, and says the secret will not be shown again. Nothing is stored anywhere.

## Design system

Stellar's own palette, on the light side.

| token | value | used for |
|---|---|---|
| ground | `#ebe9e2` | the page, lightened from Stellar's `bg-warm` |
| surface | `#f9f9f9` | cells and cards |
| ink | `#0f0f0f` | all text, and the one inverted cell |
| yellow | `#fdda24` | solid blocks only: the testnet tag, the one call to action |
| lavender | `#b7ace8` | a refusal, which is the allowance acting |
| cream | `#d6d3c4` | the number inside the inverted cell |
| line | `rgba(15,15,15,.12)` and `.3` | hairlines and the run's frame |

Type: Lora 600 for the headline and 400 for large numbers, Inter for body, IBM Plex Mono for
anything an agent would read: addresses, hashes, amounts, labels. Tabular figures wherever a
number can change. Headlines get `text-wrap: balance`. Fonts are served by `next/font`, so no
request leaves the page for them and a failed fetch cannot produce a silent fallback.

Structure: square corners, hairline borders, cells in a grid with 1px gaps, and one stat cell
inverted to black with a cream number. Yellow never appears as text. A screenprint grain at
4.5% sits on the ground.

Motion: demo rows reveal with a 40ms stagger, the refused chip pulses once, the button scales
to 0.985 on press. Nothing else moves, and `prefers-reduced-motion` turns all of it off.

Care: an SVG favicon that follows the OS theme, and an OG image generated from the same tokens,
because for a link sent by email the preview is the first thing seen.

## Responsive

Fluid type through `clamp`. One column below 720px. From 1024px the hero is two columns,
headline on the left and the stat tile on the right. The run's rows and the stats grid adapt to
their container rather than to the viewport, so the same components hold on a phone and inside
a narrow column on a desktop.

## Testing

The run is an async generator with its network dependencies injected, so the sequence, both
refusals and the failure paths are tested with `node --test` and no network. The index finder
is tested the same way. A Playwright spec loads the page and captures it at four viewports,
which is the proof that it holds at every size.

## Deployment

Vercel, root directory `web`, with files outside the root included so `file:../sdk` resolves.
The build installs and builds the SDK first, because `sdk/dist` is not committed. The first
deploy is a preview URL. `stellar-allowance.vercel.app` serves v1 today, and pointing it here
is a separate decision.

## Not in this phase

Publishing the SDK. Enumerating an owner's allowances, editing rules, disabling, withdrawing. A
seller of its own; the demo pays `xlm-quote-api.vercel.app`. Mainnet.
