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
    Add         = 0x20,
    Sub         = 0x21,
    Mul         = 0x22,
    Div         = 0x23,
    
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
    GetMember   = 0x65,  // pops key, pops obj/list
    SetMember   = 0x66,  // pops val, pops key, pops obj/list
    Length      = 0x67,  // pops obj/list/string, pushes length
    Hash256     = 0x68,  // pops value, pushes sha256 hash string
    
    // Cryptography and Parsing
    EncryptAES  = 0x69,  // pops key, pops payload, pushes encrypted base64 string
    JSONStringify = 0x6A, // pops value, pushes json string

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
            0x20 => Ok(OpCode::Add),
            0x21 => Ok(OpCode::Sub),
            0x22 => Ok(OpCode::Mul),
            0x23 => Ok(OpCode::Div),
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
            0x65 => Ok(OpCode::GetMember),
            0x66 => Ok(OpCode::SetMember),
            0x67 => Ok(OpCode::Length),
            0x68 => Ok(OpCode::Hash256),
            0x69 => Ok(OpCode::EncryptAES),
            0x6A => Ok(OpCode::JSONStringify),
            0x70 => Ok(OpCode::Call),
            0x71 => Ok(OpCode::Return),
            0x80 => Ok(OpCode::CallNative),
            0xFF => Ok(OpCode::Halt),
            _ => Err(()),
        }
    }
}
