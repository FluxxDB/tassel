import { describe, expect, it } from 'vitest';
import {
  decodeFrame,
  parseServerMessage,
} from '../../../../src/renderer/src/paper/sources/helper-protocol';

/** Bytes from hex digits; spaces are ignored. */
function hexBuffer(hex: string): ArrayBuffer {
  const digits = hex.replaceAll(' ', '');
  const bytes = new Uint8Array(digits.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes.buffer;
}

/** The contract fixture both languages test (Global Constraints, "Helper protocol v1"). */
const FIXTURE = '54534C46 0001 0001 00000007 000000000012D687 0004 0003 FFD8FFD9';

function withByte(index: number, value: number): ArrayBuffer {
  const bytes = new Uint8Array(hexBuffer(FIXTURE));
  bytes[index] = value;
  return bytes.buffer;
}

describe('the helper protocol', () => {
  it('decodeFrame reads the contract fixture', () => {
    const frame = decodeFrame(hexBuffer(FIXTURE));
    expect(frame).toMatchObject({ seq: 7, ptsMicros: 1_234_567, width: 4, height: 3 });
    expect([...frame.jpeg]).toEqual([0xff, 0xd8, 0xff, 0xd9]);

    expect(() => decodeFrame(withByte(0, 0x55))).toThrow();
    expect(() => decodeFrame(hexBuffer(FIXTURE).slice(0, 23))).toThrow();
    expect(() => decodeFrame(withByte(5, 0x02))).toThrow();
  });

  it('decodeFrame reads the largest values', () => {
    const frame = decodeFrame(hexBuffer('54534C46 0001 0001 FFFFFFFF 001FFFFFFFFFFFFF FFFF FFFF'));
    expect(frame).toMatchObject({
      seq: 4_294_967_295,
      ptsMicros: Number.MAX_SAFE_INTEGER,
      width: 65_535,
      height: 65_535,
    });
    expect(frame.jpeg).toHaveLength(0);
  });

  it('parseServerMessage reads kebab error codes and returns null for an unknown type', () => {
    // The exact lines the Swift helper's own tests pin (DeskViewCoreTests/MessagesTests).
    expect(parseServerMessage('{"code":"permission-denied","message":"x","type":"error"}')).toEqual(
      {
        type: 'error',
        code: 'permission-denied',
        message: 'x',
      },
    );
    for (const code of ['auth', 'no-device', 'device-lost', 'busy', 'bad-request', 'internal']) {
      expect(parseServerMessage(JSON.stringify({ type: 'error', code, message: 'm' }))).toEqual({
        type: 'error',
        code,
        message: 'm',
      });
    }
    expect(
      parseServerMessage(
        '{"camera":"authorized","helperVersion":"0.1.0","protocol":1,"type":"welcome"}',
      ),
    ).toEqual({ type: 'welcome', camera: 'authorized', helperVersion: '0.1.0', protocol: 1 });
    expect(
      parseServerMessage(
        '{"devices":[{"builtIn":true,"id":"clip","name":"Test clip"}],"type":"devices"}',
      ),
    ).toEqual({ type: 'devices', devices: [{ id: 'clip', name: 'Test clip', builtIn: true }] });
    expect(
      parseServerMessage('{"fps":15,"height":1440,"state":"running","type":"status","width":1920}'),
    ).toEqual({ type: 'status', state: 'running', width: 1920, height: 1440, fps: 15 });
    expect(parseServerMessage('{"result":"presented","type":"setup"}')).toEqual({
      type: 'setup',
      result: 'presented',
    });
    expect(
      parseServerMessage('{"message":"Desk View is unavailable","result":"failed","type":"setup"}'),
    ).toEqual({ type: 'setup', result: 'failed', message: 'Desk View is unavailable' });

    for (const text of [
      '{"type":"dance"}',
      'not json',
      '[]',
      '{"type":"error","code":"exploded","message":"x"}',
      '{"type":"welcome","camera":"maybe","helperVersion":"0.1.0","protocol":1}',
      '{"type":"status","state":"running","width":"1920","height":1440,"fps":15}',
      '{"type":"devices","devices":[{"id":"clip"}]}',
    ]) {
      expect(parseServerMessage(text), text).toBeNull();
    }
  });
});
