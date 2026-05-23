#[cfg(test)]
mod tests {
    use crate::vm::Vm;
    use crate::value::Value;
    use crate::stack::VmError;
    use crate::opcodes::OpCode;
    
    

    fn setup_vm(mut bytecode: Vec<u8>) -> Vm {
        // Identity map for tests
        let mut opcode_map = [0u8; 256];
        for i in 0..256 {
            opcode_map[i] = i as u8;
        }

        // Zero session key means XOR cipher is an identity operation, 
        // allowing us to write plaintext test bytecode safely without decryption mangling it
        let session_key = [0u8; 32];

        // Encrypt any PushString literals in the bytecode with SHA-256 keystream derived from zero session key
        let mut i = 0;
        while i < bytecode.len() {
            let op = bytecode[i];
            i += 1;
            if op == OpCode::PushString as u8 {
                if i + 8 <= bytecode.len() {
                    let mut nonce = [0u8; 4];
                    nonce.copy_from_slice(&bytecode[i..i+4]);
                    i += 4;
                    
                    let mut len_bytes = [0u8; 4];
                    len_bytes.copy_from_slice(&bytecode[i..i+4]);
                    let len = u32::from_le_bytes(len_bytes) as usize;
                    i += 4;
                    
                    if i + len <= bytecode.len() {
                        // Generate keystream
                        let mut keystream = Vec::with_capacity(len);
                        let mut block_index = 0u32;
                        while keystream.len() < len {
                            use sha2::{Sha256, Digest};
                            let mut hasher = Sha256::new();
                            hasher.update(&session_key);
                            hasher.update(&nonce);
                            hasher.update(&block_index.to_le_bytes());
                            let block = hasher.finalize();
                            
                            let bytes_to_add = (len - keystream.len()).min(block.len());
                            keystream.extend_from_slice(&block[..bytes_to_add]);
                            block_index += 1;
                        }
                        
                        // Encrypt plaintext bytes in-place in the bytecode
                        for j in 0..len {
                            bytecode[i + j] ^= keystream[j];
                        }
                        i += len;
                    }
                }
            } else if op == OpCode::PushFloat as u8 || op == OpCode::CallNative as u8 || op == OpCode::Call as u8 {
                i = (i + 8).min(bytecode.len());
            } else if op == OpCode::PushInt as u8 || op == OpCode::PushBool as u8 || op == OpCode::LoadLocal as u8 ||
                      op == OpCode::StoreLocal as u8 || op == OpCode::Jump as u8 || op == OpCode::JumpIf as u8 ||
                      op == OpCode::JumpIfNot as u8 || op == OpCode::JumpAndMul as u8 {
                i = (i + 4).min(bytecode.len());
            }
        }
        
        // Compute correct hash so VirtSC doesn't corrupt the session key
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(&bytecode);
        let hash: [u8; 32] = hasher.finalize().into();
        
        Vm::new(bytecode, opcode_map.to_vec(), session_key, hash)
    }

    fn encode_u32(val: u32) -> [u8; 4] {
        val.to_le_bytes()
    }

    fn encode_u64(val: u64) -> [u8; 8] {
        val.to_le_bytes()
    }

    #[test]
    fn test_push_int() {
        let mut bytecode = vec![OpCode::PushInt as u8];
        bytecode.extend_from_slice(&encode_u32(42));
        bytecode.push(OpCode::Halt as u8);
        
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        
        match result {
            Value::Int(i) => assert_eq!(i, 42),
            _ => panic!("Expected Int"),
        }
    }

    #[test]
    fn test_push_float() {
        let mut bytecode = vec![OpCode::PushFloat as u8];
        bytecode.extend_from_slice(&encode_u64(3.14f64.to_bits()));
        bytecode.push(OpCode::Halt as u8);
        
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        
        match result {
            Value::Float(f) => assert_eq!(f, 3.14),
            _ => panic!("Expected Float"),
        }
    }

    #[test]
    fn test_push_bool() {
        let bytecode = vec![
            OpCode::PushBool as u8, 1, 0, 0, 0,
            OpCode::PushBool as u8, 0, 0, 0, 0,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap(); // Halt returns top of stack, which is false
        
        match result {
            Value::Bool(b) => assert_eq!(b, false),
            _ => panic!("Expected Bool false"),
        }
        
        // The remaining item on stack is true
        match vm.stack.pop().unwrap() {
            Value::Bool(b) => assert_eq!(b, true),
            _ => panic!("Expected Bool true"),
        }
    }

    #[test]
    fn test_push_null() {
        let bytecode = vec![OpCode::PushNull as u8, OpCode::Halt as u8];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        assert!(matches!(result, Value::Null));
    }

    #[test]
    fn test_push_string() {
        let mut bytecode = vec![OpCode::PushString as u8];
        bytecode.extend_from_slice(&[0, 0, 0, 0]); // 4-byte nonce
        let text = b"test";
        bytecode.extend_from_slice(&encode_u32(text.len() as u32));
        bytecode.extend_from_slice(text);
        bytecode.push(OpCode::Halt as u8);

        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Str(s) => assert_eq!(&*s, "test"),
            _ => panic!("Expected Str"),
        }
    }

    #[test]
    fn test_pop() {
        let bytecode = vec![
            OpCode::PushInt as u8, 42, 0, 0, 0,
            OpCode::Pop as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        assert!(matches!(result, Value::Null)); // Stack empty, run() returns Null
    }

    #[test]
    fn test_dup() {
        let bytecode = vec![
            OpCode::PushInt as u8, 42, 0, 0, 0,
            OpCode::Dup as u8,
            OpCode::Add as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, 84),
            _ => panic!("Expected Int 84"),
        }
    }

    #[test]
    fn test_load_store_local() {
        let bytecode = vec![
            OpCode::PushInt as u8, 99, 0, 0, 0,
            OpCode::StoreLocal as u8, 5, 0, 0, 0,
            OpCode::LoadLocal as u8, 5, 0, 0, 0,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, 99),
            _ => panic!("Expected Int 99"),
        }
    }

    #[test]
    fn test_add() {
        let bytecode = vec![
            OpCode::PushInt as u8, 10, 0, 0, 0,
            OpCode::PushInt as u8, 20, 0, 0, 0,
            OpCode::Add as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, 30),
            _ => panic!("Expected Int 30"),
        }
    }

    #[test]
    fn test_add_floats() {
        let mut bytecode = vec![OpCode::PushFloat as u8];
        bytecode.extend_from_slice(&encode_u64(1.5f64.to_bits()));
        bytecode.push(OpCode::PushFloat as u8);
        bytecode.extend_from_slice(&encode_u64(2.5f64.to_bits()));
        bytecode.push(OpCode::Add as u8);
        bytecode.push(OpCode::Halt as u8);

        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Float(f) => assert_eq!(f, 4.0),
            _ => panic!("Expected Float 4.0"),
        }
    }

    #[test]
    fn test_add_type_error() {
        let bytecode = vec![
            OpCode::PushInt as u8, 10, 0, 0, 0,
            OpCode::PushBool as u8, 1, 0, 0, 0,
            OpCode::Add as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        assert!(matches!(vm.run(), Err(VmError::TypeError)));
    }

    #[test]
    fn test_sub_mul_div() {
        let bytecode = vec![
            OpCode::PushInt as u8, 20, 0, 0, 0,
            OpCode::PushInt as u8, 10, 0, 0, 0,
            OpCode::Sub as u8, // 20 - 10 = 10
            OpCode::PushInt as u8, 2, 0, 0, 0,
            OpCode::Mul as u8, // 10 * 2 = 20
            OpCode::PushInt as u8, 4, 0, 0, 0,
            OpCode::Div as u8, // 20 / 4 = 5
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, 5),
            _ => panic!("Expected Int 5"),
        }
    }

    #[test]
    fn test_div_by_zero() {
        let bytecode = vec![
            OpCode::PushInt as u8, 10, 0, 0, 0,
            OpCode::PushInt as u8, 0, 0, 0, 0,
            OpCode::Div as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        assert!(matches!(vm.run(), Err(VmError::DivisionByZero)));
    }

    #[test]
    fn test_shl() {
        let bytecode = vec![
            OpCode::PushInt as u8, 1, 0, 0, 0,
            OpCode::PushInt as u8, 63, 0, 0, 0,
            OpCode::Shl as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, 1i64 << 63),
            _ => panic!("Expected Int"),
        }
    }

    #[test]
    fn test_shl_overflow() {
        let bytecode = vec![
            OpCode::PushInt as u8, 1, 0, 0, 0,
            OpCode::PushInt as u8, 64, 0, 0, 0,
            OpCode::Shl as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        assert!(matches!(vm.run(), Err(VmError::InvalidShiftAmount)));
    }

    #[test]
    fn test_shr_overflow() {
        let bytecode = vec![
            OpCode::PushInt as u8, 1, 0, 0, 0,
            OpCode::PushInt as u8, 64, 0, 0, 0,
            OpCode::Shr as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        assert!(matches!(vm.run(), Err(VmError::InvalidShiftAmount)));
    }

    #[test]
    fn test_bitwise() {
        let bytecode = vec![
            // BitAnd
            OpCode::PushInt as u8, 0b1100, 0, 0, 0,
            OpCode::PushInt as u8, 0b1010, 0, 0, 0,
            OpCode::BitAnd as u8, // 0b1000
            
            // BitOr
            OpCode::PushInt as u8, 0b0011, 0, 0, 0,
            OpCode::BitOr as u8, // 0b1011

            // BitXor
            OpCode::PushInt as u8, 0b1111, 0, 0, 0,
            OpCode::BitXor as u8, // 0b0100

            // BitNot
            OpCode::BitNot as u8, // !0b0100
            
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, !0b0100),
            _ => panic!("Expected Int"),
        }
    }

    #[test]
    fn test_comparisons() {
        let bytecode = vec![
            // 10 < 20
            OpCode::PushInt as u8, 10, 0, 0, 0,
            OpCode::PushInt as u8, 20, 0, 0, 0,
            OpCode::Lt as u8, // true
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Bool(b) => assert_eq!(b, true),
            _ => panic!("Expected Bool true"),
        }
    }

    #[test]
    fn test_logical() {
        let bytecode = vec![
            OpCode::PushBool as u8, 1, 0, 0, 0,
            OpCode::Not as u8, // false
            OpCode::PushBool as u8, 1, 0, 0, 0,
            OpCode::Or as u8, // true
            OpCode::PushBool as u8, 1, 0, 0, 0,
            OpCode::And as u8, // true
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Bool(b) => assert_eq!(b, true),
            _ => panic!("Expected Bool true"),
        }
    }

    #[test]
    fn test_jump() {
        let bytecode = vec![
            OpCode::Jump as u8, 11, 0, 0, 0, // Jump to PC 11
            OpCode::PushInt as u8, 1, 0, 0, 0, // PC 5: Skipped
            OpCode::Halt as u8, // PC 10: Skipped
            OpCode::PushInt as u8, 42, 0, 0, 0, // PC 11
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, 42),
            _ => panic!("Expected Int 42"),
        }
    }

    #[test]
    fn test_jump_if() {
        let bytecode = vec![
            OpCode::PushBool as u8, 1, 0, 0, 0, // PC 0-4
            OpCode::JumpIf as u8, 16, 0, 0, 0, // PC 5-9. Jump to 16
            OpCode::PushInt as u8, 1, 0, 0, 0, // PC 10-14
            OpCode::Halt as u8,                // PC 15
            OpCode::PushInt as u8, 42, 0, 0, 0, // PC 16-20
            OpCode::Halt as u8                 // PC 21
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, 42),
            _ => panic!("Expected Int 42"),
        }
    }

    #[test]
    fn test_jump_if_not() {
        let bytecode = vec![
            OpCode::PushBool as u8, 0, 0, 0, 0,
            OpCode::JumpIfNot as u8, 16, 0, 0, 0,
            OpCode::PushInt as u8, 1, 0, 0, 0,
            OpCode::Halt as u8,
            OpCode::PushInt as u8, 42, 0, 0, 0, // PC 16
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, 42),
            _ => panic!("Expected Int 42"),
        }
    }

    #[test]
    fn test_new_object_list() {
        let bytecode = vec![
            OpCode::NewObject as u8,
            OpCode::NewList as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap(); // Returns top of stack (list)
        
        match result {
            Value::List(_) => {},
            _ => panic!("Expected List"),
        }
        match vm.stack.pop().unwrap() {
            Value::Object(_) => {},
            _ => panic!("Expected Object"),
        }
    }

    #[test]
    fn test_list_push() {
        let bytecode = vec![
            OpCode::NewList as u8,
            OpCode::PushInt as u8, 42, 0, 0, 0,
            OpCode::ListPush as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::List(l) => {
                let vec = l.borrow();
                assert_eq!(vec.len(), 1);
                match vec[0] {
                    Value::Int(i) => assert_eq!(i, 42),
                    _ => panic!("Expected Int in list"),
                }
            },
            _ => panic!("Expected List"),
        }
    }

    #[test]
    fn test_get_member_object() {
        let bytecode = vec![
            OpCode::NewObject as u8,
            
            // Push string key "k"
            OpCode::PushString as u8, 0, 0, 0, 0, 1, 0, 0, 0, b'k',
            OpCode::PushInt as u8, 42, 0, 0, 0,
            OpCode::SetMember as u8,
            
            // SetMember pops object, key, value and pushes object back.
            // Push string key "k" again
            OpCode::PushString as u8, 0, 0, 0, 0, 1, 0, 0, 0, b'k',
            OpCode::GetMember as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, 42),
            _ => panic!("Expected Int 42"),
        }
    }

    #[test]
    fn test_get_member_object_missing() {
        let bytecode = vec![
            OpCode::NewObject as u8,
            OpCode::PushString as u8, 0, 0, 0, 0, 1, 0, 0, 0, b'k',
            OpCode::GetMember as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        assert!(matches!(result, Value::Null));
    }

    #[test]
    fn test_get_member_list_bounds() {
        let bytecode_base = vec![
            OpCode::NewList as u8,
            OpCode::PushInt as u8, 42, 0, 0, 0,
            OpCode::ListPush as u8,
            // List is on stack
        ];
        
        let mut bytecode = bytecode_base.clone();
        bytecode.extend_from_slice(&[OpCode::PushInt as u8, 0, 0, 0, 0]); // Index 0
        bytecode.extend_from_slice(&[OpCode::GetMember as u8, OpCode::Halt as u8]);
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, 42),
            _ => panic!("Expected Int 42"),
        }
        
        // Negative index
        let mut bytecode2 = bytecode_base.clone();
        bytecode2.extend_from_slice(&[OpCode::PushInt as u8]);
        bytecode2.extend_from_slice(&(-1i32 as u32).to_le_bytes()); // -1
        bytecode2.extend_from_slice(&[OpCode::GetMember as u8, OpCode::Halt as u8]);
        let mut vm = setup_vm(bytecode2);
        assert!(matches!(vm.run(), Err(VmError::IndexOutOfBounds)));

        // Out of bounds index
        let mut bytecode3 = bytecode_base.clone();
        bytecode3.extend_from_slice(&[OpCode::PushInt as u8, 5, 0, 0, 0]); // Index 5
        bytecode3.extend_from_slice(&[OpCode::GetMember as u8, OpCode::Halt as u8]);
        let mut vm = setup_vm(bytecode3);
        assert!(matches!(vm.run(), Err(VmError::IndexOutOfBounds)));
    }

    #[test]
    fn test_set_member_list() {
        let bytecode = vec![
            OpCode::NewList as u8,
            OpCode::PushInt as u8, 0, 0, 0, 0,
            OpCode::PushInt as u8, 42, 0, 0, 0,
            OpCode::SetMember as u8, // Append to empty list
            OpCode::PushInt as u8, 0, 0, 0, 0, // Get index 0
            OpCode::GetMember as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, 42),
            _ => panic!("Expected Int 42"),
        }
    }

    #[test]
    fn test_set_member_list_oob() {
        let bytecode = vec![
            OpCode::NewList as u8,
            OpCode::PushInt as u8, 5, 0, 0, 0, // Index 5 (OOB since length is 0)
            OpCode::PushInt as u8, 42, 0, 0, 0,
            OpCode::SetMember as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        assert!(matches!(vm.run(), Err(VmError::IndexOutOfBounds)));
    }

    #[test]
    fn test_length() {
        // List length
        let bytecode = vec![
            OpCode::NewList as u8,
            OpCode::PushInt as u8, 42, 0, 0, 0,
            OpCode::ListPush as u8,
            OpCode::Length as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, 1),
            _ => panic!("Expected Int 1"),
        }

        // String length
        let mut bytecode = vec![OpCode::PushString as u8, 0, 0, 0, 0, 5, 0, 0, 0];
        bytecode.extend_from_slice(b"hello");
        bytecode.extend_from_slice(&[OpCode::Length as u8, OpCode::Halt as u8]);
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, 5),
            _ => panic!("Expected Int 5"),
        }

        // Type Error
        let bytecode = vec![
            OpCode::PushInt as u8, 5, 0, 0, 0,
            OpCode::Length as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        assert!(matches!(vm.run(), Err(VmError::TypeError)));
    }

    #[test]
    fn test_concat() {
        let mut bytecode = vec![OpCode::PushString as u8, 0, 0, 0, 0, 2, 0, 0, 0];
        bytecode.extend_from_slice(b"ab");
        bytecode.extend_from_slice(&[OpCode::PushString as u8, 0, 0, 0, 0, 2, 0, 0, 0]);
        bytecode.extend_from_slice(b"cd");
        bytecode.extend_from_slice(&[OpCode::Concat as u8, OpCode::Halt as u8]);

        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Str(s) => assert_eq!(&*s, "abcd"),
            _ => panic!("Expected Str abcd"),
        }

        let bytecode = vec![
            OpCode::PushInt as u8, 5, 0, 0, 0,
            OpCode::PushString as u8, 0, 0, 0, 0, 1, 0, 0, 0, b'x',
            OpCode::Concat as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        assert!(matches!(vm.run(), Err(VmError::TypeError)));
    }

    #[test]
    fn test_hash256() {
        let mut bytecode = vec![OpCode::PushString as u8, 0, 0, 0, 0, 5, 0, 0, 0];
        bytecode.extend_from_slice(b"hello");
        bytecode.extend_from_slice(&[OpCode::Hash256 as u8, OpCode::Halt as u8]);

        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Str(s) => assert_eq!(&*s, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"),
            _ => panic!("Expected SHA256 Str"),
        }
    }

    #[test]
    fn test_call_and_return() {
        let bytecode = vec![
            OpCode::Jump as u8, 17, 0, 0, 0, // Jump to PC 17 (over function)
            // Function at PC 5
            OpCode::LoadLocal as u8, 0, 0, 0, 0, // PC 5: load arg0
            OpCode::PushInt as u8, 1, 0, 0, 0,   // PC 10: push 1
            OpCode::Add as u8,                   // PC 15: arg0 + 1
            OpCode::Return as u8,                // PC 16: return
            
            // PC 17: main execution
            OpCode::PushInt as u8, 41, 0, 0, 0, // PC 17: push 41
            OpCode::Call as u8, 5, 0, 0, 0, 1, 0, 0, 0, // PC 22: Call PC 5, 1 arg
            OpCode::Halt as u8                  // PC 31
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, 42),
            _ => panic!("Expected Int 42"),
        }
    }

    #[test]
    fn test_return_no_frames() {
        let bytecode = vec![
            OpCode::PushInt as u8, 42, 0, 0, 0,
            OpCode::Return as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, 42),
            _ => panic!("Expected Int 42"),
        }
    }

    #[test]
    fn test_call_stack_overflow() {
        let bytecode = vec![
            // Function at PC 0 calls itself
            OpCode::Call as u8, 0, 0, 0, 0, 0, 0, 0, 0, // call PC 0, 0 args
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        assert!(matches!(vm.run(), Err(VmError::CallStackOverflow)));
    }

    #[test]
    fn test_execution_cycle_limit() {
        let bytecode = vec![
            // Infinite loop
            OpCode::Jump as u8, 0, 0, 0, 0
        ];
        let mut vm = setup_vm(bytecode);
        vm.set_gas_limit(10);
        assert!(matches!(vm.run(), Err(VmError::OutOfGas)));
    }

    #[test]
    fn test_read_byte_oob() {
        let bytecode = vec![
            OpCode::PushInt as u8 // Missing 4 bytes of operand
        ];
        let mut vm = setup_vm(bytecode);
        assert!(matches!(vm.run(), Err(VmError::UnexpectedEndOfCode)));
    }

    #[test]
    #[cfg(not(feature = "dev"))]
    fn test_secure_pushstring_decryption() {
        let session_key = [0x55u8; 32];
        let nonce = [0xAAu8; 4];
        let text = b"secure_cryptography_layer";
        let len = text.len();
        
        let mut keystream = Vec::with_capacity(len);
        let mut block_index = 0u32;
        while keystream.len() < len {
            use sha2::{Sha256, Digest};
            let mut hasher = Sha256::new();
            hasher.update(&session_key);
            hasher.update(&nonce);
            hasher.update(&block_index.to_le_bytes());
            let block = hasher.finalize();
            
            let bytes_to_add = (len - keystream.len()).min(block.len());
            keystream.extend_from_slice(&block[..bytes_to_add]);
            block_index += 1;
        }
        
        let mut encrypted_text = Vec::with_capacity(len);
        for j in 0..len {
            encrypted_text.push(text[j] ^ keystream[j]);
        }
        
        let mut bytecode = vec![OpCode::PushString as u8];
        bytecode.extend_from_slice(&nonce);
        bytecode.extend_from_slice(&(len as u32).to_le_bytes());
        bytecode.extend_from_slice(&encrypted_text);
        bytecode.push(OpCode::Halt as u8);

        #[cfg(not(feature = "dev"))]
        {
            for i in 0..bytecode.len() {
                bytecode[i] ^= session_key[i % 32];
            }
        }
        
        let mut opcode_map = [0u8; 256];
        for i in 0..256 {
            opcode_map[i] = i as u8;
        }
        
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(&bytecode);
        let hash: [u8; 32] = hasher.finalize().into();
        
        let mut vm = Vm::new(bytecode, opcode_map.to_vec(), session_key, hash);
        let result = vm.run().unwrap();
        match result {
            Value::Str(s) => assert_eq!(&*s, "secure_cryptography_layer"),
            _ => panic!("Expected decrypted Str"),
        }
    }

    #[test]
    fn test_manual_partial_eq() {
        use std::collections::HashMap;
        use std::rc::Rc;
        use std::cell::RefCell;
        
        // Equal pointer check
        let obj_inner = Rc::new(RefCell::new(HashMap::new()));
        let val1 = Value::Object(obj_inner.clone());
        let val2 = Value::Object(obj_inner.clone());
        assert_eq!(val1, val2);
        
        // Different pointer check (should be false, as pointer equality is checked)
        let obj_inner2 = Rc::new(RefCell::new(HashMap::new()));
        let val3 = Value::Object(obj_inner2);
        assert_ne!(val1, val3);
    }

    #[test]
    fn test_gas_limits() {
        let bytecode = vec![
            OpCode::PushInt as u8, 42, 0, 0, 0,
            OpCode::PushInt as u8, 1, 0, 0, 0,
            OpCode::Add as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        vm.set_gas_limit(2); // very low limit (need 1 + 1 + 2 + 1 = 5 gas)
        assert!(matches!(vm.run(), Err(VmError::OutOfGas)));
    }

    #[test]
    fn test_value_to_json_cycle() {
        use std::collections::HashMap;
        use std::rc::Rc;
        use std::cell::RefCell;
        
        // Cyclic list
        let list_inner = Rc::new(RefCell::new(Vec::new()));
        let list_val = Value::List(list_inner.clone());
        list_inner.borrow_mut().push(list_val.clone());
        
        let json_res = crate::wrapper::value_to_json(&list_val);
        assert_eq!(json_res, serde_json::Value::Array(vec![serde_json::Value::String("<cycle>".to_string())]));

        // Cyclic object
        let obj_inner = Rc::new(RefCell::new(HashMap::new()));
        let obj_val = Value::Object(obj_inner.clone());
        obj_inner.borrow_mut().insert("self".to_string(), obj_val.clone());
        
        let json_res2 = crate::wrapper::value_to_json(&obj_val);
        assert_eq!(json_res2.get("self").unwrap(), &serde_json::Value::String("<cycle>".to_string()));
    }

    #[test]
    fn test_clear_crypto() {
        let expected_hash = [0x11u8; 32];
        crate::verify_bridge::set_payload_hash(Box::new(expected_hash));
        
        // Initialize static variables
        crate::verify_bridge::PAYLOAD_HASH.with(|h| {
            assert!(h.borrow().is_some());
        });

        crate::verify_bridge::clear_crypto();

        crate::verify_bridge::PAYLOAD_HASH.with(|h| {
            assert!(h.borrow().is_none());
        });
        crate::verify_bridge::SIGNING_KEY.with(|k| {
            assert!(k.borrow().is_none());
        });
    }

    #[test]
    fn test_pushstring_len_too_large() {
        // len is larger than limit (65536)
        let mut bytecode = vec![OpCode::PushString as u8];
        bytecode.extend_from_slice(&[0, 0, 0, 0]); // nonce
        bytecode.extend_from_slice(&encode_u32(65537)); // length too large
        bytecode.push(OpCode::Halt as u8);
        
        let mut vm = setup_vm(bytecode);
        assert!(matches!(vm.run(), Err(VmError::UnexpectedEndOfCode)));
    }

    #[test]
    fn test_pushstring_len_exceeds_bytecode() {
        // len is within limit but exceeds remaining bytecode
        let mut bytecode = vec![OpCode::PushString as u8];
        bytecode.extend_from_slice(&[0, 0, 0, 0]); // nonce
        bytecode.extend_from_slice(&encode_u32(100)); // length 100, but bytecode terminates immediately
        
        let mut vm = setup_vm(bytecode);
        assert!(matches!(vm.run(), Err(VmError::UnexpectedEndOfCode)));
    }

    #[test]
    fn test_call_arg_count_too_large() {
        let bytecode = vec![
            OpCode::PushInt as u8, 42, 0, 0, 0,
            OpCode::Call as u8, 0, 0, 0, 0, 1, 1, 0, 0, // target = 0, arg_count = 257 (> 256)
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        assert!(matches!(vm.run(), Err(VmError::InvalidLocalSlot)));
    }

    #[test]
    fn test_get_member_str_unicode() {
        // Test unicode multi-byte string member indexing
        // String: "🦀🤖" (chars: '🦀', '🤖')
        // Crab: 4 bytes, Robot: 4 bytes. Total chars = 2
        let s = "🦀🤖";
        let mut bytecode = vec![OpCode::PushString as u8, 0, 0, 0, 0];
        bytecode.extend_from_slice(&encode_u32(s.len() as u32));
        bytecode.extend_from_slice(s.as_bytes());
        
        // Push index 1 ('🤖')
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(1));
        bytecode.push(OpCode::GetMember as u8);
        bytecode.push(OpCode::Halt as u8);
        
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Str(ch) => assert_eq!(&*ch, "🤖"),
            _ => panic!("Expected Robot emoji string"),
        }

        // Test out of bounds index (index 2)
        let mut bytecode2 = vec![OpCode::PushString as u8, 0, 0, 0, 0];
        bytecode2.extend_from_slice(&encode_u32(s.len() as u32));
        bytecode2.extend_from_slice(s.as_bytes());
        bytecode2.push(OpCode::PushInt as u8);
        bytecode2.extend_from_slice(&encode_u32(2)); // index 2 is out of bounds
        bytecode2.push(OpCode::GetMember as u8);
        bytecode2.push(OpCode::Halt as u8);

        let mut vm2 = setup_vm(bytecode2);
        assert!(matches!(vm2.run(), Err(VmError::IndexOutOfBounds)));
    }

    #[test]
    fn test_pushstring_huge_length_no_oom() {
        // len is extremely large: 0xFFFFFFFF
        let mut bytecode = vec![OpCode::PushString as u8];
        bytecode.extend_from_slice(&[0, 0, 0, 0]); // nonce
        bytecode.extend_from_slice(&encode_u32(0xFFFFFFFF));
        bytecode.push(OpCode::Halt as u8);
        
        let mut vm = setup_vm(bytecode);
        assert!(matches!(vm.run(), Err(VmError::UnexpectedEndOfCode)));
    }

    #[test]
    fn test_call_arg_count_limits_no_panic() {
        // Test different large arg counts: 257, 1000, 0xFFFFFFFF
        for invalid_count in [257, 1000, 0xFFFFFFFF] {
            let mut bytecode = vec![
                OpCode::PushInt as u8, 42, 0, 0, 0,
                OpCode::Call as u8, 0, 0, 0, 0,
            ];
            bytecode.extend_from_slice(&encode_u32(invalid_count));
            bytecode.push(OpCode::Halt as u8);
            
            let mut vm = setup_vm(bytecode);
            assert!(matches!(vm.run(), Err(VmError::InvalidLocalSlot)));
        }
    }

    #[test]
    fn test_get_member_complex_unicode_indexing() {
        // Complex unicode characters: surrogate pairs, multi-byte, emojis
        // String: "A𠜎B🇨🇳C👨‍👩‍👧‍👦D"
        // 'A' : 1 byte, 1 char
        // '𠜎' : 4 bytes (surrogate pair range/supplementary plane), 1 char
        // 'B' : 1 byte, 1 char
        // '🇨🇳' : 8 bytes (Regional Indicator Symbol Letter C + N), 2 chars
        // 'C' : 1 byte, 1 char
        // '👨‍👩‍👧‍👦' : 25 bytes (Family emoji: Man + ZWJ + Woman + ZWJ + Girl + ZWJ + Boy), 7 chars
        // 'D' : 1 byte, 1 char
        // Let's verify total character count and correct character-by-character indexing
        let s = "A𠜎B🇨🇳C👨‍👩‍👧‍👦D";
        let chars_list: Vec<String> = s.chars().map(|c| c.to_string()).collect();
        let char_count = chars_list.len();

        for i in 0..char_count {
            let mut bytecode = vec![OpCode::PushString as u8, 0, 0, 0, 0];
            bytecode.extend_from_slice(&encode_u32(s.len() as u32));
            bytecode.extend_from_slice(s.as_bytes());
            bytecode.push(OpCode::PushInt as u8);
            bytecode.extend_from_slice(&encode_u32(i as u32));
            bytecode.push(OpCode::GetMember as u8);
            bytecode.push(OpCode::Halt as u8);

            let mut vm = setup_vm(bytecode);
            let result = vm.run().unwrap();
            match result {
                Value::Str(ch) => {
                    assert_eq!(*ch, chars_list[i]);
                    // Verify it is not null-byte or empty
                    assert!(!ch.is_empty());
                    assert_ne!(*ch, "\0");
                }
                _ => panic!("Expected Str at index {}", i),
            }
        }

        // Test out of bounds indexing (exactly char_count and beyond)
        for out_idx in [char_count as u32, char_count as u32 + 1, 1000] {
            let mut bytecode = vec![OpCode::PushString as u8, 0, 0, 0, 0];
            bytecode.extend_from_slice(&encode_u32(s.len() as u32));
            bytecode.extend_from_slice(s.as_bytes());
            bytecode.push(OpCode::PushInt as u8);
            bytecode.extend_from_slice(&encode_u32(out_idx));
            bytecode.push(OpCode::GetMember as u8);
            bytecode.push(OpCode::Halt as u8);

            let mut vm = setup_vm(bytecode);
            assert!(matches!(vm.run(), Err(VmError::IndexOutOfBounds)));
        }

        // Test negative index
        let mut bytecode = vec![OpCode::PushString as u8, 0, 0, 0, 0];
        bytecode.extend_from_slice(&encode_u32(s.len() as u32));
        bytecode.extend_from_slice(s.as_bytes());
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&(-1i32 as u32).to_le_bytes()); // -1
        bytecode.push(OpCode::GetMember as u8);
        bytecode.push(OpCode::Halt as u8);

        let mut vm = setup_vm(bytecode);
        assert!(matches!(vm.run(), Err(VmError::IndexOutOfBounds)));
    }

    #[test]
    fn test_pushstring_invalid_utf8_no_panic() {
        // [0xFF, 0xFF, 0xFF] is invalid UTF-8
        let mut bytecode = vec![OpCode::PushString as u8];
        bytecode.extend_from_slice(&[0, 0, 0, 0]); // nonce
        bytecode.extend_from_slice(&encode_u32(3)); // length 3
        bytecode.extend_from_slice(&[0xFF, 0xFF, 0xFF]);
        bytecode.push(OpCode::Halt as u8);
        
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Str(s) => assert_eq!(&*s, "INVALID_STR"),
            _ => panic!("Expected Str"),
        }
    }
}

