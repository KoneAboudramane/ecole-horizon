import { describe, expect, it } from 'vitest';
import { keyBytes } from './push';

describe('Clé des alertes', () => {
  it('décode la clé publique base64 « url », sans remplissage', () => {
    expect(Array.from(keyBytes('AQID_-8'))).toEqual([1, 2, 3, 255, 239]);
  });
  it('une clé VAPID fait 65 octets (point non compressé)', () => {
    const k = keyBytes('B' + 'A'.repeat(86));
    expect(k.length).toBe(65);
    expect(k[0]).toBe(4);
  });
});
