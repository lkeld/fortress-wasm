use std::fs::File;
use vm_core::wrapper::execute;

#[test]
fn test_compiler_output() {
    let bytecode = std::fs::read("../../comprehensive_test.scrambled.fvbc").expect("Failed to read bytecode");
    let opcodes_json = std::fs::read_to_string("../../comprehensive_test.scrambled.opcodes.json").expect("Failed to read opcodes");
    let opcodes_arr: Vec<u8> = serde_json::from_str(&opcodes_json).expect("Failed to parse opcodes");
    
    // Parse the PNG key image to get raw RGBA pixels
    let decoder = png::Decoder::new(File::open("../../comprehensive_test.scrambled.key.png").unwrap());
    let mut reader = decoder.read_info().unwrap();
    let mut image_rgba = vec![0; reader.output_buffer_size()];
    reader.next_frame(&mut image_rgba).unwrap();
    
    let result = execute(&bytecode, &image_rgba, "{}", &opcodes_arr);
    assert_eq!(result, "100", "Comprehensive test should evaluate and return 100");
}
