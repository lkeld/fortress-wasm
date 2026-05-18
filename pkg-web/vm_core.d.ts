/* tslint:disable */
/* eslint-disable */

export function execute(bytecode: Uint8Array, image_rgba: Uint8Array, input_json: string, opcode_map: Uint8Array): string;

export function init_crypto(image_bytes: Uint8Array, width: number, height: number, session_seed: Uint8Array, fingerprint: Uint8Array, epoch_day: number): void;

export function set_payload_hash(hash: Uint8Array): void;

export function sign_request(method: string, url: string, body_str: string, timestamp: string): string;
