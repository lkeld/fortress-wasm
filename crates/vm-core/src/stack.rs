use crate::value::Value;

#[derive(Debug)]
pub enum VmError {
    StackUnderflow,
    TypeError,
    InvalidOpCode(u8),
    InvalidConstantIndex,
    InvalidLocalSlot,
    InvalidFunctionIndex,
    DivisionByZero,
    FieldNotFound,
    UnknownNativeFunction,
}

pub struct Stack {
    data: Vec<Value>,
}

impl Stack {
    pub fn new() -> Self {
        Self {
            data: Vec::with_capacity(256),
        }
    }

    pub fn push(&mut self, val: Value) {
        self.data.push(val);
    }

    pub fn pop(&mut self) -> Result<Value, VmError> {
        self.data.pop().ok_or(VmError::StackUnderflow)
    }

    pub fn peek(&self) -> Result<&Value, VmError> {
        self.data.last().ok_or(VmError::StackUnderflow)
    }

    pub fn dup(&mut self) -> Result<(), VmError> {
        let val = self.peek()?.clone();
        self.push(val);
        Ok(())
    }

    pub fn clear(&mut self) {
        self.data.clear();
    }
}
