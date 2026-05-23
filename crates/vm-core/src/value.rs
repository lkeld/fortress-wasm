use std::collections::HashMap;
use std::sync::Arc;
use std::rc::Rc;
use std::cell::RefCell;

#[derive(Debug, Clone)]
pub enum Value {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(Arc<String>),
    Object(Rc<RefCell<HashMap<String, Value>>>),
    List(Rc<RefCell<Vec<Value>>>),
}

impl Value {
    pub fn is_truthy(&self) -> bool {
        match self {
            Value::Null => false,
            Value::Bool(b) => *b,
            Value::Int(i) => *i != 0,
            Value::Float(f) => *f != 0.0,
            Value::Str(s) => !s.is_empty(),
            Value::Object(m) => m.try_borrow().map(|b| !b.is_empty()).unwrap_or(false),
            Value::List(l) => l.try_borrow().map(|b| !b.is_empty()).unwrap_or(false),
        }
    }
}

impl PartialEq for Value {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Value::Null, Value::Null) => true,
            (Value::Bool(a), Value::Bool(b)) => a == b,
            (Value::Int(a), Value::Int(b)) => a == b,
            (Value::Float(a), Value::Float(b)) => a == b,
            (Value::Int(a), Value::Float(b)) => *a as f64 == *b,
            (Value::Float(a), Value::Int(b)) => *a == *b as f64,
            (Value::Str(a), Value::Str(b)) => a == b,
            (Value::Object(a), Value::Object(b)) => {
                Rc::ptr_eq(a, b) && a.try_borrow().is_ok()
            }
            (Value::List(a), Value::List(b)) => {
                Rc::ptr_eq(a, b) && a.try_borrow().is_ok()
            }
            _ => false,
        }
    }
}
