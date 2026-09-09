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

        <div style={{ display: 'flex', gap: 14 }}>
          <div style={{ background: '#0f0f0f', color: '#f2f0e8', padding: '20px 28px', fontSize: 32, display: 'flex', alignItems: 'center' }}>
            agent holds 0.00 USDC
          </div>
          <div style={{ background: '#e9e5f7', color: '#3a2f63', padding: '20px 28px', fontSize: 26, display: 'flex', alignItems: 'center' }}>
            allowance holds the funds and the rules
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: 'Lora', data: lora, weight: 600, style: 'normal' }] },
  );
}
