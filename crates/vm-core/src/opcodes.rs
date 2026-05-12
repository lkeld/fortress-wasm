#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum OpCode {
    // Stack
    Push        = 0x01,  // Push constant (operand = constant pool index)
    Pop         = 0x02,
    Dup         = 0x03,  // Duplicate top of stack
    
    // Locals
    LoadLocal   = 0x10,  // operand = slot index
    StoreLocal  = 0x11,
    
    // Arithmetic
    AddInt      = 0x20,
    SubInt      = 0x21,
    MulInt      = 0x22,
    DivInt      = 0x23,
    AddFloat    = 0x24,
    SubFloat    = 0x25,
    MulFloat    = 0x26,
    DivFloat    = 0x27,
    
    // Comparison
    Eq          = 0x30,
    Neq         = 0x31,
    Lt          = 0x32,
    Gt          = 0x33,
    Lte         = 0x34,
    Gte         = 0x35,
    
    // Logic
    And         = 0x40,
    Or          = 0x41,
    Not         = 0x42,
    
    // Control Flow
    Jump        = 0x50,  // operand = absolute instruction index
    JumpIf      = 0x51,  // jump if top of stack is truthy
    JumpIfNot   = 0x52,
    
    // Objects/Maps
    NewObject   = 0x60,
    SetField    = 0x61,  // operand = field name constant index
    GetField    = 0x62,
    NewList     = 0x63,
    ListPush    = 0x64,
    
    // Functions
    Call        = 0x70,  // operand = function index in function table
    Return      = 0x71,
    
    // Native Bridge (call back into host WASM functions)
    CallNative  = 0x80,  // operand = native function ID
    
    // Halt
    Halt        = 0xFF,
}

impl TryFrom<u8> for OpCode {
    type Error = ();

    fn try_from(v: u8) -> Result<Self, Self::Error> {
        match v {
            0x01 => Ok(OpCode::Push),
            0x02 => Ok(OpCode::Pop),
            0x03 => Ok(OpCode::Dup),
            0x10 => Ok(OpCode::LoadLocal),
            0x11 => Ok(OpCode::StoreLocal),
            0x20 => Ok(OpCode::AddInt),
            0x21 => Ok(OpCode::SubInt),
            0x22 => Ok(OpCode::MulInt),
            0x23 => Ok(OpCode::DivInt),
            0x24 => Ok(OpCode::AddFloat),
            0x25 => Ok(OpCode::SubFloat),
            0x26 => Ok(OpCode::MulFloat),
            0x27 => Ok(OpCode::DivFloat),
            0x30 => Ok(OpCode::Eq),
            0x31 => Ok(OpCode::Neq),
            0x32 => Ok(OpCode::Lt),
            0x33 => Ok(OpCode::Gt),
            0x34 => Ok(OpCode::Lte),
            0x35 => Ok(OpCode::Gte),
            0x40 => Ok(OpCode::And),
            0x41 => Ok(OpCode::Or),
            0x42 => Ok(OpCode::Not),
            0x50 => Ok(OpCode::Jump),
            0x51 => Ok(OpCode::JumpIf),
            0x52 => Ok(OpCode::JumpIfNot),
            0x60 => Ok(OpCode::NewObject),
            0x61 => Ok(OpCode::SetField),
            0x62 => Ok(OpCode::GetField),
            0x63 => Ok(OpCode::NewList),
            0x64 => Ok(OpCode::ListPush),
            0x70 => Ok(OpCode::Call),
            0x71 => Ok(OpCode::Return),
            0x80 => Ok(OpCode::CallNative),
            0xFF => Ok(OpCode::Halt),
            _ => Err(()),
        }
    }
}
