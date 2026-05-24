use crate::vm::Vm;
use crate::stack::VmError;
use crate::value::Value;
use std::collections::HashMap;
use std::rc::Rc;
use std::cell::RefCell;
use crate::handlers::*;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

pub fn op_invalid(_vm: &mut Vm) -> Result<bool, VmError> {
    // Return true to halt? No, we return Err for invalid
    Err(VmError::InvalidOpCode(0)) // Wait, the dispatch table doesn't pass the opcode byte, so we just return a generic error or just return true (halt).
    // Actually, in the monolithic dispatcher it printed and returned InvalidOpCode.
    // I will return InvalidOpCode(255) as a fallback.
}


pub fn op_pushint(vm: &mut Vm) -> Result<bool, VmError> {
    let val = vm.read_u32()? as i32 as i64;
    vm.stack.push(Value::Int(val))?;
    Ok(false)
}


pub fn op_pop(vm: &mut Vm) -> Result<bool, VmError> {
    vm.stack.pop()?;
    Ok(false)
}


pub fn op_dup(vm: &mut Vm) -> Result<bool, VmError> {
    vm.stack.dup()?;
    Ok(false)
}


pub fn op_pushfloat(vm: &mut Vm) -> Result<bool, VmError> {
    let val = f64::from_bits(vm.read_u64()?);
    vm.stack.push(Value::Float(val))?;
    Ok(false)
}


pub fn op_pushbool(vm: &mut Vm) -> Result<bool, VmError> {
    let val = vm.read_u32()?;
    vm.stack.push(Value::Bool(val != 0))?;
    Ok(false)
}


pub fn op_pushnull(vm: &mut Vm) -> Result<bool, VmError> {
    vm.stack.push(Value::Null)?;
    Ok(false)
}


pub fn op_loadlocal(vm: &mut Vm) -> Result<bool, VmError> {
    let idx = vm.read_u32()? as usize;
    let val = vm.locals.get(idx).ok_or(VmError::InvalidLocalSlot)?.clone();
    vm.stack.push(val)?;
    Ok(false)
}


pub fn op_storelocal(vm: &mut Vm) -> Result<bool, VmError> {
    let idx = vm.read_u32()? as usize;
    let val = vm.stack.pop()?;
    let slot = vm.locals.get_mut(idx).ok_or(VmError::InvalidLocalSlot)?;
    *slot = val;
    Ok(false)
}


pub fn op_jump(vm: &mut Vm) -> Result<bool, VmError> {
    let target = vm.read_u32()? as usize;
    vm.set_pc(target);
    Ok(false)
}


pub fn op_jumpif(vm: &mut Vm) -> Result<bool, VmError> {
    let target = vm.read_u32()? as usize;
    let cond = vm.stack.pop()?;
    if cond.is_truthy() {
        vm.set_pc(target);
    }
    Ok(false)
}


pub fn op_jumpifnot(vm: &mut Vm) -> Result<bool, VmError> {
    let target = vm.read_u32()? as usize;
    let cond = vm.stack.pop()?;
    if !cond.is_truthy() {
        vm.set_pc(target);
    }
    Ok(false)
}


pub fn op_call(vm: &mut Vm) -> Result<bool, VmError> {
    let target = vm.read_u32()? as usize;
    let arg_count = vm.read_u32()? as usize;
    
    if arg_count > 256 {
        return Err(VmError::InvalidLocalSlot);
    }
    
    let mut new_locals = vec![Value::Null; 256];
    for i in (0..arg_count).rev() {
        new_locals[i] = vm.stack.pop()?;
    }

    if vm.frames.len() >= 64 {
        return Err(VmError::CallStackOverflow);
    }
    
    vm.frames.push(crate::vm::CallFrame {
        pc_base: vm.pc_base,
        pc_offset: vm.pc_offset,
        locals: std::mem::replace(&mut vm.locals, new_locals),
    });
    
    vm.set_pc(target);
    Ok(false)
}


pub fn op_return(vm: &mut Vm) -> Result<bool, VmError> {
    let ret_val = vm.stack.pop().unwrap_or(Value::Null);
    if let Some(frame) = vm.frames.pop() {
        vm.locals = frame.locals;
        vm.pc_base = frame.pc_base;
        vm.pc_offset = frame.pc_offset;
        vm.stack.push(ret_val)?;
        Ok(false)
    } else {
        vm.stack.push(ret_val)?;
        Ok(true) // Halt
    }
}


pub fn op_callnative(vm: &mut Vm) -> Result<bool, VmError> {
    #[allow(unused_variables)]
    let id = vm.read_u32()?;
    let arg_count = vm.read_u32()? as usize;
    let mut args = Vec::new();
    for _ in 0..arg_count {
        args.push(vm.stack.pop()?);
    }
    args.reverse();
    
    let mut json_arr = serde_json::Value::Array(Vec::new());
    if let serde_json::Value::Array(ref mut arr) = json_arr {
        for arg in args {
            arr.push(crate::wrapper::value_to_json(&arg));
        }
    }
    #[allow(unused_variables)]
    let args_json = json_arr.to_string();
    
    #[cfg(target_arch = "wasm32")]
    let res_str = crate::vm::native_call(id, &args_json);
    
    #[cfg(not(target_arch = "wasm32"))]
    let res_str = "{}".to_string(); // Mock for non-wasm targets
    
    if res_str.len() > 4096 {
        vm.stack.push(Value::Str(std::sync::Arc::new("PayloadTooLarge".to_string())))?;
    } else if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&res_str) {
        vm.stack.push(crate::wrapper::json_to_value(&json_val))?;
    } else {
        vm.stack.push(Value::Str(std::sync::Arc::new(res_str)))?;
    }
    Ok(false)
}


pub fn op_halt(_vm: &mut Vm) -> Result<bool, VmError> {
    Ok(true)
}


pub fn op_jumpandmul(vm: &mut Vm) -> Result<bool, VmError> {
    let target = vm.read_u32()? as usize;
    let cond = vm.stack.pop()?;
    if cond.is_truthy() {
        vm.set_pc(target);
    } else {
        op_mul(vm)?;
    }
    Ok(false)
}


pub fn op_swap(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    vm.stack.push(b)?;
    vm.stack.push(a)?;
    Ok(false)
}


pub fn op_rotate(vm: &mut Vm) -> Result<bool, VmError> {
    let c = vm.stack.pop()?;
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    vm.stack.push(b)?;
    vm.stack.push(c)?;
    vm.stack.push(a)?;
    Ok(false)
}


pub fn op_drop2(vm: &mut Vm) -> Result<bool, VmError> {
    vm.stack.pop()?;
    vm.stack.pop()?;
    Ok(false)
}

// ----------------------------------------------------
// 74 New Opcodes Handler Implementation
// ----------------------------------------------------

use crate::vm::CachedRegex;

// Helper methods
