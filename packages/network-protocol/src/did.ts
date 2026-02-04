import { generateKeyPairSync } from 'crypto';

export interface DIDKeyPair {
  did: string;
  publicKey: string;
  privateKey: string;
}

export interface DIDDocument {
  '@context': string[];
  id: string;
  verificationMethod: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyMultibase: string;
  }>;
  authentication: string[];
  assertionMethod: string[];
}

export function generateDID(hostname: string): DIDKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubKeyDer = publicKey.export({ type: 'spki', format: 'der' });
  const privKeyDer = privateKey.export({ type: 'pkcs8', format: 'der' });

  return {
    did: `did:web:${hostname}`,
    publicKey: Buffer.from(pubKeyDer).toString('base64url'),
    privateKey: Buffer.from(privKeyDer).toString('base64url'),
  };
}

export function createDIDDocument(keyPair: DIDKeyPair): DIDDocument {
  return {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: keyPair.did,
    verificationMethod: [
      {
        id: `${keyPair.did}#key-1`,
        type: 'Ed25519VerificationKey2020',
        controller: keyPair.did,
        publicKeyMultibase: `z${keyPair.publicKey}`,
      },
    ],
    authentication: [`${keyPair.did}#key-1`],
    assertionMethod: [`${keyPair.did}#key-1`],
  };
}
