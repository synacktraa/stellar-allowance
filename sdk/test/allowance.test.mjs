import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import { Keypair } from '@stellar/stellar-sdk';
import { Allowance } from '../dist/index.js';

const ID = 'CC7C7SNKQ3R4LOMEFKVMJHK62ZAXC3BCHXV6DA6JY2VHIHWKQ6ATBZS6';
const OTHER = 'CBFEEMMWQVBKM32YXUSSGFUKLKTJVOT5UHPSJNQJIYLQDSCLFXEPIKTT';
const SECRET = Keypair.random().secret();

async function withEnv(values, body) {
  const saved = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  const apply = (pairs) => {
    for (const [key, value] of Object.entries(pairs)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(values);
  try {
    return await body();
  } finally {
    apply(saved);
  }
}

const set = { STELLAR_ALLOWANCE_ID: ID, STELLAR_ALLOWANCE_SECRET: SECRET };
const unset = { STELLAR_ALLOWANCE_ID: undefined, STELLAR_ALLOWANCE_SECRET: undefined };

test('reads the environment', async () => {
  await withEnv(set, () => {
    const allowance = new Allowance();
    assert.equal(allowance.address, ID);
    assert.equal(allowance.scheme.scheme, 'exact');
    assert.equal(typeof allowance.fetch, 'function');
  });
});

test('options beat the environment', async () => {
  await withEnv(set, () => {
    assert.equal(new Allowance({ id: OTHER }).address, OTHER);
  });
});

test('names the variable that is missing', async () => {
  await withEnv(unset, () => {
    assert.throws(() => new Allowance(), /STELLAR_ALLOWANCE_ID/);
  });
  await withEnv({ ...unset, STELLAR_ALLOWANCE_ID: ID }, () => {
    assert.throws(() => new Allowance(), /STELLAR_ALLOWANCE_SECRET/);
  });
});

test('refuses a malformed pair at construction, not at the first payment', async () => {
  await withEnv({ ...set, STELLAR_ALLOWANCE_ID: Keypair.random().publicKey() }, () => {
    assert.throws(() => new Allowance(), /contract address/);
  });
  await withEnv({ ...set, STELLAR_ALLOWANCE_SECRET: 'not a secret' }, () => {
    assert.throws(() => new Allowance());
  });
});

test('fetch survives being pulled off the instance', async () => {
  await withEnv(set, async () => {
    const { fetch } = new Allowance();
    await assert.rejects(() => fetch('http://127.0.0.1:1/nothing'));
  });
});

// x402 v2 carries the requirements in the PAYMENT-REQUIRED header. The body is the v1 form.
async function seller(network, asset) {
  const server = createServer((_req, res) => {
    res.writeHead(402, {
      'content-type': 'application/json',
      'payment-required': encodePaymentRequiredHeader({
        x402Version: 2,
        resource: { url: 'http://127.0.0.1/paid' },
        accepts: [{
          scheme: 'exact',
          network,
          asset,
          amount: '1000',
          payTo: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7',
          maxTimeoutSeconds: 60,
          extra: { areFeesSponsored: true },
        }],
      }),
    });
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/paid`, close: () => server.close() };
}

const USDC_TESTNET = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const OTHER_TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

test('a mainnet 402 goes unpaid', async () => {
  const paid = await seller('stellar:pubnet', USDC_TESTNET);
  try {
    await withEnv(set, async () => {
      const { fetch } = new Allowance();
      await assert.rejects(() => fetch(paid.url), /No network\/scheme registered/);
    });
  } finally {
    paid.close();
  }
});

test('the caller picks the network, not the seller', async () => {
  const paid = await seller('stellar:pubnet', USDC_TESTNET);
  try {
    await withEnv(set, async () => {
      // There is no public mainnet Soroban RPC, so pubnet needs a url either way.
      const { fetch } = new Allowance({
        network: 'stellar:pubnet',
        rpc: { url: 'http://127.0.0.1:1' },
      });
      await assert.rejects(
        () => fetch(paid.url),
        (error) => !/No network\/scheme registered/.test(error.message),
      );
    });
  } finally {
    paid.close();
  }
});

test('the client does not second-guess the owner rules', async () => {
  // x402Client defaults to USDC only and $1 a payment. With those on, a non-default asset
  // is refused here, before any network call.
  const paid = await seller('stellar:testnet', OTHER_TOKEN);
  try {
    await withEnv(set, async () => {
      const { fetch } = new Allowance({ rpc: { url: 'http://127.0.0.1:1' } });
      await assert.rejects(
        () => fetch(paid.url),
        (error) => !/spendControls/.test(error.message),
      );
    });
  } finally {
    paid.close();
  }
});
