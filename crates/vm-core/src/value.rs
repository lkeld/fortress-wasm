use std::collections::HashMap;
use std::sync::Arc;
use std::rc::Rc;
use std::cell::RefCell;

#[derive(Debug, Clone, PartialEq)]
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
            Value::Object(m) => !m.borrow().is_empty(),
            Value::List(l) => !l.borrow().is_empty(),
        }
    }
}
