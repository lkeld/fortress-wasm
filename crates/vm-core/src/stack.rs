use crate::value::Value;

#[derive(Debug)]
pub enum VmError {
    StackUnderflow,
    StackOverflow,
    TypeError,
    InvalidOpCode(u8),
    InvalidConstantIndex,
    InvalidLocalSlot,
    InvalidFunctionIndex,
    DivisionByZero,
    FieldNotFound,
    UnknownNativeFunction,
    CallStackOverflow,
    UnexpectedEndOfCode,
    IndexOutOfBounds,
    ExecutionLimitExceeded,
    InvalidShiftAmount,
    BorrowError,
    OutOfGas,
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

    pub fn push(&mut self, val: Value) -> Result<(), VmError> {
        if self.data.len() >= 1024 {
            return Err(VmError::StackOverflow);
        }
        self.data.push(val);
        Ok(())
    }

    pub fn pop(&mut self) -> Result<Value, VmError> {
        self.data.pop().ok_or(VmError::StackUnderflow)
    }

    pub fn peek(&self) -> Result<&Value, VmError> {
        self.data.last().ok_or(VmError::StackUnderflow)
    }

    pub fn dup(&mut self) -> Result<(), VmError> {
        let val = self.peek()?.clone();
        self.push(val)?;
        Ok(())
    }

    pub fn clear(&mut self) {
        self.data.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_push_and_pop() {
        let mut stack = Stack::new();
        stack.push(Value::Int(42)).unwrap();
        stack.push(Value::Float(3.14)).unwrap();

        match stack.pop().unwrap() {
            Value::Float(f) => assert_eq!(f, 3.14),
            _ => panic!("Expected Float"),
        }

        match stack.pop().unwrap() {
            Value::Int(i) => assert_eq!(i, 42),
            _ => panic!("Expected Int"),
        }
    }

    #[test]
    fn test_pop_empty() {
        let mut stack = Stack::new();
        assert!(matches!(stack.pop(), Err(VmError::StackUnderflow)));
    }

    #[test]
    fn test_dup_empty() {
        let mut stack = Stack::new();
        assert!(matches!(stack.dup(), Err(VmError::StackUnderflow)));
    }

    #[test]
    fn test_dup() {
        let mut stack = Stack::new();
        stack.push(Value::Int(99)).unwrap();
        stack.dup().unwrap();

        match stack.pop().unwrap() {
            Value::Int(i) => assert_eq!(i, 99),
            _ => panic!("Expected Int"),
        }

        match stack.pop().unwrap() {
            Value::Int(i) => assert_eq!(i, 99),
            _ => panic!("Expected Int"),
        }
        
        assert!(matches!(stack.pop(), Err(VmError::StackUnderflow)));
    }

    #[test]
    fn test_stack_overflow() {
        let mut stack = Stack::new();
        // The limit is 1024
        for _ in 0..1024 {
            stack.push(Value::Null).unwrap();
        }
        
        // Pushing the 1025th value should fail
        assert!(matches!(stack.push(Value::Null), Err(VmError::StackOverflow)));
    }
}
