import { describe, it, expect } from 'vitest';
import { generateDID, createDIDDocument, type DIDKeyPair } from '../did.js';

describe('DID Utilities', () => {
  it('should generate a DID from a hostname', () => {
    const result = generateDID('acme-corp.eurocomply.app');
    expect(result.did).toBe('did:web:acme-corp.eurocomply.app');
    expect(result.publicKey).toBeDefined();
    expect(result.privateKey).toBeDefined();
    expect(result.publicKey).not.toBe(result.privateKey);
  });

  it('should create a DID document', () => {
    const keyPair = generateDID('test.eurocomply.app');
    const doc = createDIDDocument(keyPair);

    expect(doc.id).toBe('did:web:test.eurocomply.app');
    expect(doc['@context']).toContain('https://www.w3.org/ns/did/v1');
    expect(doc.verificationMethod).toHaveLength(1);
    expect(doc.verificationMethod[0].type).toBe('Ed25519VerificationKey2020');
    expect(doc.verificationMethod[0].publicKeyMultibase).toBeDefined();
  });

  it('should generate unique key pairs', () => {
    const kp1 = generateDID('one.eurocomply.app');
    const kp2 = generateDID('two.eurocomply.app');
    expect(kp1.publicKey).not.toBe(kp2.publicKey);
  });
});
