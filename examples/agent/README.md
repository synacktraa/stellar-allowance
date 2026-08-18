# A buying agent with an allowance

An agent that pays for API calls and holds no money. It asks a contract, and the contract
decides.

Nothing here is specific to one allowance — `agent.mjs` is a placeholder, because the file you
want is generated with your own contract id already in it.

## Run it

**1. Get the file.** On the Stellar Allowance user tab, step 06, press copy on the code block.
Paste it over `agent.mjs`.

**2. Add the agent's secret.** Copy `.env.example` to `.env` and fill in `AGENT_SECRET` — the key
shown once in step 02.

**3. Buy something.**

```bash
npm start -- <your-paid-url>
```

Dependencies are already installed, and `package.json` sets `"type": "module"`, so the ESM
imports work from `agent.mjs` directly.

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
network, so a blocked purchase never becomes a transaction.

## The rules that can refuse it

| | |
|---|---|
| `#4` | agent revoked |
| `#5` | over the per-call cap |
| `#6` | recipient not on the allowlist |
| `#7` | over the window cap |
| `#10` | the allowance is empty |

## Why the secret is safe in a file

The agent's account has no USDC trustline, so it cannot hold the asset it spends. Its only route
to money is asking the allowance, and the allowance refuses anything outside the rules the owner
set. Losing this key loses the agent, not the funds — which is the entire point.

Testnet only.
