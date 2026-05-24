use crate::vm::Vm;
use crate::stack::VmError;
use crate::value::Value;
use std::collections::HashMap;
use std::rc::Rc;
use std::cell::RefCell;
use crate::handlers::*;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

pub fn op_eq(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    vm.stack.push(Value::Bool(a == b))?;
    Ok(false)
}


pub fn op_neq(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    vm.stack.push(Value::Bool(a != b))?;
    Ok(false)
}

pub fn op_stricteq(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    let result = match (&a, &b) {
        (Value::Int(x), Value::Int(y)) => x == y,
        (Value::Float(x), Value::Float(y)) => x == y,
        (Value::Int(x), Value::Float(y)) => (*x as f64) == *y,
        (Value::Float(x), Value::Int(y)) => *x == (*y as f64),
        (Value::Str(x), Value::Str(y)) => x == y,
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::Null, Value::Null) => true,
        _ => false, // different types: strict equality is always false
    };
    vm.stack.push(Value::Bool(result))?;
    Ok(false)
}

pub fn op_strictneq(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    let result = match (&a, &b) {
        (Value::Int(x), Value::Int(y)) => x != y,
        (Value::Float(x), Value::Float(y)) => x != y,
        (Value::Int(x), Value::Float(y)) => (*x as f64) != *y,
        (Value::Float(x), Value::Int(y)) => *x != (*y as f64),
        (Value::Str(x), Value::Str(y)) => x != y,
        (Value::Bool(x), Value::Bool(y)) => x != y,
        (Value::Null, Value::Null) => false,
        _ => true,
    };
    vm.stack.push(Value::Bool(result))?;
    Ok(false)
}


pub fn op_lt(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => vm.stack.push(Value::Bool(a_val < b_val))?,
        (Value::Float(a_val), Value::Float(b_val)) => vm.stack.push(Value::Bool(a_val < b_val))?,
        (Value::Int(a_val), Value::Float(b_val)) => vm.stack.push(Value::Bool((a_val as f64) < b_val))?,
        (Value::Float(a_val), Value::Int(b_val)) => vm.stack.push(Value::Bool(a_val < (b_val as f64)))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_gt(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => vm.stack.push(Value::Bool(a_val > b_val))?,
        (Value::Float(a_val), Value::Float(b_val)) => vm.stack.push(Value::Bool(a_val > b_val))?,
        (Value::Int(a_val), Value::Float(b_val)) => vm.stack.push(Value::Bool((a_val as f64) > b_val))?,
        (Value::Float(a_val), Value::Int(b_val)) => vm.stack.push(Value::Bool(a_val > (b_val as f64)))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_lte(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => vm.stack.push(Value::Bool(a_val <= b_val))?,
        (Value::Float(a_val), Value::Float(b_val)) => vm.stack.push(Value::Bool(a_val <= b_val))?,
        (Value::Int(a_val), Value::Float(b_val)) => vm.stack.push(Value::Bool((a_val as f64) <= b_val))?,
        (Value::Float(a_val), Value::Int(b_val)) => vm.stack.push(Value::Bool(a_val <= (b_val as f64)))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_gte(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => vm.stack.push(Value::Bool(a_val >= b_val))?,
        (Value::Float(a_val), Value::Float(b_val)) => vm.stack.push(Value::Bool(a_val >= b_val))?,
        (Value::Int(a_val), Value::Float(b_val)) => vm.stack.push(Value::Bool((a_val as f64) >= b_val))?,
        (Value::Float(a_val), Value::Int(b_val)) => vm.stack.push(Value::Bool(a_val >= (b_val as f64)))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_compareandadd(vm: &mut Vm) -> Result<bool, VmError> {
    // Compare top two values
    op_eq(vm)?;
    // Save the boolean result
    let bool_val = vm.stack.pop()?;
    // Add the next two values
    op_add(vm)?;
    // Push the boolean result back on top
    vm.stack.push(bool_val)?;
    Ok(false)
}


pub fn op_swapandmul(vm: &mut Vm) -> Result<bool, VmError> {
    op_swap(vm)?;
    op_mul(vm)?;
    Ok(false)
}

