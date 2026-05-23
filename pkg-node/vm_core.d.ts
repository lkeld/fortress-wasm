/* tslint:disable */
/* eslint-disable */

export function clear_crypto(): void;

export function execute(bytecode: Uint8Array, handshake_header: Uint8Array, input_json: string, opcode_map: Uint8Array): string;

export function generate_client_keypair(): Uint8Array;

export function init_crypto(image_bytes: Uint8Array, _width: number, _height: number, session_seed: Uint8Array, fingerprint: Uint8Array, epoch_day: number): void;

export function init_crypto_with_key(stego_key_bytes: Uint8Array, session_seed: Uint8Array, fingerprint: Uint8Array, epoch_day: number): void;

export function set_client_private_key(key: Uint8Array): boolean;

export function set_payload_hash(hash: Uint8Array): void;

export function sign_request(method: string, url: string, body_str: string, timestamp: string): string;
