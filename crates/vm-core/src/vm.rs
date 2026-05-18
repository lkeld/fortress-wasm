use crate::opcodes::OpCode;
use crate::stack::{Stack, VmError};
use crate::value::Value;
use std::collections::HashMap;
use std::rc::Rc;
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(module = "env")]
extern "C" {
    fn native_call(id: u32, args_json: &str) -> String;
}

struct CallFrame {
    pc_base: usize,
    pc_offset: usize,
    locals: Vec<Value>,
}

pub struct Vm {
    stack: Stack,
    frames: Vec<CallFrame>,
    locals: Vec<Value>,
    code: Vec<u8>,
    pc_base: usize,
    pc_offset: usize,
    expected_hash: u32,
    opcode_map: [u8; 256],
    session_key: [u8; 32],
    current_page_id: i32,
    ves: [u8; 256],
}

impl Vm {
    pub fn new(code: Vec<u8>, opcode_map_vec: Vec<u8>, session_key: [u8; 32]) -> Self {
        let mut opcode_map = [0u8; 256];
        if opcode_map_vec.len() >= 256 {
            opcode_map.copy_from_slice(&opcode_map_vec[0..256]);
        } else {
            // Fallback (identity map) if code is malformed/too short
            for i in 0..256 {
                opcode_map[i] = i as u8;
            }
        }
        let expected_hash = code.iter().fold(0u32, |acc, &x| acc.wrapping_add(x as u32));
        
        Self {
            stack: Stack::new(),
            frames: Vec::new(),
            locals: vec![Value::Null; 256],
            code,
            pc_base: 0,
            pc_offset: 0,
            expected_hash,
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

    // Splitting the program counter into pc_base and pc_offset specifically to defeat PUSHAN's VPC-sensitive symbolic emulation.
    // A stable single pointer is the primary heuristic PUSHAN uses to identify and track virtual program counters during trace-free deobfuscation.
    // See Pushan: Trace-Free Deobfuscation of Virtualisation-Obfuscated Binaries, arxiv.org/abs/2603.18355.
    fn get_pc(&self) -> usize {
        self.pc_base.wrapping_add(self.pc_offset)
    }

    fn set_pc(&mut self, new_pc: usize) {
        self.pc_base = new_pc / 2;
        self.pc_offset = new_pc - self.pc_base;
    }

    fn advance_pc(&mut self, amount: usize) {
        if self.get_pc() % 2 == 0 {
            self.pc_base = self.pc_base.wrapping_add(amount);
        } else {
            self.pc_offset = self.pc_offset.wrapping_add(amount);
        }
    }

    fn decrypt_page(&mut self, page_id: u32) {
        // VirtSC Self-Checksumming: Computes a runtime hash of the bytecode payload to detect patching or tampering.
        // If the hash fails, we intentionally do NOT throw an error (which an attacker could hook). Instead, we silently corrupt the session key.
        // This causes subsequent JIT decryptions to produce garbage opcodes, executing a silent, untraceable crash.
        // See VirtSC: Combining Virtualisation Obfuscation with Self-Checksumming, arxiv.org/abs/1909.11404.
        let current_hash = self.code.iter().fold(0u32, |acc, &x| acc.wrapping_add(x as u32));
        if current_hash != self.expected_hash {
            // Silently corrupt session key
            self.session_key[0] ^= 0xFF;
        }

        let start_addr = page_id as usize * 256;
        for i in 0..256 {
            if start_addr + i < self.code.len() {
                let key_byte = self.session_key[(start_addr + i) % 32];
                self.ves[i] = self.code[start_addr + i] ^ key_byte;
            } else {
                self.ves[i] = 0;
            }
        }
        self.current_page_id = page_id as i32;
    }

    fn read_byte(&mut self) -> Result<u8, VmError> {
        let pc = self.get_pc();
        if pc >= self.code.len() {
            panic!("UnexpectedEndOfCode at PC: {}", pc);
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

    fn read_u32(&mut self) -> Result<u32, VmError> {
        let b1 = self.read_byte()?;
        let b2 = self.read_byte()?;
        let b3 = self.read_byte()?;
        let b4 = self.read_byte()?;
        Ok(u32::from_le_bytes([b1, b2, b3, b4]))
    }

    fn read_u64(&mut self) -> Result<u64, VmError> {
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
            let perf = global.dyn_into::<web_sys::Window>()
                .map(|w| w.performance().unwrap())
                .or_else(|global| global.dyn_into::<web_sys::WorkerGlobalScope>().map(|w| w.performance().unwrap()))
                .ok();
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
            let opcode = OpCode::try_from(opcode_val_translated).map_err(|_| {
                println!("InvalidOpCode at PC: {} (translated={}, original={})", self.get_pc() - 1, opcode_val_translated, raw_instruction);
                VmError::InvalidOpCode(opcode_val_translated)
            })?;

            // Decentralising the monolithic match block into tiered sub-dispatchers.
            // A monolithic switch with a high successor count is the universal fingerprint LLVM passes use to statically identify virtual machine dispatchers.
            // By shattering it into grouped `matches!` statements, we artificially fragment the Control Flow Graph, defeating trace-free deobfuscators like PUSHAN.
            // See Pushan: Trace-Free Deobfuscation of Virtualisation-Obfuscated Binaries, arxiv.org/abs/2603.18355.
            
            if matches!(opcode, OpCode::PushInt | OpCode::PushFloat | OpCode::PushString | OpCode::PushBool | OpCode::PushNull | OpCode::Pop | OpCode::Dup | OpCode::LoadLocal | OpCode::StoreLocal) {
                match opcode {
                    OpCode::PushInt => {
                    let val = self.read_u32()? as i32 as i64;
                    self.stack.push(Value::Int(val))?;
                }
                OpCode::PushFloat => {
                    let val = f64::from_bits(self.read_u64()?);
                    self.stack.push(Value::Float(val))?;
                }
                OpCode::PushString => {
                    let nonce_u32 = self.read_u32()?;
                    let nonce = nonce_u32.to_le_bytes();
                    let len = self.read_u32()? as usize;
                    let mut bytes = Vec::with_capacity(len);
                    for j in 0..len {
                        let enc_byte = self.read_byte()?;
                        let key_idx = (nonce[j % 4] as usize + j) % 32;
                        let key_byte = self.session_key[key_idx];
                        bytes.push(enc_byte ^ key_byte);
                    }
                    let s = String::from_utf8(bytes).unwrap_or_else(|_| "INVALID_STR".to_string());
                    self.stack.push(Value::Str(std::sync::Arc::new(s)))?;
                }
                OpCode::PushBool => {
                    let val = self.read_u32()?;
                    self.stack.push(Value::Bool(val != 0))?;
                }
                OpCode::PushNull => {
                    self.stack.push(Value::Null)?;
                }
                OpCode::Pop => {
                    self.stack.pop()?;
                }
                OpCode::Dup => {
                    self.stack.dup()?;
                }
                OpCode::LoadLocal => {
                    let idx = self.read_u32()? as usize;
                    let val = self.locals.get(idx).ok_or(VmError::InvalidLocalSlot)?.clone();
                    self.stack.push(val)?;
                }
                OpCode::StoreLocal => {
                    let idx = self.read_u32()? as usize;
                    let val = self.stack.pop()?;
                    if idx >= self.locals.len() {
                        return Err(VmError::InvalidLocalSlot);
                    }
                    self.locals[idx] = val;
                }
                _ => {}
            }
        } else if matches!(opcode, OpCode::Add | OpCode::Sub | OpCode::Mul | OpCode::Div | OpCode::Eq | OpCode::Neq | OpCode::Lt | OpCode::Gt | OpCode::Lte | OpCode::Gte | OpCode::And | OpCode::Or | OpCode::Not | OpCode::BitAnd | OpCode::BitOr | OpCode::BitXor | OpCode::BitNot | OpCode::Shl | OpCode::Shr | OpCode::Concat) {
            match opcode {
                OpCode::Add => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    match (a, b) {
                        (Value::Int(a_val), Value::Int(b_val)) => self.stack.push(Value::Int(a_val + b_val))?,
                        (Value::Float(a_val), Value::Float(b_val)) => self.stack.push(Value::Float(a_val + b_val))?,
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::Concat => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    match (a, b) {
                        (Value::Str(a_val), Value::Str(b_val)) => {
                            let mut res = String::new();
                            res.push_str(&a_val);
                            res.push_str(&b_val);
                            self.stack.push(Value::Str(std::sync::Arc::new(res)))?;
                        }
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::Sub => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    match (a, b) {
                        (Value::Int(a_val), Value::Int(b_val)) => self.stack.push(Value::Int(a_val - b_val))?,
                        (Value::Float(a_val), Value::Float(b_val)) => self.stack.push(Value::Float(a_val - b_val))?,
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::Mul => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    match (a, b) {
                        (Value::Int(a_val), Value::Int(b_val)) => self.stack.push(Value::Int(a_val * b_val))?,
                        (Value::Float(a_val), Value::Float(b_val)) => self.stack.push(Value::Float(a_val * b_val))?,
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::Div => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    match (a, b) {
                        (Value::Int(a_val), Value::Int(b_val)) => {
                            if b_val == 0 { return Err(VmError::DivisionByZero); }
                            self.stack.push(Value::Int(a_val / b_val))?;
                        }
                        (Value::Float(a_val), Value::Float(b_val)) => {
                            if b_val == 0.0 { return Err(VmError::DivisionByZero); }
                            self.stack.push(Value::Float(a_val / b_val))?;
                        }
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::Eq => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    self.stack.push(Value::Bool(a == b))?;
                }
                OpCode::Neq => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    self.stack.push(Value::Bool(a != b))?;
                }
                OpCode::Lt => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    match (a, b) {
                        (Value::Int(a_val), Value::Int(b_val)) => self.stack.push(Value::Bool(a_val < b_val))?,
                        (Value::Float(a_val), Value::Float(b_val)) => self.stack.push(Value::Bool(a_val < b_val))?,
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::Gt => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    match (a, b) {
                        (Value::Int(a_val), Value::Int(b_val)) => self.stack.push(Value::Bool(a_val > b_val))?,
                        (Value::Float(a_val), Value::Float(b_val)) => self.stack.push(Value::Bool(a_val > b_val))?,
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::Lte => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    match (a, b) {
                        (Value::Int(a_val), Value::Int(b_val)) => self.stack.push(Value::Bool(a_val <= b_val))?,
                        (Value::Float(a_val), Value::Float(b_val)) => self.stack.push(Value::Bool(a_val <= b_val))?,
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::Gte => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    match (a, b) {
                        (Value::Int(a_val), Value::Int(b_val)) => self.stack.push(Value::Bool(a_val >= b_val))?,
                        (Value::Float(a_val), Value::Float(b_val)) => self.stack.push(Value::Bool(a_val >= b_val))?,
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::And => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    self.stack.push(Value::Bool(a.is_truthy() && b.is_truthy()))?;
                }
                OpCode::Or => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    self.stack.push(Value::Bool(a.is_truthy() || b.is_truthy()))?;
                }
                OpCode::Not => {
                    let a = self.stack.pop()?;
                    self.stack.push(Value::Bool(!a.is_truthy()))?;
                }
                OpCode::BitAnd => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    match (a, b) {
                        (Value::Int(a_val), Value::Int(b_val)) => self.stack.push(Value::Int(a_val & b_val))?,
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::BitOr => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    match (a, b) {
                        (Value::Int(a_val), Value::Int(b_val)) => self.stack.push(Value::Int(a_val | b_val))?,
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::BitXor => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    match (a, b) {
                        (Value::Int(a_val), Value::Int(b_val)) => self.stack.push(Value::Int(a_val ^ b_val))?,
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::BitNot => {
                    let a = self.stack.pop()?;
                    match a {
                        Value::Int(a_val) => self.stack.push(Value::Int(!a_val))?,
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::Shl => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    match (a, b) {
                        (Value::Int(a_val), Value::Int(b_val)) => self.stack.push(Value::Int(a_val << b_val))?,
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::Shr => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    match (a, b) {
                        (Value::Int(a_val), Value::Int(b_val)) => self.stack.push(Value::Int(a_val >> b_val))?,
                        _ => return Err(VmError::TypeError),
                    }
                }
                _ => {}
            }
        } else {
            match opcode {
                OpCode::Jump => {
                    let target = self.read_u32()? as usize;
                    self.set_pc(target);
                }
                OpCode::JumpIf => {
                    let target = self.read_u32()? as usize;
                    let cond = self.stack.pop()?;
                    if cond.is_truthy() {
                        self.set_pc(target);
                    }
                }
                OpCode::JumpIfNot => {
                    let target = self.read_u32()? as usize;
                    let cond = self.stack.pop()?;
                    if !cond.is_truthy() {
                        self.set_pc(target);
                    }
                }
                OpCode::NewObject => {
                    self.stack.push(Value::Object(Rc::new(RefCell::new(HashMap::new()))))?;
                }
                OpCode::NewList => {
                    self.stack.push(Value::List(Rc::new(RefCell::new(Vec::new()))))?;
                }
                OpCode::ListPush => {
                    let val = self.stack.pop()?;
                    let list = self.stack.pop()?;
                    if let Value::List(ref vec) = list {
                        vec.borrow_mut().push(val);
                        self.stack.push(list)?;
                    } else {
                        return Err(VmError::TypeError);
                    }
                }
                OpCode::GetMember => {
                    let key = self.stack.pop()?;
                    let target = self.stack.pop()?;
                    match target {
                        Value::Object(map_rc) => {
                            if let Value::Str(s) = key {
                                let val = map_rc.borrow().get(s.as_str()).cloned().unwrap_or(Value::Null);
                                self.stack.push(val)?;
                            } else {
                                return Err(VmError::TypeError);
                            }
                        }
                        Value::List(vec_rc) => {
                            if let Value::Int(i) = key {
                                let idx = i as usize;
                                let vec = vec_rc.borrow();
                                let val = vec.get(idx).cloned().unwrap_or(Value::Null);
                                self.stack.push(val)?;
                            } else {
                                return Err(VmError::TypeError);
                            }
                        }
                        Value::Str(s) => {
                            if let Value::Int(i) = key {
                                let idx = i as usize;
                                if idx < s.len() {
                                    let ch = s.chars().nth(idx).unwrap_or('\0').to_string();
                                    self.stack.push(Value::Str(std::sync::Arc::new(ch)))?;
                                } else {
                                    return Err(VmError::IndexOutOfBounds);
                                }
                            } else {
                                return Err(VmError::TypeError);
                            }
                        }
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::SetMember => {
                    let val = self.stack.pop()?;
                    let key = self.stack.pop()?;
                    let target = self.stack.pop()?;
                    match target {
                        Value::Object(ref map_rc) => {
                            if let Value::Str(s) = key {
                                map_rc.borrow_mut().insert(s.to_string(), val);
                                self.stack.push(target.clone())?;
                            } else {
                                return Err(VmError::TypeError);
                            }
                        }
                        Value::List(ref vec_rc) => {
                            if let Value::Int(i) = key {
                                let idx = i as usize;
                                let mut vec = vec_rc.borrow_mut();
                                if idx < vec.len() {
                                    vec[idx] = val;
                                } else if idx == vec.len() {
                                    vec.push(val);
                                } else {
                                    return Err(VmError::IndexOutOfBounds);
                                }
                                self.stack.push(target.clone())?;
                            } else {
                                return Err(VmError::TypeError);
                            }
                        }
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::Length => {
                    let target = self.stack.pop()?;
                    match target {
                        Value::List(vec_rc) => {
                            self.stack.push(Value::Int(vec_rc.borrow().len() as i64))?;
                        }
                        Value::Str(s) => {
                            self.stack.push(Value::Int(s.len() as i64))?;
                        }
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::Call => {
                    let target = self.read_u32()? as usize;
                    let arg_count = self.read_u32()? as usize;
                    
                    let mut new_locals = vec![Value::Null; 256];
                    for i in (0..arg_count).rev() {
                        new_locals[i] = self.stack.pop()?;
                    }

                    if self.frames.len() >= 64 {
                        return Err(VmError::CallStackOverflow);
                    }
                    
                    self.frames.push(CallFrame {
                        pc_base: self.pc_base,
                        pc_offset: self.pc_offset,
                        locals: std::mem::replace(&mut self.locals, new_locals),
                    });
                    
                    self.set_pc(target);
                }
                OpCode::Return => {
                    let ret_val = self.stack.pop().unwrap_or(Value::Null);
                    if let Some(frame) = self.frames.pop() {
                        self.locals = frame.locals;
                        self.pc_base = frame.pc_base;
                        self.pc_offset = frame.pc_offset;
                        self.stack.push(ret_val)?;
                    } else {
                        self.stack.push(ret_val)?;
                        break;
                    }
                }
                OpCode::CallNative => {
                    let id = self.read_u32()?;
                    let arg_count = self.read_u32()? as usize;
                    let mut args = Vec::new();
                    for _ in 0..arg_count {
                        args.push(self.stack.pop()?);
                    }
                    args.reverse(); // Args were pushed left-to-right, so popped right-to-left
                    
                    let mut json_arr = serde_json::Value::Array(Vec::new());
                    if let serde_json::Value::Array(ref mut arr) = json_arr {
                        for arg in args {
                            arr.push(crate::wrapper::value_to_json(&arg));
                        }
                    }
                    let args_json = json_arr.to_string();
                    
                    let res_str = native_call(id, &args_json);
                    
                    if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&res_str) {
                        self.stack.push(crate::wrapper::json_to_value(&json_val))?;
                    } else {
                        self.stack.push(Value::Str(std::sync::Arc::new(res_str)))?;
                    }
                }
                OpCode::Hash256 => {
                    let val = self.stack.pop()?;
                    let str_val = match val {
                        Value::Str(s) => s.to_string(),
                        Value::Int(i) => i.to_string(),
                        Value::Float(f) => f.to_string(),
                        Value::Bool(b) => b.to_string(),
                        _ => return Err(VmError::TypeError),
                    };
                    use sha2::{Sha256, Digest};
                    let mut hasher = Sha256::new();
                    hasher.update(str_val.as_bytes());
                    let result = hasher.finalize();
                    let hex_str = format!("{:x}", result);
                    self.stack.push(Value::Str(std::sync::Arc::new(hex_str)))?;
                }
                OpCode::JSONStringify => {
                    let val = self.stack.pop()?;
                    let json_val = crate::wrapper::value_to_json(&val);
                    let json_str = json_val.to_string();
                    self.stack.push(Value::Str(std::sync::Arc::new(json_str)))?;
                }
                OpCode::EncryptAES => {
                    let key_val = self.stack.pop()?;
                    let payload_val = self.stack.pop()?;
                    
                    if let (Value::Str(key_str), Value::Str(payload_str)) = (key_val, payload_val) {
                        // Pad or truncate key to 32 bytes
                        let mut key_bytes = [0u8; 32];
                        let kb = key_str.as_bytes();
                        let len = kb.len().min(32);
                        key_bytes[..len].copy_from_slice(&kb[..len]);
                        
                        match crypto_core::encrypt_aes_gcm(payload_str.as_bytes(), &key_bytes) {
                            Ok(encrypted) => {
                                // Hex encode the result
                                let mut hex_str = String::with_capacity(encrypted.len() * 2);
                                for byte in encrypted {
                                    use std::fmt::Write;
                                    write!(&mut hex_str, "{:02x}", byte).unwrap();
                                }
                                self.stack.push(Value::Str(std::sync::Arc::new(hex_str)))?;
                            }
                            Err(_) => return Err(VmError::TypeError), // Generic error for now
                        }
                    } else {
                        return Err(VmError::TypeError);
                    }
                }
                OpCode::Halt => {
                    return Ok(self.stack.pop().unwrap_or(Value::Null));
                }
                _ => {}
            }
        }
        }

        Ok(self.stack.pop().unwrap_or(Value::Null))
    }
}
