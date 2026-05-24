use crate::vm::Vm;
use crate::stack::VmError;
use crate::value::Value;
use std::collections::HashMap;
use std::rc::Rc;
use std::cell::RefCell;
use crate::handlers::*;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

pub fn value_to_string(v: &Value) -> String {
    match v {
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Int(i) => i.to_string(),
        Value::Float(f) => f.to_string(),
        Value::Str(s) => (**s).clone(),
        Value::List(list) => {
            match list.try_borrow() {
                Ok(borrowed_vec) => {
                    let items: Vec<String> = borrowed_vec.iter().map(|item| value_to_string(item)).collect();
                    items.join(",")
                }
                Err(_) => "<borrowed>".to_string(),
            }
        }
        Value::Object(_) => "[object Object]".to_string(),
    }
}


pub fn to_primitive(val: &Value) -> Value {
    match val {
        Value::List(list) => {
            match list.try_borrow() {
                Ok(borrowed_vec) => {
                    let items: Vec<String> = borrowed_vec.iter().map(|item| value_to_string(item)).collect();
                    Value::Str(std::sync::Arc::new(items.join(",")))
                }
                Err(_) => Value::Str(std::sync::Arc::new("<borrowed>".to_string())),
            }
        }
        Value::Object(_) => Value::Str(std::sync::Arc::new("[object Object]".to_string())),
        other => other.clone(),
    }
}


pub fn to_number(v: &Value) -> Value {
    match v {
        Value::Null => Value::Int(0),
        Value::Bool(b) => Value::Int(if *b { 1 } else { 0 }),
        Value::Int(i) => Value::Int(*i),
        Value::Float(f) => Value::Float(*f),
        _ => Value::Int(0),
    }
}


pub fn op_add(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    
    let prim_a = to_primitive(&a);
    let prim_b = to_primitive(&b);
    
    if let (Value::Str(s_a), Value::Str(s_b)) = (&prim_a, &prim_b) {
        let mut res = String::new();
        res.push_str(s_a);
        res.push_str(s_b);
        vm.stack.push(Value::Str(std::sync::Arc::new(res)))?;
        return Ok(false);
    }
    
    if let Value::Str(s_a) = &prim_a {
        let mut res = String::new();
        res.push_str(s_a);
        res.push_str(&value_to_string(&prim_b));
        vm.stack.push(Value::Str(std::sync::Arc::new(res)))?;
        return Ok(false);
    }
    
    if let Value::Str(s_b) = &prim_b {
        let mut res = String::new();
        res.push_str(&value_to_string(&prim_a));
        res.push_str(s_b);
        vm.stack.push(Value::Str(std::sync::Arc::new(res)))?;
        return Ok(false);
    }
    
    let num_a = to_number(&prim_a);
    let num_b = to_number(&prim_b);
    
    match (num_a, num_b) {
        (Value::Int(a_val), Value::Int(b_val)) => {
            if let Some(res) = a_val.checked_add(b_val) {
                vm.stack.push(Value::Int(res))?;
            } else {
                vm.stack.push(Value::Float(a_val as f64 + b_val as f64))?;
            }
        }
        (Value::Float(a_val), Value::Float(b_val)) => vm.stack.push(Value::Float(a_val + b_val))?,
        (Value::Int(a_val), Value::Float(b_val)) => vm.stack.push(Value::Float(a_val as f64 + b_val))?,
        (Value::Float(a_val), Value::Int(b_val)) => vm.stack.push(Value::Float(a_val + b_val as f64))?,
        _ => return Err(VmError::TypeError),
    }
    
    Ok(false)
}


pub fn op_sub(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => {
            if let Some(res) = a_val.checked_sub(b_val) {
                vm.stack.push(Value::Int(res))?;
            } else {
                vm.stack.push(Value::Float(a_val as f64 - b_val as f64))?;
            }
        }
        (Value::Float(a_val), Value::Float(b_val)) => vm.stack.push(Value::Float(a_val - b_val))?,
        (Value::Int(a_val), Value::Float(b_val)) => vm.stack.push(Value::Float(a_val as f64 - b_val))?,
        (Value::Float(a_val), Value::Int(b_val)) => vm.stack.push(Value::Float(a_val - b_val as f64))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_mul(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => {
            if let Some(res) = a_val.checked_mul(b_val) {
                vm.stack.push(Value::Int(res))?;
            } else {
                vm.stack.push(Value::Float(a_val as f64 * b_val as f64))?;
            }
        }
        (Value::Float(a_val), Value::Float(b_val)) => vm.stack.push(Value::Float(a_val * b_val))?,
        (Value::Int(a_val), Value::Float(b_val)) => vm.stack.push(Value::Float(a_val as f64 * b_val))?,
        (Value::Float(a_val), Value::Int(b_val)) => vm.stack.push(Value::Float(a_val * b_val as f64))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_div(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => {
            let res = a_val as f64 / b_val as f64;
            if res.fract() == 0.0 && res.is_finite() && res >= i64::MIN as f64 && res <= i64::MAX as f64 {
                vm.stack.push(Value::Int(res as i64))?;
            } else {
                vm.stack.push(Value::Float(res))?;
            }
        }
        (Value::Float(a_val), Value::Float(b_val)) => {
            let res = a_val / b_val;
            if res.fract() == 0.0 && res.is_finite() && res >= i64::MIN as f64 && res <= i64::MAX as f64 {
                vm.stack.push(Value::Int(res as i64))?;
            } else {
                vm.stack.push(Value::Float(res))?;
            }
        }
        (Value::Int(a_val), Value::Float(b_val)) => {
            let res = a_val as f64 / b_val;
            if res.fract() == 0.0 && res.is_finite() && res >= i64::MIN as f64 && res <= i64::MAX as f64 {
                vm.stack.push(Value::Int(res as i64))?;
            } else {
                vm.stack.push(Value::Float(res))?;
            }
        }
        (Value::Float(a_val), Value::Int(b_val)) => {
            let res = a_val / b_val as f64;
            if res.fract() == 0.0 && res.is_finite() && res >= i64::MIN as f64 && res <= i64::MAX as f64 {
                vm.stack.push(Value::Int(res as i64))?;
            } else {
                vm.stack.push(Value::Float(res))?;
            }
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_and(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    vm.stack.push(Value::Bool(a.is_truthy() && b.is_truthy()))?;
    Ok(false)
}


pub fn op_or(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    vm.stack.push(Value::Bool(a.is_truthy() || b.is_truthy()))?;
    Ok(false)
}


pub fn op_not(vm: &mut Vm) -> Result<bool, VmError> {
    let a = vm.stack.pop()?;
    vm.stack.push(Value::Bool(!a.is_truthy()))?;
    Ok(false)
}


pub fn op_bitand(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    let val_a = match a {
        Value::Int(i) => i,
        Value::Float(f) => f as i64,
        _ => {
            vm.error_detail = Some(format!("op_bitand TypeError! a: {:?}", a));
            return Err(VmError::TypeError);
        }
    };
    let val_b = match b {
        Value::Int(i) => i,
        Value::Float(f) => f as i64,
        _ => {
            vm.error_detail = Some(format!("op_bitand TypeError! b: {:?}", b));
            return Err(VmError::TypeError);
        }
    };
    vm.stack.push(Value::Int(val_a & val_b))?;
    Ok(false)
}


pub fn op_bitor(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    let val_a = match a {
        Value::Int(i) => i,
        Value::Float(f) => f as i64,
        _ => {
            vm.error_detail = Some(format!("op_bitor TypeError! a: {:?}", a));
            return Err(VmError::TypeError);
        }
    };
    let val_b = match b {
        Value::Int(i) => i,
        Value::Float(f) => f as i64,
        _ => {
            vm.error_detail = Some(format!("op_bitor TypeError! b: {:?}", b));
            return Err(VmError::TypeError);
        }
    };
    vm.stack.push(Value::Int(val_a | val_b))?;
    Ok(false)
}


pub fn op_bitxor(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    let val_a = match a {
        Value::Int(i) => i,
        Value::Float(f) => f as i64,
        _ => {
            vm.error_detail = Some(format!("op_bitxor TypeError! a: {:?}", a));
            return Err(VmError::TypeError);
        }
    };
    let val_b = match b {
        Value::Int(i) => i,
        Value::Float(f) => f as i64,
        _ => {
            vm.error_detail = Some(format!("op_bitxor TypeError! b: {:?}", b));
            return Err(VmError::TypeError);
        }
    };
    vm.stack.push(Value::Int(val_a ^ val_b))?;
    Ok(false)
}


pub fn op_bitnot(vm: &mut Vm) -> Result<bool, VmError> {
    let a = vm.stack.pop()?;
    let val_a = match a {
        Value::Int(i) => i,
        Value::Float(f) => f as i64,
        _ => return Err(VmError::TypeError),
    };
    vm.stack.push(Value::Int(!val_a))?;
    Ok(false)
}


pub fn op_shl(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    let val_a = match a {
        Value::Int(i) => i as i32,
        Value::Float(f) => f as i32,
        _ => return Err(VmError::TypeError),
    };
    let val_b = match b {
        Value::Int(i) => i as i32,
        Value::Float(f) => f as i32,
        _ => return Err(VmError::TypeError),
    };
    let shift = val_b & 0x1F;
    let res = val_a.wrapping_shl(shift as u32);
    vm.stack.push(Value::Int(res as i64))?;
    Ok(false)
}


pub fn op_shr(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    let val_a = match a {
        Value::Int(i) => i as i32,
        Value::Float(f) => f as i32,
        _ => return Err(VmError::TypeError),
    };
    let val_b = match b {
        Value::Int(i) => i as i32,
        Value::Float(f) => f as i32,
        _ => return Err(VmError::TypeError),
    };
    let shift = val_b & 0x1F;
    let res = val_a.wrapping_shr(shift as u32);
    vm.stack.push(Value::Int(res as i64))?;
    Ok(false)
}


pub fn op_hash256(vm: &mut Vm) -> Result<bool, VmError> {
    let val = vm.stack.pop()?;
    let str_val = match val {
        Value::Str(s) => s.to_string(),
        Value::Int(i) => i.to_string(),
        Value::Float(f) => to_js_string(f),
        Value::Bool(b) => b.to_string(),
        _ => return Err(VmError::TypeError),
    };
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(str_val.as_bytes());
    let result = hasher.finalize();
    let hex_str = format!("{:x}", result);
    vm.stack.push(Value::Str(std::sync::Arc::new(hex_str)))?;
    Ok(false)
}


pub fn op_encryptaes(vm: &mut Vm) -> Result<bool, VmError> {
    let key_val = vm.stack.pop()?;
    let payload_val = vm.stack.pop()?;
    
    if let (Value::Str(key_str), Value::Str(payload_str)) = (key_val, payload_val) {
        let mut key_bytes = [0u8; 32];
        let kb = key_str.as_bytes();
        let len = kb.len().min(32);
        key_bytes[..len].copy_from_slice(&kb[..len]);
        
        let res = match crypto_core::encrypt_aes_gcm(payload_str.as_bytes(), &key_bytes) {
            Ok(encrypted) => {
                let mut hex_str = String::with_capacity(encrypted.len() * 2);
                for byte in encrypted {
                    use std::fmt::Write;
                    write!(&mut hex_str, "{:02x}", byte).unwrap();
                }
                vm.stack.push(Value::Str(std::sync::Arc::new(hex_str)))?;
                Ok(false)
            }
            Err(_) => Err(VmError::TypeError),
        };
        use zeroize::Zeroize;
        key_bytes.zeroize();
        res
    } else {
        Err(VmError::TypeError)
    }
}


pub fn to_js_string(f: f64) -> String {
    if f.is_nan() {
        return "NaN".to_string();
    }
    if f.is_infinite() {
        return if f.is_sign_positive() {
            "Infinity".to_string()
        } else {
            "-Infinity".to_string()
        };
    }
    if f == 0.0 || f == -0.0 {
        return "0".to_string();
    }

    let abs_f = f.abs();
    if abs_f < 1e-6 || abs_f >= 1e21 {
        let s = format!("{:e}", f);
        if let Some(pos) = s.find('e') {
            let (coef, exp_str) = s.split_at(pos);
            let exp_val = exp_str[1..].parse::<i32>().unwrap_or(0);
            let exp_sign = if exp_val >= 0 { "+" } else { "" };
            let mut coef_clean = coef.to_string();
            if coef_clean.ends_with(".0") {
                coef_clean.truncate(coef_clean.len() - 2);
            }
            return format!("{}e{}{}", coef_clean, exp_sign, exp_val);
        }
        s
    } else {
        f.to_string()
    }
}


pub fn to_f64(v: &Value) -> Result<f64, VmError> {
    match v {
        Value::Int(i) => Ok(*i as f64),
        Value::Float(f) => Ok(*f),
        _ => Err(VmError::TypeError),
    }
}


pub fn f64_to_u32(f: f64) -> u32 {
    if f.is_nan() || f.is_infinite() {
        0
    } else {
        let f = f % 4294967296.0;
        let i = f as i64;
        i as u32
    }
}


pub fn js_round(f: f64) -> f64 {
    if f.is_nan() || f.is_infinite() {
        f
    } else {
        let rounded = (f + 0.5).floor();
        if rounded == 0.0 && f < 0.0 {
            -0.0
        } else {
            rounded
        }
    }
}


pub fn js_sign_int(i: i64) -> i64 {
    if i > 0 {
        1
    } else if i < 0 {
        -1
    } else {
        0
    }
}


pub fn js_sign_float(f: f64) -> f64 {
    if f.is_nan() {
        f64::NAN
    } else if f == 0.0 {
        f
    } else if f > 0.0 {
        1.0
    } else {
        -1.0
    }
}


pub fn f64_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}


pub fn f64_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.min(b)
    }
}

// ----------------- Math Opcodes (32) -----------------


pub fn op_mathfloor(vm: &mut Vm) -> Result<bool, VmError> {
    let a = vm.stack.pop()?;
    match a {
        Value::Int(i) => vm.stack.push(Value::Int(i))?,
        Value::Float(f) => vm.stack.push(Value::Float(f.floor()))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_mathceil(vm: &mut Vm) -> Result<bool, VmError> {
    let a = vm.stack.pop()?;
    match a {
        Value::Int(i) => vm.stack.push(Value::Int(i))?,
        Value::Float(f) => vm.stack.push(Value::Float(f.ceil()))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_mathround(vm: &mut Vm) -> Result<bool, VmError> {
    let a = vm.stack.pop()?;
    match a {
        Value::Int(i) => vm.stack.push(Value::Int(i))?,
        Value::Float(f) => vm.stack.push(Value::Float(js_round(f)))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_mathabs(vm: &mut Vm) -> Result<bool, VmError> {
    let a = vm.stack.pop()?;
    match a {
        Value::Int(i) => {
            if i == i64::MIN {
                vm.stack.push(Value::Float(9223372036854775808.0))?;
            } else {
                vm.stack.push(Value::Int(i.abs()))?;
            }
        }
        Value::Float(f) => vm.stack.push(Value::Float(f.abs()))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_mathsqrt(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.sqrt()))?;
    Ok(false)
}


pub fn op_mathpow(vm: &mut Vm) -> Result<bool, VmError> {
    let e = to_f64(&vm.stack.pop()?)?;
    let b = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(b.powf(e)))?;
    Ok(false)
}


pub fn op_mathlog(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.ln()))?;
    Ok(false)
}


pub fn op_mathlog2(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.log2()))?;
    Ok(false)
}


pub fn op_mathlog10(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.log10()))?;
    Ok(false)
}


pub fn op_mathsin(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.sin()))?;
    Ok(false)
}


pub fn op_mathcos(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.cos()))?;
    Ok(false)
}


pub fn op_mathtan(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.tan()))?;
    Ok(false)
}


pub fn op_mathasin(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.asin()))?;
    Ok(false)
}


pub fn op_mathacos(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.acos()))?;
    Ok(false)
}


pub fn op_mathatan(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.atan()))?;
    Ok(false)
}


pub fn op_mathatan2(vm: &mut Vm) -> Result<bool, VmError> {
    let x = to_f64(&vm.stack.pop()?)?;
    let y = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(y.atan2(x)))?;
    Ok(false)
}


pub fn op_mathmax(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => vm.stack.push(Value::Int(a_val.max(b_val)))?,
        (Value::Float(a_val), Value::Float(b_val)) => vm.stack.push(Value::Float(f64_max(a_val, b_val)))?,
        (Value::Int(a_val), Value::Float(b_val)) => vm.stack.push(Value::Float(f64_max(a_val as f64, b_val)))?,
        (Value::Float(a_val), Value::Int(b_val)) => vm.stack.push(Value::Float(f64_max(a_val, b_val as f64)))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_mathmin(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => vm.stack.push(Value::Int(a_val.min(b_val)))?,
        (Value::Float(a_val), Value::Float(b_val)) => vm.stack.push(Value::Float(f64_min(a_val, b_val)))?,
        (Value::Int(a_val), Value::Float(b_val)) => vm.stack.push(Value::Float(f64_min(a_val as f64, b_val)))?,
        (Value::Float(a_val), Value::Int(b_val)) => vm.stack.push(Value::Float(f64_min(a_val, b_val as f64)))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_mathsign(vm: &mut Vm) -> Result<bool, VmError> {
    let a = vm.stack.pop()?;
    match a {
        Value::Int(i) => vm.stack.push(Value::Int(js_sign_int(i)))?,
        Value::Float(f) => vm.stack.push(Value::Float(js_sign_float(f)))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_mathtrunc(vm: &mut Vm) -> Result<bool, VmError> {
    let a = vm.stack.pop()?;
    match a {
        Value::Int(i) => vm.stack.push(Value::Int(i))?,
        Value::Float(f) => vm.stack.push(Value::Float(f.trunc()))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}


pub fn op_mathhypot(vm: &mut Vm) -> Result<bool, VmError> {
    let b = to_f64(&vm.stack.pop()?)?;
    let a = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(a.hypot(b)))?;
    Ok(false)
}


pub fn op_mathexp(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.exp()))?;
    Ok(false)
}


pub fn op_mathexpm1(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.exp_m1()))?;
    Ok(false)
}


pub fn op_mathlog1p(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.ln_1p()))?;
    Ok(false)
}


pub fn op_mathsinh(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.sinh()))?;
    Ok(false)
}


pub fn op_mathcosh(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.cosh()))?;
    Ok(false)
}


pub fn op_mathtanh(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.tanh()))?;
    Ok(false)
}


pub fn op_mathcbrt(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.cbrt()))?;
    Ok(false)
}


pub fn op_mathclz32(vm: &mut Vm) -> Result<bool, VmError> {
    let a = vm.stack.pop()?;
    let val = match a {
        Value::Int(i) => i as u32,
        Value::Float(f) => f64_to_u32(f),
        _ => return Err(VmError::TypeError),
    };
    vm.stack.push(Value::Int(val.leading_zeros() as i64))?;
    Ok(false)
}


pub fn op_mathfround(vm: &mut Vm) -> Result<bool, VmError> {
    let a = vm.stack.pop()?;
    let val = match a {
        Value::Int(i) => i as f32 as f64,
        Value::Float(f) => f as f32 as f64,
        _ => return Err(VmError::TypeError),
    };
    vm.stack.push(Value::Float(val))?;
    Ok(false)
}


pub fn op_mathimul(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    let val_a = match a {
        Value::Int(i) => i as i32,
        Value::Float(f) => f64_to_u32(f) as i32,
        _ => return Err(VmError::TypeError),
    };
    let val_b = match b {
        Value::Int(i) => i as i32,
        Value::Float(f) => f64_to_u32(f) as i32,
        _ => return Err(VmError::TypeError),
    };
    let res = val_a.wrapping_mul(val_b);
    vm.stack.push(Value::Int(res as i64))?;
    Ok(false)
}


pub fn op_mathrandom(vm: &mut Vm) -> Result<bool, VmError> {
    let mut buf = [0u8; 8];
    getrandom::getrandom(&mut buf).map_err(|_| VmError::RuntimeError)?;
    let bits = u64::from_le_bytes(buf);
    let r = (bits >> 11) as f64 * (1.0f64 / (1u64 << 53) as f64);
    vm.stack.push(Value::Float(r))?;
    Ok(false)
}

// ----------------- String Opcodes (22) -----------------


pub fn op_typeof(vm: &mut Vm) -> Result<bool, VmError> {
    let val = vm.stack.pop()?;
    let type_str = match val {
        Value::Str(_) => "string",
        Value::Int(_) | Value::Float(_) => "number",
        Value::Bool(_) => "boolean",
        Value::Null => "undefined",
        Value::Object(_) | Value::List(_) => "object",
    };
    vm.stack.push(Value::Str(std::sync::Arc::new(type_str.to_string())))?;
    Ok(false)
}

// ----------------- Array Opcodes (14) -----------------

