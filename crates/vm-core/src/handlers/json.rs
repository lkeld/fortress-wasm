use crate::vm::Vm;
use crate::stack::VmError;
use crate::value::Value;
use std::collections::HashMap;
use std::rc::Rc;
use std::cell::RefCell;
use crate::handlers::*;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

pub fn op_newobject(vm: &mut Vm) -> Result<bool, VmError> {
    vm.stack.push(Value::Object(Rc::new(RefCell::new(HashMap::new()))))?;
    Ok(false)
}


pub fn op_getmember(vm: &mut Vm) -> Result<bool, VmError> {
    let key = vm.stack.pop()?;
    let target = vm.stack.pop()?;
    match target {
        Value::Object(map_rc) => {
            let key_str = match key {
                Value::Str(s) => s.to_string(),
                Value::Int(i) => i.to_string(),
                Value::Float(f) => to_js_string(f),
                _ => return Err(VmError::TypeError),
            };
            let map = map_rc.try_borrow().map_err(|_| VmError::BorrowError)?;
            let val = map.get(key_str.as_str()).cloned().unwrap_or(Value::Null);
            vm.stack.push(val)?;
        }
        Value::List(vec_rc) => {
            let i = match key {
                Value::Int(i) => i,
                Value::Float(f) if f.fract() == 0.0 => f as i64,
                _ => {
                    vm.stack.push(Value::Null)?;
                    return Ok(false);
                }
            };
            let idx = usize::try_from(i).map_err(|_| VmError::IndexOutOfBounds)?;
            let vec = vec_rc.try_borrow().map_err(|_| VmError::BorrowError)?;
            if idx < vec.len() {
                let val = vec.get(idx).cloned().unwrap_or(Value::Null);
                vm.stack.push(val)?;
            } else {
                return Err(VmError::IndexOutOfBounds);
            }
        }
        Value::Str(s) => {
            let i = match key {
                Value::Int(i) => i,
                Value::Float(f) if f.fract() == 0.0 => f as i64,
                _ => return Err(VmError::TypeError),
            };
            let idx = usize::try_from(i).map_err(|_| VmError::IndexOutOfBounds)?;
            let char_count = s.chars().count();
            if idx < char_count {
                let ch = s.chars().nth(idx).unwrap_or('\0').to_string();
                vm.stack.push(Value::Str(std::sync::Arc::new(ch)))?;
            } else {
                return Err(VmError::IndexOutOfBounds);
            }
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_setmember(vm: &mut Vm) -> Result<bool, VmError> {
    let val = vm.stack.pop()?;
    let key = vm.stack.pop()?;
    let target = vm.stack.pop()?;
    match target {
        Value::Object(ref map_rc) => {
            let key_str = match key {
                Value::Str(s) => s.to_string(),
                Value::Int(i) => i.to_string(),
                Value::Float(f) => to_js_string(f),
                _ => return Err(VmError::TypeError),
            };
            map_rc.try_borrow_mut().map_err(|_| VmError::BorrowError)?.insert(key_str, val);
            vm.stack.push(target.clone())?;
        }
        Value::List(ref vec_rc) => {
            let i = match key {
                Value::Int(i) => i,
                Value::Float(f) if f.fract() == 0.0 => f as i64,
                _ => {
                    vm.stack.push(target.clone())?;
                    return Ok(false);
                }
            };
            let idx = usize::try_from(i).map_err(|_| VmError::IndexOutOfBounds)?;
            let mut vec = vec_rc.try_borrow_mut().map_err(|_| VmError::BorrowError)?;
            if idx < vec.len() {
                let slot = vec.get_mut(idx).ok_or(VmError::IndexOutOfBounds)?;
                *slot = val;
            } else if idx == vec.len() {
                vec.push(val);
            } else {
                return Err(VmError::IndexOutOfBounds);
            }
            vm.stack.push(target.clone())?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_length(vm: &mut Vm) -> Result<bool, VmError> {
    let target = vm.stack.pop()?;
    match target {
        Value::List(vec_rc) => {
            let len = vec_rc.try_borrow().map_err(|_| VmError::BorrowError)?.len();
            vm.stack.push(Value::Int(len as i64))?;
        }
        Value::Str(s) => {
            vm.stack.push(Value::Int(s.chars().count() as i64))?;
        }
        Value::Object(map_rc) => {
            let len = map_rc.try_borrow().map_err(|_| VmError::BorrowError)?.len();
            vm.stack.push(Value::Int(len as i64))?;
        }
        _ => {
            vm.stack.push(Value::Int(0))?;
        }
    }
    Ok(false)
}


pub fn op_jsonstringify(vm: &mut Vm) -> Result<bool, VmError> {
    let val = vm.stack.pop()?;
    let json_val = crate::wrapper::value_to_json(&val);
    let json_str = json_val.to_string();
    vm.stack.push(Value::Str(std::sync::Arc::new(json_str)))?;
    Ok(false)
}


pub fn op_jsonparse(vm: &mut Vm) -> Result<bool, VmError> {
    let s = pop_string(vm)?;
    let json_val: serde_json::Value = serde_json::from_str(s.as_str())
        .map_err(|_| VmError::TypeError)?;
    vm.stack.push(crate::wrapper::json_to_value(&json_val))?;
    Ok(false)
}

// ----------------- Type Checking (1) -----------------

