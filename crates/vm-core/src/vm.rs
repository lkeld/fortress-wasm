use crate::opcodes::OpCode;
use crate::stack::{Stack, VmError};
use crate::value::Value;
use std::collections::HashMap;
use std::rc::Rc;
use std::cell::RefCell;
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
    pub(crate) current_page_id: i32,
    pub(crate) ves: [u8; 256],
}

impl Vm {
    pub fn new(code: Vec<u8>, opcode_map_vec: Vec<u8>, session_key: [u8; 32], expected_hash: [u8; 32]) -> Self {
        let mut opcode_map = [0u8; 256];
        if opcode_map_vec.len() >= 256 {
            opcode_map.copy_from_slice(&opcode_map_vec[0..256]);
        } else {
            // Fallback (identity map) if code is malformed/too short
            for i in 0..256 {
                opcode_map[i] = i as u8;
            }
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
            current_page_id: -1,
            ves: [0u8; 256],
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

    pub(crate) fn set_pc(&mut self, new_pc: usize) {
        let mut rand_buf = [0u8; 1];
        let _ = getrandom::getrandom(&mut rand_buf);
        let base_amount = if new_pc > 0 {
            (rand_buf[0] as usize) % new_pc
        } else {
            0
        };
        self.pc_base = base_amount;
        self.pc_offset = new_pc - self.pc_base;
        self.current_page_id = -1; // Invalidate JIT cache on jump
    }

    pub(crate) fn advance_pc(&mut self, amount: usize) {
        let mut rand_buf = [0u8; 1];
        let _ = getrandom::getrandom(&mut rand_buf);
        if rand_buf[0] % 2 == 0 {
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
            use sha2::{Sha256, Digest};
            let mut hasher = Sha256::new();
            hasher.update(&self.code);
            let current_hash: [u8; 32] = hasher.finalize().into();
            if current_hash != self.expected_hash {
                // Silently corrupt session key
                self.session_key[0] ^= 0xFF;
            }
            self.hash_verified = true;
        }

        let start_addr = page_id as usize * 256;
        #[cfg(feature = "dev")]
        {
            for i in 0..256 {
                if start_addr + i < self.code.len() {
                    self.ves[i] = self.code[start_addr + i];
                } else {
                    self.ves[i] = 0;
                }
            }
        }
        #[cfg(not(feature = "dev"))]
        {
            for i in 0..256 {
                if start_addr + i < self.code.len() {
                    let key_byte = self.session_key[(start_addr + i) % 32];
                    self.ves[i] = self.code[start_addr + i] ^ key_byte;
                } else {
                    self.ves[i] = 0;
                }
            }
        }
        self.current_page_id = page_id as i32;
    }

    pub(crate) fn read_byte(&mut self) -> Result<u8, VmError> {
        let pc = self.get_pc();
        if pc >= self.code.len() {
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

            if self.get_pc() >= self.code.len() {
                break;
            }

            let raw_instruction = self.read_byte()?;
            let opcode_val_translated = self.opcode_map[raw_instruction as usize];
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
