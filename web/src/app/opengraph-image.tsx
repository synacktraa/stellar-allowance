import { ImageResponse } from 'next/og';

/**
 * The link preview.
 *
 * Generated rather than drawn, so it cannot drift from the page it represents. Only system
 * fonts are used: loading a webfont here would add a network fetch to every card render, and
 * a failed fetch produces a silently wrong image rather than an error.
 */

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt =
  'Stellar Allowance — a spending limit for AI agents, enforced on-chain rather than promised in code';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#060607',
          color: '#ededf0',
          padding: '72px 80px',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 22,
            letterSpacing: 3,
            color: '#8a8d94',
          }}
        >
          <span>STELLAR//ALLOWANCE</span>
          <span
            style={{
              border: '1px solid #2e3138',
              padding: '6px 14px',
              fontSize: 18,
              color: '#8a8d94',
            }}
          >
            STELLAR:TESTNET
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 84,
              lineHeight: 1.02,
              letterSpacing: -3,
              fontWeight: 600,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <span>Give agents an allowance.</span>
            <span>Your costs stay put.</span>
          </div>
          <div style={{ fontSize: 30, color: '#8a8d94', marginTop: 28, maxWidth: 900 }}>
            Set three limits — per purchase, per time frame, and which vendors get paid. Your
            agents can&apos;t break them. Ever.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, fontSize: 20, color: '#060607' }}>
          {['PER-CALL CAP', 'ROLLING WINDOW', 'ALLOWLIST'].map((rule) => (
            <span
              key={rule}
              style={{ background: '#fdda24', padding: '8px 18px', letterSpacing: 2 }}
            >
              {rule}
            </span>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
