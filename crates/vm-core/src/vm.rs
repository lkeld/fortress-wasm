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
    pc: usize,
    locals: Vec<Value>,
}

pub struct Vm {
    stack: Stack,
    frames: Vec<CallFrame>,
    locals: Vec<Value>,
    constants: Vec<Value>,
    code: Vec<u8>,
    pc: usize,
    opcode_map: [u8; 256],
}

impl Vm {
    pub fn new(code: Vec<u8>, constants: Vec<Value>, opcode_map_vec: Vec<u8>) -> Self {
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
            constants,
            code,
            pc: 0,
            opcode_map,
        }
    }

    pub fn set_local(&mut self, index: usize, value: Value) {
        if index < self.locals.len() {
            self.locals[index] = value;
        }
    }

    fn read_byte(&mut self) -> Result<u8, VmError> {
        if self.pc >= self.code.len() {
            return Err(VmError::UnexpectedEndOfCode);
        }
        let b = self.code[self.pc];
        self.pc += 1;
        Ok(b)
    }

    fn read_u32(&mut self) -> Result<u32, VmError> {
        if self.pc + 4 > self.code.len() {
            return Err(VmError::UnexpectedEndOfCode);
        }
        let mut bytes = [0u8; 4];
        bytes.copy_from_slice(&self.code[self.pc..self.pc + 4]);
        self.pc += 4;
        Ok(u32::from_le_bytes(bytes))
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

            if self.pc >= self.code.len() {
                break;
            }

            let raw_instruction = self.read_byte()?;
            let instruction = self.opcode_map[raw_instruction as usize];
            let opcode = OpCode::try_from(instruction).map_err(|_| VmError::InvalidOpCode(instruction))?;

            match opcode {
                OpCode::Push => {
                    let idx = self.read_u32()? as usize;
                    let val = self.constants.get(idx).ok_or(VmError::InvalidConstantIndex)?.clone();
                    self.stack.push(val)?;
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
                OpCode::Add => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    match (a, b) {
                        (Value::Int(a_val), Value::Int(b_val)) => self.stack.push(Value::Int(a_val + b_val))?,
                        (Value::Float(a_val), Value::Float(b_val)) => self.stack.push(Value::Float(a_val + b_val))?,
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
                OpCode::Jump => {
                    let target = self.read_u32()? as usize;
                    self.pc = target;
                }
                OpCode::JumpIf => {
                    let target = self.read_u32()? as usize;
                    let cond = self.stack.pop()?;
                    if cond.is_truthy() {
                        self.pc = target;
                    }
                }
                OpCode::JumpIfNot => {
                    let target = self.read_u32()? as usize;
                    let cond = self.stack.pop()?;
                    if !cond.is_truthy() {
                        self.pc = target;
                    }
                }
                OpCode::NewObject => {
                    self.stack.push(Value::Object(Rc::new(RefCell::new(HashMap::new()))))?;
                }
                OpCode::SetField => {
                    let key_idx = self.read_u32()? as usize;
                    let key_val = self.constants.get(key_idx).ok_or(VmError::InvalidConstantIndex)?;
                    let key_str = match key_val {
                        Value::Str(s) => s.to_string(),
                        _ => return Err(VmError::TypeError),
                    };
                    let val = self.stack.pop()?;
                    let obj = self.stack.pop()?;
                    if let Value::Object(ref map) = obj {
                        map.borrow_mut().insert(key_str, val);
                        self.stack.push(obj)?;
                    } else {
                        return Err(VmError::TypeError);
                    }
                }
                OpCode::GetField => {
                    let key_idx = self.read_u32()? as usize;
                    let key_val = self.constants.get(key_idx).ok_or(VmError::InvalidConstantIndex)?;
                    let key_str = match key_val {
                        Value::Str(s) => s.to_string(),
                        _ => return Err(VmError::TypeError),
                    };
                    let obj = self.stack.pop()?;
                    if let Value::Object(ref map) = obj {
                        let val = map.borrow().get(&key_str).cloned().unwrap_or(Value::Null);
                        self.stack.push(val)?;
                    } else {
                        return Err(VmError::TypeError);
                    }
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

                        pc: self.pc,
                        locals: std::mem::replace(&mut self.locals, new_locals),
                    });

                    self.pc = target;
                }
                OpCode::Return => {
                    let ret_val = self.stack.pop().unwrap_or(Value::Null);
                    if let Some(frame) = self.frames.pop() {
                        self.pc = frame.pc;
                        self.locals = frame.locals;
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
            }
        }

        Ok(self.stack.pop().unwrap_or(Value::Null))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::opcodes::OpCode;
    use std::sync::Arc;

    #[test]
    fn test_addition_and_truthiness() {
        // Simple program: 2 + 3 == 5
        let constants = vec![Value::Int(2), Value::Int(3), Value::Int(5)];
        let mut code = Vec::new();
        code.push(OpCode::Push as u8);
        code.extend_from_slice(&0u32.to_le_bytes());
        code.push(OpCode::Push as u8);
        code.extend_from_slice(&1u32.to_le_bytes());
        code.push(OpCode::Add as u8);
        code.push(OpCode::Push as u8);
        code.extend_from_slice(&2u32.to_le_bytes());
        code.push(OpCode::Eq as u8);
        code.push(OpCode::Halt as u8);

        let mut vm = Vm::new(code, constants, vec![]);
        let result = vm.run().expect("VM execution failed");
        assert_eq!(result, Value::Bool(true));
    }

    #[test]
    fn test_objects_and_references() {
        let constants = vec![Value::Str(Arc::new("score".to_string())), Value::Int(100)];
        let mut code = Vec::new();
        code.push(OpCode::NewObject as u8); // Object is at stack[0]
        code.push(OpCode::Dup as u8); // Dup object
        code.push(OpCode::Push as u8); 
        code.extend_from_slice(&1u32.to_le_bytes()); // Push 100
        code.push(OpCode::SetField as u8);
        code.extend_from_slice(&0u32.to_le_bytes()); // Set field "score"
        
        code.push(OpCode::GetField as u8); // Get field "score" from object
        code.extend_from_slice(&0u32.to_le_bytes());
        code.push(OpCode::Halt as u8);

        let mut vm = Vm::new(code, constants, vec![]);
        let result = vm.run().expect("VM execution failed");
        assert_eq!(result, Value::Int(100));
    }

    #[test]
    fn test_stack_overflow() {
        let mut code = Vec::new();
        // Push 0 over 1024 times to trigger stack overflow
        for _ in 0..1025 {
            code.push(OpCode::Push as u8);
            code.extend_from_slice(&0u32.to_le_bytes());
        }
        let constants = vec![Value::Int(0)];
        let mut vm = Vm::new(code, constants, vec![]);
        let result = vm.run();
        assert!(matches!(result, Err(VmError::StackOverflow)));
    }

    #[test]
    fn test_call_stack_overflow() {
        let mut code = Vec::new();
        code.push(OpCode::Call as u8);
        code.extend_from_slice(&0u32.to_le_bytes()); // target = 0
        code.extend_from_slice(&0u32.to_le_bytes()); // arg_count = 0
        
        let mut vm = Vm::new(code, vec![], vec![]);
        let result = vm.run();
        assert!(matches!(result, Err(VmError::CallStackOverflow)));
    }

    #[test]
    fn test_unexpected_end_of_code() {
        let mut code = Vec::new();
        code.push(OpCode::Push as u8);
        
        let mut vm = Vm::new(code, vec![], vec![]);
        let result = vm.run();
        assert!(matches!(result, Err(VmError::UnexpectedEndOfCode)));
    }

    #[test]
    fn test_arithmetic_exhaustive() {
        let constants = vec![Value::Int(10), Value::Int(3)];
        
        let run_op = |op: OpCode| -> Value {
            let mut code = Vec::new();
            code.push(OpCode::Push as u8);
            code.extend_from_slice(&0u32.to_le_bytes());
            code.push(OpCode::Push as u8);
            code.extend_from_slice(&1u32.to_le_bytes());
            code.push(op as u8);
            code.push(OpCode::Halt as u8);
            Vm::new(code, constants.clone(), vec![]).run().unwrap()
        };

        assert_eq!(run_op(OpCode::Add), Value::Int(13));
        assert_eq!(run_op(OpCode::Sub), Value::Int(7));
        assert_eq!(run_op(OpCode::Mul), Value::Int(30));
        assert_eq!(run_op(OpCode::Div), Value::Int(3)); // 10 / 3 = 3

        // Float arithmetic
        let fconstants = vec![Value::Float(10.0), Value::Float(2.5)];
        let run_fop = |op: OpCode| -> Value {
            let mut code = Vec::new();
            code.push(OpCode::Push as u8);
            code.extend_from_slice(&0u32.to_le_bytes());
            code.push(OpCode::Push as u8);
            code.extend_from_slice(&1u32.to_le_bytes());
            code.push(op as u8);
            code.push(OpCode::Halt as u8);
            Vm::new(code, fconstants.clone(), vec![]).run().unwrap()
        };

        assert_eq!(run_fop(OpCode::Add), Value::Float(12.5));
        assert_eq!(run_fop(OpCode::Sub), Value::Float(7.5));
        assert_eq!(run_fop(OpCode::Mul), Value::Float(25.0));
        assert_eq!(run_fop(OpCode::Div), Value::Float(4.0));
    }

    #[test]
    fn test_logic_and_comparison() {
        let constants = vec![Value::Int(10), Value::Int(20), Value::Bool(true), Value::Bool(false)];
        // idx 0=10, 1=20, 2=true, 3=false
        
        let eval_cmp = |a: u32, b: u32, op: OpCode| -> Value {
            let mut code = Vec::new();
            code.push(OpCode::Push as u8);
            code.extend_from_slice(&a.to_le_bytes());
            code.push(OpCode::Push as u8);
            code.extend_from_slice(&b.to_le_bytes());
            code.push(op as u8);
            code.push(OpCode::Halt as u8);
            Vm::new(code, constants.clone(), vec![]).run().unwrap()
        };

        assert_eq!(eval_cmp(0, 1, OpCode::Eq), Value::Bool(false));
        assert_eq!(eval_cmp(0, 0, OpCode::Eq), Value::Bool(true));
        assert_eq!(eval_cmp(0, 1, OpCode::Lt), Value::Bool(true));
        assert_eq!(eval_cmp(1, 0, OpCode::Gt), Value::Bool(true));
        assert_eq!(eval_cmp(0, 0, OpCode::Lte), Value::Bool(true));
        assert_eq!(eval_cmp(2, 3, OpCode::And), Value::Bool(false));
        assert_eq!(eval_cmp(2, 3, OpCode::Or), Value::Bool(true));

        // Test Not
        let mut code = Vec::new();
        code.push(OpCode::Push as u8);
        code.extend_from_slice(&2u32.to_le_bytes()); // Push true
        code.push(OpCode::Not as u8);
        code.push(OpCode::Halt as u8);
        let res = Vm::new(code, constants.clone(), vec![]).run().unwrap();
        assert_eq!(res, Value::Bool(false));
    }

    #[test]
    fn test_list_push() {
        let constants = vec![Value::Int(5), Value::Int(10)];
        let mut code = Vec::new();
        code.push(OpCode::NewList as u8);
        code.push(OpCode::Dup as u8);
        code.push(OpCode::Push as u8);
        code.extend_from_slice(&0u32.to_le_bytes()); // Push 5
        code.push(OpCode::ListPush as u8);
        
        code.push(OpCode::Dup as u8);
        code.push(OpCode::Push as u8);
        code.extend_from_slice(&1u32.to_le_bytes()); // Push 10
        code.push(OpCode::ListPush as u8);
        code.push(OpCode::Halt as u8);

        let mut vm = Vm::new(code, constants, vec![]);
        let result = vm.run().unwrap();
        
        if let Value::List(vec_rc) = result {
            let vec = vec_rc.borrow();
            assert_eq!(vec.len(), 2);
            assert_eq!(vec[0], Value::Int(5));
            assert_eq!(vec[1], Value::Int(10));
        } else {
            panic!("Expected list");
        }
    }

    #[test]
    fn test_edge_cases() {
        
        // Test String + Int TypeError
        let constants = vec![Value::Str(Arc::new("Hello".to_string())), Value::Int(5)];
        let mut fail_code = Vec::new();
        fail_code.push(OpCode::Push as u8);
        fail_code.extend_from_slice(&0u32.to_le_bytes()); // Push String
        fail_code.push(OpCode::Push as u8);
        fail_code.extend_from_slice(&1u32.to_le_bytes()); // Push Int
        fail_code.push(OpCode::Add as u8);
        fail_code.push(OpCode::Halt as u8);
        
        let res = Vm::new(fail_code, constants.clone(), vec![]).run();
        assert!(matches!(res, Err(VmError::TypeError)));
        
        // Test Division by Zero
        let mut consts2 = constants.clone();
        consts2.push(Value::Int(0)); // index 2 is Int(0)
        
        let mut fail_code2 = Vec::new();
        fail_code2.push(OpCode::Push as u8);
        fail_code2.extend_from_slice(&1u32.to_le_bytes()); // Push 5 (index 1)
        fail_code2.push(OpCode::Push as u8);
        fail_code2.extend_from_slice(&2u32.to_le_bytes()); // Push 0 (index 2)
        fail_code2.push(OpCode::Div as u8);
        fail_code2.push(OpCode::Halt as u8);
        
        let res2 = Vm::new(fail_code2, consts2, vec![]).run();
        assert!(matches!(res2, Err(VmError::DivisionByZero)));
        
        // Test SetMember IndexOutOfBounds
        let mut out_code = Vec::new();
        out_code.push(OpCode::NewList as u8);
        out_code.push(OpCode::Dup as u8); // list
        out_code.push(OpCode::Push as u8);
        out_code.extend_from_slice(&1u32.to_le_bytes()); // push Int(5) as key (index out of bounds for empty list!)
        out_code.push(OpCode::Push as u8);
        out_code.extend_from_slice(&1u32.to_le_bytes()); // push Int(5) as val
        out_code.push(OpCode::SetMember as u8);
        out_code.push(OpCode::Halt as u8);
        
        let res3 = Vm::new(out_code, constants.clone(), vec![]).run();
        assert!(matches!(res3, Err(VmError::IndexOutOfBounds)));
        
        // Test Infinite Loop Limit
        let mut loop_code = Vec::new();
        loop_code.push(OpCode::Jump as u8);
        loop_code.extend_from_slice(&0u32.to_le_bytes()); // Jump to 0 (since first 256 bytes are drained)
        
        let res4 = Vm::new(loop_code, constants, vec![]).run();
        assert!(matches!(res4, Err(VmError::ExecutionLimitExceeded)));
    }
    
    #[test]
    fn test_hash256() {
        let constants = vec![Value::Str(Arc::new("password123".to_string()))];
        let mut code = Vec::new();
        code.push(OpCode::Push as u8);
        code.extend_from_slice(&0u32.to_le_bytes()); // Push "password123"
        code.push(OpCode::Hash256 as u8);
        code.push(OpCode::Halt as u8);
        
        let res = Vm::new(code, constants, vec![]).run().unwrap();
        
        if let Value::Str(hash_str) = res {
            // SHA256 of "password123" is ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f
            assert_eq!(*hash_str, "ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f");
        } else {
            panic!("Expected string hash");
        }
    }

    #[test]
    fn test_json_stringify() {
        let mut code = Vec::new();
        // Create list [5, 10]
        code.push(OpCode::NewList as u8);
        code.push(OpCode::Dup as u8);
        code.push(OpCode::Push as u8);
        code.extend_from_slice(&0u32.to_le_bytes()); // Push 5
        code.push(OpCode::ListPush as u8);
        code.push(OpCode::Dup as u8);
        code.push(OpCode::Push as u8);
        code.extend_from_slice(&1u32.to_le_bytes()); // Push 10
        code.push(OpCode::ListPush as u8);
        
        // Stringify
        code.push(OpCode::JSONStringify as u8);
        code.push(OpCode::Halt as u8);

        let constants = vec![Value::Int(5), Value::Int(10)];
        let res = Vm::new(code, constants, vec![]).run().unwrap();
        
        if let Value::Str(json_str) = res {
            assert_eq!(*json_str, "[5,10]");
        } else {
            panic!("Expected JSON string");
        }
    }

    #[test]
    fn test_encrypt_aes() {
        let constants = vec![
            Value::Str(Arc::new("{\"data\":\"secret\"}".to_string())), 
            Value::Str(Arc::new("12345678901234567890123456789012".to_string())) // 32 byte key
        ];
        
        let mut code = Vec::new();
        code.push(OpCode::Push as u8);
        code.extend_from_slice(&0u32.to_le_bytes()); // Push payload
        code.push(OpCode::Push as u8);
        code.extend_from_slice(&1u32.to_le_bytes()); // Push key
        code.push(OpCode::EncryptAES as u8);
        code.push(OpCode::Halt as u8);
        
        let res = Vm::new(code, constants, vec![]).run().unwrap();
        
        if let Value::Str(hex_str) = res {
            // Ciphertext should be at least 12 bytes nonce + 16 bytes MAC = 28 bytes = 56 hex chars
            assert!(hex_str.len() > 56, "Ciphertext too short");
        } else {
            panic!("Expected Encrypted hex string");
        }
    }
}
