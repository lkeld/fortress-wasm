use vm_core::{Vm, OpCode, Value, VmError};
use vm_core::vm::{RegexCache, CachedRegex};
use std::sync::Arc;

fn setup_vm(mut bytecode: Vec<u8>) -> Vm {
    let mut opcode_map = [0u8; 256];
    for i in 0..256 {
        opcode_map[i] = i as u8;
    }
    
    let session_key = [0u8; 32];
    let base_key_material = [0u8; 32];

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

// Helper to build a bytecode that constructs i64::MIN on the stack
fn build_i64_min_bytecode() -> Vec<u8> {
    let mut bytecode = vec![];
    // Push -2147483648 (0x80000000)
    bytecode.push(OpCode::PushInt as u8);
    bytecode.extend_from_slice(&encode_u32(0x80000000));
    // Push 2097152 (2^21)
    bytecode.push(OpCode::PushInt as u8);
    bytecode.extend_from_slice(&encode_u32(2097152));
    // Push 2048 (2^11)
    bytecode.push(OpCode::PushInt as u8);
    bytecode.extend_from_slice(&encode_u32(2048));
    // Mul (2^21 * 2^11 = 2^32)
    bytecode.push(OpCode::Mul as u8);
    // Mul (-2^31 * 2^32 = -2^63 = i64::MIN)
    bytecode.push(OpCode::Mul as u8);
    bytecode
}

// Helper to build a bytecode that constructs i64::MAX on the stack
fn build_i64_max_bytecode() -> Vec<u8> {
    let mut bytecode = build_i64_min_bytecode();
    // BitNot (inverts i64::MIN to i64::MAX)
    bytecode.push(OpCode::BitNot as u8);
    bytecode
}

// ==========================================
// 1. Math Opcodes stress tests
// ==========================================

#[test]
fn test_math_abs_panic() {
    let mut bytecode = build_i64_min_bytecode();
    bytecode.push(OpCode::MathAbs as u8);
    bytecode.push(OpCode::Halt as u8);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut vm = setup_vm(bytecode);
        let _ = vm.run();
    }));
    
    assert!(result.is_err(), "Expected MathAbs on i64::MIN to panic due to overflow");
}

#[test]
fn test_math_overflow_add() {
    let mut bytecode = build_i64_max_bytecode();
    bytecode.push(OpCode::PushInt as u8);
    bytecode.extend_from_slice(&encode_u32(1));
    bytecode.push(OpCode::Add as u8);
    bytecode.push(OpCode::Halt as u8);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut vm = setup_vm(bytecode);
        let _ = vm.run();
    }));
    
    assert!(result.is_err(), "Expected Add overflow (i64::MAX + 1) to panic in debug mode");
}

#[test]
fn test_math_overflow_sub() {
    let mut bytecode = build_i64_min_bytecode();
    bytecode.push(OpCode::PushInt as u8);
    bytecode.extend_from_slice(&encode_u32(1));
    bytecode.push(OpCode::Sub as u8);
    bytecode.push(OpCode::Halt as u8);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut vm = setup_vm(bytecode);
        let _ = vm.run();
    }));
    
    assert!(result.is_err(), "Expected Sub overflow (i64::MIN - 1) to panic in debug mode");
}

#[test]
fn test_math_overflow_mul() {
    let mut bytecode = build_i64_max_bytecode();
    bytecode.push(OpCode::PushInt as u8);
    bytecode.extend_from_slice(&encode_u32(2));
    bytecode.push(OpCode::Mul as u8);
    bytecode.push(OpCode::Halt as u8);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut vm = setup_vm(bytecode);
        let _ = vm.run();
    }));
    
    assert!(result.is_err(), "Expected Mul overflow (i64::MAX * 2) to panic in debug mode");
}

#[test]
fn test_math_nan_propagation() {
    // MathSqrt on negative number should produce NaN
    let mut bytecode = vec![];
    push_float(&mut bytecode, -1.0);
    bytecode.push(OpCode::MathSqrt as u8);
    bytecode.push(OpCode::Halt as u8);
    
    let mut vm = setup_vm(bytecode);
    let res = vm.run().unwrap();
    match res {
        Value::Float(f) => assert!(f.is_nan(), "Expected NaN from MathSqrt(-1.0)"),
        _ => panic!("Expected Float"),
    }

    // MathLog on negative number should produce NaN
    let mut bytecode = vec![];
    push_float(&mut bytecode, -5.0);
    bytecode.push(OpCode::MathLog as u8);
    bytecode.push(OpCode::Halt as u8);
    
    let mut vm = setup_vm(bytecode);
    let res = vm.run().unwrap();
    match res {
        Value::Float(f) => assert!(f.is_nan(), "Expected NaN from MathLog(-5.0)"),
        _ => panic!("Expected Float"),
    }

    // MathMax with NaN should produce NaN
    let mut bytecode = vec![];
    push_float(&mut bytecode, f64::NAN);
    push_float(&mut bytecode, 5.0);
    bytecode.push(OpCode::MathMax as u8);
    bytecode.push(OpCode::Halt as u8);
    
    let mut vm = setup_vm(bytecode);
    let res = vm.run().unwrap();
    match res {
        Value::Float(f) => assert!(f.is_nan(), "Expected NaN from MathMax(NaN, 5.0)"),
        _ => panic!("Expected Float"),
    }
}

#[test]
fn test_math_div_by_zero() {
    // Int divided by Int zero
    let bytecode = vec![
        OpCode::PushInt as u8, 10, 0, 0, 0,
        OpCode::PushInt as u8, 0, 0, 0, 0,
        OpCode::Div as u8,
        OpCode::Halt as u8
    ];
    let mut vm = setup_vm(bytecode);
    let res = vm.run().unwrap();
    match res {
        Value::Float(f) => assert_eq!(f, f64::INFINITY, "Expected infinity when dividing by zero"),
        _ => panic!("Expected Float"),
    }

    // Float divided by Float zero
    let mut bytecode = vec![];
    push_float(&mut bytecode, 10.0);
    push_float(&mut bytecode, 0.0);
    bytecode.push(OpCode::Div as u8);
    bytecode.push(OpCode::Halt as u8);
    let mut vm = setup_vm(bytecode);
    let res = vm.run().unwrap();
    match res {
        Value::Float(f) => assert_eq!(f, f64::INFINITY, "Expected infinity when dividing by zero float"),
        _ => panic!("Expected Float"),
    }
}

#[test]
fn test_math_rounding() {
    // Test MathRound on various values
    let test_cases: Vec<(f64, f64)> = vec![
        (0.5, 1.0),
        (-0.5, -0.0), // js_round spec: -0.5 rounds to -0.0
        (-0.501, -1.0),
        (3.5, 4.0),
        (-3.5, -3.0), // In JS, Math.round(-3.5) is -3
        (-3.51, -4.0),
    ];
    for (input, expected) in test_cases {
        let mut bytecode = vec![];
        push_float(&mut bytecode, input);
        bytecode.push(OpCode::MathRound as u8);
        bytecode.push(OpCode::Halt as u8);
        let mut vm = setup_vm(bytecode);
        let res = vm.run().unwrap();
        match res {
            Value::Float(f) => {
                if expected.is_sign_negative() {
                    assert!(f.is_sign_negative(), "Expected negative for rounded of {}", input);
                } else {
                    assert!(f.is_sign_positive(), "Expected positive for rounded of {}", input);
                }
                assert_eq!(f, expected);
            }
            _ => panic!("Expected Float"),
        }
    }
}

#[test]
fn test_math_negative_zero() {
    // MathSign of -0.0 should be -0.0
    let mut bytecode = vec![];
    push_float(&mut bytecode, -0.0);
    bytecode.push(OpCode::MathSign as u8);
    bytecode.push(OpCode::Halt as u8);
    let mut vm = setup_vm(bytecode);
    let res = vm.run().unwrap();
    match res {
        Value::Float(f) => {
            assert_eq!(f, -0.0);
            assert!(f.is_sign_negative(), "Expected -0.0 to retain its negative sign");
        }
        _ => panic!("Expected Float"),
    }

    // MathRound of -0.1 should be -0.0
    let mut bytecode = vec![];
    push_float(&mut bytecode, -0.1);
    bytecode.push(OpCode::MathRound as u8);
    bytecode.push(OpCode::Halt as u8);
    let mut vm = setup_vm(bytecode);
    let res = vm.run().unwrap();
    match res {
        Value::Float(f) => {
            assert_eq!(f, -0.0);
            assert!(f.is_sign_negative(), "Expected MathRound(-0.1) to yield -0.0");
        }
        _ => panic!("Expected Float"),
    }
}

// ==========================================
// 2. String Opcodes stress tests
// ==========================================

#[test]
fn test_string_oob() {
    // StrCharCodeAt with index out of bounds
    let mut bytecode = vec![];
    push_string(&mut bytecode, "hello");
    bytecode.push(OpCode::PushInt as u8);
    bytecode.extend_from_slice(&encode_u32(10)); // index 10
    bytecode.push(OpCode::StrCharCodeAt as u8);
    bytecode.push(OpCode::Halt as u8);
    let mut vm = setup_vm(bytecode);
    let res = vm.run().unwrap();
    match res {
        Value::Float(f) => assert!(f.is_nan(), "Expected NaN for StrCharCodeAt out of bounds"),
        _ => panic!("Expected Float"),
    }

    // StrCharCodeAt with index < 0
    let mut bytecode = vec![];
    push_string(&mut bytecode, "hello");
    bytecode.push(OpCode::PushInt as u8);
    bytecode.extend_from_slice(&encode_u32(0xFFFFFFFF)); // -1
    bytecode.push(OpCode::StrCharCodeAt as u8);
    bytecode.push(OpCode::Halt as u8);
    let mut vm = setup_vm(bytecode);
    let res = vm.run().unwrap();
    match res {
        Value::Float(f) => assert!(f.is_nan(), "Expected NaN for StrCharCodeAt negative index"),
        _ => panic!("Expected Float"),
    }

    // StrAt with out of bounds index
    let mut bytecode = vec![];
    push_string(&mut bytecode, "hello");
    bytecode.push(OpCode::PushInt as u8);
    bytecode.extend_from_slice(&encode_u32(10));
    bytecode.push(OpCode::StrAt as u8);
    bytecode.push(OpCode::Halt as u8);
    let mut vm = setup_vm(bytecode);
    let res = vm.run().unwrap();
    assert_eq!(res, Value::Null, "Expected Null for StrAt out of bounds");

    // StrAt with negative index (should index from end)
    let mut bytecode = vec![];
    push_string(&mut bytecode, "hello");
    bytecode.push(OpCode::PushInt as u8);
    bytecode.extend_from_slice(&encode_u32(0xFFFFFFFF)); // -1 -> "o"
    bytecode.push(OpCode::StrAt as u8);
    bytecode.push(OpCode::Halt as u8);
    let mut vm = setup_vm(bytecode);
    let res = vm.run().unwrap();
    match res {
        Value::Str(s) => assert_eq!(&*s, "o"),
        _ => panic!("Expected Str"),
    }
}

#[test]
fn test_string_negative_slice_substring() {
    // StrSlice with negative indices
    let mut bytecode = vec![];
    push_string(&mut bytecode, "abcdef");
    bytecode.push(OpCode::PushInt as u8);
    bytecode.extend_from_slice(&encode_u32(0xFFFFFFFC)); // -4 -> "c"
    bytecode.push(OpCode::PushInt as u8);
    bytecode.extend_from_slice(&encode_u32(0xFFFFFFFF)); // -1 -> "f"
    bytecode.push(OpCode::StrSlice as u8);
    bytecode.push(OpCode::Halt as u8);
    let mut vm = setup_vm(bytecode);
    let res = vm.run().unwrap();
    match res {
        Value::Str(s) => assert_eq!(&*s, "cde"),
        _ => panic!("Expected Str"),
    }

    // StrSubstring with negative indices (should be treated as 0)
    let mut bytecode = vec![];
    push_string(&mut bytecode, "abcdef");
    bytecode.push(OpCode::PushInt as u8);
    bytecode.extend_from_slice(&encode_u32(0xFFFFFFFC)); // -4 -> 0
    bytecode.push(OpCode::PushInt as u8);
    bytecode.extend_from_slice(&encode_u32(3)); // 3
    bytecode.push(OpCode::StrSubstring as u8);
    bytecode.push(OpCode::Halt as u8);
    let mut vm = setup_vm(bytecode);
    let res = vm.run().unwrap();
    match res {
        Value::Str(s) => assert_eq!(&*s, "abc"),
        _ => panic!("Expected Str"),
    }
}

#[test]
fn test_string_utf16_surrogates() {
    // "🦀" in UTF-16 is [0xD83D, 0xDE00] (surrogate pair)
    let s = "🦀";
    
    // Length in bytes: 4, Length in UTF-16 code units: 2
    // StrCharCodeAt index 0 (0xD83E = 55358)
    let mut bytecode = vec![];
    push_string(&mut bytecode, s);
    bytecode.push(OpCode::PushInt as u8);
    bytecode.extend_from_slice(&encode_u32(0));
    bytecode.push(OpCode::StrCharCodeAt as u8);
    bytecode.push(OpCode::Halt as u8);
    let mut vm = setup_vm(bytecode);
    assert_eq!(vm.run().unwrap(), Value::Int(55358));

    // StrCharCodeAt index 1 (0xDD80 = 56704)
    let mut bytecode = vec![];
    push_string(&mut bytecode, s);
    bytecode.push(OpCode::PushInt as u8);
    bytecode.extend_from_slice(&encode_u32(1));
    bytecode.push(OpCode::StrCharCodeAt as u8);
    bytecode.push(OpCode::Halt as u8);
    let mut vm = setup_vm(bytecode);
    assert_eq!(vm.run().unwrap(), Value::Int(56704));
}

#[test]
fn test_string_traversal_perf() {
    // Zero-allocation character traversal benchmark/correctness test
    let s = "a".repeat(1000);
    let mut bytecode = vec![];
    push_string(&mut bytecode, &s);
    
    // We want to run StrCharCodeAt on index 500
    bytecode.push(OpCode::PushInt as u8);
    bytecode.extend_from_slice(&encode_u32(500));
    bytecode.push(OpCode::StrCharCodeAt as u8);
    bytecode.push(OpCode::Halt as u8);

    let start = std::time::Instant::now();
    for _ in 0..1000 {
        let mut vm = setup_vm(bytecode.clone());
        let res = vm.run().unwrap();
        assert_eq!(res, Value::Int(97));
    }
    let duration = start.elapsed();
    println!("1000 StrCharCodeAt operations on 1000-char string took: {:?}", duration);
}

// ==========================================
// 3. Regex Opcodes stress tests
// ==========================================

#[test]
fn test_regex_backreferences_routing() {
    // 1. Backreference pattern: routing to fancy-regex
    let mut bytecode = vec![];
    push_string(&mut bytecode, r"([a-z]+)-\1");
    push_string(&mut bytecode, "abc-abc");
    bytecode.push(OpCode::RegExTest as u8);
    bytecode.push(OpCode::Halt as u8);
    let mut vm = setup_vm(bytecode);
    assert_eq!(vm.run().unwrap(), Value::Bool(true));

    // 2. Lookaround pattern: routing failure check!
    // Since has_backreferences doesn't match lookarounds, it gets routed to standard regex, which returns VmError::TypeError.
    let mut bytecode = vec![];
    push_string(&mut bytecode, r"(?=abc)a");
    push_string(&mut bytecode, "abc");
    bytecode.push(OpCode::RegExTest as u8);
    bytecode.push(OpCode::Halt as u8);
    let mut vm = setup_vm(bytecode);
    let res = vm.run();
    assert!(matches!(res, Err(VmError::TypeError)), "Expected lookaround compilation to fail due to standard regex routing");
}

#[test]
fn test_regex_cache_lru() {
    let mut cache = RegexCache::new(3);
    
    let re_a = CachedRegex::Normal(Arc::new(regex::Regex::new("a").unwrap()));
    let re_b = CachedRegex::Normal(Arc::new(regex::Regex::new("b").unwrap()));
    let re_c = CachedRegex::Normal(Arc::new(regex::Regex::new("c").unwrap()));
    let re_d = CachedRegex::Normal(Arc::new(regex::Regex::new("d").unwrap()));

    cache.insert("a".to_string(), re_a);
    cache.insert("b".to_string(), re_b);
    cache.insert("c".to_string(), re_c);
    
    // Access "a" to move it to MRU
    assert!(cache.get("a").is_some());
    
    // Insert "d" -> capacity is 3, "b" is now LRU, so "b" should be evicted
    cache.insert("d".to_string(), re_d);
    
    assert!(cache.get("b").is_none());
    assert!(cache.get("a").is_some());
    assert!(cache.get("c").is_some());
    assert!(cache.get("d").is_some());
}

// ==========================================
// 4. Array Opcodes stress tests
// ==========================================

#[test]
fn test_array_in_place_mutation() {
    // Test that ArrReverse mutates in-place and returns the same list reference
    let bytecode = vec![
        OpCode::NewList as u8,
        OpCode::PushInt as u8, 1, 0, 0, 0,
        OpCode::ListPush as u8,
        OpCode::PushInt as u8, 2, 0, 0, 0,
        OpCode::ListPush as u8, // [1, 2]
        OpCode::Dup as u8, // stack: [List, List]
        OpCode::ArrReverse as u8, // reverses top. Stack: [List, List]
        OpCode::Pop as u8, // pop mutated list. Stack: [List]
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
}

#[test]
fn test_array_borrow_conflict_cyclic() {
    // Construct a cyclic list (list containing itself) via bytecode:
    // NewList, Dup, ListPush, PushInt(1), ArrFlat, Halt
    let bytecode = vec![
        OpCode::NewList as u8,
        OpCode::Dup as u8,
        OpCode::ListPush as u8, // cyclic list containing itself
        OpCode::PushInt as u8, 1, 0, 0, 0, // depth = 1
        OpCode::ArrFlat as u8,
        OpCode::Halt as u8
    ];
    let mut vm = setup_vm(bytecode);
    let res = vm.run();
    assert!(res.is_ok(), "Expected ArrFlat on cyclic list with depth 1 to succeed");

    /*
    // Construct a cyclic list and run ArrFlat with extremely large depth (50000)
    let bytecode_huge = vec![
        OpCode::NewList as u8,
        OpCode::Dup as u8,
        OpCode::ListPush as u8, // cyclic list containing itself
        OpCode::PushInt as u8, 80, 195, 0, 0, // 50000 in little endian
        OpCode::ArrFlat as u8,
        OpCode::Halt as u8
    ];
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut vm2 = setup_vm(bytecode_huge);
        let _ = vm2.run();
    }));
    assert!(result.is_err(), "Expected stack overflow or panic on infinite recursion of cyclic list");
    */
}

#[test]
fn test_array_stable_sort_nan() {
    // We want to construct array: [3.0, NaN, 1.0, -NaN, 2.0]
    // And run ArrSortNumeric
    let mut bytecode = vec![OpCode::NewList as u8];
    
    // Push 3.0, push to list
    push_float(&mut bytecode, 3.0);
    bytecode.push(OpCode::ListPush as u8);
    
    // Push NaN, push to list
    push_float(&mut bytecode, f64::NAN);
    bytecode.push(OpCode::ListPush as u8);
    
    // Push 1.0, push to list
    push_float(&mut bytecode, 1.0);
    bytecode.push(OpCode::ListPush as u8);
    
    // Push -NaN, push to list
    push_float(&mut bytecode, -f64::NAN);
    bytecode.push(OpCode::ListPush as u8);
    
    // Push 2.0, push to list
    push_float(&mut bytecode, 2.0);
    bytecode.push(OpCode::ListPush as u8);
    
    bytecode.push(OpCode::ArrSortNumeric as u8);
    bytecode.push(OpCode::Halt as u8);
    
    let mut vm = setup_vm(bytecode);
    let res = vm.run().unwrap();
    
    match res {
        Value::List(l) => {
            let vec = l.borrow();
            assert_eq!(vec.len(), 5);
            // total_cmp ordering expects: [-NaN, 1.0, 2.0, 3.0, NaN]
            assert!(match vec[0] { Value::Float(f) => f.is_nan() && f.is_sign_negative(), _ => false });
            assert_eq!(vec[1], Value::Float(1.0));
            assert_eq!(vec[2], Value::Float(2.0));
            assert_eq!(vec[3], Value::Float(3.0));
            assert!(match vec[4] { Value::Float(f) => f.is_nan() && f.is_sign_positive(), _ => false });
        }
        _ => panic!("Expected List"),
    }
}
