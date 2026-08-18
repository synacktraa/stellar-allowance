# Runner

**This is not an agent.** An agent decides what to buy and why — it reads something, forms an
intent, and acts. This directory has none of that. It is the smallest project that can run one
purchase, so that the interesting file has somewhere to go the moment you copy it.

What it saves you is four steps of setup: a `package.json`, `"type": "module"` so the ESM
imports resolve, the SDK installed, and an env file wired up. All done here already.

## Run it

**1. Get the file.** On the Stellar Allowance user tab, step 06, press copy on the code block.
Paste it over `buy.mjs`. It already contains your allowance's contract id.

**2. Add the agent's secret.** Copy `.env.example` to `.env` and fill in `AGENT_SECRET` — the key
shown once in step 02.

> Leave a newline at the end of `.env`. Node's `--env-file` drops the last line if the file does
> not end with one, and the failure looks like the key was never set rather than like a parsing
> problem. Copying `.env.example` gets this right; hand-editing sometimes does not.

**3. Buy something.**

```bash
npm start -- <your-paid-url>
```

The URL has to be one your allowance is allowed to pay. The user tab lists the allowlist when you
select an allowance; anything else is refused, however small the amount.

## What you should see

A purchase that passes the rules prints the API's own response:

```
200 Keep it logically awesome.
```

One that breaks a rule prints the rule that stopped it, and no money moves:

```
refused — over the window cap
```

The refusal costs nothing. The rules run during simulation, before anything is submitted to the
network, so a blocked purchase never becomes a transaction — which is also why pointing this at a
URL that is *not* on your allowlist is the cheapest way to watch the allowlist work.

## The rules that can refuse it

| | |
|---|---|
| `#4` | agent revoked |
| `#5` | over the per-call cap |
| `#6` | recipient not on the allowlist |
| `#7` | over the window cap |
| `#10` | the allowance is empty |

## Why the secret sits in a file

The agent's account has no USDC trustline, so it cannot hold the asset it spends. Its only route
to money is asking the allowance, and the allowance refuses anything outside the rules the owner
set. Losing this key loses the agent, not the funds — which is the entire point.

Testnet only.
