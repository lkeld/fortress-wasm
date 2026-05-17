use std::fs;
use vm_core::wrapper::execute;

#[test]
fn test_compiler_output() {
    let bytecode = fs::read("../../test.fvbc").expect("Failed to read bytecode");
    let constants = fs::read_to_string("../../test.const.json").expect("Failed to read constants");
    
    let result = execute(&bytecode, &constants, "{}");
    assert_eq!(result, "120", "Factorial of 5 should be 120");
}
