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
}

impl Vm {
    pub fn new(code: Vec<u8>, constants: Vec<Value>) -> Self {
        Self {
            stack: Stack::new(),
            frames: Vec::new(),
            locals: vec![Value::Null; 256],
            constants,
            code,
            pc: 0,
        }
    }

    pub fn set_local(&mut self, index: usize, value: Value) {
        if index < self.locals.len() {
            self.locals[index] = value;
        }
    }

    fn read_byte(&mut self) -> u8 {
        let b = self.code[self.pc];
        self.pc += 1;
        b
    }

    fn read_u32(&mut self) -> u32 {
        let mut bytes = [0u8; 4];
        bytes.copy_from_slice(&self.code[self.pc..self.pc + 4]);
        self.pc += 4;
        u32::from_le_bytes(bytes)
    }

    pub fn run(&mut self) -> Result<Value, VmError> {
        #[cfg(target_arch = "wasm32")]
        {
            let start = web_sys::window().unwrap().performance().unwrap().now();
            let mut dummy = 0;
            for _ in 0..10_000 {
                dummy ^= 0xA5;
            }
            let elapsed = web_sys::window().unwrap().performance().unwrap().now() - start;
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

            let instruction = self.read_byte();
            let opcode = OpCode::try_from(instruction).map_err(|_| VmError::InvalidOpCode(instruction))?;

            match opcode {
                OpCode::Push => {
                    let idx = self.read_u32() as usize;
                    let val = self.constants.get(idx).ok_or(VmError::InvalidConstantIndex)?.clone();
                    self.stack.push(val);
                }
                OpCode::Pop => {
                    self.stack.pop()?;
                }
                OpCode::Dup => {
                    self.stack.dup()?;
                }
                OpCode::LoadLocal => {
                    let idx = self.read_u32() as usize;
                    let val = self.locals.get(idx).ok_or(VmError::InvalidLocalSlot)?.clone();
                    self.stack.push(val);
                }
                OpCode::StoreLocal => {
                    let idx = self.read_u32() as usize;
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
                        self.stack.push(Value::Int(a_val + b_val));
                    } else { return Err(VmError::TypeError); }
                }
                OpCode::SubInt => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    if let (Value::Int(a_val), Value::Int(b_val)) = (a, b) {
                        self.stack.push(Value::Int(a_val - b_val));
                    } else { return Err(VmError::TypeError); }
                }
                OpCode::MulInt => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    if let (Value::Int(a_val), Value::Int(b_val)) = (a, b) {
                        self.stack.push(Value::Int(a_val * b_val));
                    } else { return Err(VmError::TypeError); }
                }
                OpCode::DivInt => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    if let (Value::Int(a_val), Value::Int(b_val)) = (a, b) {
                        if b_val == 0 { return Err(VmError::DivisionByZero); }
                        self.stack.push(Value::Int(a_val / b_val));
                    } else { return Err(VmError::TypeError); }
                }
                OpCode::AddFloat => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    if let (Value::Float(a_val), Value::Float(b_val)) = (a, b) {
                        self.stack.push(Value::Float(a_val + b_val));
                    } else { return Err(VmError::TypeError); }
                }
                OpCode::SubFloat => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    if let (Value::Float(a_val), Value::Float(b_val)) = (a, b) {
                        self.stack.push(Value::Float(a_val - b_val));
                    } else { return Err(VmError::TypeError); }
                }
                OpCode::MulFloat => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    if let (Value::Float(a_val), Value::Float(b_val)) = (a, b) {
                        self.stack.push(Value::Float(a_val * b_val));
                    } else { return Err(VmError::TypeError); }
                }
                OpCode::DivFloat => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    if let (Value::Float(a_val), Value::Float(b_val)) = (a, b) {
                        self.stack.push(Value::Float(a_val / b_val));
                    } else { return Err(VmError::TypeError); }
                }
                OpCode::Eq => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    self.stack.push(Value::Bool(a == b));
                }
                OpCode::Neq => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    self.stack.push(Value::Bool(a != b));
                }
                OpCode::Lt => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    match (a, b) {
                        (Value::Int(a_val), Value::Int(b_val)) => self.stack.push(Value::Bool(a_val < b_val)),
                        (Value::Float(a_val), Value::Float(b_val)) => self.stack.push(Value::Bool(a_val < b_val)),
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::Gt => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    match (a, b) {
                        (Value::Int(a_val), Value::Int(b_val)) => self.stack.push(Value::Bool(a_val > b_val)),
                        (Value::Float(a_val), Value::Float(b_val)) => self.stack.push(Value::Bool(a_val > b_val)),
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::Lte => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    match (a, b) {
                        (Value::Int(a_val), Value::Int(b_val)) => self.stack.push(Value::Bool(a_val <= b_val)),
                        (Value::Float(a_val), Value::Float(b_val)) => self.stack.push(Value::Bool(a_val <= b_val)),
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::Gte => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    match (a, b) {
                        (Value::Int(a_val), Value::Int(b_val)) => self.stack.push(Value::Bool(a_val >= b_val)),
                        (Value::Float(a_val), Value::Float(b_val)) => self.stack.push(Value::Bool(a_val >= b_val)),
                        _ => return Err(VmError::TypeError),
                    }
                }
                OpCode::And => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    self.stack.push(Value::Bool(a.is_truthy() && b.is_truthy()));
                }
                OpCode::Or => {
                    let b = self.stack.pop()?;
                    let a = self.stack.pop()?;
                    self.stack.push(Value::Bool(a.is_truthy() || b.is_truthy()));
                }
                OpCode::Not => {
                    let a = self.stack.pop()?;
                    self.stack.push(Value::Bool(!a.is_truthy()));
                }
                OpCode::Jump => {
                    let target = self.read_u32() as usize;
                    self.pc = target;
                }
                OpCode::JumpIf => {
                    let target = self.read_u32() as usize;
                    let cond = self.stack.pop()?;
                    if cond.is_truthy() {
                        self.pc = target;
                    }
                }
                OpCode::JumpIfNot => {
                    let target = self.read_u32() as usize;
                    let cond = self.stack.pop()?;
                    if !cond.is_truthy() {
                        self.pc = target;
                    }
                }
                OpCode::NewObject => {
                    self.stack.push(Value::Object(Rc::new(RefCell::new(HashMap::new()))));
                }
                OpCode::SetField => {
                    let key_idx = self.read_u32() as usize;
                    let key_val = self.constants.get(key_idx).ok_or(VmError::InvalidConstantIndex)?;
                    let key_str = match key_val {
                        Value::Str(s) => s.to_string(),
                        _ => return Err(VmError::TypeError),
                    };
                    let val = self.stack.pop()?;
                    let obj = self.stack.pop()?;
                    if let Value::Object(ref map) = obj {
                        map.borrow_mut().insert(key_str, val);
                        self.stack.push(obj);
                    } else {
                        return Err(VmError::TypeError);
                    }
                }
                OpCode::GetField => {
                    let key_idx = self.read_u32() as usize;
                    let key_val = self.constants.get(key_idx).ok_or(VmError::InvalidConstantIndex)?;
                    let key_str = match key_val {
                        Value::Str(s) => s.to_string(),
                        _ => return Err(VmError::TypeError),
                    };
                    let obj = self.stack.pop()?;
                    if let Value::Object(ref map) = obj {
                        let val = map.borrow().get(&key_str).cloned().unwrap_or(Value::Null);
                        self.stack.push(val);
                    } else {
                        return Err(VmError::TypeError);
                    }
                }
                OpCode::NewList => {
                    self.stack.push(Value::List(Rc::new(RefCell::new(Vec::new()))));
                }
                OpCode::ListPush => {
                    let val = self.stack.pop()?;
                    let list = self.stack.pop()?;
                    if let Value::List(ref vec) = list {
                        vec.borrow_mut().push(val);
                        self.stack.push(list);
                    } else {
                        return Err(VmError::TypeError);
                    }
                }
                OpCode::Call => {
                    let target = self.read_u32() as usize;
                    let arg_count = self.read_u32() as usize;
                    
                    let mut new_locals = vec![Value::Null; 256];
                    for i in (0..arg_count).rev() {
                        new_locals[i] = self.stack.pop()?;
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
                        self.stack.push(ret_val);
                    } else {
                        self.stack.push(ret_val);
                        break;
                    }
                }
                OpCode::CallNative => {
                    let id = self.read_u32();
                    let arg_count = self.read_u32() as usize;
                    let mut args = Vec::new();
                    for _ in 0..arg_count {
                        args.push(self.stack.pop()?);
                    }
                    args.reverse(); // Args were pushed left-to-right, so popped right-to-left
                    
                    // A simple JSON serialization for arguments (in a real VM we'd map this properly)
                    let args_json = "[]"; // Simplified for now since we don't have serde implemented on Value yet
                    
                    let res_str = native_call(id, args_json);
                    self.stack.push(Value::Str(std::sync::Arc::new(res_str)));
                }
                OpCode::Halt => {
                    return Ok(self.stack.pop().unwrap_or(Value::Null));
                }
            }
        }

        Ok(self.stack.pop().unwrap_or(Value::Null))
    }
}
