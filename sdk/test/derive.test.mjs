import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveAllowanceAddress, generateAllowanceSalt } from '../dist/index.js';

const OWNER = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';

// stellar contract id wasm --salt <salt> --source-account <OWNER>
//   --network-passphrase "Test SDF Network ; September 2015"
const FIXTURES = [
  [0, 'CC7C7SNKQ3R4LOMEFKVMJHK62ZAXC3BCHXV6DA6JY2VHIHWKQ6ATBZS6'],
  [1, 'CBFEEMMWQVBKM32YXUSSGFUKLKTJVOT5UHPSJNQJIYLQDSCLFXEPIKTT'],
  [7, 'CAPWSN6WRLIRHLMPYZMYJ2WHE7XUXEHS2DI5O6FF5CYIAPLWKKNHSHGF'],
];

test('derives the addresses the CLI derives', () => {
  for (const [index, expected] of FIXTURES) {
    assert.equal(deriveAllowanceAddress({ owner: OWNER, index }), expected);
  }
});

test('the salt is 32 bytes and changes with the index', () => {
  const first = generateAllowanceSalt(OWNER, 0);
  assert.equal(first.length, 32);
  assert.notDeepEqual(first, generateAllowanceSalt(OWNER, 1));
});

test('a different network is a different address', () => {
  const pubnet = deriveAllowanceAddress({
    owner: OWNER,
    index: 0,
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
  });
  assert.notEqual(pubnet, FIXTURES[0][1]);
});
