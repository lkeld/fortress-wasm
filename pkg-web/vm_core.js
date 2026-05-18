/* @ts-self-types="./vm_core.d.ts" */
import * as wasm from "./vm_core_bg.wasm";
import { __wbg_set_wasm } from "./vm_core_bg.js";

__wbg_set_wasm(wasm);

export {
    execute, init_crypto, set_payload_hash, sign_request
} from "./vm_core_bg.js";
