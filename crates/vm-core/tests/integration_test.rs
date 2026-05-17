use std::fs;
use vm_core::wrapper::execute;

#[test]
fn test_compiler_output() {
    let bytecode = fs::read("../../comprehensive_test.fvbc").expect("Failed to read bytecode");
    let constants = fs::read_to_string("../../comprehensive_test.const.json").expect("Failed to read constants");
    let opcodes_json = fs::read_to_string("../../comprehensive_test.opcodes.json").expect("Failed to read opcodes");
    let opcodes_arr: Vec<u8> = serde_json::from_str(&opcodes_json).expect("Failed to parse opcodes");
    
    let result = execute(&bytecode, &constants, "{}", &opcodes_arr);
    assert_eq!(result, "100", "Comprehensive test should evaluate and return 100");
}
