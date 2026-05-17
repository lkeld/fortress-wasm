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
    pub fn new(mut code: Vec<u8>, constants: Vec<Value>) -> Self {
        let mut opcode_map = [0u8; 256];
        if code.len() >= 256 {
            opcode_map.copy_from_slice(&code[0..256]);
            code.drain(0..256);
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

        loop {
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
                OpCode::AddInt => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    if let (Value::Int(a_val), Value::Int(b_val)) = (a, b) {
                        self.stack.push(Value::Int(a_val + b_val))?;
                    } else { return Err(VmError::TypeError); }
                }
                OpCode::SubInt => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    if let (Value::Int(a_val), Value::Int(b_val)) = (a, b) {
                        self.stack.push(Value::Int(a_val - b_val))?;
                    } else { return Err(VmError::TypeError); }
                }
                OpCode::MulInt => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    if let (Value::Int(a_val), Value::Int(b_val)) = (a, b) {
                        self.stack.push(Value::Int(a_val * b_val))?;
                    } else { return Err(VmError::TypeError); }
                }
                OpCode::DivInt => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    if let (Value::Int(a_val), Value::Int(b_val)) = (a, b) {
                        if b_val == 0 { return Err(VmError::DivisionByZero); }
                        self.stack.push(Value::Int(a_val / b_val))?;
                    } else { return Err(VmError::TypeError); }
                }
                OpCode::AddFloat => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    if let (Value::Float(a_val), Value::Float(b_val)) = (a, b) {
                        self.stack.push(Value::Float(a_val + b_val))?;
                    } else { return Err(VmError::TypeError); }
                }
                OpCode::SubFloat => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    if let (Value::Float(a_val), Value::Float(b_val)) = (a, b) {
                        self.stack.push(Value::Float(a_val - b_val))?;
                    } else { return Err(VmError::TypeError); }
                }
                OpCode::MulFloat => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    if let (Value::Float(a_val), Value::Float(b_val)) = (a, b) {
                        self.stack.push(Value::Float(a_val * b_val))?;
                    } else { return Err(VmError::TypeError); }
                }
                OpCode::DivFloat => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    if let (Value::Float(a_val), Value::Float(b_val)) = (a, b) {
                        self.stack.push(Value::Float(a_val / b_val))?;
                    } else { return Err(VmError::TypeError); }
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
                    
                    // A simple JSON serialization for arguments (in a real VM we'd map this properly)
                    let args_json = "[]"; // Simplified for now since we don't have serde implemented on Value yet
                    
                    let res_str = native_call(id, args_json);
                    self.stack.push(Value::Str(std::sync::Arc::new(res_str)))?;
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
        code.push(OpCode::AddInt as u8);
        code.push(OpCode::Push as u8);
        code.extend_from_slice(&2u32.to_le_bytes());
        code.push(OpCode::Eq as u8);
        code.push(OpCode::Halt as u8);

        let mut vm = Vm::new(code, constants);
        let result = vm.run().expect("VM execution failed");
        assert_eq!(result, Value::Bool(true));
    }

    #[test]
    fn test_objects_and_references() {
        // Create an object, set a field, get it back.
        // Pushes key "score", pushes value 100, pushes new object, sets field, gets field.
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

        let mut vm = Vm::new(code, constants);
        let result = vm.run().expect("VM execution failed");
        assert_eq!(result, Value::Int(100));
    }
}
