use std::fs;
use vm_core::wrapper::execute;

fn main() {
    let bytecode = fs::read("test.fvbc").unwrap();
    let constants = fs::read_to_string("test.const.json").unwrap();
    
    let result = execute(&bytecode, &constants, "{}");
    println!("Execution result: {}", result);
}
