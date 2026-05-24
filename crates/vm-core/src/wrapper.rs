use wasm_bindgen::prelude::*;
use crate::vm::Vm;
use crate::value::Value;
use std::cell::RefCell;

thread_local! {
    pub static CLIENT_PRIVATE_KEY: RefCell<Option<[u8; 32]>> = const { RefCell::new(None) };
}

struct ClientKeyClearGuard;
impl Drop for ClientKeyClearGuard {
    fn drop(&mut self) {
        CLIENT_PRIVATE_KEY.with(|k| {
            use zeroize::Zeroize;
            let mut borrow = k.borrow_mut();
            if let Some(ref mut key) = *borrow {
                key.zeroize();
            }
            *borrow = None;
        });
    }
}

#[wasm_bindgen]
pub fn generate_client_keypair() -> Box<[u8]> {
    let mut private_bytes = [0u8; 32];
    getrandom::getrandom(&mut private_bytes).expect("Failed to generate client ephemeral key");
    
    let secret = x25519_dalek::StaticSecret::from(private_bytes);
    let public = x25519_dalek::PublicKey::from(&secret);
    
    CLIENT_PRIVATE_KEY.with(|k| {
        *k.borrow_mut() = Some(private_bytes);
    });
    
    use zeroize::Zeroize;
    private_bytes.zeroize();
    
    public.as_bytes().to_vec().into_boxed_slice()
}

#[wasm_bindgen]
pub fn set_client_private_key(key: &[u8]) -> bool {
    if key.len() == 32 {
        let mut arr = [0u8; 32];
        arr.copy_from_slice(key);
        CLIENT_PRIVATE_KEY.with(|k| {
            *k.borrow_mut() = Some(arr);
        });
        true
    } else {
        false
    }
}

#[wasm_bindgen]
pub fn get_client_private_key() -> Box<[u8]> {
    let mut key_bytes = vec![0u8; 32];
    CLIENT_PRIVATE_KEY.with(|k| {
        if let Some(bytes) = *k.borrow() {
            key_bytes.copy_from_slice(&bytes);
        }
    });
    key_bytes.into_boxed_slice()
}

// No wee_alloc for now to keep dependencies simple

const SERVER_LONG_TERM_PUBLIC_KEY: [u8; 32] = *include_bytes!("public_key.bin");

const SERVER_TRUSTED_PUBLIC_KEYS: [[u8; 32]; 3] = [
    SERVER_LONG_TERM_PUBLIC_KEY,
    SERVER_LONG_TERM_PUBLIC_KEY,
    SERVER_LONG_TERM_PUBLIC_KEY,
];

#[wasm_bindgen]
pub fn execute(bytecode: &[u8], handshake_header: &[u8], input_json: &str, opcode_map: &[u8]) -> String {
    let _guard = ClientKeyClearGuard;
    if bytecode.is_empty() {
        return r#"{"status": false, "error": "UnexpectedEndOfCode"}"#.to_string();
    }

    // VirtSC Verification Step 1: Compute the payload hash at the exact moment of ingestion.
    // This hash is stored globally and verified inside the VM loop. If the payload is patched, the VM silently corrupts the key.
    // See VirtSC: Combining Virtualisation Obfuscation with Self-Checksumming, arxiv.org/abs/1909.11404.
    let mut payload_data = Vec::new();
    payload_data.extend_from_slice(bytecode);
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(&payload_data);
    let hash = hasher.finalize();
    let hash_arr: [u8; 32] = hash.into();
    
    #[cfg(feature = "dev")]
    {
        let expected_hash = crate::verify_bridge::PAYLOAD_HASH.with(|h| *h.borrow());
        if let Some(expected) = expected_hash {
            if hash_arr != expected {
                return r#"{"status": false, "error": "Dev mode VirtSC hash mismatch"}"#.to_string();
            }
        }
    }
    
    crate::verify_bridge::set_payload_hash(Box::new(hash_arr));

    let mut session_key = zeroize::Zeroizing::new([0u8; 32]);
    let mut base_key_material = zeroize::Zeroizing::new([0u8; 32]);
    let mut has_session_key = false;
    crate::verify_bridge::SESSION_KEY.with(|k| {
        if let Some(key) = *k.borrow() {
            *session_key = key;
            has_session_key = true;
        }
    });
    if has_session_key {
        let mut loaded_base = false;
        crate::verify_bridge::BASE_KEY_MATERIAL.with(|k| {
            if let Some(key) = *k.borrow() {
                *base_key_material = key;
                loaded_base = true;
            }
        });
        if !loaded_base {
            *base_key_material = *session_key;
        }
    }

    if !has_session_key {
        // Handshake check
        let skip_handshake = {
            #[cfg(feature = "dev")]
            { true }
            #[cfg(not(feature = "dev"))]
            { false }
        };

        if !skip_handshake {
            if handshake_header.is_empty() {
                #[cfg(not(test))]
                {
                    return r#"{"status": false, "error": "InvalidHandshake"}"#.to_string();
                }
            } else if handshake_header.len() != 154 {
                return r#"{"status": false, "error": "InvalidHandshake"}"#.to_string();
            }

            if handshake_header.len() == 154 {
                let session_id = &handshake_header[0..16];
                let nonce = &handshake_header[16..48];
                let timestamp = &handshake_header[48..58];
                let server_ephemeral_public = &handshake_header[58..90];
                let signature = &handshake_header[90..154];

                // 1. Reconstruct signed buffer
                let mut msg = [0u8; 90];
                msg[0..16].copy_from_slice(session_id);
                msg[16..48].copy_from_slice(server_ephemeral_public);
                msg[48..80].copy_from_slice(nonce);
                msg[80..90].copy_from_slice(timestamp);

                // 2. Verify signature
                use ed25519_dalek::{VerifyingKey, Signature, Verifier};
                use subtle::Choice;

                let sig = Signature::from_slice(signature)
                    .map_err(|_| r#"{"status": false, "error": "SignatureVerificationFailed"}"#.to_string());
                let sig = match sig {
                    Ok(s) => s,
                    Err(e) => return e,
                };

                let mut sig_valid = Choice::from(0);
                for key_bytes in &SERVER_TRUSTED_PUBLIC_KEYS {
                    if let Ok(verifying_key) = VerifyingKey::from_bytes(key_bytes) {
                        let is_ok = verifying_key.verify(&msg, &sig).is_ok();
                        sig_valid |= Choice::from(is_ok as u8);
                    } else {
                        sig_valid |= Choice::from(0);
                    }
                }
                if sig_valid.unwrap_u8() == 0 {
                    return r#"{"status": false, "error": "SignatureVerificationFailed"}"#.to_string();
                }

                // 3. Replay protection
                let mut parsed_timestamp = 0u64;
                let mut timestamp_valid = true;
                for &b in timestamp {
                    if b.is_ascii_digit() {
                        parsed_timestamp = parsed_timestamp * 10 + (b - b'0') as u64;
                    } else {
                        timestamp_valid = false;
                    }
                }
                if !timestamp_valid {
                    return r#"{"status": false, "error": "InvalidHandshake"}"#.to_string();
                }

                let current_time_secs = {
                    #[cfg(target_arch = "wasm32")]
                    {
                        (js_sys::Date::now() / 1000.0) as u64
                    }
                    #[cfg(not(target_arch = "wasm32"))]
                    {
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs()
                    }
                };

                let diff = (current_time_secs as i128 - parsed_timestamp as i128).unsigned_abs() as u64;
                if diff > 300 {
                    return r#"{"status": false, "error": "HandshakeExpired"}"#.to_string();
                }

                // 4. Perform DH
                let mut client_private_bytes = zeroize::Zeroizing::new([0u8; 32]);
                let mut has_client_private = false;
                CLIENT_PRIVATE_KEY.with(|k| {
                    if let Some(bytes) = *k.borrow() {
                        *client_private_bytes = bytes;
                        has_client_private = true;
                    }
                });

                if !has_client_private {
                    let _ = getrandom::getrandom(&mut *client_private_bytes);
                }

                let client_secret = x25519_dalek::StaticSecret::from(*client_private_bytes);

                let mut server_pub_arr = [0u8; 32];
                server_pub_arr.copy_from_slice(server_ephemeral_public);
                let server_pub = x25519_dalek::PublicKey::from(server_pub_arr);

                let shared_secret = client_secret.diffie_hellman(&server_pub);

                // Derive session key and base key material using HKDF-SHA256
                use hkdf::Hkdf;
                use sha2::Sha256;
                let hk = Hkdf::<Sha256>::new(Some(nonce), shared_secret.as_bytes());
                let mut derived_key = zeroize::Zeroizing::new([0u8; 32]);
                let mut derived_base = zeroize::Zeroizing::new([0u8; 32]);
                if hk.expand(session_id, &mut *derived_key).is_ok() && hk.expand(b"base_key_material", &mut *derived_base).is_ok() {
                    *session_key = *derived_key;
                    *base_key_material = *derived_base;
                    has_session_key = true;
                    // Cache in thread-locals!
                    crate::verify_bridge::SESSION_KEY.with(|k| {
                        *k.borrow_mut() = Some(*derived_key);
                    });
                    crate::verify_bridge::BASE_KEY_MATERIAL.with(|k| {
                        *k.borrow_mut() = Some(*derived_base);
                    });
                }

                // Clear thread-local client private key for forward secrecy
                CLIENT_PRIVATE_KEY.with(|k| {
                    use zeroize::Zeroize;
                    if let Some(ref mut key) = *k.borrow_mut() {
                        key.zeroize();
                    }
                    *k.borrow_mut() = None;
                });
            }
        }
    }

    #[cfg(all(not(feature = "dev"), not(test)))]
    {
        if !has_session_key {
            return r#"{"status": false, "error": "MissingSessionKey"}"#.to_string();
        }
    }
    let _ = has_session_key;

    let bytecode_payload = bytecode;

    let mut expected_hash = [0u8; 32];
    {
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        type HmacSha256 = Hmac<Sha256>;
        if let Ok(mut mac) = HmacSha256::new_from_slice(&*base_key_material) {
            mac.update(bytecode);
            expected_hash.copy_from_slice(&mac.finalize().into_bytes());
        }
    }

    let mut vm = Vm::new(
        bytecode_payload.to_vec(),
        opcode_map.to_vec(),
        *session_key,
        *base_key_material,
        expected_hash,
    );
    
    // Load input_json into locals
    if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(input_json) {
        if let Some(arr) = json_val.as_array() {
            for (i, v) in arr.iter().enumerate() {
                vm.set_local(i, json_to_value(v));
            }
        }
    }
    
    let res = match vm.run() {
        Ok(result) => {
            value_to_json(&result).to_string()
        },
        Err(e) => {
            let err_str = match e {
                crate::stack::VmError::OutOfGas => "ExecutionLimitExceeded".to_string(),
                crate::stack::VmError::RuntimeError => "RuntimeError".to_string(),
                _ => format!("{:?}", e),
            };
            format!(r#"{{"status": false, "error": "{}"}}"#, err_str)
        }
    };
    res
}

// Helpers to convert between our Value enum and serde_json::Value
pub fn json_to_value(v: &serde_json::Value) -> Value {
    match v {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Bool(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Int(i)
            } else if let Some(f) = n.as_f64() {
                Value::Float(f)
            } else {
                Value::Null
            }
        },
        serde_json::Value::String(s) => Value::Str(std::sync::Arc::new(s.clone())),
        serde_json::Value::Array(arr) => {
            let list = arr.iter().map(json_to_value).collect();
            Value::List(std::rc::Rc::new(std::cell::RefCell::new(list)))
        },
        serde_json::Value::Object(obj) => {
            let mut map = std::collections::HashMap::new();
            for (k, v) in obj {
                map.insert(k.clone(), json_to_value(v));
            }
            Value::Object(std::rc::Rc::new(std::cell::RefCell::new(map)))
        }
    }
}

pub fn value_to_json(v: &Value) -> serde_json::Value {
    use std::collections::HashSet;
    let mut visited = HashSet::new();
    value_to_json_inner(v, &mut visited)
}

fn value_to_json_inner(v: &Value, visited: &mut std::collections::HashSet<usize>) -> serde_json::Value {
    match v {
        Value::Null => serde_json::Value::Null,
        Value::Bool(b) => serde_json::Value::Bool(*b),
        Value::Int(i) => serde_json::Value::Number((*i).into()),
        Value::Float(f) => {
            if let Some(num) = serde_json::Number::from_f64(*f) {
                serde_json::Value::Number(num)
            } else {
                serde_json::Value::Null
            }
        },
        Value::Str(s) => serde_json::Value::String(s.to_string()),
        Value::List(list) => {
            let ptr_val = std::rc::Rc::as_ptr(list) as usize;
            if visited.contains(&ptr_val) {
                return serde_json::Value::String("<cycle>".to_string());
            }
            visited.insert(ptr_val);
            
            let res = match list.try_borrow() {
                Ok(borrowed_vec) => {
                    let arr = borrowed_vec.iter().map(|item| value_to_json_inner(item, visited)).collect();
                    serde_json::Value::Array(arr)
                }
                Err(_) => {
                    serde_json::Value::String("<borrowed>".to_string())
                }
            };
            
            visited.remove(&ptr_val);
            res
        },
        Value::Object(obj_rc) => {
            let ptr_val = std::rc::Rc::as_ptr(obj_rc) as usize;
            if visited.contains(&ptr_val) {
                return serde_json::Value::String("<cycle>".to_string());
            }
            visited.insert(ptr_val);
            
            let res = match obj_rc.try_borrow() {
                Ok(borrowed_map) => {
                    let mut map = serde_json::Map::new();
                    for (k, v) in borrowed_map.iter() {
                        map.insert(k.clone(), value_to_json_inner(v, visited));
                    }
                    serde_json::Value::Object(map)
                }
                Err(_) => {
                    serde_json::Value::String("<borrowed>".to_string())
                }
            };
            
            visited.remove(&ptr_val);
            res
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::opcodes::OpCode;

    #[test]
    fn test_execute_empty_bytecode() {
        let result = execute(&[], &[], "[]", &[]);
        // An empty bytecode payload should not panic, it should return an UnexpectedEndOfCode error or similar
        // because the PC will immediately go out of bounds.
        assert!(result.contains(r#"{"status": false, "error":"#));
    }

    #[test]
    fn test_execute_empty_image_and_map() {
        // Construct a minimal valid bytecode using identity map (PushInt(42), Halt)
        // PushInt = 0, operand = 42 (0x2A 00 00 00), Halt = 43
        // Actually, we must provide it via JIT, but if session_key is all 0s, cipher is identity!
        let mut bytecode = vec![0; 256]; // Need 256 bytes for JIT page
        bytecode[0] = OpCode::PushInt as u8;
        bytecode[1] = 42;
        bytecode[2] = 0;
        bytecode[3] = 0;
        bytecode[4] = 0;
        bytecode[5] = OpCode::Halt as u8;

        let mut opcode_map = [0u8; 256];
        for i in 0..256 {
            opcode_map[i] = i as u8;
        }

        let result = execute(&bytecode, &[], "[]", &opcode_map);
        // Should execute successfully and return 42
        assert_eq!(result, "42");
    }

    #[test]
    fn test_verify_load_and_sign() {
        let key_bytes = std::fs::read("../../server/.signing_key").expect("Unable to read key");
        assert_eq!(key_bytes.len(), 48);
        let private_bytes: [u8; 32] = key_bytes[16..48].try_into().unwrap();
        use ed25519_dalek::{SigningKey, Signer, VerifyingKey, Verifier};
        let signing_key = SigningKey::from_bytes(&private_bytes);
        let message = b"hello world";
        let sig = signing_key.sign(message);
        let verifying_key = VerifyingKey::from_bytes(&SERVER_LONG_TERM_PUBLIC_KEY).unwrap();
        assert!(verifying_key.verify(message, &sig).is_ok());
    }

    #[test]
    fn test_execute_invalid_handshake_length() {
        let handshake = [0u8; 100];
        let mut bytecode = vec![0; 256];
        bytecode[5] = OpCode::Halt as u8;
        let mut opcode_map = [0u8; 256];
        for i in 0..256 {
            opcode_map[i] = i as u8;
        }
        let result = execute(&bytecode, &handshake, "[]", &opcode_map);
        assert!(result.contains(r#"{"status": false, "error": "InvalidHandshake"}"#));
    }

    #[test]
    fn test_execute_signature_verification_failure() {
        // Construct a 154-byte handshake header with a corrupt/invalid signature
        let mut handshake = [0u8; 154];
        handshake[48..58].copy_from_slice(b"1600000000");

        let mut bytecode = vec![0; 256];
        bytecode[5] = OpCode::Halt as u8;
        let mut opcode_map = [0u8; 256];
        for i in 0..256 {
            opcode_map[i] = i as u8;
        }

        let result = execute(&bytecode, &handshake, "[]", &opcode_map);
        assert!(result.contains(r#"{"status": false, "error": "SignatureVerificationFailed"}"#));
    }

    #[test]
    fn test_execute_expired_timestamp() {
        let key_bytes = std::fs::read("../../server/.signing_key").expect("Unable to read key");
        assert_eq!(key_bytes.len(), 48);
        let private_bytes: [u8; 32] = key_bytes[16..48].try_into().unwrap();
        use ed25519_dalek::{SigningKey, Signer};
        let signing_key = SigningKey::from_bytes(&private_bytes);

        // Expired timestamp: current time minus 310 seconds
        let current_time_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let expired_time = current_time_secs - 310;
        let timestamp_str = format!("{:010}", expired_time);
        let timestamp_bytes = timestamp_str.as_bytes();

        let session_id = [0x11; 16];
        let nonce = [0x22; 32];
        let server_ephemeral_public = [0x33; 32];

        // 90-byte msg: session_id | server_ephemeral_public | nonce | timestamp
        let mut msg = [0u8; 90];
        msg[0..16].copy_from_slice(&session_id);
        msg[16..48].copy_from_slice(&server_ephemeral_public);
        msg[48..80].copy_from_slice(&nonce);
        msg[80..90].copy_from_slice(timestamp_bytes);

        let sig = signing_key.sign(&msg);

        // Reconstruct 154-byte handshake header:
        // session_id (16) | nonce (32) | timestamp (10) | server_ephemeral_public (32) | signature (64)
        let mut handshake = [0u8; 154];
        handshake[0..16].copy_from_slice(&session_id);
        handshake[16..48].copy_from_slice(&nonce);
        handshake[48..58].copy_from_slice(timestamp_bytes);
        handshake[58..90].copy_from_slice(&server_ephemeral_public);
        handshake[90..154].copy_from_slice(&sig.to_bytes());

        let mut bytecode = vec![0; 256];
        bytecode[5] = OpCode::Halt as u8;
        let mut opcode_map = [0u8; 256];
        for i in 0..256 {
            opcode_map[i] = i as u8;
        }

        let result = execute(&bytecode, &handshake, "[]", &opcode_map);
        assert!(result.contains(r#"{"status": false, "error": "HandshakeExpired"}"#));
    }

    #[test]
    fn test_execute_valid_handshake() {
        let key_bytes = std::fs::read("../../server/.signing_key").expect("Unable to read key");
        assert_eq!(key_bytes.len(), 48);
        let private_bytes: [u8; 32] = key_bytes[16..48].try_into().unwrap();
        use ed25519_dalek::{SigningKey, Signer};
        let signing_key = SigningKey::from_bytes(&private_bytes);

        // Valid timestamp: current time
        let current_time_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let timestamp_str = format!("{:010}", current_time_secs);
        let timestamp_bytes = timestamp_str.as_bytes();

        let session_id = [0x11; 16];
        let nonce = [0x22; 32];
        
        // Generate a valid ephemeral keypair
        let client_private = [0x44; 32];
        CLIENT_PRIVATE_KEY.with(|k| {
            *k.borrow_mut() = Some(client_private);
        });

        let server_private = x25519_dalek::StaticSecret::from([0x55; 32]);
        let server_ephemeral_public = x25519_dalek::PublicKey::from(&server_private);

        // 90-byte msg: session_id | server_ephemeral_public | nonce | timestamp
        let mut msg = [0u8; 90];
        msg[0..16].copy_from_slice(&session_id);
        msg[16..48].copy_from_slice(server_ephemeral_public.as_bytes());
        msg[48..80].copy_from_slice(&nonce);
        msg[80..90].copy_from_slice(timestamp_bytes);

        let sig = signing_key.sign(&msg);

        // Reconstruct 154-byte handshake header:
        let mut handshake = [0u8; 154];
        handshake[0..16].copy_from_slice(&session_id);
        handshake[16..48].copy_from_slice(&nonce);
        handshake[48..58].copy_from_slice(timestamp_bytes);
        handshake[58..90].copy_from_slice(server_ephemeral_public.as_bytes());
        handshake[90..154].copy_from_slice(&sig.to_bytes());

        // Construct a minimal valid bytecode (PushInt(42), Halt) using identity map
        let mut bytecode = vec![0; 256];
        bytecode[0] = OpCode::PushInt as u8;
        bytecode[1] = 42;
        bytecode[2] = 0;
        bytecode[3] = 0;
        bytecode[4] = 0;
        bytecode[5] = OpCode::Halt as u8;

        let mut opcode_map = [0u8; 256];
        for i in 0..256 {
            opcode_map[i] = i as u8;
        }

        let result = execute(&bytecode, &handshake, "[]", &opcode_map);
        // Handshake verification must succeed, VM runs but might fail due to decryption mismatch or succeed.
        // What's critical is that it does NOT fail verification checks.
        assert!(!result.contains("SignatureVerificationFailed"));
        assert!(!result.contains("HandshakeExpired"));
        assert!(!result.contains("InvalidHandshake"));
    }
}
