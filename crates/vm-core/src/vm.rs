use crate::stack::{Stack, VmError};
use crate::value::Value;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(module = "env")]
extern "C" {
    pub(crate) fn native_call(id: u32, args_json: &str) -> String;
}

pub(crate) struct CallFrame {
    pub(crate) pc_base: usize,
    pub(crate) pc_offset: usize,
    pub(crate) locals: Vec<Value>,
}

pub struct Vm {
    pub(crate) stack: Stack,
    pub(crate) frames: Vec<CallFrame>,
    pub(crate) locals: Vec<Value>,
    pub(crate) code: Vec<u8>,
    pub(crate) pc_base: usize,
    pub(crate) pc_offset: usize,
    pub(crate) expected_hash: [u8; 32],
    pub(crate) hash_verified: bool,
    pub(crate) opcode_map: [u8; 256],
    pub(crate) session_key: [u8; 32],
    pub(crate) base_key_material: [u8; 32],
    pub(crate) current_page_id: i32,
    pub(crate) ves: [u8; 256],
    pub(crate) prng_state: u64,
    pub(crate) gas_limit: u64,
    pub(crate) gas_used: u64,
}

impl Vm {
    pub fn new(
        code: Vec<u8>,
        opcode_map_vec: Vec<u8>,
        session_key: [u8; 32],
        base_key_material: [u8; 32],
        expected_hash: [u8; 32],
    ) -> Self {
        let mut opcode_map = [0u8; 256];
        if opcode_map_vec.len() >= 256 {
            opcode_map.copy_from_slice(&opcode_map_vec[0..256]);
        } else {
            // Fallback (identity map) if code is malformed/too short
            for i in 0..256 {
                opcode_map[i] = i as u8;
            }
        }
        
        let mut seed_bytes = [0u8; 8];
        let _ = getrandom::getrandom(&mut seed_bytes);
        let mut seed = u64::from_le_bytes(seed_bytes);
        if seed == 0 {
            seed = 0xDEADC0DE;
        }
        
        Self {
            stack: Stack::new(),
            frames: Vec::new(),
            locals: vec![Value::Null; 256],
            code,
            pc_base: 0,
            pc_offset: 0,
            expected_hash,
            hash_verified: false,
            opcode_map,
            session_key,
            base_key_material,
            current_page_id: -1,
            ves: [0u8; 256],
            prng_state: seed,
            gas_limit: 1_000_000,
            gas_used: 0,
        }
    }

    pub fn set_local(&mut self, index: usize, value: Value) {
        if index < self.locals.len() {
            self.locals[index] = value;
        }
    }

    pub(crate) fn get_pc(&self) -> usize {
        self.pc_base.wrapping_add(self.pc_offset)
    }

    fn next_random(&mut self) -> u64 {
        let mut x = self.prng_state;
        x ^= x << 12;
        x ^= x >> 25;
        x ^= x << 27;
        self.prng_state = x;
        x
    }

    pub fn set_gas_limit(&mut self, limit: u64) {
        self.gas_limit = limit;
    }

    pub(crate) fn charge_gas(&mut self, amount: u64) -> Result<(), VmError> {
        self.gas_used = self.gas_used.saturating_add(amount);
        if self.gas_used > self.gas_limit {
            return Err(VmError::OutOfGas);
        }
        Ok(())
    }

    pub(crate) fn set_pc(&mut self, new_pc: usize) {
        let rand_val = self.next_random();
        let base_amount = if new_pc > 0 {
            (rand_val as usize) % new_pc
        } else {
            0
        };
        self.pc_base = base_amount;
        self.pc_offset = new_pc - self.pc_base;
        self.current_page_id = -1; // Invalidate JIT cache on jump
    }

    pub(crate) fn advance_pc(&mut self, amount: usize) {
        let rand_val = self.next_random();
        if rand_val % 2 == 0 {
            self.pc_base = self.pc_base.wrapping_add(amount);
        } else {
            self.pc_offset = self.pc_offset.wrapping_add(amount);
        }
    }

    pub(crate) fn decrypt_page(&mut self, page_id: u32) {
        // VirtSC Self-Checksumming: Computes a runtime hash of the bytecode payload to detect patching or tampering.
        // If the hash fails, we intentionally do NOT throw an error (which an attacker could hook). Instead, we silently corrupt the session key.
        // This causes subsequent JIT decryptions to produce garbage opcodes, executing a silent, untraceable crash.
        // See VirtSC: Combining Virtualisation Obfuscation with Self-Checksumming, arxiv.org/abs/1909.11404.
        self.ves = [0u8; 256];

        if !self.hash_verified {
            use hmac::{Hmac, Mac};
            use sha2::Sha256;
            use subtle::ConstantTimeEq;
            type HmacSha256 = Hmac<Sha256>;
            
            let mut computed_mac = [0u8; 32];
            if let Ok(mut mac) = HmacSha256::new_from_slice(&self.base_key_material) {
                mac.update(&self.code);
                computed_mac.copy_from_slice(&mac.finalize().into_bytes());
            }
            
            if computed_mac.ct_eq(&self.expected_hash).unwrap_u8() == 0 {
                // If mismatch, zeroize self.base_key_material, self.session_key, self.code, self.ves, and self.opcode_map in memory.
                use zeroize::Zeroize;
                self.base_key_material.zeroize();
                self.session_key.zeroize();
                self.code.zeroize();
                self.ves.zeroize();
                self.opcode_map.zeroize();
            }
            self.hash_verified = true;
        }

        let start_addr = page_id as usize * 256;
        let page_key = {
            #[cfg(feature = "dev")]
            { [0u8; 32] }
            #[cfg(not(feature = "dev"))]
            { self.session_key }
        };

        for i in 0..256 {
            let in_bounds = (start_addr + i) < self.code.len();
            let mask = (in_bounds as u8).wrapping_neg(); // 0xFF if in_bounds, 0x00 if not
            let code_byte = *self.code.get(start_addr + i).unwrap_or(&0);
            self.ves[i] = (code_byte ^ page_key[i % 32]) & mask;
        }
        self.current_page_id = page_id as i32;

        #[cfg(not(feature = "dev"))]
        {
            if self.code.len() % 288 == 0 && self.code.len() > 0 {
                let num_pages = self.code.len() / 288;
                let hash_start = (num_pages * 256) + page_id as usize * 32;
                if hash_start + 32 <= self.code.len() {
                    let mut expected_page_hash = [0u8; 32];
                    for i in 0..32 {
                        expected_page_hash[i] = self.code[hash_start + i] ^ self.session_key[i];
                    }
                    
                    use sha2::{Sha256, Digest};
                    let mut hasher = Sha256::new();
                    hasher.update(&self.ves);
                    let actual_page_hash: [u8; 32] = hasher.finalize().into();
                    if actual_page_hash != expected_page_hash {
                        self.session_key[0] ^= 0xFF;
                    }
                }
            }
        }
    }

    pub(crate) fn read_byte(&mut self) -> Result<u8, VmError> {
        let pc = self.get_pc();
        let limit = if self.code.len() % 288 == 0 {
            #[cfg(feature = "dev")]
            {
                self.code.len()
            }
            #[cfg(not(feature = "dev"))]
            {
                (self.code.len() / 288) * 256
            }
        } else {
            self.code.len()
        };
        if pc >= limit {
            return Err(VmError::UnexpectedEndOfCode);
        }
        
        let page_id = (pc / 256) as u32;
        let offset = pc % 256;
        
        if self.current_page_id != page_id as i32 {
            self.decrypt_page(page_id);
        }
        
        let b = self.ves[offset];
        self.advance_pc(1);
        Ok(b)
    }

    pub(crate) fn read_u32(&mut self) -> Result<u32, VmError> {
        let b1 = self.read_byte()?;
        let b2 = self.read_byte()?;
        let b3 = self.read_byte()?;
        let b4 = self.read_byte()?;
        Ok(u32::from_le_bytes([b1, b2, b3, b4]))
    }

    pub(crate) fn read_u64(&mut self) -> Result<u64, VmError> {
        let mut bytes = [0u8; 8];
        for i in 0..8 {
            bytes[i] = self.read_byte()?;
        }
        Ok(u64::from_le_bytes(bytes))
    }

    pub fn run(&mut self) -> Result<Value, VmError> {
        #[cfg(target_arch = "wasm32")]
        {
            use std::collections::HashMap;
            use std::rc::Rc;
            use std::cell::RefCell;
            
            let global = js_sys::global();
            use wasm_bindgen::JsCast;
            let perf = global.clone().dyn_into::<web_sys::Window>().ok().and_then(|w| w.performance())
                .or_else(|| global.dyn_into::<web_sys::WorkerGlobalScope>().ok().and_then(|w| w.performance()));
            let start = perf.as_ref().map(|p| p.now()).unwrap_or_else(|| js_sys::Date::now());
            let mut dummy = 0;
            for _ in 0..10_000 {
                dummy ^= 0xA5;
            }
            let elapsed = perf.as_ref().map(|p| p.now()).unwrap_or_else(|| js_sys::Date::now()) - start;
            if elapsed > 50.0 {
                let mut garbage = HashMap::new();
                garbage.insert("status".to_string(), Value::Bool(false));
                garbage.insert("error".to_string(), Value::Str(std::sync::Arc::new("timeout".to_string())));
                return Ok(Value::Object(Rc::new(RefCell::new(garbage))));
            }
        }
        let mut cycles = 0;
        let max_cycles = 1_000_000;
        let dispatch_table = crate::dispatch_table::get_dispatch_table();

        loop {
            cycles += 1;
            if cycles > max_cycles {
                return Err(VmError::ExecutionLimitExceeded);
            }

            let limit = if self.code.len() % 288 == 0 {
                #[cfg(feature = "dev")]
                {
                    self.code.len()
                }
                #[cfg(not(feature = "dev"))]
                {
                    (self.code.len() / 288) * 256
                }
            } else {
                self.code.len()
            };
            if self.get_pc() >= limit {
                break;
            }

            let raw_instruction = self.read_byte()?;
            let opcode_val_translated = self.opcode_map[raw_instruction as usize];

            let gas_cost = match crate::opcodes::OpCode::try_from(opcode_val_translated) {
                Ok(crate::opcodes::OpCode::PushInt) | Ok(crate::opcodes::OpCode::Pop) | Ok(crate::opcodes::OpCode::Dup) | Ok(crate::opcodes::OpCode::PushFloat) |
                Ok(crate::opcodes::OpCode::PushBool) | Ok(crate::opcodes::OpCode::PushNull) | Ok(crate::opcodes::OpCode::Swap) | Ok(crate::opcodes::OpCode::Rotate) |
                Ok(crate::opcodes::OpCode::Drop2) => 1,
                
                Ok(crate::opcodes::OpCode::Add) | Ok(crate::opcodes::OpCode::Sub) | Ok(crate::opcodes::OpCode::Mul) | Ok(crate::opcodes::OpCode::Div) |
                Ok(crate::opcodes::OpCode::Eq) | Ok(crate::opcodes::OpCode::Neq) | Ok(crate::opcodes::OpCode::Lt) | Ok(crate::opcodes::OpCode::Gt) |
                Ok(crate::opcodes::OpCode::Lte) | Ok(crate::opcodes::OpCode::Gte) | Ok(crate::opcodes::OpCode::And) | Ok(crate::opcodes::OpCode::Or) |
                Ok(crate::opcodes::OpCode::Not) | Ok(crate::opcodes::OpCode::BitAnd) | Ok(crate::opcodes::OpCode::BitOr) | Ok(crate::opcodes::OpCode::BitXor) |
                Ok(crate::opcodes::OpCode::BitNot) | Ok(crate::opcodes::OpCode::Shl) | Ok(crate::opcodes::OpCode::Shr) => 2,
                
                Ok(crate::opcodes::OpCode::LoadLocal) | Ok(crate::opcodes::OpCode::StoreLocal) => 2,
                
                Ok(crate::opcodes::OpCode::Jump) | Ok(crate::opcodes::OpCode::JumpIf) | Ok(crate::opcodes::OpCode::JumpIfNot) |
                Ok(crate::opcodes::OpCode::Call) | Ok(crate::opcodes::OpCode::Return) => 5,
                
                Ok(crate::opcodes::OpCode::NewObject) | Ok(crate::opcodes::OpCode::NewList) | Ok(crate::opcodes::OpCode::ListPush) |
                Ok(crate::opcodes::OpCode::GetMember) | Ok(crate::opcodes::OpCode::SetMember) | Ok(crate::opcodes::OpCode::Length) => 10,
                
                Ok(crate::opcodes::OpCode::PushString) | Ok(crate::opcodes::OpCode::Concat) => 5,
                
                Ok(crate::opcodes::OpCode::JSONStringify) => 10,
                
                Ok(crate::opcodes::OpCode::CompareAndAdd) | Ok(crate::opcodes::OpCode::SwapAndMul) | Ok(crate::opcodes::OpCode::JumpAndMul) => 5,
                
                Ok(crate::opcodes::OpCode::Hash256) => 50,
                
                Ok(crate::opcodes::OpCode::EncryptAES) => 250,
                
                Ok(crate::opcodes::OpCode::CallNative) => 50,
                
                Ok(crate::opcodes::OpCode::Halt) => 1,
                
                _ => 1,
            };
            self.charge_gas(gas_cost)?;

            let handler = dispatch_table[opcode_val_translated as usize];
            
            match handler(self) {
                Ok(true) => break,
                Ok(false) => continue,
                Err(e) => return Err(e),
            }
        }

        Ok(self.stack.pop().unwrap_or(Value::Null))
    }
}

impl Drop for Vm {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.session_key.zeroize();
        self.base_key_material.zeroize();
        self.ves.zeroize();
        self.code.zeroize();
    }
}

include!("vm_tests.rs");
