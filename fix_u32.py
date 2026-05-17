import re

with open('crates/vm-core/src/vm.rs', 'r') as f:
    content = f.read()

content = content.replace("let target = self.read_u32() as usize;", "let target = self.read_u32()? as usize;")
content = content.replace("let arg_count = self.read_u32() as usize;", "let arg_count = self.read_u32()? as usize;")
content = content.replace("let id = self.read_u32();", "let id = self.read_u32()?;")
content = content.replace("let key_idx = self.read_u32() as usize;", "let key_idx = self.read_u32()? as usize;")
content = content.replace("let target = self.read_u32()? as usize;", "let target = self.read_u32()? as usize;") # fix double ?? if any

with open('crates/vm-core/src/vm.rs', 'w') as f:
    f.write(content)
