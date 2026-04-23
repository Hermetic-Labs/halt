use any_ascii::any_ascii;

fn main() {
    let ar = any_ascii("يجب على جميع المسعفين");
    let ru = any_ascii("Привет мир");
    let ko = any_ascii("안녕하세요");
    
    println!("Arabic: {}", ar);
    println!("Russian: {}", ru);
    println!("Korean: {}", ko);
}
