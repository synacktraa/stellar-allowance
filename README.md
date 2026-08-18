# Stellar Allowance

## Hero

Your agents can spend. Your budget can't.

Set three limits: max per transaction, max per day, which vendors get paid. Your AI agent can't break these rules — the contract won't let it. Failed API retries won't spiral your costs. No code changes needed.

- **Rules enforce themselves** (no clever workarounds)
- **Agents hold zero funds** (can't be hacked for your money)
- **Try it in 15 minutes** on testnet

---

## The Problem

### For API Builders

You want to charge per call. But you're stuck between two bad choices:

- **Monthly subscriptions** are simple but unfair — heavy users subsidize light ones, and you leave money on the table
- **Per-call billing** sounds great, but then what? You need a middleman to split fees, handle disputes, and ensure developers actually get paid. That's more infrastructure, more trust required, more fees eating into margins

And developers still worry: *"Will the platform actually pay me? Can they change the rules? What if they go under?"*

### For AI Builders

You deploy agents to do work. They need to spend money — calling APIs, renting compute, buying data. But then:

- **Failed requests retry automatically** — each retry is a real cost. A network hiccup becomes a $50 mistake
- **Bugs get expensive fast** — a loop in your agent's logic spirals costs before you notice
- **You're watching constantly** — no real spending guardrails, just alerts after money's already gone

---

## The Solution

Stellar Allowance puts your money in a **contract that your agent cannot break out of**.

Instead of handing an agent a wallet and hoping for the best, you set three rules:

1. **Max per transaction** — this one purchase can't exceed $X
2. **Max per rolling window** — this agent can't spend more than $Y per day/hour
3. **Approved vendors** — only these addresses can be paid

The agent asks the contract for permission before every transaction. If the purchase breaks any rule, the contract says no. Money doesn't move. The agent's code has zero say in it.

### For API Builders

**You get:**
- Developers can call your API with confidence — they know their costs are capped
- You charge per call, instantly and fairly
- Developer payouts are automatic and verifiable on-chain
- Fee splits are locked in at setup — you can't cheat, the platform can't cheat, and developers don't have to trust anyone

### For AI Builders

**You get:**
- Cost guarantees — your agent can't spend more than you allow, period
- No surprises — retries, bugs, and unexpected API costs just bounce off your limits
- Zero custody risk — agents never hold your funds, so there's nothing to steal
- No code changes — works with any agent, any framework

---

## How It Works

### The Simple Flow

```
You set three rules
    ↓
You deposit money into a contract
    ↓
Your agent asks the contract before each purchase
    ↓
Contract checks: Does this break a rule?
    ↓
YES → Transaction blocked, no money moves
NO → Money flows, agent gets what it needs
```

### Why This Actually Works

**Agents hold zero funds.**  
Your agent doesn't own a wallet. It can't receive, hold, or move money. It can only *ask* the contract to pay on its behalf. That's it. No private keys to leak, no wallet to hack.

**Rules are unchangeable.**  
The spending limits are built into the contract when you create it. You can't change them later. Nobody can. They're rules the blockchain itself enforces. Your agent can't negotiate around them, and neither can anyone else.

**Retries stop costing.**  
Every failed API call that auto-retries is normally a duplicate charge. With Stellar Allowance, the contract sees the limit being approached and refuses the extra requests. Your agent just gets an error and stops — no runaway bill.

**For APIs: Developers trust the math, not you.**  
When a developer sets up an allowance, they see the fee split written into the contract. That split is permanent. It can't be changed, can't be stolen, can't be "updated with new terms." The blockchain is the contract. No lawyers needed.

---

## Who It's For

### API Platforms

- Offering per-call pricing models (AI APIs, data services, compute)
- Want to attract price-conscious developers
- Need instant, verifiable developer payouts
- Don't want to run a financial settlement system yourself

**Example:** You build an image generation API. You want to charge $0.01 per image. Developers want to know they'll be charged fairly and paid instantly. Set up Stellar Allowance, and every call triggers a micropayment. Developers see their costs in real time. No friction, no delays, no disputes.

### AI & Agent Builders

- Running autonomous agents that make API calls
- Worried about cost spirals from retries or bugs
- Want hard spending ceilings that actually work
- Building agentic workflows that need guardrails

**Example:** You're building an AI agent that does research—calling multiple APIs, buying datasets, renting GPUs. You can afford to spend up to $100. You set Stellar Allowance to cap spend at $100 per day, max $10 per API call. Your agent runs overnight. No matter what happens—retries, bugs, unexpected rate changes—it can't spend more than $100. You wake up, it's done, no surprises.

---

## Key Features

### Spending Limits That Actually Block Spending

Set a max per transaction. Your agent hits a vendor that starts charging too much? Blocked. A retrying request loops 10 times? The first 9 go through, the 10th hits the daily cap and fails. That's it. No workarounds, no clever hacks.

### Automatic Fee Splits (For APIs)

Running an API marketplace? You charge $0.10 per call. $0.07 goes to the developer, $0.03 is your platform fee. That split is written into a contract at creation. Every call, money splits automatically. The developer doesn't have to wait for you to process payouts. The platform fee is guaranteed. No manual settlement, no arguments.

### Permissionless Payouts

Developers can trigger their own payouts anytime. The platform can trigger payouts. Anyone can. It doesn't matter — the rules are locked in. Money always goes to exactly two addresses: developer wallet and platform wallet. Nothing else is possible.

### Zero-Custody Agents

Your agent doesn't hold funds. Period. It has no Stellar trustline, no ability to receive USDC. It can only ask the contract to spend on its behalf. That means:

- No wallet to compromise
- No funds to steal
- No private keys to rotate
- Simpler compliance (you're not holding customer assets)

### On-Chain Verification

Every transaction is on the Stellar blockchain. Every limit check, every payment split, every refusal — it's all there. Transparent, auditable, verifiable. Developers can prove they were charged fairly. You can prove payouts went out. No black boxes.

---

## Get Started

### Try It in 15 Minutes

No credit card. Everything runs on Stellar testnet.

**You need:**
- Node 22+
- A free Supabase account
- 15 minutes

**The contracts are already deployed.** You don't need Rust, you don't need to compile anything. Everything is ready to run locally.

**Step 1: Clone and install**
```bash
git clone https://github.com/synacktraa/stellar-allowance
cd stellar-allowance
npm run install:web
```

**Step 2: Set up Supabase (free, no card)**
- Create a project at supabase.com
- Copy three values into `web/.env.local`
- We have a docs for exactly which three and where they live

**Step 3: Create accounts and tables**
```bash
npm run setup && npm run migrate
```

**Step 4: Get testnet USDC**
- Run `setup` prints two addresses
- Go to faucet.circle.com → Stellar Testnet
- Send 5 USDC to each address

**Step 5: Start it**
```bash
npm run dev
```

Then seed the demo:
```bash
npm run seed-demo   # in a second terminal
```

You now have:
- A demo API that charges per call
- A demo agent that buys from that API
- The UI to create your own agents and test spending limits
- Full transparency into how money moves

That's it. No mainnet, no real money, no risk. Just see how it works.

---

## Use Cases

### Use Case 1: AI Research Agent

You're building an AI that reads research papers, summarizes them, and buys access to databases for deeper dives.

**Setup:**
- Allowance of $200/day
- Max $50 per database purchase
- Approved vendors: Paper API, DataWorld, ResearchHub

**What happens:**
- Agent calls Paper API (within limit) → approved
- Agent needs fresh data → calls DataWorld ($40) → approved
- Retrying request hits same vendor twice → second call rejected (would exceed daily cap)
- Agent completes research with $195 spent
- You didn't have to babysit it

### Use Case 2: Developer Marketplace

You built a platform where freelance developers can sell code snippets, templates, or AI models.

**Setup:**
- Per-download fee: $2.99
- Developer gets: $2.39
- Platform takes: $0.60
- Fee split is locked in the contract

**What happens:**
- Buyer downloads a snippet
- $2.99 is paid
- Contract automatically splits: $2.39 to developer wallet, $0.60 to platform
- No settlement delays, no "when do I get paid" questions
- Developer can trigger their own payout anytime

### Use Case 3: Multi-Step Workflow

You're running a complex agent: fetch data from API-A, transform with API-B, upload to storage-C, notify via API-D.

**Setup:**
- Total budget: $50/workflow
- Max per API: $15 (no single call surprises)
- Approved APIs: A, B, C, D only

**What happens:**
- Workflow runs through all four APIs
- Each stays under $15
- Total spend: $42
- Unused $8 stays in the account for next run
- No retries spiral costs

---

## Technical Details

### For the Curious

Stellar Allowance uses two smart contracts:

**Allowance Contract**
Holds the owner's funds and enforces the three rules. You create one per agent owner. The owner is named in the same transaction that deploys it — it's never unowned, and you don't need XLM to claim it. The platform pays the deployment fee and has no other control.

**Splitter Contract**
One per registered API. When a payment comes in, it automatically splits between developer and platform. The split is permanent and permissionless — anyone can trigger payouts, but money can only ever reach those two addresses.

Both contracts are Rust-based, compiled to WebAssembly, and deployed on Stellar testnet. You can inspect them, audit them, or run tests locally. No black boxes.

### Performance

Verified on chain:

- **Throughput:** 6 transactions tested (5 approved, 1 rejected by limits)
- **Speed:** 4.6–9.0 seconds per purchase (mean 6.9s)
  - Quote approval: 0.4–1.2s
  - Ledger wait: 2.8–6.8s
  - Delivery: 1.4–2.0s
- **Accuracy:** Limits enforced correctly, fee splits exact, no orphaned funds

---

## Important Notes

### Testnet Only (For Now)

Stellar Allowance is built and verified on **testnet**. It's ready to try, ready to learn from, ready to build with. Don't put mainnet funds behind it yet.

When you're ready to go live, the same code works on mainnet, but we recommend waiting for:
- Audit results
- More time in production environments
- Mainnet launch of any dependent services

### No Surprises

- **Unaudited:** This is early. Use it to learn, experiment, and understand the model. Don't gamble with production money yet.
- **Testnet USDC only:** You can't lose real money; you can only learn.
- **Open source:** Read the code, run the tests, verify the contracts yourself.

---

## FAQ

**Q: Can the platform change the fee split after I set it up?**  
A: No. The split is locked in the contract at creation. It's immutable. The platform can't change it, the owner can't change it, nobody can. It's why developers can trust it.

**Q: What if my agent malfunctions and hits a limit?**  
A: The contract rejects the transaction, money doesn't move, and your agent gets an error. That's the whole point. The limit stops bad behavior at the contract level, not after the fact.

**Q: Do I need to understand blockchain or Stellar?**  
A: No. You set limits, you deposit money, your agent or API runs. The blockchain is working behind the scenes, but you interact with it the same way you'd interact with any payment system.

**Q: Can I deploy this myself?**  
A: Yes. It's open source (Apache 2.0). Deploy on any Node.js host. On Vercel, set the root directory to `web` and copy your environment variables. Detailed deploy docs are in the repo.

**Q: What if the testnet USDC has no real value?**  
A: Correct. That's the whole idea. Experiment with zero risk. When Stellar launches mainnet USDC support and you're confident, you migrate. Same code, real money.

**Q: How much does it cost to run?**  
A: Stellar transaction fees are tiny (~0.00001 XLM ≈ $0.000001). Database hosting (Supabase free tier) is free for small deployments. Scaling up is cheap. The expensive part isn't the infrastructure — it's the API calls your agents make.

**Q: Can I integrate this with my existing API/agent?**  
A: Yes. No code changes needed for agents (they already make HTTP calls). For APIs, you add a single endpoint that checks the contract before approving a payment. Detailed integration guides are in the docs.

---

## Next Steps

1. **Try it:** Clone the repo, run through the 15-minute setup, play with the demo.
2. **Read the contracts:** Dive into the Rust code if you want to understand how rules are enforced.
3. **Build:** Create your own allowance, your own agent, your own API. Use testnet USDC as much as you want.
4. **Feedback:** Found a bug? Want a feature? Open an issue or reach out.

When you're ready for mainnet, we'll be here to help you scale.

---

## Resources

- **[GitHub Repository](https://github.com/synacktraa/stellar-allowance)** — Full source code, contracts, setup instructions
- **[CONTRACT.md](docs/CONTRACT.md)** — Deep dive into the contract design, authorization model, and known traps
- **Testnet Faucet:** [faucet.circle.com](https://faucet.circle.com) for testnet USDC
- **Stellar Docs:** [developers.stellar.org](https://developers.stellar.org)

---

**License:** Apache 2.0

**Status:** Unaudited. Testnet only. Not for production use yet.
