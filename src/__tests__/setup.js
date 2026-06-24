// Polyfill TextEncoder/TextDecoder for environments that lack them (older Node).
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
