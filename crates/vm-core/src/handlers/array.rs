use crate::vm::Vm;
use crate::stack::VmError;
use crate::value::Value;
use std::collections::HashMap;
use std::rc::Rc;
use std::cell::RefCell;
use crate::handlers::*;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

pub fn op_newlist(vm: &mut Vm) -> Result<bool, VmError> {
    vm.stack.push(Value::List(Rc::new(RefCell::new(Vec::new()))))?;
    Ok(false)
}


pub fn op_listpush(vm: &mut Vm) -> Result<bool, VmError> {
    let val = vm.stack.pop()?;
    let list = vm.stack.pop()?;
    if let Value::List(ref vec) = list {
        vec.try_borrow_mut().map_err(|_| VmError::BorrowError)?.push(val);
        vm.stack.push(list)?;
    } else {
        return Err(VmError::TypeError);
    }
    Ok(false)
}


pub fn op_arrindexof(vm: &mut Vm) -> Result<bool, VmError> {
    let target = vm.stack.pop()?;
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let vec = rc.try_borrow().map_err(|_| VmError::RuntimeError)?;
            let idx = vec.iter().position(|x| x == &target).map(|i| i as i64).unwrap_or(-1);
            vm.stack.push(Value::Int(idx))?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_arrlastindexof(vm: &mut Vm) -> Result<bool, VmError> {
    let target = vm.stack.pop()?;
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let vec = rc.try_borrow().map_err(|_| VmError::RuntimeError)?;
            let idx = vec.iter().rposition(|x| x == &target).map(|i| i as i64).unwrap_or(-1);
            vm.stack.push(Value::Int(idx))?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_arrincludes(vm: &mut Vm) -> Result<bool, VmError> {
    let target = vm.stack.pop()?;
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let vec = rc.try_borrow().map_err(|_| VmError::RuntimeError)?;
            let found = vec.contains(&target);
            vm.stack.push(Value::Bool(found))?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_arrreverse(vm: &mut Vm) -> Result<bool, VmError> {
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let mut vec = rc.try_borrow_mut().map_err(|_| VmError::RuntimeError)?;
            vec.reverse();
            std::mem::drop(vec);
            vm.stack.push(list.clone())?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_arrsortnumeric(vm: &mut Vm) -> Result<bool, VmError> {
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let mut vec = rc.try_borrow_mut().map_err(|_| VmError::RuntimeError)?;
            vec.sort_by(|a, b| {
                let af = match a { Value::Int(i) => *i as f64, Value::Float(f) => *f, _ => 0.0 };
                let bf = match b { Value::Int(i) => *i as f64, Value::Float(f) => *f, _ => 0.0 };
                af.total_cmp(&bf)
            });
            std::mem::drop(vec);
            vm.stack.push(list.clone())?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_arrsortstring(vm: &mut Vm) -> Result<bool, VmError> {
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let mut vec = rc.try_borrow_mut().map_err(|_| VmError::RuntimeError)?;
            vec.sort_by(|a, b| {
                let as_str = match a {
                    Value::Str(s) => (**s).clone(),
                    Value::Int(i) => i.to_string(),
                    Value::Float(f) => to_js_string(*f),
                    Value::Bool(b) => b.to_string(),
                    Value::Null => "null".to_string(),
                    _ => String::new(),
                };
                let bs_str = match b {
                    Value::Str(s) => (**s).clone(),
                    Value::Int(i) => i.to_string(),
                    Value::Float(f) => to_js_string(*f),
                    Value::Bool(b) => b.to_string(),
                    Value::Null => "null".to_string(),
                    _ => String::new(),
                };
                as_str.cmp(&bs_str)
            });
            std::mem::drop(vec);
            vm.stack.push(list.clone())?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_arrslice(vm: &mut Vm) -> Result<bool, VmError> {
    let end = vm.stack.pop()?;
    let start = vm.stack.pop()?;
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let vec = rc.try_borrow().map_err(|_| VmError::RuntimeError)?;
            let len = vec.len() as i64;
            let start_idx = match start {
                Value::Int(i) => if i < 0 { (len + i).max(0) as usize } else { i.min(len) as usize },
                _ => return Err(VmError::TypeError),
            };
            let end_idx = match end {
                Value::Int(i) => if i < 0 { (len + i).max(0) as usize } else { i.min(len) as usize },
                Value::Null => len as usize,
                _ => return Err(VmError::TypeError),
            };
            let lo = start_idx.min(end_idx);
            let hi = end_idx.max(start_idx).min(len as usize);
            let slice_vec = vec.get(lo..hi).ok_or(VmError::IndexOutOfBounds)?.to_vec();
            vm.stack.push(Value::List(std::rc::Rc::new(std::cell::RefCell::new(slice_vec))))?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_arrjoin(vm: &mut Vm) -> Result<bool, VmError> {
    let sep = pop_string(vm)?;
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let vec = rc.try_borrow().map_err(|_| VmError::RuntimeError)?;
            let mut parts = Vec::new();
            for item in vec.iter() {
                let s = match item {
                    Value::Str(s) => (**s).clone(),
                    Value::Int(i) => i.to_string(),
                    Value::Float(f) => to_js_string(*f),
                    Value::Bool(b) => b.to_string(),
                    Value::Null => "".to_string(),
                    _ => String::new(),
                };
                parts.push(s);
            }
            let joined = parts.join(sep.as_str());
            vm.stack.push(Value::Str(std::sync::Arc::new(joined)))?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_arrflat(vm: &mut Vm) -> Result<bool, VmError> {
    let depth_val = vm.stack.pop()?;
    let depth = match depth_val {
        Value::Int(i) => i.max(0) as usize,
        Value::Null => 1,
        _ => return Err(VmError::TypeError),
    };
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let vec = rc.try_borrow().map_err(|_| VmError::RuntimeError)?;
            let flattened = flatten_vec(&vec, depth)?;
            vm.stack.push(Value::List(std::rc::Rc::new(std::cell::RefCell::new(flattened))))?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn flatten_vec(vec: &[Value], depth: usize) -> Result<Vec<Value>, VmError> {
    let mut result = Vec::new();
    for val in vec {
        if let Value::List(sub_rc) = val {
            if depth > 0 {
                let sub_vec = sub_rc.try_borrow().map_err(|_| VmError::RuntimeError)?;
                let sub_flat = flatten_vec(&sub_vec, depth - 1)?;
                result.extend(sub_flat);
            } else {
                result.push(val.clone());
            }
        } else {
            result.push(val.clone());
        }
    }
    Ok(result)
}


pub fn op_arrfill(vm: &mut Vm) -> Result<bool, VmError> {
    let end = vm.stack.pop()?;
    let start = vm.stack.pop()?;
    let fill_val = vm.stack.pop()?;
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let mut vec = rc.try_borrow_mut().map_err(|_| VmError::RuntimeError)?;
            let len = vec.len() as i64;
            let start_idx = match start {
                Value::Int(i) => if i < 0 { (len + i).max(0) as usize } else { i.min(len) as usize },
                _ => return Err(VmError::TypeError),
            };
            let end_idx = match end {
                Value::Int(i) => if i < 0 { (len + i).max(0) as usize } else { i.min(len) as usize },
                Value::Null => len as usize,
                _ => return Err(VmError::TypeError),
            };
            let lo = start_idx.min(end_idx);
            let hi = end_idx.max(start_idx).min(len as usize);
            for i in lo..hi {
                if let Some(slot) = vec.get_mut(i) {
                    *slot = fill_val.clone();
                }
            }
            std::mem::drop(vec);
            vm.stack.push(list.clone())?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_arrpush(vm: &mut Vm) -> Result<bool, VmError> {
    let item = vm.stack.pop()?;
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let mut vec = rc.try_borrow_mut().map_err(|_| VmError::RuntimeError)?;
            vec.push(item);
            let new_len = vec.len() as i64;
            std::mem::drop(vec);
            vm.stack.push(Value::Int(new_len))?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_arrpop(vm: &mut Vm) -> Result<bool, VmError> {
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let mut vec = rc.try_borrow_mut().map_err(|_| VmError::RuntimeError)?;
            let popped = vec.pop().unwrap_or(Value::Null);
            std::mem::drop(vec);
            vm.stack.push(popped)?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_arrshift(vm: &mut Vm) -> Result<bool, VmError> {
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let mut vec = rc.try_borrow_mut().map_err(|_| VmError::RuntimeError)?;
            let shifted = if vec.is_empty() {
                Value::Null
            } else {
                vec.remove(0)
            };
            std::mem::drop(vec);
            vm.stack.push(shifted)?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_arrunshift(vm: &mut Vm) -> Result<bool, VmError> {
    let item = vm.stack.pop()?;
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let mut vec = rc.try_borrow_mut().map_err(|_| VmError::RuntimeError)?;
            vec.insert(0, item);
            let new_len = vec.len() as i64;
            std::mem::drop(vec);
            vm.stack.push(Value::Int(new_len))?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

