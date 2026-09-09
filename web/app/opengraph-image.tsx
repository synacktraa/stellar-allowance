import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Give the agent an allowance. Keep the wallet.';

// The same tokens as the page, so the preview cannot drift from what it links to.
export default async function OpengraphImage() {
  const lora = await readFile(join(process.cwd(), 'app/lora-600.woff'));

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#ebe9e2',
          color: '#0f0f0f',
          padding: 72,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          fontFamily: 'Lora',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 22, letterSpacing: 4 }}>
          <span>STELLAR//ALLOWANCE</span>
          <span
            style={{
              padding: '9px 15px',
              fontSize: 18,
              color: 'rgba(15, 15, 15, 0.7)',
              border: '1px solid rgba(15, 15, 15, 0.3)',
            }}
          >
            TESTNET · UNAUDITED
          </span>
        </div>

        <div style={{ fontSize: 84, lineHeight: 1.05, maxWidth: 900, display: 'flex' }}>
          Give the agent an allowance. Keep the wallet.
        </div>

        <div style={{ display: 'flex', gap: 2 }}>
          <div style={{ background: '#0f0f0f', color: '#d6d3c4', padding: '18px 26px', fontSize: 44, display: 'flex', alignItems: 'baseline', gap: 14 }}>
            0.000
            <span style={{ fontSize: 18, color: '#f9f9f9' }}>USDC held by the agent</span>
          </div>
          <div style={{ background: '#e9e5f7', padding: '18px 26px', fontSize: 22, display: 'flex', alignItems: 'center' }}>
            refused · allowlist
          </div>
          <div style={{ background: '#f9f9f9', padding: '18px 26px', fontSize: 22, display: 'flex', alignItems: 'center' }}>
            refused · window
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: 'Lora', data: lora, weight: 600, style: 'normal' }] },
  );
}
