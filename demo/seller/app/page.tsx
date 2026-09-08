export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: '40rem', margin: '4rem auto', padding: '0 1rem' }}>
      <h1>A paid API</h1>
      <p>
        <code>GET /api/quote</code> answers 402 until it is paid, and 200 with an XLM/USD quote
        once it is. Payments settle on Stellar testnet through an x402 facilitator.
      </p>
      <p>
        It exists so that <a href="https://github.com/synacktraa/stellar-allowance">Stellar
        Allowance</a> has something to pay that it does not control.
      </p>
    </main>
  );
}
