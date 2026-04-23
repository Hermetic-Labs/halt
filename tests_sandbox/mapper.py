_pad = '_'
_punctuation = ';:,.!?¡¿—…"«»“” '
_letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
_letters_ipa = 'ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟɠɡɢɣɤɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘\'̩\'ᵻ'

vocab = _pad + _punctuation + _letters + _letters_ipa

# Let's map how we think the author's tensor maps to python's tensor.
# Author has:
# ; = 1
# ' ' = 16
# \u0303 = 17
# ʣ = 18, ʥ=19, ʦ=20, ʨ=21, ᵝ=22, \uAB67=23
# A = 24.
# In Python, A is 18. So the shift is exactly 6 between \u0303 and A.

# Wait, a = 43 in Rust.
# In Python, a is 18 + 26 = 44.
# Wait! If A is 24 and a is 43, the uppercase length gap is 19.
# In Python, A is 18, a is 44. Gap is 26.
# If Rust 'a' = 43, why is a=43?
# Let's see python:
# A=18, B=19, C=20 ... Z=43, a=44.
# Wait! In python, Z=43! And a=44!
# In Rust, a=43!
# This means Rust 'a' is ONE index lower than Python 'a'!
# How could a=43 in Rust?
with open("c:\\Halt\\tests_sandbox\\mapping_test.txt", "w", encoding="utf-8") as f:
    for i, c in enumerate(vocab):
        f.write(f"{c}: {i}\n")
