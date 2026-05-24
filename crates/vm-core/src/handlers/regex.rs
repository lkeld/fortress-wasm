use crate::vm::Vm;
use crate::stack::VmError;
use crate::value::Value;
use std::collections::HashMap;
use std::rc::Rc;
use std::cell::RefCell;
use crate::handlers::*;
use crate::vm::CachedRegex;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

pub fn has_backreferences(pattern: &str) -> bool {
    let mut chars = pattern.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            if let Some(&next_ch) = chars.peek() {
                if next_ch.is_ascii_digit() && next_ch != '0' {
                    return true;
                }
            }
        }
    }
    false
}


pub fn get_regex(vm: &mut Vm, pattern: &str) -> Result<CachedRegex, VmError> {
    if pattern.len() > 1024 {
        return Err(VmError::TypeError);
    }
    if let Some(re) = vm.regex_cache.get(pattern) {
        return Ok(re.clone());
    }
    let is_fancy = has_backreferences(pattern);
    let re = if is_fancy {
        let compiled = fancy_regex::Regex::new(pattern)
            .map_err(|_| VmError::TypeError)?;
        CachedRegex::Fancy(std::sync::Arc::new(compiled))
    } else {
        let compiled = ::regex::Regex::new(pattern)
            .map_err(|_| VmError::TypeError)?;
        CachedRegex::Normal(std::sync::Arc::new(compiled))
    };
    vm.regex_cache.insert(pattern.to_string(), re.clone());
    Ok(re)
}


pub fn get_normal_regex(vm: &mut Vm, pattern: &str) -> Result<std::sync::Arc<::regex::Regex>, VmError> {
    match get_regex(vm, pattern)? {
        CachedRegex::Normal(re) => Ok(re),
        CachedRegex::Fancy(_) => Err(VmError::TypeError),
    }
}


pub fn op_regextest(vm: &mut Vm) -> Result<bool, VmError> {
    let input = pop_string(vm)?;
    let pattern = pop_string(vm)?;
    let cached_re = get_regex(vm, pattern.as_str())?;
    
    let result = match cached_re {
        CachedRegex::Normal(re) => re.is_match(input.as_str()),
        CachedRegex::Fancy(re) => re.is_match(input.as_str()).map_err(|_| VmError::TypeError)?,
    };
    
    vm.stack.push(Value::Bool(result))?;
    Ok(false)
}


pub fn op_regexmatch(vm: &mut Vm) -> Result<bool, VmError> {
    let input = pop_string(vm)?;
    let pattern = pop_string(vm)?;
    let cached_re = get_regex(vm, pattern.as_str())?;
    
    match cached_re {
        CachedRegex::Normal(re) => {
            match re.captures(input.as_str()) {
                None => vm.stack.push(Value::Null)?,
                Some(caps) => {
                    let groups: Vec<Value> = caps.iter().map(|m| match m {
                        None => Value::Null,
                        Some(m) => Value::Str(std::sync::Arc::new(m.as_str().to_string()))
                    }).collect();
                    vm.stack.push(Value::List(std::rc::Rc::new(std::cell::RefCell::new(groups))))?;
                }
            }
        }
        CachedRegex::Fancy(re) => {
            match re.captures(input.as_str()).map_err(|_| VmError::TypeError)? {
                None => vm.stack.push(Value::Null)?,
                Some(caps) => {
                    let groups: Vec<Value> = caps.iter().map(|m| match m {
                        None => Value::Null,
                        Some(m) => Value::Str(std::sync::Arc::new(m.as_str().to_string()))
                    }).collect();
                    vm.stack.push(Value::List(std::rc::Rc::new(std::cell::RefCell::new(groups))))?;
                }
            }
        }
    }
    Ok(false)
}


pub fn op_regexreplace(vm: &mut Vm) -> Result<bool, VmError> {
    let replacement = pop_string(vm)?;
    let input = pop_string(vm)?;
    let pattern = pop_string(vm)?;
    let cached_re = get_regex(vm, pattern.as_str())?;
    
    let result = match cached_re {
        CachedRegex::Normal(re) => re.replace(input.as_str(), replacement.as_str()).to_string(),
        CachedRegex::Fancy(re) => re.replace(input.as_str(), replacement.as_str()).to_string(),
    };
    
    vm.stack.push(Value::Str(std::sync::Arc::new(result)))?;
    Ok(false)
}


pub fn op_regexsplit(vm: &mut Vm) -> Result<bool, VmError> {
    let input = pop_string(vm)?;
    let pattern = pop_string(vm)?;
    let re = get_normal_regex(vm, pattern.as_str())?;
    
    let parts: Vec<Value> = re.split(input.as_str())
        .map(|p| Value::Str(std::sync::Arc::new(p.to_string())))
        .collect();
    
    vm.stack.push(Value::List(std::rc::Rc::new(std::cell::RefCell::new(parts))))?;
    Ok(false)
}

// ----------------- JSON (1) -----------------

