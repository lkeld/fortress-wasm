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
        let base_key_material = [0u8; 32];

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
        let mut expected_hash = [0u8; 32];
        {
            use hmac::{Hmac, Mac};
            use sha2::Sha256;
            type HmacSha256 = Hmac<Sha256>;
            if let Ok(mut mac) = HmacSha256::new_from_slice(&base_key_material) {
                mac.update(&bytecode);
                expected_hash.copy_from_slice(&mac.finalize().into_bytes());
            }
        }
        
        Vm::new(bytecode, opcode_map.to_vec(), session_key, base_key_material, expected_hash)
    }

    fn encode_u32(val: u32) -> [u8; 4] {
        val.to_le_bytes()
    }

    fn encode_u64(val: u64) -> [u8; 8] {
        val.to_le_bytes()
    }

    fn push_float(bytecode: &mut Vec<u8>, val: f64) {
        bytecode.push(OpCode::PushFloat as u8);
        bytecode.extend_from_slice(&val.to_bits().to_le_bytes());
    }

    fn push_string(bytecode: &mut Vec<u8>, text: &str) {
        bytecode.push(OpCode::PushString as u8);
        bytecode.extend_from_slice(&[0, 0, 0, 0]); // nonce
        bytecode.extend_from_slice(&(text.len() as u32).to_le_bytes());
        bytecode.extend_from_slice(text.as_bytes());
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
    fn test_add_bool() {
        let bytecode = vec![
            OpCode::PushInt as u8, 10, 0, 0, 0,
            OpCode::PushBool as u8, 1, 0, 0, 0,
            OpCode::Add as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, 11),
            _ => panic!("Expected Int 11"),
        }
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
        let result = vm.run().unwrap();
        match result {
            Value::Float(f) => assert!(f.is_infinite()),
            _ => panic!("Expected Float Infinity"),
        }
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
            Value::Int(i) => assert_eq!(i, -2147483648), // 1 << (63 & 31) = 1 << 31 = -2147483648
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
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, 1), // 1 << (64 & 31) = 1 << 0 = 1
            _ => panic!("Expected Int 1"),
        }
    }

    #[test]
    fn test_shr_overflow() {
        let bytecode = vec![
            OpCode::PushInt as u8, 16, 0, 0, 0,
            OpCode::PushInt as u8, 66, 0, 0, 0,
            OpCode::Shr as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, 4), // 16 >> (66 & 31) = 16 >> 2 = 4
            _ => panic!("Expected Int 4"),
        }
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

        // Length of integer returns 0 fallback
        let bytecode = vec![
            OpCode::PushInt as u8, 5, 0, 0, 0,
            OpCode::Length as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, 0),
            _ => panic!("Expected Int 0"),
        }
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
        let base_key_material = [0x66u8; 32];
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
        
        let mut expected_hash = [0u8; 32];
        {
            use hmac::{Hmac, Mac};
            use sha2::Sha256;
            type HmacSha256 = Hmac<Sha256>;
            if let Ok(mut mac) = HmacSha256::new_from_slice(&base_key_material) {
                mac.update(&bytecode);
                expected_hash.copy_from_slice(&mac.finalize().into_bytes());
            }
        }
        
        let mut vm = Vm::new(bytecode, opcode_map.to_vec(), session_key, base_key_material, expected_hash);
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

    #[test]
    fn test_load_local_oob() {
        // LoadLocal slot 256 (OOB, limit is 256, so slot indices are 0..255)
        let bytecode = vec![
            OpCode::LoadLocal as u8, 0, 1, 0, 0, // 256 in little endian
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        assert!(matches!(vm.run(), Err(VmError::InvalidLocalSlot)));
    }

    #[test]
    fn test_store_local_oob() {
        // StoreLocal slot 256 (OOB, limit is 256, so slot indices are 0..255)
        let bytecode = vec![
            OpCode::PushInt as u8, 42, 0, 0, 0,
            OpCode::StoreLocal as u8, 0, 1, 0, 0, // 256 in little endian
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        assert!(matches!(vm.run(), Err(VmError::InvalidLocalSlot)));
    }

    #[test]
    fn test_tampered_bytecode_aborts_and_zeroizes_keys() {
        let bytecode = vec![OpCode::PushInt as u8, 0, 0, 0, 42, OpCode::Halt as u8];
        let mut vm = setup_vm(bytecode);
        
        // Let's modify a byte in vm.code to simulate tampering (e.g. patching bytecode)
        vm.code[1] = 99;
        
        // Running the vm should trigger JIT page decryption which checks the hash,
        // finds a mismatch, and zeroizes the key materials and code.
        let result = vm.run();
        
        // Since code is zeroized, the execution will abort/fail.
        assert!(result.is_err());
        
        // Let's verify that key materials and memory states are zeroed out.
        assert_eq!(vm.base_key_material, [0u8; 32]);
        assert_eq!(vm.session_key, [0u8; 32]);
        assert!(vm.code.iter().all(|&b| b == 0));
        assert_eq!(vm.ves, [0u8; 256]);
        assert_eq!(vm.opcode_map, [0u8; 256]);
    }

    #[test]
    fn test_math_opcodes_all() {
        // Floor
        let mut bytecode = vec![];
        push_float(&mut bytecode, 3.7);
        bytecode.push(OpCode::MathFloor as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(3.0));

        // Ceil
        let mut bytecode = vec![];
        push_float(&mut bytecode, 3.1);
        bytecode.push(OpCode::MathCeil as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(4.0));

        // Round
        let mut bytecode = vec![];
        push_float(&mut bytecode, 3.5);
        bytecode.push(OpCode::MathRound as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(4.0));

        // Abs
        let mut bytecode = vec![];
        push_float(&mut bytecode, -5.5);
        bytecode.push(OpCode::MathAbs as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(5.5));

        // Sqrt
        let mut bytecode = vec![];
        push_float(&mut bytecode, 16.0);
        bytecode.push(OpCode::MathSqrt as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(4.0));

        // Pow
        let mut bytecode = vec![];
        push_float(&mut bytecode, 2.0);
        push_float(&mut bytecode, 3.0);
        bytecode.push(OpCode::MathPow as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(8.0));

        // Log, Log2, Log10
        let mut bytecode = vec![];
        push_float(&mut bytecode, std::f64::consts::E);
        bytecode.push(OpCode::MathLog as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert!((match vm.run().unwrap() { Value::Float(f) => f, _ => 0.0 } - 1.0).abs() < 1e-9);

        let mut bytecode = vec![];
        push_float(&mut bytecode, 8.0);
        bytecode.push(OpCode::MathLog2 as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(3.0));

        let mut bytecode = vec![];
        push_float(&mut bytecode, 100.0);
        bytecode.push(OpCode::MathLog10 as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(2.0));

        // Sin, Cos, Tan, Asin, Acos, Atan
        let mut bytecode = vec![];
        push_float(&mut bytecode, 0.0);
        bytecode.push(OpCode::MathSin as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(0.0));

        let mut bytecode = vec![];
        push_float(&mut bytecode, 0.0);
        bytecode.push(OpCode::MathCos as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(1.0));

        let mut bytecode = vec![];
        push_float(&mut bytecode, 0.0);
        bytecode.push(OpCode::MathTan as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(0.0));

        let mut bytecode = vec![];
        push_float(&mut bytecode, 0.0);
        bytecode.push(OpCode::MathAsin as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(0.0));

        let mut bytecode = vec![];
        push_float(&mut bytecode, 1.0);
        bytecode.push(OpCode::MathAcos as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(0.0));

        let mut bytecode = vec![];
        push_float(&mut bytecode, 0.0);
        bytecode.push(OpCode::MathAtan as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(0.0));

        // Atan2
        let mut bytecode = vec![];
        push_float(&mut bytecode, 1.0);
        push_float(&mut bytecode, 1.0);
        bytecode.push(OpCode::MathAtan2 as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(std::f64::consts::FRAC_PI_4));

        // Max, Min
        let mut bytecode = vec![];
        push_float(&mut bytecode, 5.0);
        push_float(&mut bytecode, 10.0);
        bytecode.push(OpCode::MathMax as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(10.0));

        let mut bytecode = vec![];
        push_float(&mut bytecode, 5.0);
        push_float(&mut bytecode, 10.0);
        bytecode.push(OpCode::MathMin as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(5.0));

        // Sign
        let mut bytecode = vec![];
        push_float(&mut bytecode, -10.5);
        bytecode.push(OpCode::MathSign as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(-1.0));

        let mut bytecode = vec![];
        push_float(&mut bytecode, 10.5);
        bytecode.push(OpCode::MathSign as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(1.0));

        // Trunc
        let mut bytecode = vec![];
        push_float(&mut bytecode, 3.7);
        bytecode.push(OpCode::MathTrunc as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(3.0));

        // Hypot
        let mut bytecode = vec![];
        push_float(&mut bytecode, 3.0);
        push_float(&mut bytecode, 4.0);
        bytecode.push(OpCode::MathHypot as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(5.0));

        // Exp, Expm1, Log1p
        let mut bytecode = vec![];
        push_float(&mut bytecode, 0.0);
        bytecode.push(OpCode::MathExp as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(1.0));

        let mut bytecode = vec![];
        push_float(&mut bytecode, 0.0);
        bytecode.push(OpCode::MathExpm1 as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(0.0));

        let mut bytecode = vec![];
        push_float(&mut bytecode, 0.0);
        bytecode.push(OpCode::MathLog1p as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(0.0));

        // Sinh, Cosh, Tanh
        let mut bytecode = vec![];
        push_float(&mut bytecode, 0.0);
        bytecode.push(OpCode::MathSinh as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(0.0));

        let mut bytecode = vec![];
        push_float(&mut bytecode, 0.0);
        bytecode.push(OpCode::MathCosh as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(1.0));

        let mut bytecode = vec![];
        push_float(&mut bytecode, 0.0);
        bytecode.push(OpCode::MathTanh as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(0.0));

        // Cbrt
        let mut bytecode = vec![];
        push_float(&mut bytecode, 27.0);
        bytecode.push(OpCode::MathCbrt as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Float(3.0));

        // Clz32
        let mut bytecode = vec![];
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(0x000F0000));
        bytecode.push(OpCode::MathClz32 as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Int(12));

        // Fround
        let mut bytecode = vec![];
        push_float(&mut bytecode, 1.337);
        bytecode.push(OpCode::MathFround as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        let res = match vm.run().unwrap() {
            Value::Float(f) => f,
            _ => panic!("Expected float"),
        };
        assert!((res - 1.3370000123977661).abs() < 1e-9);

        // Imul
        let mut bytecode = vec![];
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(2));
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(3));
        bytecode.push(OpCode::MathImul as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Int(6));

        // Random
        let mut bytecode = vec![];
        bytecode.push(OpCode::MathRandom as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        let res = match vm.run().unwrap() {
            Value::Float(f) => f,
            _ => panic!("Expected Float"),
        };
        assert!(res >= 0.0 && res < 1.0);
    }

    #[test]
    fn test_string_opcodes_all() {
        // StrIndexOf
        let mut bytecode = vec![];
        push_string(&mut bytecode, "hello world");
        push_string(&mut bytecode, "world");
        bytecode.push(OpCode::StrIndexOf as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Int(6));

        // StrLastIndexOf
        let mut bytecode = vec![];
        push_string(&mut bytecode, "hello world world");
        push_string(&mut bytecode, "world");
        bytecode.push(OpCode::StrLastIndexOf as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Int(12));

        // StrSlice
        let mut bytecode = vec![];
        push_string(&mut bytecode, "abcdef");
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(1));
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(4));
        bytecode.push(OpCode::StrSlice as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("bcd".to_string())));

        // StrReplace
        let mut bytecode = vec![];
        push_string(&mut bytecode, "hello world");
        push_string(&mut bytecode, "world");
        push_string(&mut bytecode, "rust");
        bytecode.push(OpCode::StrReplace as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("hello rust".to_string())));

        // StrReplaceAll
        let mut bytecode = vec![];
        push_string(&mut bytecode, "banana");
        push_string(&mut bytecode, "a");
        push_string(&mut bytecode, "o");
        bytecode.push(OpCode::StrReplaceAll as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("bonono".to_string())));

        // StrSplit
        let mut bytecode = vec![];
        push_string(&mut bytecode, "a,b,c");
        push_string(&mut bytecode, ",");
        bytecode.push(OpCode::StrSplit as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        let res = vm.run().unwrap();
        match res {
            Value::List(l) => {
                let vec = l.borrow();
                assert_eq!(vec.len(), 3);
                assert_eq!(vec[0], Value::Str(std::sync::Arc::new("a".to_string())));
                assert_eq!(vec[1], Value::Str(std::sync::Arc::new("b".to_string())));
                assert_eq!(vec[2], Value::Str(std::sync::Arc::new("c".to_string())));
            }
            _ => panic!("Expected List"),
        }

        // StrToLower, StrToUpper
        let mut bytecode = vec![];
        push_string(&mut bytecode, "aBc");
        bytecode.push(OpCode::StrToLower as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("abc".to_string())));

        let mut bytecode = vec![];
        push_string(&mut bytecode, "aBc");
        bytecode.push(OpCode::StrToUpper as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("ABC".to_string())));

        // StrTrim, StrTrimStart, StrTrimEnd
        let mut bytecode = vec![];
        push_string(&mut bytecode, "  abc  ");
        bytecode.push(OpCode::StrTrim as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("abc".to_string())));

        let mut bytecode = vec![];
        push_string(&mut bytecode, "  abc  ");
        bytecode.push(OpCode::StrTrimStart as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("abc  ".to_string())));

        let mut bytecode = vec![];
        push_string(&mut bytecode, "  abc  ");
        bytecode.push(OpCode::StrTrimEnd as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("  abc".to_string())));

        // StrRepeat
        let mut bytecode = vec![];
        push_string(&mut bytecode, "xyz");
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(3));
        bytecode.push(OpCode::StrRepeat as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("xyzxyzxyz".to_string())));

        // StrPadStart, StrPadEnd
        let mut bytecode = vec![];
        push_string(&mut bytecode, "abc");
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(5));
        push_string(&mut bytecode, "x");
        bytecode.push(OpCode::StrPadStart as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("xxabc".to_string())));

        let mut bytecode = vec![];
        push_string(&mut bytecode, "abc");
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(5));
        push_string(&mut bytecode, "x");
        bytecode.push(OpCode::StrPadEnd as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("abcxx".to_string())));

        // StrCharCodeAt
        let mut bytecode = vec![];
        push_string(&mut bytecode, "abc");
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(1));
        bytecode.push(OpCode::StrCharCodeAt as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Int(98)); // 'b' in ASCII/UTF-16

        // StrFromCharCode
        let mut bytecode = vec![];
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(98));
        bytecode.push(OpCode::StrFromCharCode as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("b".to_string())));

        // StrStartsWith, StrEndsWith, StrIncludes
        let mut bytecode = vec![];
        push_string(&mut bytecode, "abcdef");
        push_string(&mut bytecode, "abc");
        bytecode.push(OpCode::StrStartsWith as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Bool(true));

        let mut bytecode = vec![];
        push_string(&mut bytecode, "abcdef");
        push_string(&mut bytecode, "def");
        bytecode.push(OpCode::StrEndsWith as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Bool(true));

        let mut bytecode = vec![];
        push_string(&mut bytecode, "abcdef");
        push_string(&mut bytecode, "cd");
        bytecode.push(OpCode::StrIncludes as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Bool(true));

        // StrAt
        let mut bytecode = vec![];
        push_string(&mut bytecode, "abc");
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(1));
        bytecode.push(OpCode::StrAt as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("b".to_string())));

        // StrConcat
        let mut bytecode = vec![];
        push_string(&mut bytecode, "abc");
        push_string(&mut bytecode, "def");
        bytecode.push(OpCode::StrConcat as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("abcdef".to_string())));

        // StrSubstring
        let mut bytecode = vec![];
        push_string(&mut bytecode, "abcdef");
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(1));
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(4));
        bytecode.push(OpCode::StrSubstring as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("bcd".to_string())));
    }

    #[test]
    fn test_regex_opcodes_all() {
        // RegExTest (normal regex)
        let mut bytecode = vec![];
        push_string(&mut bytecode, r"\d+"); // pattern (pushed first)
        push_string(&mut bytecode, "hello 123 world"); // input (pushed second)
        bytecode.push(OpCode::RegExTest as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Bool(true));

        // RegExTest (fancy regex with backreference)
        let mut bytecode = vec![];
        push_string(&mut bytecode, r"([a-z]+)-\1"); // pattern
        push_string(&mut bytecode, "abc-abc"); // input
        bytecode.push(OpCode::RegExTest as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Bool(true));

        // RegExMatch
        let mut bytecode = vec![];
        push_string(&mut bytecode, r"(\d+)"); // pattern
        push_string(&mut bytecode, "hello 123 world"); // input
        bytecode.push(OpCode::RegExMatch as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        let res = vm.run().unwrap();
        match res {
            Value::List(l) => {
                let vec = l.borrow();
                assert_eq!(vec.len(), 2); // full match + group 1
                assert_eq!(vec[0], Value::Str(std::sync::Arc::new("123".to_string())));
                assert_eq!(vec[1], Value::Str(std::sync::Arc::new("123".to_string())));
            }
            _ => panic!("Expected List"),
        }

        // RegExReplace
        let mut bytecode = vec![];
        push_string(&mut bytecode, r"\d+"); // pattern
        push_string(&mut bytecode, "abc-123-def"); // input
        push_string(&mut bytecode, "xyz"); // replacement
        bytecode.push(OpCode::RegExReplace as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("abc-xyz-def".to_string())));

        // RegExSplit
        let mut bytecode = vec![];
        push_string(&mut bytecode, r"\d"); // pattern
        push_string(&mut bytecode, "a1b2c"); // input
        bytecode.push(OpCode::RegExSplit as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        let res = vm.run().unwrap();
        match res {
            Value::List(l) => {
                let vec = l.borrow();
                assert_eq!(vec.len(), 3);
                assert_eq!(vec[0], Value::Str(std::sync::Arc::new("a".to_string())));
                assert_eq!(vec[1], Value::Str(std::sync::Arc::new("b".to_string())));
                assert_eq!(vec[2], Value::Str(std::sync::Arc::new("c".to_string())));
            }
            _ => panic!("Expected List"),
        }
    }

    #[test]
    fn test_json_and_typeof_opcodes() {
        // JSONParse
        let mut bytecode = vec![];
        push_string(&mut bytecode, r#"{"x": 42, "y": [true, "hello"]}"#);
        bytecode.push(OpCode::JSONParse as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        let res = vm.run().unwrap();
        match res {
            Value::Object(obj) => {
                let map = obj.borrow();
                assert_eq!(map.get("x").unwrap(), &Value::Int(42));
                match map.get("y").unwrap() {
                    Value::List(l) => {
                        let vec = l.borrow();
                        assert_eq!(vec.len(), 2);
                        assert_eq!(vec[0], Value::Bool(true));
                        assert_eq!(vec[1], Value::Str(std::sync::Arc::new("hello".to_string())));
                    }
                    _ => panic!("Expected List"),
                }
            }
            _ => panic!("Expected Object"),
        }

        // TypeOf
        let mut bytecode = vec![];
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(123));
        bytecode.push(OpCode::TypeOf as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("number".to_string())));
    }

    #[test]
    fn test_array_opcodes_all() {
        // ArrIndexOf / ArrLastIndexOf / ArrIncludes
        let bytecode = vec![
            OpCode::NewList as u8,
            OpCode::PushInt as u8, 10, 0, 0, 0,
            OpCode::ListPush as u8,
            OpCode::PushInt as u8, 20, 0, 0, 0,
            OpCode::ListPush as u8,
            OpCode::PushInt as u8, 10, 0, 0, 0,
            OpCode::ListPush as u8, // List: [10, 20, 10]
            
            // Test IndexOf
            OpCode::Dup as u8,
            OpCode::PushInt as u8, 20, 0, 0, 0,
            OpCode::ArrIndexOf as u8, // Pops 20, pops list, pushes index 1. Stack: [List, 1]
            
            // Test LastIndexOf
            OpCode::Swap as u8, // Stack: [1, List]
            OpCode::Dup as u8, // Stack: [1, List, List]
            OpCode::PushInt as u8, 10, 0, 0, 0,
            OpCode::ArrLastIndexOf as u8, // Pops 10, pops list, pushes index 2. Stack: [1, List, 2]
            
            // Test Includes
            OpCode::Swap as u8, // Stack: [1, 2, List]
            OpCode::Dup as u8, // Stack: [1, 2, List, List]
            OpCode::PushInt as u8, 30, 0, 0, 0,
            OpCode::ArrIncludes as u8, // Pops 30, pops list, pushes false. Stack: [1, 2, List, false]
            
            OpCode::Swap as u8, // Stack: [1, 2, false, List]
            OpCode::Pop as u8, // Stack: [1, 2, false]
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Bool(false)); // Last pushed value is false
        assert_eq!(vm.stack.pop().unwrap(), Value::Int(2)); // LastIndexOf
        assert_eq!(vm.stack.pop().unwrap(), Value::Int(1)); // IndexOf

        // ArrReverse
        let bytecode = vec![
            OpCode::NewList as u8,
            OpCode::PushInt as u8, 1, 0, 0, 0,
            OpCode::ListPush as u8,
            OpCode::PushInt as u8, 2, 0, 0, 0,
            OpCode::ListPush as u8,
            OpCode::ArrReverse as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let res = vm.run().unwrap();
        match res {
            Value::List(l) => {
                let vec = l.borrow();
                assert_eq!(vec.len(), 2);
                assert_eq!(vec[0], Value::Int(2));
                assert_eq!(vec[1], Value::Int(1));
            }
            _ => panic!("Expected List"),
        }

        // ArrSortNumeric
        let bytecode = vec![
            OpCode::NewList as u8,
            OpCode::PushInt as u8, 5, 0, 0, 0,
            OpCode::ListPush as u8,
            OpCode::PushInt as u8, 2, 0, 0, 0,
            OpCode::ListPush as u8,
            OpCode::PushInt as u8, 8, 0, 0, 0,
            OpCode::ListPush as u8,
            OpCode::ArrSortNumeric as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let res = vm.run().unwrap();
        match res {
            Value::List(l) => {
                let vec = l.borrow();
                assert_eq!(vec.len(), 3);
                assert_eq!(vec[0], Value::Int(2));
                assert_eq!(vec[1], Value::Int(5));
                assert_eq!(vec[2], Value::Int(8));
            }
            _ => panic!("Expected List"),
        }

        // ArrSortString
        let mut bytecode = vec![
            OpCode::NewList as u8,
        ];
        push_string(&mut bytecode, "c");
        bytecode.push(OpCode::ListPush as u8);
        push_string(&mut bytecode, "a");
        bytecode.push(OpCode::ListPush as u8);
        push_string(&mut bytecode, "b");
        bytecode.push(OpCode::ListPush as u8);
        bytecode.push(OpCode::ArrSortString as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        let res = vm.run().unwrap();
        match res {
            Value::List(l) => {
                let vec = l.borrow();
                assert_eq!(vec.len(), 3);
                assert_eq!(vec[0], Value::Str(std::sync::Arc::new("a".to_string())));
                assert_eq!(vec[1], Value::Str(std::sync::Arc::new("b".to_string())));
                assert_eq!(vec[2], Value::Str(std::sync::Arc::new("c".to_string())));
            }
            _ => panic!("Expected List"),
        }

        // ArrSlice
        let bytecode = vec![
            OpCode::NewList as u8,
            OpCode::PushInt as u8, 10, 0, 0, 0,
            OpCode::ListPush as u8,
            OpCode::PushInt as u8, 20, 0, 0, 0,
            OpCode::ListPush as u8,
            OpCode::PushInt as u8, 30, 0, 0, 0,
            OpCode::ListPush as u8,
            OpCode::PushInt as u8, 1, 0, 0, 0, // start
            OpCode::PushInt as u8, 3, 0, 0, 0, // end
            OpCode::ArrSlice as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let res = vm.run().unwrap();
        match res {
            Value::List(l) => {
                let vec = l.borrow();
                assert_eq!(vec.len(), 2);
                assert_eq!(vec[0], Value::Int(20));
                assert_eq!(vec[1], Value::Int(30));
            }
            _ => panic!("Expected List"),
        }

        // ArrJoin
        let mut bytecode = vec![
            OpCode::NewList as u8,
            OpCode::PushInt as u8, 1, 0, 0, 0,
            OpCode::ListPush as u8,
            OpCode::PushInt as u8, 2, 0, 0, 0,
            OpCode::ListPush as u8,
        ];
        push_string(&mut bytecode, "-");
        bytecode.push(OpCode::ArrJoin as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("1-2".to_string())));

        // ArrFlat
        let bytecode = vec![
            OpCode::NewList as u8, // Inner list [1]
            OpCode::PushInt as u8, 1, 0, 0, 0,
            OpCode::ListPush as u8,
            OpCode::NewList as u8, // Outer list
            OpCode::Swap as u8,  // Swap so inner list is on top, outer below
            OpCode::ListPush as u8, // Push inner list to outer list. Outer is [[1]]
            OpCode::PushInt as u8, 2, 0, 0, 0,
            OpCode::ListPush as u8, // Push 2 to outer list. Outer is [[1], 2]
            OpCode::PushNull as u8, // depth Null
            OpCode::ArrFlat as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let res = vm.run().unwrap();
        match res {
            Value::List(l) => {
                let vec = l.borrow();
                assert_eq!(vec.len(), 2);
                assert_eq!(vec[0], Value::Int(1));
                assert_eq!(vec[1], Value::Int(2));
            }
            _ => panic!("Expected List"),
        }

        // ArrFill
        let bytecode = vec![
            OpCode::NewList as u8,
            OpCode::PushInt as u8, 1, 0, 0, 0,
            OpCode::ListPush as u8,
            OpCode::PushInt as u8, 2, 0, 0, 0,
            OpCode::ListPush as u8,
            OpCode::PushInt as u8, 9, 0, 0, 0, // fill value
            OpCode::PushInt as u8, 0, 0, 0, 0, // start
            OpCode::PushInt as u8, 2, 0, 0, 0, // end
            OpCode::ArrFill as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        let res = vm.run().unwrap();
        match res {
            Value::List(l) => {
                let vec = l.borrow();
                assert_eq!(vec.len(), 2);
                assert_eq!(vec[0], Value::Int(9));
                assert_eq!(vec[1], Value::Int(9));
            }
            _ => panic!("Expected List"),
        }

        // ArrPush / ArrPop / ArrShift / ArrUnshift
        let bytecode = vec![
            OpCode::NewList as u8,
            
            OpCode::Dup as u8,
            OpCode::PushInt as u8, 10, 0, 0, 0,
            OpCode::ArrPush as u8, // Pops 10, pops list, pushes new length 1
            OpCode::Pop as u8,     // Discard length
            
            OpCode::Dup as u8,
            OpCode::PushInt as u8, 20, 0, 0, 0,
            OpCode::ArrPush as u8, // Pops 20, pops list, pushes new length 2
            OpCode::Pop as u8,     // Discard length
            
            OpCode::Dup as u8,
            OpCode::PushInt as u8, 5, 0, 0, 0,
            OpCode::ArrUnshift as u8, // Pops 5, pops list, pushes new length 3
            OpCode::Pop as u8,     // Discard length
            
            // Now list is [5, 10, 20]
            OpCode::Dup as u8,
            OpCode::ArrShift as u8, // Pops list, shifts and pushes shifted element 5
            
            OpCode::Swap as u8, // bring list to top
            OpCode::ArrPop as u8, // Pops list, pops and pushes popped element 20
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Int(20)); // Last popped item is 20
        assert_eq!(vm.stack.pop().unwrap(), Value::Int(5)); // Shifted item was 5
    }

    // ----------------------------------------------------
    // Adversarial & Stress Testing Suite by challenger_m1_opcodes_1
    // ----------------------------------------------------

    #[test]
    fn test_math_nan_propagation_and_boundaries() {
        // We will test NaN propagation for all floating-point math opcodes
        let opcodes_one_arg = vec![
            OpCode::MathFloor, OpCode::MathCeil, OpCode::MathRound, OpCode::MathAbs,
            OpCode::MathSqrt, OpCode::MathLog, OpCode::MathLog2, OpCode::MathLog10,
            OpCode::MathSin, OpCode::MathCos, OpCode::MathTan, OpCode::MathAsin,
            OpCode::MathAcos, OpCode::MathAtan, OpCode::MathSign, OpCode::MathTrunc,
            OpCode::MathExp, OpCode::MathExpm1, OpCode::MathLog1p, OpCode::MathSinh,
            OpCode::MathCosh, OpCode::MathTanh, OpCode::MathCbrt, OpCode::MathFround
        ];

        for op in opcodes_one_arg {
            let mut bytecode = vec![];
            push_float(&mut bytecode, f64::NAN);
            bytecode.push(op as u8);
            bytecode.push(OpCode::Halt as u8);
            let mut vm = setup_vm(bytecode);
            let res = vm.run().unwrap();
            match res {
                Value::Float(f) => assert!(f.is_nan(), "Opcode {:?} did not propagate NaN", op),
                _ => panic!("Expected Float for opcode {:?}", op),
            }
        }

        // Two arg math opcodes: Pow, Atan2, Max, Min, Hypot, Imul
        let opcodes_two_args = vec![
            (OpCode::MathPow, 2.0, f64::NAN, true), // NaN exponent
            (OpCode::MathPow, f64::NAN, 2.0, true), // NaN base
            (OpCode::MathAtan2, 1.0, f64::NAN, true),
            (OpCode::MathAtan2, f64::NAN, 1.0, true),
            (OpCode::MathMax, 3.0, f64::NAN, true),
            (OpCode::MathMax, f64::NAN, 3.0, true),
            (OpCode::MathMin, 3.0, f64::NAN, true),
            (OpCode::MathMin, f64::NAN, 3.0, true),
            (OpCode::MathHypot, 4.0, f64::NAN, true),
            (OpCode::MathHypot, f64::NAN, 4.0, true),
        ];

        for (op, arg1, arg2, should_be_nan) in opcodes_two_args {
            let mut bytecode = vec![];
            push_float(&mut bytecode, arg1);
            push_float(&mut bytecode, arg2);
            bytecode.push(op as u8);
            bytecode.push(OpCode::Halt as u8);
            let mut vm = setup_vm(bytecode);
            let res = vm.run().unwrap();
            match res {
                Value::Float(f) => {
                    if should_be_nan {
                        assert!(f.is_nan(), "Opcode {:?} with args ({}, {}) did not yield NaN", op, arg1, arg2);
                    }
                }
                _ => panic!("Expected Float for opcode {:?}", op),
            }
        }
    }

    #[test]
    fn test_math_negative_zero_preservation() {
        // MathMin(0.0, -0.0) -> JS: -0.0
        let mut bytecode = vec![];
        push_float(&mut bytecode, 0.0);
        push_float(&mut bytecode, -0.0);
        bytecode.push(OpCode::MathMin as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        let res = vm.run().unwrap();
        println!("MathMin(0.0, -0.0) returned: {:?}", res);

        // MathMin(-0.0, 0.0) -> JS: -0.0
        let mut bytecode = vec![];
        push_float(&mut bytecode, -0.0);
        push_float(&mut bytecode, 0.0);
        bytecode.push(OpCode::MathMin as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        let res = vm.run().unwrap();
        println!("MathMin(-0.0, 0.0) returned: {:?}", res);

        // MathMax(0.0, -0.0) -> JS: 0.0
        let mut bytecode = vec![];
        push_float(&mut bytecode, 0.0);
        push_float(&mut bytecode, -0.0);
        bytecode.push(OpCode::MathMax as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        let res = vm.run().unwrap();
        println!("MathMax(0.0, -0.0) returned: {:?}", res);

        // MathMax(-0.0, 0.0) -> JS: 0.0
        let mut bytecode = vec![];
        push_float(&mut bytecode, -0.0);
        push_float(&mut bytecode, 0.0);
        bytecode.push(OpCode::MathMax as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        let res = vm.run().unwrap();
        println!("MathMax(-0.0, 0.0) returned: {:?}", res);

        // Test division 0 / -1 -> -0
        let mut bytecode = vec![];
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(0));
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&(-1i32 as u32).to_le_bytes());
        bytecode.push(OpCode::Div as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        let res = vm.run().unwrap();
        // If it got optimized to Int(0) because of `res.fract() == 0.0`, we lost negative zero.
        println!("0.0 / -1.0 Division returned: {:?}", res);
    }

    #[test]
    fn test_string_slice_negative_and_oob() {
        // StrSlice with negative indices
        // "abcdef".slice(-3, -1) -> "de"
        let mut bytecode = vec![];
        push_string(&mut bytecode, "abcdef");
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&(-3i32 as u32).to_le_bytes()); // start -3
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&(-1i32 as u32).to_le_bytes()); // end -1
        bytecode.push(OpCode::StrSlice as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("de".to_string())));

        // StrSlice with huge OOB indices
        // "abcdef".slice(100, 200) -> ""
        let mut bytecode = vec![];
        push_string(&mut bytecode, "abcdef");
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(100));
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(200));
        bytecode.push(OpCode::StrSlice as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("".to_string())));

        // StrSubstring with negative index -> treated as 0
        // "abcdef".substring(-3, 2) -> "ab"
        let mut bytecode = vec![];
        push_string(&mut bytecode, "abcdef");
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&(-3i32 as u32).to_le_bytes());
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(2));
        bytecode.push(OpCode::StrSubstring as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Str(std::sync::Arc::new("ab".to_string())));
    }

    #[test]
    fn test_string_utf16_surrogate_halves() {
        // String with surrogate pair: "A🦀B" -> U+1F980 is encoded as 0xD83E 0xDD80 in UTF-16
        let s = "A🦀B";
        // slice(1, 2) should extract only the first half of the surrogate pair (0xD83E)
        let mut bytecode = vec![];
        push_string(&mut bytecode, s);
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(1));
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(2));
        bytecode.push(OpCode::StrSlice as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        let res = vm.run().unwrap();
        // Since Rust String cannot have unpaired surrogates, it should be replaced with U+FFFD
        assert_eq!(res, Value::Str(std::sync::Arc::new("\u{FFFD}".to_string())));

        // charCodeAt(1) should return 0xD83E (55358)
        let mut bytecode = vec![];
        push_string(&mut bytecode, s);
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&encode_u32(1));
        bytecode.push(OpCode::StrCharCodeAt as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        assert_eq!(vm.run().unwrap(), Value::Int(55358));

        // Test StrFromCharCode with Infinity and NaN
        let mut bytecode = vec![];
        push_float(&mut bytecode, f64::INFINITY);
        bytecode.push(OpCode::StrFromCharCode as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        let res = vm.run().unwrap();
        println!("StrFromCharCode(Infinity) returned: {:?}", res);

        let mut bytecode = vec![];
        push_float(&mut bytecode, f64::NAN);
        bytecode.push(OpCode::StrFromCharCode as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        let res = vm.run().unwrap();
        println!("StrFromCharCode(NaN) returned: {:?}", res);
    }

    #[test]
    fn test_regex_complex_routing_and_lookaround() {
        // Routing check: standard regex vs fancy regex
        // Pattern with lookahead: `(?=foo)bar` has lookahead, but no backreferences
        // Let's see if compiling lookahead works
        let mut bytecode = vec![];
        push_string(&mut bytecode, "(?=foo)bar"); // pattern
        push_string(&mut bytecode, "bar"); // input
        bytecode.push(OpCode::RegExTest as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        // This will try to compile using `regex::Regex::new` and fail because of no digit backreference check
        let res = vm.run();
        println!("Lookahead RegExTest result: {:?}", res);
    }

    #[test]
    fn test_regex_cache_eviction() {
        // We will insert 40 unique regexes and verify cache limits
        // The default capacity is 32.
        let mut bytecode = vec![];
        for i in 0..40 {
            push_string(&mut bytecode, &format!("^a{}$", i)); // pattern
            push_string(&mut bytecode, "a"); // input
            bytecode.push(OpCode::RegExTest as u8);
            bytecode.push(OpCode::Pop as u8);
        }
        bytecode.push(OpCode::PushNull as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        let res = vm.run();
        assert!(res.is_ok());
        
        // Check vm.regex_cache size is indeed bounded at 32
        assert_eq!(vm.regex_cache.entries.len(), 32);
        // Verify LRU eviction: the first few patterns like "^a0$" should have been evicted
        assert!(vm.regex_cache.get("^a0$").is_none());
        // The last inserted ones like "^a39$" should be present
        assert!(vm.regex_cache.get("^a39$").is_some());
    }

    #[test]
    fn test_array_in_place_mutation_and_stable_ordering() {
        // Sort numeric with NaNs, infinities
        // Array: [NaN, -0.0, 0.0, -10.0, Infinity, -Infinity, 5.0]
        let mut bytecode = vec![
            OpCode::NewList as u8,
        ];
        
        let values = vec![
            f64::NAN, -0.0, 0.0, -10.0, f64::INFINITY, f64::NEG_INFINITY, 5.0
        ];
        for val in values {
            push_float(&mut bytecode, val);
            bytecode.push(OpCode::ListPush as u8);
        }
        
        // Now stack contains the List
        bytecode.push(OpCode::ArrSortNumeric as u8);
        bytecode.push(OpCode::Halt as u8);
        
        let mut vm = setup_vm(bytecode);
        let res = vm.run().unwrap();
        if let Value::List(l) = res {
            let vec = l.borrow();
            // Output the sorted sequence to verify stable totalcmp order
            let sorted: Vec<String> = vec.iter().map(|v| match v {
                Value::Float(f) => f.to_string(),
                _ => "Other".to_string(),
            }).collect();
            println!("Sorted numeric values with NaN and Infinity: {:?}", sorted);
        } else {
            panic!("Expected List");
        }
    }

    #[test]
    fn test_array_borrow_conflicts_propagation() {
        // Test cyclic array flatting
        let bytecode = vec![
            OpCode::NewList as u8,
            OpCode::Dup as u8,
            OpCode::Dup as u8,
            OpCode::ListPush as u8, // Push itself to itself -> [[...]] cyclic list
            OpCode::Pop as u8, // discard returning list ref
            OpCode::PushInt as u8, 1, 0, 0, 0, // depth = 1
            OpCode::ArrFlat as u8,
            OpCode::Halt as u8
        ];
        let mut vm = setup_vm(bytecode);
        // Flatting a cyclic list with depth > 0 should succeed because multiple read borrows are allowed, but we shouldn't format it via debug print.
        let res = vm.run();
        assert!(res.is_ok());
    }

    #[test]
    fn test_float_list_indexing() {
        let mut bytecode = vec![
            OpCode::NewList as u8,
            OpCode::PushInt as u8, 42, 0, 0, 0,
            OpCode::ListPush as u8,
            OpCode::Dup as u8,
        ];
        push_float(&mut bytecode, 0.0);
        bytecode.push(OpCode::GetMember as u8);
        
        bytecode.push(OpCode::Pop as u8);
        
        push_float(&mut bytecode, 0.0);
        bytecode.push(OpCode::PushInt as u8);
        bytecode.extend_from_slice(&[99, 0, 0, 0]);
        bytecode.push(OpCode::SetMember as u8);
        
        push_float(&mut bytecode, 0.0);
        bytecode.push(OpCode::GetMember as u8);
        bytecode.push(OpCode::Halt as u8);

        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Int(i) => assert_eq!(i, 99),
            _ => panic!("Expected Int 99, got {:?}", result),
        }
    }

    #[test]
    fn test_float_string_indexing() {
        let mut bytecode = vec![];
        push_string(&mut bytecode, "hello");
        push_float(&mut bytecode, 1.0);
        bytecode.push(OpCode::GetMember as u8);
        bytecode.push(OpCode::Halt as u8);

        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Str(s) => assert_eq!(&*s, "e"),
            _ => panic!("Expected Str 'e', got {:?}", result),
        }
    }
    #[test]
    fn test_scientific_notation_formatting() {
        let mut bytecode = vec![
            OpCode::NewList as u8,
        ];
        push_float(&mut bytecode, 1e-7);
        bytecode.push(OpCode::ListPush as u8);
        push_float(&mut bytecode, 1e21);
        bytecode.push(OpCode::ListPush as u8);
        push_float(&mut bytecode, 0.0001);
        bytecode.push(OpCode::ListPush as u8);
        push_float(&mut bytecode, -0.0);
        bytecode.push(OpCode::ListPush as u8);
        
        push_string(&mut bytecode, ",");
        bytecode.push(OpCode::ArrJoin as u8);
        bytecode.push(OpCode::Halt as u8);
        
        let mut vm = setup_vm(bytecode);
        let result = vm.run().unwrap();
        match result {
            Value::Str(s) => assert_eq!(&*s, "1e-7,1e+21,0.0001,0"),
            _ => panic!("Expected Str, got {:?}", result),
        }
    }
}

